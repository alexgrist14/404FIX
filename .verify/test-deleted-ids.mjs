import http from "node:http";
import { chromium } from "playwright";

// Мок-список удалённых ID + страница на реальном http-origin (нужно для localStorage и new URL).
const LIST = { anime: [900, 901, 1626], manga: [50, 14166] };
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/deleted-ids.json")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ generated_at: "x", anime: LIST.anime, manga: LIST.manga }));
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!DOCTYPE html><html><body></body></html>");
  }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

// Точные копии функций из 404FIX.user.js (зависимости замоканы).
const HARNESS = (port) => `
const log = () => {}, debug = () => {}, error = () => {};
const CONFIG = {
  DELETED_IDS_URL: "http://localhost:${port}/deleted-ids.json",
  DELETED_IDS_TTL: 7 * 24 * 60 * 60 * 1000,
  INTERCEPT_KNOWN_DELETED: true,
};
window.__fetchCount = 0;
const fetchWithTimeout = async (url) => {
  window.__fetchCount++;
  const r = await fetch(url);
  return r;
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
  const displayType = typePlural === "ranobe" ? "ranobe" : type;
  return { id: idMatch[1], type, displayType };
};

const DELETED_IDS_CACHE_KEY = "fix404_deleted_ids_v1";
let __deletedSets = null;
const loadDeletedIds = async () => {
  if (__deletedSets) return __deletedSets;
  try {
    const raw = localStorage.getItem(DELETED_IDS_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && Date.now() - cached.ts < CONFIG.DELETED_IDS_TTL) {
        __deletedSets = { anime: new Set(cached.anime), manga: new Set(cached.manga) };
        return __deletedSets;
      }
    }
  } catch (e) {}
  try {
    const res = await fetchWithTimeout(CONFIG.DELETED_IDS_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const anime = Array.isArray(data.anime) ? data.anime : [];
    const manga = Array.isArray(data.manga) ? data.manga : [];
    __deletedSets = { anime: new Set(anime), manga: new Set(manga) };
    try { localStorage.setItem(DELETED_IDS_CACHE_KEY, JSON.stringify({ ts: Date.now(), anime, manga })); } catch (e) {}
    return __deletedSets;
  } catch (e) {
    __deletedSets = { anime: new Set(), manga: new Set() };
    return __deletedSets;
  }
};
const isListLoaded = () => __deletedSets !== null && (__deletedSets.anime.size > 0 || __deletedSets.manga.size > 0);
const isKnownDeleted = (id, type) => {
  if (!__deletedSets) return false;
  const set = type === "anime" ? __deletedSets.anime : __deletedSets.manga;
  return set.has(Number(id));
};

// prefetch: stub prefetchEntity-счётчик + точная prefetchFromHref
window.__prefetched = [];
const prefetchEntity = (id, type) => { window.__prefetched.push(type + "_" + id); };
const prefetchFromHref = (href) => {
  const parsed = parseEntityLink(href);
  if (!parsed) return;
  if (isListLoaded() && !isKnownDeleted(parsed.id, parsed.type)) return;
  prefetchEntity(parsed.id, parsed.type);
};

// click-перехват: stub renderEntityPage/showLoader + точный обработчик
window.__rendered = null;
const renderEntityPage = (id, type, displayType) => { window.__rendered = { id, type, displayType }; };
const showLoader = () => {};
let __lastHandledHref = "";
const linkFrom = (e) => (e.target && e.target.closest ? e.target.closest("a[href]") : null);

document.addEventListener("click", (e) => {
  if (!CONFIG.INTERCEPT_KNOWN_DELETED) return;
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = linkFrom(e);
  if (!a || a.target === "_blank") return;
  const href = a.getAttribute("href");
  const parsed = parseEntityLink(href);
  if (!parsed || !isKnownDeleted(parsed.id, parsed.type)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const absUrl = new URL(href, location.origin).href;
  try { history.pushState({ fix404: true }, "", absUrl); } catch (err) {}
  __lastHandledHref = location.href;
  if (typeof showLoader === "function") showLoader();
  renderEntityPage(parsed.id, parsed.type, parsed.displayType);
}, true);

// Предохранитель ТОЛЬКО для теста: ловим клики, не перехваченные нашим обработчиком
// (наш на intercepted делает stopImmediatePropagation -> сюда не дойдёт), запоминаем,
// прервал ли НАШ обработчик дефолт, и гасим реальную навигацию, чтобы не рушить контекст.
window.__navPreventedByUs = null;
document.addEventListener("click", (e) => {
  window.__navPreventedByUs = e.defaultPrevented;
  e.preventDefault();
}, false);

Object.assign(window, { loadDeletedIds, isListLoaded, isKnownDeleted, prefetchFromHref, parseEntityLink });
`;

const browser = await chromium.launch();
const context = await browser.newContext(); // общий контекст -> общий localStorage
const page = await context.newPage();
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(HARNESS(PORT));

const results = [];
const assert = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

