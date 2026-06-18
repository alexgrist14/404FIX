import { chromium } from "playwright";

// --- точные копии логики из 404FIX.user.js ---
const SEARCH_FETCH_LIMIT = 8;
const searchQuery = (root) =>
  `query($s:String){ ${root}(search:$s, limit:${SEARCH_FETCH_LIMIT}, censored:false){ id name russian english synonyms url kind status airedOn{year} ${root==="animes"?"studios{name}":"publishers{name}"} genres{id name russian} poster{miniUrl mainUrl} } }`;
const SEARCH_Q_ANIME = searchQuery("animes");

const searchPoster = (item, seg) => {
  if (item.poster && item.poster.miniUrl) return { mini:item.poster.miniUrl, main:item.poster.mainUrl||item.poster.miniUrl };
  return { mini:`/system/${seg}/x48/${item.id}.jpg`, main:`/system/${seg}/x96/${item.id}.jpg` };
};
const searchRelevance = (item, termLower) => {
  let s=0; const titles=[(item.russian||"").toLowerCase(),(item.name||"").toLowerCase(),(item.english||"").toLowerCase(),...(item.synonyms||[]).map(x=>x.toLowerCase())];
  for(const t of titles){ if(!t)continue; if(t===termLower)s+=20; else if(t.startsWith(termLower))s+=12; else if(t.includes(termLower))s+=8; } return s;
};
const buildSearchItem = (item, kind) => {
  const seg = kind==="anime"?"animes":"mangas";
  const pic = searchPoster(item, seg);
  const titleRu = item.russian||item.name||"???";
  return `<a class="b-db_entry-variant-list_item" data-id="${item.id}" data-type="${kind}" href="${item.url||""}" data-adv="true"><div class="image"><img src="${pic.mini}" srcset="${pic.main} 2x" alt="${titleRu}"></div></a>`;
};

const results = [];
const assert = (n,c,d)=>results.push({n,p:!!c,d});

// === ЖИВОЙ тест GraphQL на shikimori ===
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" });
try {
  await page.goto("https://shikimori.io/", { waitUntil: "domcontentloaded", timeout: 30000 });
  const data = await page.evaluate(async (q) => {
    const r = await fetch("/api/graphql", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({query:q, variables:{s:"starless"}}) });
    return (await r.json()).data;
  }, SEARCH_Q_ANIME);
  const animes = (data && data.animes) || [];
  const starless = animes.find(a => a.id === "14129");
  assert("Живой GraphQL: censored:false находит удалённый Starless (14129)", !!starless, JSON.stringify(animes.map(a=>a.id)));
  assert("У удалённого poster === null (проверяем фолбэк)", starless && starless.poster === null, JSON.stringify(starless && starless.poster));
  if (starless) {
    // билдер НЕ должен падать на null-постере
    let html, threw=false;
    try { html = buildSearchItem(starless, "anime"); } catch(e){ threw=true; }
    assert("buildSearchItem не падает на null-постере", !threw, "");
    assert("Фолбэк постера -> /system/animes/x48/14129.jpg", html && html.includes("/system/animes/x48/14129.jpg"), html && html.slice(0,200));
  }
} catch(e) { assert("Живой GraphQL доступен", false, e.message); }
await browser.close();

// === ЮНИТ: дедуп против нативных + релевантность ===
{
  const anime = [{id:"1",name:"A",russian:"А"},{id:"2",name:"B",russian:"Б"}];
  const manga = [{id:"1",name:"M1"}];
  const nativeIds = new Set(["anime:1"]); // нативный уже показал anime:1
  const tagged = [...anime.map(it=>({it,kind:"anime"})),...manga.map(it=>({it,kind:"manga"}))]
    .filter(({it,kind})=>!nativeIds.has(`${kind}:${it.id}`));
  const ids = tagged.map(t=>`${t.kind}:${t.it.id}`);
  assert("Дедуп: anime:1 убран, manga:1 и anime:2 остались", ids.length===2 && ids.includes("anime:2") && ids.includes("manga:1") && !ids.includes("anime:1"), JSON.stringify(ids));
}
{
  const exact = searchRelevance({russian:"наруто"}, "наруто");
  const starts = searchRelevance({russian:"наруто узумаки"}, "наруто");
  const incl = searchRelevance({russian:"легенда о наруто"}, "наруто");
  assert("Релевантность: точное > начинается > содержит", exact>starts && starts>incl, `${exact}/${starts}/${incl}`);
}
{
  // постер есть -> используем его, не шаблон
  const p = searchPoster({id:"5", poster:{miniUrl:"M", mainUrl:"L"}}, "animes");
  assert("Постер из GraphQL когда не null", p.mini==="M" && p.main==="L", JSON.stringify(p));
}

console.log("\n=== РЕЗУЛЬТАТЫ (поиск) ===");
let ok=true;
for(const r of results){ console.log(`${r.p?"✅":"❌"} ${r.n}  ${r.p?"":"-> "+r.d}`); if(!r.p)ok=false; }
console.log(ok?"\nВСЕ ТЕСТЫ ПРОЙДЕНЫ":"\nЕСТЬ ПРОВАЛЫ");
process.exit(ok?0:1);
