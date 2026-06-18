import http from "node:http";
import { chromium } from "playwright";

// --- Реальная разметка страниц shikimori (срезы из живого сайта) ---
const PAGE_404 = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>404</title></head><body><div class="dialog"><p class="error-404">404</p><h1>Страница не найдена</h1><p>Скорее всего, ты тут из-за очепятки в адресе страницы.</p></div></body></html>`;

const PAGE_NORMAL = (title) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${title}</title></head><body class="p-animes p-animes-show"><div id="content">normal page</div></body></html>`;

// Точная копия логики точки входа из 404FIX.user.js (блок ОБРАБОТЧИКИ ДЛЯ TURBOLINKS/PJAX),
// с init, замоканным на счётчик. Всё остальное идентично продакшен-коду.
const ENTRYPOINT = `
window.__initCalls = [];
const init = (testUrl, options) => {
  window.__initCalls.push({ href: location.href, opts: options || null });
};

let __lastHandledHref = "";
const isRestorableRoute = (pathname) =>
  /^\\/(animes|mangas|ranobe)\\/[a-z0-9-]+/i.test(pathname);
const isShiki404 = () =>
  !!document.querySelector(".dialog .error-404") ||
  /^404(\\s|$)/i.test(document.title.trim());
const handleNavigation = () => {
  if (!isRestorableRoute(window.location.pathname)) return;
  if (!isShiki404()) { __lastHandledHref = ""; return; }
  const href = window.location.href;
  if (__lastHandledHref === href) return;
  __lastHandledHref = href;
  init();
};
document.addEventListener("page:load", handleNavigation);
document.addEventListener("turbolinks:load", handleNavigation);
try {
  const navObserver = new MutationObserver(handleNavigation);
  navObserver.observe(document.documentElement, { childList: true });
} catch (e) { console.error("[404FIX] observer fail:", e); }
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", handleNavigation);
} else {
  handleNavigation();
}
`;

// Симуляция Turbolinks "error render": замена <head> и <body> на месте,
// БЕЗ диспатча turbolinks:load (именно так Turbolinks обрабатывает 404).
const SWAP_HEADBODY = (html) => `
(() => {
  const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, "text/html");
  document.documentElement.replaceChild(doc.head, document.head);
  document.documentElement.replaceChild(doc.body, document.body);
})();
`;

const server = http.createServer((req, res) => {
  const path = req.url.split("?")[0];
  if (path.startsWith("/animes/") && path.includes("deleted")) {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(PAGE_404);
  } else if (path.startsWith("/animes/")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(PAGE_NORMAL("Test Anime / Аниме"));
  } else {
    res.writeHead(404);
    res.end("nope");
  }
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

const browser = await chromium.launch();
const results = [];
const assert = (name, cond, detail) =>
  results.push({ name, pass: !!cond, detail });

// ---------------------------------------------------------------
// Сценарий 1: МЯГКИЙ переход (Turbolinks). Старт на нормальной странице,
// затем error-render 404 на месте БЕЗ turbolinks:load.
// Ожидание: восстановление запускается (init вызван 1 раз).
// ---------------------------------------------------------------
{
  const page = await browser.newPage();
  await page.goto(`${base}/animes/123-test`, { waitUntil: "load" });
  // Tampermonkey инжектит на document-idle -> readyState complete:
  await page.evaluate(ENTRYPOINT);
  const before = await page.evaluate(() => window.__initCalls.length);
  // Имитируем Turbolinks 404 error-render:
  await page.evaluate(SWAP_HEADBODY(PAGE_404));
  await page.waitForTimeout(50);
  const after = await page.evaluate(() => window.__initCalls.length);
  assert(
    "Мягкий переход на 404 (Turbolinks без события) -> init вызван",
    before === 0 && after === 1,
    `before=${before} after=${after}`,
  );
  await page.close();
}

// ---------------------------------------------------------------
// Сценарий 2: ЖЁСТКАЯ загрузка 404 (F5 / ввод URL). Скрипт инжектится
// уже в готовую 404-страницу. Ожидание: init вызван 1 раз.
// ---------------------------------------------------------------
{
  const page = await browser.newPage();
  await page.goto(`${base}/animes/777-deleted`, { waitUntil: "load" });
  await page.evaluate(ENTRYPOINT);
  await page.waitForTimeout(50);
  const n = await page.evaluate(() => window.__initCalls.length);
  assert("Жёсткая загрузка 404 -> init вызван 1 раз", n === 1, `count=${n}`);
  await page.close();
}

// ---------------------------------------------------------------
// Сценарий 3: ВАЛИДНЫЙ Turbolinks-переход на существующее аниме.
// Ожидание: init НЕ вызывается (это не 404), нет ложных срабатываний.
// ---------------------------------------------------------------
{
  const page = await browser.newPage();
  await page.goto(`${base}/animes/123-test`, { waitUntil: "load" });
  await page.evaluate(ENTRYPOINT);
  await page.evaluate(SWAP_HEADBODY(PAGE_NORMAL("Another Anime / Аниме")));
  await page.waitForTimeout(50);
  const n = await page.evaluate(() => window.__initCalls.length);
  assert("Валидный переход -> init НЕ вызван", n === 0, `count=${n}`);
  await page.close();
}

// ---------------------------------------------------------------
// Сценарий 4: повторные мутации/события не вызывают двойной рендер.
// После 404-рендера ещё раз триггерим turbolinks:load и мутацию.
// Ожидание: init остаётся вызванным ровно 1 раз для того же URL.
// ---------------------------------------------------------------
{
  const page = await browser.newPage();
  await page.goto(`${base}/animes/123-test`, { waitUntil: "load" });
  await page.evaluate(ENTRYPOINT);
  await page.evaluate(SWAP_HEADBODY(PAGE_404));
  await page.waitForTimeout(30);
  await page.evaluate(() => {
    document.dispatchEvent(new Event("turbolinks:load"));
    // лишняя мутация в body
    document.body.appendChild(document.createElement("span"));
  });
  await page.waitForTimeout(50);
  const n = await page.evaluate(() => window.__initCalls.length);
  assert("Нет двойного запуска на тот же URL", n === 1, `count=${n}`);
  await page.close();
}

await browser.close();
server.close();

console.log("\n=== РЕЗУЛЬТАТЫ ===");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}  (${r.detail})`);
  if (!r.pass) ok = false;
}
console.log(ok ? "\nВСЕ ТЕСТЫ ПРОЙДЕНЫ" : "\nЕСТЬ ПРОВАЛЫ");
process.exit(ok ? 0 : 1);