// 1. Загрузка списка из сети + кеш в localStorage; повторная загрузка -> 0 fetch.
{
  const r = await page.evaluate(async () => {
    window.__fetchCount = 0;
    await window.loadDeletedIds();
    const after1 = window.__fetchCount;
    const loaded = window.isListLoaded();
    // второй вызов — из памяти (0 fetch)
    await window.loadDeletedIds();
    const after2 = window.__fetchCount;
    const hasCache = !!localStorage.getItem("fix404_deleted_ids_v1");
    return { after1, after2, loaded, hasCache };
  });
  assert("Список: сеть 1 раз, кеш в localStorage, повтор без fetch", r.after1 === 1 && r.after2 === 1 && r.loaded && r.hasCache, JSON.stringify(r));
}

// 1b. Новая страница в ТОМ ЖЕ контексте (общий localStorage) -> 0 сетевых запросов.
{
  const page2 = await context.newPage();
  await page2.goto(`http://localhost:${PORT}/`);
  await page2.evaluate(HARNESS(PORT));
  const r = await page2.evaluate(async () => {
    window.__fetchCount = 0;
    await window.loadDeletedIds();
    return { fetches: window.__fetchCount, loaded: window.isListLoaded() };
  });
  assert("Список: новая сессия читает localStorage-кеш (0 fetch)", r.fetches === 0 && r.loaded, JSON.stringify(r));
  await page2.close();
}

// 2. isKnownDeleted: по типу и id (с приведением строки к числу).
{
  const r = await page.evaluate(() => ({
    a900: window.isKnownDeleted("900", "anime"),   // да
    a999: window.isKnownDeleted("999", "anime"),   // нет
    m50: window.isKnownDeleted("50", "manga"),     // да
    m900: window.isKnownDeleted("900", "manga"),   // нет (900 в anime, не в manga)
  }));
  assert("isKnownDeleted: точная проверка по типу+id", r.a900 && !r.a999 && r.m50 && !r.m900, JSON.stringify(r));
}

// 3. Точечный префетч: удалённый греется, живой — нет.
{
  const r = await page.evaluate(() => {
    window.__prefetched = [];
    window.prefetchFromHref("/animes/900-deleted"); // в списке -> префетч
    window.prefetchFromHref("/animes/999-alive");   // нет в списке -> пропуск
    window.prefetchFromHref("/mangas/50-deleted");  // в списке -> префетч
    return window.__prefetched;
  });
  const ok = r.includes("anime_900") && r.includes("manga_50") && !r.includes("anime_999");
  assert("Точечный префетч: только удалённые, живые пропущены", ok, JSON.stringify(r));
}

// 4. Перехват клика по удалённой ссылке: рендер вызван + URL изменён (pushState).
{
  const r = await page.evaluate(() => {
    window.__rendered = null;
    window.__navPreventedByUs = null;
    document.body.innerHTML = '<a id="del" href="/animes/901-x">t</a>';
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    const notCancelled = document.getElementById("del").dispatchEvent(evt); // false = preventDefault
    return { prevented: !notCancelled, rendered: window.__rendered, url: location.pathname };
  });
  const ok = r.prevented && r.rendered && r.rendered.id === "901" && r.rendered.type === "anime" && r.url === "/animes/901-x";
  assert("Клик по удалённому: переход отменён, рендер + pushState", ok, JSON.stringify(r));
}

// 5. Клик по ЖИВОЙ ссылке: НЕ перехватываем (наш обработчик не трогает дефолт).
{
  const r = await page.evaluate(() => {
    window.__rendered = null;
    window.__navPreventedByUs = null;
    document.body.innerHTML = '<a id="alive" href="/animes/999-alive">t</a>';
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    document.getElementById("alive").dispatchEvent(evt);
    return { ourPrevent: window.__navPreventedByUs, rendered: window.__rendered };
  });
  assert("Клик по живому тайтлу: НЕ перехвачен", r.ourPrevent === false && !r.rendered, JSON.stringify(r));
}

// 6. Ctrl+клик по удалённому (новая вкладка): НЕ перехватываем.
{
  const r = await page.evaluate(() => {
    window.__rendered = null;
    window.__navPreventedByUs = null;
    document.body.innerHTML = '<a id="ctrl" href="/animes/900-x">t</a>';
    const evt = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    document.getElementById("ctrl").dispatchEvent(evt);
    return { ourPrevent: window.__navPreventedByUs, rendered: window.__rendered };
  });
  assert("Ctrl+клик (новая вкладка): НЕ перехвачен", r.ourPrevent === false && !r.rendered, JSON.stringify(r));
}

await browser.close();
server.close();
console.log("\n=== РЕЗУЛЬТАТЫ (deleted-ids + перехват) ===");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}  ${r.pass ? "" : "-> " + r.detail}`);
  if (!r.pass) ok = false;
}
console.log(ok ? "\nВСЕ ТЕСТЫ ПРОЙДЕНЫ" : "\nЕСТЬ ПРОВАЛЫ");
process.exit(ok ? 0 : 1);
