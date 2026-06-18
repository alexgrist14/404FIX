import { chromium } from "playwright";

const HARNESS = `
const debug=()=>{};
const POSTER_MISSING_MAIN_RE = /\\/assets\\/globals\\/missing\\/main(@2x)?\\.png/;
const POSTER_MISSING_CATALOG_RE = /\\/assets\\/globals\\/missing\\/preview_animanga(@2x)?\\.png/;
window.__fetchCalls = [];
const fetchPosterPic = async (id, kind) => { window.__fetchCalls.push(kind+":"+id); return { large:"https://x/L.jpg", medium:"https://x/M.jpg" }; };

// === точные копии fixCensoredImg / scanForCensored / setupTooltipPosterFix ===
const fixCensoredImg = (img) => {
  if (!img || img.dataset.fix404Poster) return;
  img.dataset.fix404Poster = "1";
  const tip = img.closest(".b-catalog_entry-tooltip");
  let el = img;
  for (let i=0; el && i<6; i++) {
    if (el.classList) el.classList.remove("is-moderation_censored");
    if (el.style && el.style.setProperty) el.style.setProperty("filter","none","important");
    if (el === tip || el === document.body) break;
    el = el.parentElement;
  }
  const scope = tip || img.parentElement || img;
  const link = (scope.querySelector && scope.querySelector('a.image-link[href], a[href*="/animes/"], a[href*="/mangas/"], a[href*="/ranobe/"]')) || img.closest("a[href]");
  const href = (link && link.getAttribute("href")) || "";
  const m = href.match(/\\/(animes|mangas|ranobe)\\/(\\d+)/);
  if (!m) return;
  const kind = m[1]==="animes"?"anime":m[1]==="mangas"?"manga":"ranobe";
  fetchPosterPic(m[2], kind).then((pic)=>{ if(!pic)return; img.src=pic.medium; img.srcset=pic.large+" 2x, "+pic.medium+" 1x"; img.removeAttribute("data-src"); const p=img.closest("picture"); if(p)p.querySelectorAll("source").forEach(s=>s.remove()); });
};
const scanForCensored = (root) => {
  if (!root || root.nodeType !== 1) return;
  if (root.matches && root.matches("img.is-moderation_censored")) fixCensoredImg(root);
  if (!root.querySelectorAll) return;
  root.querySelectorAll("img.is-moderation_censored").forEach(fixCensoredImg);
  root.querySelectorAll(".b-catalog_entry-tooltip img").forEach((im)=>{ const s=im.getAttribute("src")||""; if(POSTER_MISSING_MAIN_RE.test(s)||POSTER_MISSING_CATALOG_RE.test(s))fixCensoredImg(im); });
};
let tooltipObserver=null;
const setupTooltipPosterFix=()=>{ if(tooltipObserver)return; tooltipObserver=new MutationObserver((muts)=>{ for(const mut of muts){ for(const node of mut.addedNodes) scanForCensored(node); } }); tooltipObserver.observe(document.body,{childList:true,subtree:true}); scanForCensored(document.body); };

// CSS-блюр цензуры (как у shikimori, в lazy-чанке) — на картинке И на контейнере
const style = document.createElement("style");
style.textContent = ".is-moderation_censored{filter:blur(8px)!important} .blurred-parent{filter:blur(8px)}";
document.head.appendChild(style);

setupTooltipPosterFix();
window.__cf = (sel) => getComputedStyle(document.querySelector(sel)).filter;
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");
await page.evaluate(HARNESS);

const results = [];
const assert = (name, cond, detail) => results.push({ name, pass: !!cond, detail });
const wait = (ms) => page.waitForTimeout(ms);

// Заранее создаём ПУСТОЙ переиспользуемый контейнер тултипа (как делает shikimori).
await page.evaluate(() => {
  const t = document.createElement("div");
  t.className = "b-catalog_entry-tooltip";
  t.id = "reused-tip";
  document.body.appendChild(t);
});
await wait(30);

// 1. Переиспользование: заполняем innerHTML цензур-картинкой -> наблюдатель чинит.
{
  await page.evaluate(() => {
    document.getElementById("reused-tip").innerHTML =
      '<a class="image-link" href="/animes/14129-starless"><picture><source srcset="real.webp" type="image/webp"><img class="is-moderation_censored" src="https://shikimori.io/uploads/poster/animes/14129/preview_alt.jpeg"></picture></a>';
  });
  await wait(100);
  const r = await page.evaluate(() => {
    const img = document.querySelector("#reused-tip img");
    return { censored: img.classList.contains("is-moderation_censored"), computedFilter: getComputedStyle(img).filter, src: img.getAttribute("src"), source: !!document.querySelector("#reused-tip picture source"), calls: window.__fetchCalls };
  });
  assert("Переиспользуемый тултип: картинка поймана, блюр снят (filter none)",
    !r.censored && r.computedFilter === "none", JSON.stringify({censored:r.censored,filter:r.computedFilter}));
  assert("Постер заменён на Jikan + <source> удалён + запрос anime:14129",
    r.src === "https://x/M.jpg" && !r.source && r.calls.includes("anime:14129"), JSON.stringify({src:r.src,source:r.source}));
}

// 2. Повторное заполнение того же контейнера (другой тайтл) -> снова чинится.
{
  await page.evaluate(() => {
    document.getElementById("reused-tip").innerHTML =
      '<a class="image-link" href="/mangas/89548-x"><img class="is-moderation_censored" src="https://shikimori.io/uploads/poster/mangas/89548/preview_alt.jpeg"></a>';
  });
  await wait(100);
  const r = await page.evaluate(() => {
    const img = document.querySelector("#reused-tip img");
    return { filter: getComputedStyle(img).filter, src: img.getAttribute("src"), calls: window.__fetchCalls.slice(-1)[0] };
  });
  assert("Повторное заполнение тултипа: снова разблюрено + Jikan (manga:89548)",
    r.filter === "none" && r.src === "https://x/M.jpg" && r.calls === "manga:89548", JSON.stringify(r));
}

// 3. Блюр на РОДИТЕЛЕ (не на img) -> тоже снимается у предков.
{
  await page.evaluate(() => {
    const t = document.createElement("div");
    t.className = "b-catalog_entry-tooltip";
    t.id = "parent-blur-tip";
    t.innerHTML = '<a class="image-link blurred-parent" href="/animes/100-x"><img src="https://shikimori.io/uploads/poster/animes/100/preview_alt.jpeg"></a>';
    document.body.appendChild(t);
    // у img нет класса censored -> сами вызовем как при missing? тут проверяем именно снятие блюра у родителя,
    // поэтому пометим img censored, чтобы наблюдатель его поймал:
    document.querySelector("#parent-blur-tip img").classList.add("is-moderation_censored");
    // повторно добавим, чтобы сработал наблюдатель на добавление
    const im = document.querySelector("#parent-blur-tip img");
    im.remove(); document.querySelector("#parent-blur-tip a").appendChild(im);
  });
  await wait(100);
  const r = await page.evaluate(() => ({
    parentFilter: getComputedStyle(document.querySelector("#parent-blur-tip a")).filter,
    imgFilter: getComputedStyle(document.querySelector("#parent-blur-tip img")).filter,
  }));
  assert("Блюр на родителе снят (filter none у .image-link)", r.parentFilter === "none" && r.imgFilter === "none", JSON.stringify(r));
}

// 4. Идемпотентность.
{
  const r = await page.evaluate(() => {
    const img = document.querySelector("#reused-tip img");
    const before = window.__fetchCalls.length;
    img.dispatchEvent(new Event("x"));
    // повторный ручной вызов через повторное добавление не должен дублировать (dataset)
    return { done: img.dataset.fix404Poster, };
  });
  assert("Идемпотентность (dataset.fix404Poster выставлен)", r.done === "1", JSON.stringify(r));
}

await browser.close();
console.log("\n=== РЕЗУЛЬТАТЫ (постер в тултипе) ===");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}  ${r.pass ? "" : "-> " + r.detail}`);
  if (!r.pass) ok = false;
}
console.log(ok ? "\nВСЕ ТЕСТЫ ПРОЙДЕНЫ" : "\nЕСТЬ ПРОВАЛЫ");
process.exit(ok ? 0 : 1);
