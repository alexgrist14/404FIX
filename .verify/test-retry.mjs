import { chromium } from "playwright";

// Точные копии withRetry/isRetryable и fetchGQL из 404FIX.user.js.
// log заменён на no-op, fetchWithTimeout -> глобальный мок window.__fetch.
const HARNESS = `
const log = () => {};
const fetchWithTimeout = (...a) => window.__fetch(...a);

const isRetryable = (err) => {
  const msg = err && err.message ? err.message : "";
  if (/timeout|Failed to fetch|NetworkError|load failed|terminated/i.test(msg)) return true;
  const status = err && err.status;
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  if (/GQL errors/i.test(msg)) return true;
  return false;
};
const withRetry = async (fn, { retries = 3, baseDelay = 400, label = "request" } = {}) => {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(attempt); }
    catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) break;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
};

const makeFetchGQL = (id) => (query) =>
  withRetry(async () => {
    const response = await fetchWithTimeout("/api/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { id: String(id) } }),
    });
    if (!response.ok) {
      const e = new Error('GQL HTTP ' + response.status);
      e.status = response.status;
      throw e;
    }
    const json = await response.json();
    if (json && json.errors && (!json.data || Object.keys(json.data).length === 0)) {
      throw new Error('GQL errors: ' + JSON.stringify(json.errors).slice(0,200));
    }
    return json;
  }, { label: "GraphQL", retries: 3, baseDelay: 5 }); // baseDelay 5мс чтобы тест шёл быстро

window.__makeFetchGQL = makeFetchGQL;
`;

// Мок ответа fetch
const resp = (ok, status, body) => ({
  ok,
  status,
  json: async () => body,
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");
await page.evaluate(HARNESS);

const results = [];
const assert = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

// Каждый тест задаёт очередь ответов/ошибок; мок отдаёт их по очереди и считает вызовы.
const run = (name, script) => page.evaluate(script).then((r) => ({ name, ...r }));

// 1. Два 503, затем успех -> вернулись данные, 3 вызова fetch.
{
  const r = await page.evaluate(async () => {
    let calls = 0;
    const seq = [
      () => { const e = new Error("GQL HTTP 503"); e.status = 503; throw e; },
      () => { const e = new Error("GQL HTTP 503"); e.status = 503; throw e; },
      () => ({ ok: true, status: 200, json: async () => ({ data: { animes: [{ id: 1 }] } }) }),
    ];
    window.__fetch = async () => { const f = seq[calls++]; return f(); };
    const gql = window.__makeFetchGQL(1);
    let out, err = null;
    try { out = await gql("q"); } catch (e) { err = e.message; }
    return { calls, ok: !!(out && out.data), err };
  });
  assert("503,503 -> успех после ретраев (3 вызова, есть data)", r.calls === 3 && r.ok && !r.err, JSON.stringify(r));
}

// 2. 400 (детерминированная) -> без ретраев, 1 вызов, бросает.
{
  const r = await page.evaluate(async () => {
    let calls = 0;
    window.__fetch = async () => { calls++; return { ok: false, status: 400, json: async () => ({}) }; };
    const gql = window.__makeFetchGQL(1);
    let err = null;
    try { await gql("q"); } catch (e) { err = e.message; }
    return { calls, err };
  });
  assert("400 -> НЕ повторяется (1 вызов, ошибка)", r.calls === 1 && !!r.err, JSON.stringify(r));
}

// 3. 200 с errors/без data дважды, затем валидный -> ретраи, 3 вызова.
{
  const r = await page.evaluate(async () => {
    let calls = 0;
    const seq = [
      { ok: true, status: 200, json: async () => ({ errors: [{ message: "x" }] }) },
      { ok: true, status: 200, json: async () => ({ errors: [{ message: "x" }], data: {} }) },
      { ok: true, status: 200, json: async () => ({ data: { animes: [{ id: 1 }] } }) },
    ];
    window.__fetch = async () => seq[calls++];
    const gql = window.__makeFetchGQL(1);
    let out, err = null;
    try { out = await gql("q"); } catch (e) { err = e.message; }
    return { calls, ok: !!(out && out.data), err };
  });
  assert("GraphQL errors в теле -> повтор до успеха (3 вызова)", r.calls === 3 && r.ok && !r.err, JSON.stringify(r));
}

// 4. 429 на всех попытках -> исчерпание (4 вызова: 1 + 3 ретрая), бросает.
{
  const r = await page.evaluate(async () => {
    let calls = 0;
    window.__fetch = async () => { calls++; return { ok: false, status: 429, json: async () => ({}) }; };
    const gql = window.__makeFetchGQL(1);
    let err = null;
    try { await gql("q"); } catch (e) { err = e.message; }
    return { calls, err };
  });
  assert("429 постоянно -> 4 попытки и ошибка", r.calls === 4 && /429/.test(r.err || ""), JSON.stringify(r));
}

// 5. Сетевой сбой (Failed to fetch) один раз, затем успех -> ретрай.
{
  const r = await page.evaluate(async () => {
    let calls = 0;
    const seq = [
      () => { throw new Error("Failed to fetch"); },
      () => ({ ok: true, status: 200, json: async () => ({ data: { animes: [{}] } }) }),
    ];
    window.__fetch = async () => seq[calls++]();
    const gql = window.__makeFetchGQL(1);
    let out, err = null;
    try { out = await gql("q"); } catch (e) { err = e.message; }
    return { calls, ok: !!(out && out.data), err };
  });
  assert("Сетевой сбой -> повтор и успех (2 вызова)", r.calls === 2 && r.ok && !r.err, JSON.stringify(r));
}

await browser.close();

console.log("\n=== РЕЗУЛЬТАТЫ (retry) ===");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}  ${r.pass ? "" : "-> " + r.detail}`);
  if (!r.pass) ok = false;
}
console.log(ok ? "\nВСЕ ТЕСТЫ ПРОЙДЕНЫ" : "\nЕСТЬ ПРОВАЛЫ");
process.exit(ok ? 0 : 1);
