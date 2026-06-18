import { chromium } from "playwright";

// Харнесс с ТОЧНЫМИ копиями ключевых функций модуля постеров из 404FIX.user.js.
const HARNESS = `
const debug=()=>{}, log=()=>{};
const CONFIG = { JIKAN_BASE: "https://api.jikan.moe/v4", USER_AGENT: "t", JIKAN_CACHE_TTL: 9e9 };
const POSTER_MISSING_MAIN_RE = /\\/assets\\/globals\\/missing\\/main(@2x)?\\.png/;
const POSTER_MISSING_CATALOG_RE = /\\/assets\\/globals\\/missing\\/preview_animanga(@2x)?\\.png/;

// мок-сеть
window.__apiCalls = [];
const fetchWithTimeout = async (url) => {
  window.__apiCalls.push(url);
  if (url.includes("/api/animes/") || url.includes("/api/mangas/") || url.includes("/api/ranobe/")) {
    // shikimori -> myanimelist_id
    return { ok: true, json: async () => ({ myanimelist_id: 777 }) };
  }
  if (url.includes(CONFIG.JIKAN_BASE)) {
    return { ok: true, json: async () => ({ data: { images: { jpg: { large_image_url: "L.jpg", image_url: "M.jpg" } } } }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
const isRetryable=(e)=>{const m=e&&e.message||"";if(/timeout|Failed to fetch|NetworkError/i.test(m))return true;const s=e&&e.status;return s===429||(s>=500&&s<=599);};
const withRetry=async(fn,o={})=>{const r=o.retries??3;let last;for(let a=0;a<=r;a++){try{return await fn(a);}catch(e){last=e;if(a===r||!isRetryable(e))break;await new Promise(x=>setTimeout(x,1));}}throw last;};

const _pcache = new Map();
const jikanPosterCache = { get:(k)=>_pcache.get(k), set:(k,v)=>_pcache.set(k,v) };
const shikiToMalCache = new Map();
const posterIsAnimeKind=(k)=>k==="anime";

const resolveMalId = async (id, kind) => {
  const key = kind+":"+id;
  if (shikiToMalCache.has(key)) return shikiToMalCache.get(key);
  const seg = kind==="anime"?"animes":kind==="manga"?"mangas":"ranobe";
  let malId=id;
  try { const r=await fetchWithTimeout(location.origin+"/api/"+seg+"/"+id,{headers:{}}); if(r.ok){const d=await r.json(); if(d.myanimelist_id!=null) malId=String(d.myanimelist_id);} } catch(e){}
  shikiToMalCache.set(key,malId); return malId;
};
const getJikanPoster = async (malId, kind) => {
  const type=posterIsAnimeKind(kind)?"anime":"manga";
  const cacheKey=type+"_"+malId;
  const cached=jikanPosterCache.get(cacheKey);
  if(cached!==undefined&&cached!==null) return cached;
  try {
    const json=await withRetry(async()=>{const res=await fetchWithTimeout(CONFIG.JIKAN_BASE+"/"+type+"/"+malId,{headers:{}});if(!res.ok){const e=new Error("Jikan "+res.status);e.status=res.status;throw e;}return res.json();},{retries:3});
    const jpg=json?.data?.images?.jpg||{};
    const large=jpg.large_image_url||jpg.image_url||null;
    const medium=jpg.image_url||jpg.large_image_url||null;
    const pic=large||medium?{large:large||medium,medium:medium||large}:null;
    jikanPosterCache.set(cacheKey,pic); return pic;
  } catch(e){ return null; }
};
const fetchPosterPic = async (id, kind) => getJikanPoster(await resolveMalId(id,kind), kind);

const applyCatalogPoster=(row,pic)=>{if(!pic)return;const img=row.querySelector(".image-cutter img");if(img){img.src=pic.medium;img.srcset=pic.large+" 2x, "+pic.medium+" 1x";img.removeAttribute("data-src");}};
const applyLineListPoster=(tr,pic)=>{if(!pic)return;const tdName=tr.querySelector("td.name");if(!tdName)return;let wrap=tr.querySelector(".mal-userlist-poster");if(!wrap){wrap=document.createElement("span");wrap.className="mal-userlist-poster";const im=document.createElement("img");wrap.appendChild(im);tdName.insertBefore(wrap,tdName.firstChild);}const img=wrap.querySelector("img");if(img){img.src=pic.medium;img.srcset=pic.large+" 2x, "+pic.medium+" 1x";}};
const applyDetailPoster=(root,pic)=>{if(!pic)return;const meta=root.querySelector('meta[itemprop="image"]');const img=root.querySelector("img");if(meta)meta.setAttribute("content",pic.large);if(img){img.src=pic.medium;img.srcset=pic.large+" 2x, "+pic.medium+" 1x";}};

const isUserAnimeListPage=()=>false, isUserMangaListPage=()=>false, isUserListLinesPage=()=>false;
const posterEntryKey=(i)=>i.kind+":"+i.id;
const getGridEntryInfo=(el)=>{ if(el.matches("article.b-catalog_entry.c-anime")&&el.id)return {id:el.id,kind:"anime"}; if(el.matches("article.b-catalog_entry.c-manga")&&el.id)return {id:el.id,kind:"manga"}; return null; };
const needsGridPosterFix=(el)=>{const info=getGridEntryInfo(el);if(!info)return false;const img=el.querySelector(".image-cutter img");if(!img||!POSTER_MISSING_CATALOG_RE.test(img.getAttribute("src")||""))return false;const k=posterEntryKey(info);if(el.dataset.malPosterResolved===k)return false;if(el.dataset.malPosterBusy===k)return false;return true;};

const processGrid=async(el)=>{const info=getGridEntryInfo(el);if(!info||!needsGridPosterFix(el))return;const k=posterEntryKey(info);el.dataset.malPosterBusy=k;try{const pic=await fetchPosterPic(info.id,info.kind);const img=el.querySelector(".image-cutter img");if(img&&POSTER_MISSING_CATALOG_RE.test(img.getAttribute("src")||"")&&pic)applyCatalogPoster(el,pic);el.dataset.malPosterResolved=k;}finally{if(el.dataset.malPosterBusy===k)delete el.dataset.malPosterBusy;}};

Object.assign(window,{getJikanPoster,resolveMalId,fetchPosterPic,applyCatalogPoster,applyLineListPoster,applyDetailPoster,needsGridPosterFix,processGrid,POSTER_MISSING_CATALOG_RE});
`;

