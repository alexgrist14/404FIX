import http from "node:http";
import { chromium } from "playwright";

// Реальный http-origin, чтобы location.origin был валиден (about:blank даёт "null").
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<!DOCTYPE html><html><body></body></html>");
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

// Точные копии функций префетча из 404FIX.user.js.
// Зависимости замоканы по минимуму: gqlCache -> Map, fetchWithTimeout -> window.__fetch,
// GraphQL-константы -> строки, log/debug -> no-op.
const HARNESS = `
const log = () => {}, debug = () => {};
const CONFIG = { USER_AGENT: "test" };
const GRAPHQL_QUERY_ANIME_MAIN = "AM", GRAPHQL_QUERY_ANIME_DETAILS = "AD";
const GRAPHQL_QUERY_MANGA_MAIN = "MM", GRAPHQL_QUERY_MANGA_DETAILS = "MD";
const fetchWithTimeout = (...a) => window.__fetch(...a);
const _map = new Map();
const gqlCache = { get: (k) => _map.get(k), set: (k, v) => _map.set(k, v) };

const isRetryable = (err) => {
  const msg = err && err.message ? err.message : "";
  if (/timeout|Failed to fetch|NetworkError|load failed|terminated/i.test(msg)) return true;
  const status = err && err.status;
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  if (/GQL errors/i.test(msg)) return true;
  return false;
};
const withRetry = async (fn, { retries = 3, baseDelay = 5, label = "r" } = {}) => {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(attempt); }
    catch (err) { lastErr = err; if (attempt === retries || !isRetryable(err)) break;
      await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt))); }
  }
  throw lastErr;
};

const runGraphQL = (query, id) =>
  withRetry(async () => {
    const response = await fetchWithTimeout("/api/graphql", {
      method: "POST", headers: {}, body: JSON.stringify({ query, variables: { id: String(id) } }),
    });
    if (!response.ok) { const e = new Error('GQL HTTP ' + response.status); e.status = response.status; throw e; }
    const json = await response.json();
    if (json && json.errors && (!json.data || Object.keys(json.data).length === 0))
      throw new Error('GQL errors: ' + JSON.stringify(json.errors).slice(0,200));
    return json;
  }, { label: "GraphQL", retries: 3, baseDelay: 5 });

const __gqlInFlight = new Map();
const loadHeavyGQL = (id, type) => {
  const key = type + "_" + id;
  const cached = gqlCache.get(key);
  if (cached) return Promise.resolve(cached);
  if (__gqlInFlight.has(key)) return __gqlInFlight.get(key);
  const isAnime = type === "anime";
  const queryMain = isAnime ? GRAPHQL_QUERY_ANIME_MAIN : GRAPHQL_QUERY_MANGA_MAIN;
  const queryDetails = isAnime ? GRAPHQL_QUERY_ANIME_DETAILS : GRAPHQL_QUERY_MANGA_DETAILS;
  const p = Promise.all([runGraphQL(queryMain, id), runGraphQL(queryDetails, id)])
    .then(([main, details]) => { const result = { main, details }; gqlCache.set(key, result); return result; })
    .finally(() => __gqlInFlight.delete(key));
  __gqlInFlight.set(key, p);
  return p;
};

let __assetsPromise = null;
window.__assetsFetches = 0;
const getPageAssets = async () => { window.__assetsFetches++; return { FETCHED_CSS: "css", CSRF_TOKEN: "t" }; };
const getPageAssetsCached = () => {
  if (__assetsPromise) return __assetsPromise;
  __assetsPromise = getPageAssets().then((assets) => {
    if (!assets || (!assets.FETCHED_CSS && !assets.CSRF_TOKEN)) __assetsPromise = null;
    return assets;
  }).catch((e) => { __assetsPromise = null; throw e; });
  return __assetsPromise;
};

const parseEntityLink = (href) => {
  let pathname;
  try { pathname = new URL(href, location.origin).pathname; } catch (e) { return null; }
  const m = pathname.match(/^\\/(animes|mangas|ranobe)\\/([a-z0-9-]+)/i);
  if (!m) return null;
  const idMatch = m[2].match(/^(?:z)?(\\d+)(?:-|$)/i);
  if (!idMatch) return null;
  const typePlural = m[1].toLowerCase();
  const type = typePlural === "ranobe" ? "manga" : typePlural.slice(0, -1);
  return { id: idMatch[1], type };
};

const PREFETCH_MAX_INFLIGHT = 4;
const prefetchEntity = (id, type) => {
  const key = type + "_" + id;
  getPageAssetsCached().catch(() => {});
  if (gqlCache.get(key) || __gqlInFlight.has(key)) return;
  if (__gqlInFlight.size >= PREFETCH_MAX_INFLIGHT) return;
  loadHeavyGQL(id, type).catch((e) => debug("prefetch fail " + key + " " + e.message));
};
const prefetchFromHref = (href) => { const parsed = parseEntityLink(href); if (parsed) prefetchEntity(parsed.id, parsed.type); };

// --- слушатели (точная копия) ---
let __hoverTimer = null, __hoverHref = "";
const linkFrom = (e) => (e.target && e.target.closest ? e.target.closest("a[href]") : null);
document.addEventListener("mouseover", (e) => {
  const a = linkFrom(e); if (!a) return;
  const href = a.getAttribute("href");
  if (!href || href === __hoverHref || !parseEntityLink(href)) return;
  __hoverHref = href; clearTimeout(__hoverTimer);
  __hoverTimer = setTimeout(() => prefetchFromHref(href), 80);
});
document.addEventListener("mouseout", (e) => {
  const a = linkFrom(e);
  if (a && a.getAttribute("href") === __hoverHref) { clearTimeout(__hoverTimer); __hoverHref = ""; }
});
document.addEventListener("mousedown", (e) => { const a = linkFrom(e); if (a) prefetchFromHref(a.getAttribute("href") || ""); }, true);

// экспорт для тестов
Object.assign(window, { loadHeavyGQL, parseEntityLink, prefetchEntity, getPageAssetsCached, gqlCache, __gqlInFlight });
window.__resetFetchCounter = () => { window.__fetchCalls = 0; };
window.__fetchCalls = 0;
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(HARNESS);

const results = [];
const assert = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

// 1. Дедуп: два одновременных loadHeavyGQL -> один сетевой запрос (2 fetch на main+details).
{
  const r = await page.evaluate(async () => {
    window.__fetchCalls = 0;
    window.__fetch = async () => { window.__fetchCalls++; return { ok: true, status: 200, json: async () => ({ data: { animes: [{}] } }) }; };
    const [a, b] = await Promise.all([window.loadHeavyGQL("100", "anime"), window.loadHeavyGQL("100", "anime")]);
    return { fetches: window.__fetchCalls, same: a === b };
  });
  assert("Дедуп: 2 параллельных запроса -> 1 загрузка (2 fetch) и общий результат", r.fetches === 2 && r.same, JSON.stringify(r));
}

// 2. Кеш: повторный loadHeavyGQL того же id -> 0 новых fetch.
{
  const r = await page.evaluate(async () => {
    window.__fetchCalls = 0;
    await window.loadHeavyGQL("100", "anime"); // уже в кеше с теста 1
    return { fetches: window.__fetchCalls };
  });
  assert("Кеш: повторная загрузка -> 0 сетевых запросов", r.fetches === 0, JSON.stringify(r));
}

// 3. parseEntityLink: относительные/абсолютные/ranobe/мусор.
{
  const r = await page.evaluate(() => ({
    rel: window.parseEntityLink("/animes/555-x"),
    abs: window.parseEntityLink(location.origin + "/mangas/777-y"),
    ranobe: window.parseEntityLink("/ranobe/12-z"),
    bad: window.parseEntityLink("/forum/123"),
    nojunk: window.parseEntityLink("/animes/no-id-here"),
  }));
  const ok =
    r.rel && r.rel.id === "555" && r.rel.type === "anime" &&
    r.abs && r.abs.id === "777" && r.abs.type === "manga" &&
    r.ranobe && r.ranobe.id === "12" && r.ranobe.type === "manga" &&
    r.bad === null && r.nojunk === null;
  assert("parseEntityLink: rel/abs/ranobe->manga/мусор", ok, JSON.stringify(r));
}

// 4. Hover: префетч срабатывает после 80мс; уход курсора до 80мс отменяет.
{
  const r = await page.evaluate(async () => {
    document.body.innerHTML = '<a id="lnk" href="/animes/900-test">title</a>';
    window.__fetch = async () => { window.__fetchCalls++; return { ok: true, status: 200, json: async () => ({ data: { animes: [{}] } }) }; };

    // 4a: hover и уход до 80мс -> без префетча
    window.__fetchCalls = 0;
    const lnk = document.getElementById("lnk");
    lnk.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    lnk.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const cancelled = window.__fetchCalls;

    // 4b: hover и ожидание -> префетч (id 900 ещё не в кеше)
    window.__fetchCalls = 0;
    lnk.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const fired = window.__fetchCalls;
    return { cancelled, fired };
  });
  assert("Hover: уход до 80мс отменяет, ожидание запускает префетч", r.cancelled === 0 && r.fired === 2, JSON.stringify(r));
}

// 5. mousedown: префетч сразу (новый id 901).
{
  const r = await page.evaluate(async () => {
    document.body.innerHTML = '<a id="lnk2" href="/animes/901-test">t</a>';
    window.__fetchCalls = 0;
    window.__fetch = async () => { window.__fetchCalls++; return { ok: true, status: 200, json: async () => ({ data: { animes: [{}] } }) }; };
    document.getElementById("lnk2").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    return { fetches: window.__fetchCalls };
  });
  assert("mousedown -> мгновенный префетч (2 fetch)", r.fetches === 2, JSON.stringify(r));
}

// 6. Ассеты донора кешируются на сессию (повторные вызовы -> 1 реальный fetch).
{
  const r = await page.evaluate(async () => {
    const before = window.__assetsFetches;
    await Promise.all([window.getPageAssetsCached(), window.getPageAssetsCached(), window.getPageAssetsCached()]);
    return { delta: window.__assetsFetches - before };
  });
  assert("Ассеты донора: кеш на сессию (1 fetch на много вызовов)", r.delta <= 1, JSON.stringify(r));
}

await browser.close();
server.close();
console.log("\n=== РЕЗУЛЬТАТЫ (prefetch) ===");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}  ${r.pass ? "" : "-> " + r.detail}`);
  if (!r.pass) ok = false;
}
console.log(ok ? "\nВСЕ ТЕСТЫ ПРОЙДЕНЫ" : "\nЕСТЬ ПРОВАЛЫ");
process.exit(ok ? 0 : 1);
