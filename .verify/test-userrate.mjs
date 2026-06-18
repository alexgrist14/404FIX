import { chromium } from "playwright";

// --- точная копия renderUserRateNative ---
const renderUserRateNative = (data) => {
  const id = Number(data.INFO.ID);
  const isAnimeT = data.TYPE === "anime";
  const targetType = isAnimeT ? "Anime" : "Manga";
  const cls = isAnimeT ? "anime" : "manga";
  const ls = data.LIST_STATUS && !Array.isArray(data.LIST_STATUS) && data.LIST_STATUS.id ? data.LIST_STATUS : null;
  const user = data.USER;
  const entry = { id, episodes: isAnimeT ? (data.INFO.EPISODES_TOTAL || null) : null, chapters: !isAnimeT ? (data.INFO.CHAPTERS_TOTAL || null) : null, volumes: !isAnimeT ? (data.INFO.VOLUMES_TOTAL || null) : null };
  const model = { id: ls?ls.id:null, user_id: user?Number(user.USER_ID):null, target_id:id, score: ls?(ls.score||0):0, status: ls?ls.status:"planned", episodes: ls?(ls.episodes||0):0, created_at:null, updated_at:null, target_type:targetType, volumes: ls?(ls.volumes||0):0, chapters: ls?(ls.chapters||0):0, text:null, rewatches: ls?(ls.rewatches||0):0 };
  const esc = (o) => JSON.stringify(o).replace(/"/g, "&quot;");
  return `<div class="b-user_rate to-process ${cls}-${id}" data-dynamic="user_rate" data-entry="${esc(entry)}" data-extended="true" data-model="${esc(model)}" data-target_id="${id}" data-target_type="${targetType}" data-track_user_rate="user_rate:${cls}:${id}"></div>`;
};

const results = [];
const assert = (n,c,d)=>results.push({n,p:!!c,d});
const attr = (html, name) => { const m = html.match(new RegExp(name+'="([^"]*)"')); return m ? m[1].replace(/&quot;/g,'"') : null; };

// 1. Аниме в списке: класс anime-1, target_type Anime, model со status/score/episodes
{
  const html = renderUserRateNative({ INFO:{ID:1, EPISODES_TOTAL:26, CHAPTERS_TOTAL:0}, TYPE:"anime", USER:{USER_ID:7}, LIST_STATUS:{id:555, status:"completed", score:8, episodes:26} });
  const model = JSON.parse(attr(html, "data-model"));
  const entry = JSON.parse(attr(html, "data-entry"));
  assert("Аниме: класс anime-1, target_type Anime", html.includes("b-user_rate to-process anime-1") && html.includes('data-target_type="Anime"'), html.slice(0,120));
  assert("data-model: id=555, status=completed, score=8, episodes=26, user_id=7",
    model.id===555 && model.status==="completed" && model.score===8 && model.episodes===26 && model.user_id===7, JSON.stringify(model));
  assert("data-entry: episodes=26 (total)", entry.episodes===26, JSON.stringify(entry));
}
// 2. Ранобэ -> target_type Manga, класс manga-, поле chapters в entry
{
  const html = renderUserRateNative({ INFO:{ID:9, EPISODES_TOTAL:0, CHAPTERS_TOTAL:40, VOLUMES_TOTAL:13}, TYPE:"ranobe", USER:{USER_ID:7}, LIST_STATUS:{id:3, status:"reading", score:0, chapters:10, volumes:13} });
  const entry = JSON.parse(attr(html, "data-entry"));
  assert("Ранобэ/манга -> Manga, manga-9, entry.chapters=40 И entry.volumes=13 (для скрытия '+')", html.includes('data-target_type="Manga"') && html.includes("manga-9") && entry.chapters===40 && entry.volumes===13, JSON.stringify(entry));
}
// 3. Не в списке -> model.id=null, status=planned
{
  const html = renderUserRateNative({ INFO:{ID:5, EPISODES_TOTAL:12}, TYPE:"anime", USER:{USER_ID:7}, LIST_STATUS:[] });
  const model = JSON.parse(attr(html, "data-model"));
  assert("Не в списке -> id=null, status=planned", model.id===null && model.status==="planned", JSON.stringify(model));
}

// === ЖИВОЙ тест: контейнер гидрируется в нативный виджет на shikimori ===
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" });
try {
  await page.goto("https://shikimori.io/animes/1-cowboy-bebop", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  const container = renderUserRateNative({ INFO:{ID:1, EPISODES_TOTAL:26, CHAPTERS_TOTAL:0}, TYPE:"anime", USER:{USER_ID:1}, LIST_STATUS:{id:555, status:"completed", score:8, episodes:26} });
  const r = await page.evaluate(async (html) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    const node = host.firstChild;
    document.body.appendChild(node);
    document.dispatchEvent(new Event("turbolinks:load"));
    document.dispatchEvent(new Event("page:load"));
    await new Promise(r=>setTimeout(r, 2500));
    return {
      hydrated: node.children.length > 0,
      hasAddToList: !!node.querySelector(".b-add_to_list.completed"),
      hasRateShow: !!node.querySelector(".rate-show, .current-episodes"),
      hasEpisodes: !!node.querySelector(".current-episodes"),
      hasScoreWidget: !!node.querySelector(".b-rate.rateable, .b-rate"),
      statusText: (node.querySelector(".status-name")?.getAttribute("data-text"))||"",
    };
  }, container);
  assert("Живой: мой контейнер гидрирован shikimori", r.hydrated, JSON.stringify(r));
  assert("Живой: отрисована кнопка статуса (.b-add_to_list.completed)", r.hasAddToList, JSON.stringify(r));
  assert("Живой: отрисован прогресс серий (.current-episodes)", r.hasEpisodes, JSON.stringify(r));
  assert("Живой: отрисован виджет оценки (.b-rate)", r.hasScoreWidget, JSON.stringify(r));
} catch(e){ assert("Живой тест выполнен", false, e.message); }
await browser.close();

console.log("\n=== РЕЗУЛЬТАТЫ (user_rate нативный) ===");
let ok=true;
for(const r of results){ console.log(`${r.p?"✅":"❌"} ${r.n}  ${r.p?"":"-> "+r.d}`); if(!r.p)ok=false; }
console.log(ok?"\nВСЕ ТЕСТЫ ПРОЙДЕНЫ":"\nЕСТЬ ПРОВАЛЫ");
process.exit(ok?0:1);