const MISSING = "/assets/globals/missing/preview_animanga.png";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");
await page.evaluate(HARNESS);

const results = [];
const assert = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

// 1. Jikan parse -> {large, medium}
{
  const r = await page.evaluate(() => window.getJikanPoster("777", "anime"));
  assert("Jikan parse -> {large:L.jpg, medium:M.jpg}", r && r.large === "L.jpg" && r.medium === "M.jpg", JSON.stringify(r));
}

// 2. resolveMalId -> myanimelist_id из /api
{
  const r = await page.evaluate(() => window.resolveMalId("14129", "anime"));
  assert("resolveMalId: shiki -> mal (myanimelist_id=777)", r === "777", String(r));
}

// 3. needsGridPosterFix: missing -> true, real -> false
{
  const r = await page.evaluate((MISSING) => {
    document.body.innerHTML =
      '<article class="b-catalog_entry c-anime" id="100"><div class="image-cutter"><img src="'+MISSING+'"></div></article>' +
      '<article class="b-catalog_entry c-anime" id="200"><div class="image-cutter"><img src="/real.jpg"></div></article>';
    const a = document.getElementById("100"), b = document.getElementById("200");
    return { missing: window.needsGridPosterFix(a), real: window.needsGridPosterFix(b) };
  }, MISSING);
  assert("needsGridPosterFix: пропущенный -> true, реальный -> false", r.missing === true && r.real === false, JSON.stringify(r));
}

// 4. processGrid: подменяет постер в каталоге + помечает resolved
{
  const r = await page.evaluate(async (MISSING) => {
    document.body.innerHTML = '<article class="b-catalog_entry c-anime" id="14129"><div class="image-cutter"><img src="'+MISSING+'"></div></article>';
    const el = document.getElementById("14129");
    await window.processGrid(el);
    const img = el.querySelector(".image-cutter img");
    return { src: img.getAttribute("src"), srcset: img.getAttribute("srcset"), resolved: el.dataset.malPosterResolved };
  }, MISSING);
  assert("processGrid: постер подменён (src=M.jpg, srcset с 2x) + resolved",
    r.src === "M.jpg" && /L\.jpg 2x/.test(r.srcset || "") && r.resolved === "anime:14129", JSON.stringify(r));
}

// 5. applyLineListPoster вставляет .mal-userlist-poster
{
  const r = await page.evaluate(() => {
    document.body.innerHTML = '<table><tr class="user_rate"><td class="name">name</td></tr></table>';
    const tr = document.querySelector("tr.user_rate");
    window.applyLineListPoster(tr, { large: "L.jpg", medium: "M.jpg" });
    const w = tr.querySelector(".mal-userlist-poster img");
    return { has: !!w, src: w && w.getAttribute("src") };
  });
  assert("applyLineListPoster: вставлен постер в td.name", r.has && r.src === "M.jpg", JSON.stringify(r));
}

// 6. applyDetailPoster обновляет .c-poster
{
  const r = await page.evaluate(() => {
    document.body.innerHTML = '<div class="c-poster"><meta itemprop="image" content="old"><img src="old.png"></div>';
    const root = document.querySelector(".c-poster");
    window.applyDetailPoster(root, { large: "L.jpg", medium: "M.jpg" });
    return { img: root.querySelector("img").getAttribute("src"), meta: root.querySelector("meta").getAttribute("content") };
  });
  assert("applyDetailPoster: обновлены img.src и meta", r.img === "M.jpg" && r.meta === "L.jpg", JSON.stringify(r));
}

// 7. Кэш: повторный getJikanPoster -> без новых запросов к Jikan
{
  const r = await page.evaluate(async () => {
    const before = window.__apiCalls.filter(u => u.includes("api.jikan")).length;
    await window.getJikanPoster("777", "anime"); // уже в кэше с теста 1
    const after = window.__apiCalls.filter(u => u.includes("api.jikan")).length;
    return { before, after };
  });
  assert("Кэш Jikan: повтор без новых запросов", r.before === r.after, JSON.stringify(r));
}

await browser.close();
console.log("\n=== РЕЗУЛЬТАТЫ (постеры каталог/списки) ===");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}  ${r.pass ? "" : "-> " + r.detail}`);
  if (!r.pass) ok = false;
}
console.log(ok ? "\nВСЕ ТЕСТЫ ПРОЙДЕНЫ" : "\nЕСТЬ ПРОВАЛЫ");
process.exit(ok ? 0 : 1);
