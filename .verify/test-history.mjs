import http from "node:http";
import { chromium } from "playwright";

const server = http.createServer((_q, r) => { r.writeHead(200, {"Content-Type":"text/html"}); r.end("<!doctype html><html><body></body></html>"); });
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

const HARNESS = `
// мок: список удалённых и Jikan-постер
const DELETED = { anime:new Set([49520]), manga:new Set([777]) };
const isKnownDeleted = (id,type)=> (type==="anime"?DELETED.anime:DELETED.manga).has(Number(id));
window.__fetchCalls=[];
const fetchPosterPic = async (id,kind)=>{ window.__fetchCalls.push(kind+":"+id); return {large:"L.jpg",medium:"M.jpg"}; };

const parseEntityLink = (href) => {
  let pathname; try { pathname = new URL(href, location.origin).pathname; } catch(e){ return null; }
  const m = pathname.match(/^\\/(animes|mangas|ranobe)\\/([a-z0-9-]+)/i); if(!m) return null;
  const idM = m[2].match(/^(?:z)?(\\d+)(?:-|$)/i); if(!idM) return null;
  const tp=m[1].toLowerCase(); const type=tp==="ranobe"?"manga":tp.slice(0,-1); const displayType=tp==="ranobe"?"ranobe":type;
  return { id:idM[1], type, displayType };
};
const posterEntryKey=(i)=>i.kind+":"+i.id;

// --- точные копии функций истории ---
const getHistoryInfo = (el) => {
  if(!el.matches||!el.matches(".c-history .entry"))return null;
  const a=el.querySelector("a[href]"); const p=parseEntityLink((a&&a.getAttribute("href"))||"");
  return p?{id:p.id,kind:p.displayType}:null;
};
const coverMissing = (img) => { const src=(img&&img.getAttribute("src"))||""; return /\\/assets\\/globals\\/missing\\//.test(src) || (img&&img.classList.contains("is-moderation_censored")); };
const needsHistoryFix = (el) => {
  const info=getHistoryInfo(el); if(!info)return false;
  const img=el.querySelector("img"); if(!img)return false;
  const malType=info.kind==="anime"?"anime":"manga";
  if(!coverMissing(img)&&!isKnownDeleted(info.id,malType))return false;
  const k=posterEntryKey(info);
  if(el.dataset.malPosterResolved===k)return false;
  if(el.dataset.malPosterBusy===k)return false;
  return true;
};
const applyHistoryPoster = (el,pic) => {
  if(!pic)return; const img=el.querySelector("img"); if(!img)return;
  img.src=pic.medium; img.srcset=pic.large+" 2x, "+pic.medium+" 1x";
  img.classList.remove("is-moderation_censored"); img.style.filter="none";
  const p=img.closest("picture"); if(p)p.querySelectorAll("source").forEach(s=>s.remove());
};
const processHistory = async (el) => {
  if(!(el.matches(".c-history .entry")&&needsHistoryFix(el)))return;
  const info=getHistoryInfo(el); const k=posterEntryKey(info); el.dataset.malPosterBusy=k;
  try{ const pic=await fetchPosterPic(info.id,info.kind); if(pic)applyHistoryPoster(el,pic); el.dataset.malPosterResolved=k; }
  finally{ if(el.dataset.malPosterBusy===k)delete el.dataset.malPosterBusy; }
};
Object.assign(window,{getHistoryInfo,needsHistoryFix,applyHistoryPoster,processHistory});

const entry = (href, imgSrc, censored) => '<div class="c-history"><div class="entry"><a href="'+href+'"><div class="image-name"><picture><source srcset="x.webp" type="image/webp"><img '+(censored?'class="is-moderation_censored" ':'')+'src="'+imgSrc+'"></picture><span class="title">t</span></div></a></div></div>';
window.__entry = entry;
`;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`http://localhost:${PORT}/`);
await page.evaluate(HARNESS);

const results = [];
const assert = (n,c,d)=>results.push({n,p:!!c,d});

// 1. getHistoryInfo
{
  const r = await page.evaluate(() => {
    document.body.innerHTML = window.__entry("/animes/49520-x", "/uploads/poster/animes/49520/mini.jpeg", false);
    return window.getHistoryInfo(document.querySelector(".c-history .entry"));
  });
  assert("getHistoryInfo: /animes/49520-x -> {id:49520, kind:anime}", r && r.id==="49520" && r.kind==="anime", JSON.stringify(r));
}
// 2. needsHistoryFix: missing -> true
{
  const r = await page.evaluate(() => { document.body.innerHTML = window.__entry("/mangas/12-x", "/assets/globals/missing/preview_animanga.png", false); return window.needsHistoryFix(document.querySelector(".c-history .entry")); });
  assert("needsHistoryFix: missing-обложка -> true", r===true, String(r));
}
// 3. censored -> true
{
  const r = await page.evaluate(() => { document.body.innerHTML = window.__entry("/mangas/12-x", "/uploads/poster/mangas/12/mini.jpeg", true); return window.needsHistoryFix(document.querySelector(".c-history .entry")); });
  assert("needsHistoryFix: цензур-класс -> true", r===true, String(r));
}
// 4. живая обложка + НЕ в списке -> false
{
  const r = await page.evaluate(() => { document.body.innerHTML = window.__entry("/animes/999-x", "/uploads/poster/animes/999/mini.jpeg", false); return window.needsHistoryFix(document.querySelector(".c-history .entry")); });
  assert("needsHistoryFix: живая обложка + не удалён -> false", r===false, String(r));
}
// 5. живая обложка, но тайтл В списке удалённых -> true
{
  const r = await page.evaluate(() => { document.body.innerHTML = window.__entry("/animes/49520-x", "/uploads/poster/animes/49520/mini.jpeg", false); return window.needsHistoryFix(document.querySelector(".c-history .entry")); });
  assert("needsHistoryFix: в списке удалённых -> true", r===true, String(r));
}
// 6. process: заменяет обложку + удаляет source + снимает блюр
{
  const r = await page.evaluate(async () => {
    document.body.innerHTML = window.__entry("/animes/49520-x", "/assets/globals/missing/main.png", true);
    const el = document.querySelector(".c-history .entry");
    await window.processHistory(el);
    const img = el.querySelector("img");
    return { src: img.getAttribute("src"), srcset: img.getAttribute("srcset"), source: !!el.querySelector("picture source"), censored: img.classList.contains("is-moderation_censored"), call: window.__fetchCalls.slice(-1)[0] };
  });
  assert("process: src=M.jpg, srcset 2x, source удалён, блюр снят, запрос anime:49520",
    r.src==="M.jpg" && /L\.jpg 2x/.test(r.srcset||"") && !r.source && !r.censored && r.call==="anime:49520", JSON.stringify(r));
}

await browser.close(); server.close();
console.log("\n=== РЕЗУЛЬТАТЫ (постеры в истории) ===");
let ok=true;
for(const r of results){ console.log(`${r.p?"✅":"❌"} ${r.n}  ${r.p?"":"-> "+r.d}`); if(!r.p)ok=false; }
console.log(ok?"\nВСЕ ТЕСТЫ ПРОЙДЕНЫ":"\nЕСТЬ ПРОВАЛЫ");
process.exit(ok?0:1);
