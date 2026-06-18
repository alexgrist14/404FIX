import http from "node:http";
import { chromium } from "playwright";

// Сервер считает запросы по путям (реальная перезагрузка = новый запрос).
const counts = {};
// Встроенная в страницу ТОЧНАЯ логика popstate-guard из 404FIX.user.js.
const HARNESS_HTML = `<!DOCTYPE html><html><body>page<script>
window.__popstateFired = 0;
let __spaDestroyed = false;
window.__setDestroyed = (v) => { __spaDestroyed = v; };
const onPopState = () => { window.__popstateFired++; if (__spaDestroyed) location.reload(); };
const installPopstateGuard = () => window.addEventListener("popstate", onPopState);
installPopstateGuard();
</script></body></html>`;

const server = http.createServer((req, res) => {
  const p = req.url.split("?")[0];
  counts[p] = (counts[p] || 0) + 1;
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(HARNESS_HTML);
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const base = `http://localhost:${PORT}`;

const browser = await chromium.launch();
const results = [];
const assert = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

// --- Тест 1: SPA уничтожен -> Назад делает полную перезагрузку (новый запрос /a) ---
{
  for (const k in counts) delete counts[k];
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/a`, { waitUntil: "load" }); // запрос /a #1
  // Имитируем перехват клика + document.write: pushState на /b и пометку "SPA мёртв".
  await page.evaluate(() => {
    history.pushState({ fix404: true }, "", "/b");
    window.__setDestroyed(true);
  });
  const aBefore = counts["/a"] || 0;
  await page.goBack(); // popstate -> onPopState -> location.reload()
  await page.waitForLoadState("load");
  await page.waitForTimeout(100);
  const aAfter = counts["/a"] || 0;
  const url = new URL(page.url()).pathname;
  assert(
    "SPA мёртв: Назад -> полная перезагрузка (/a запрошен заново) + URL=/a",
    aAfter === aBefore + 1 && url === "/a",
    `aBefore=${aBefore} aAfter=${aAfter} url=${url}`,
  );
  await ctx.close();
}

// --- Тест 2: SPA жив (__spaDestroyed=false) -> Назад НЕ перезагружает (Turbolinks бы обработал) ---
{
  for (const k in counts) delete counts[k];
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/a`, { waitUntil: "load" }); // /a #1
  await page.evaluate(() => {
    history.pushState({}, "", "/b");
    // __spaDestroyed остаётся false (обычная страница, мы ничего не ломали)
  });
  const aBefore = counts["/a"] || 0;
  await page.goBack(); // popstate -> onPopState -> НЕ reload
  await page.waitForTimeout(150);
  const aAfter = counts["/a"] || 0;
  const fired = await page.evaluate(() => window.__popstateFired);
  const url = new URL(page.url()).pathname;
  assert(
    "SPA жив: Назад НЕ перезагружает (нет нового запроса), popstate отработал",
    aAfter === aBefore && fired === 1 && url === "/a",
    `aBefore=${aBefore} aAfter=${aAfter} fired=${fired} url=${url}`,
  );
  await ctx.close();
}

await browser.close();
server.close();
console.log("\n=== РЕЗУЛЬТАТЫ (кнопка Назад) ===");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}  ${r.pass ? "" : "-> " + r.detail}`);
  if (!r.pass) ok = false;
}
console.log(ok ? "\nВСЕ ТЕСТЫ ПРОЙДЕНЫ" : "\nЕСТЬ ПРОВАЛЫ");
process.exit(ok ? 0 : 1);
