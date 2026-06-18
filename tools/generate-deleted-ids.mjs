// Генератор списка "удалённых" (18+) тайтлов с MAL через Jikan API.
// Аниме: rating=rx (Hentai). Манга: genres=12 (Hentai).
// shikimori ID совпадает с MAL ID, поэтому список ID можно проверять напрямую.
//
// Запуск:  node tools/generate-deleted-ids.mjs
// Результат: deleted-ids.json в корне проекта.
// Чекпоинт: tools/.deleted-ids.progress.json (для возобновления при обрыве).

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "deleted-ids.json");
const PROGRESS = join(ROOT, "tools", ".deleted-ids.progress.json");

const BASE = "https://api.jikan.moe/v4";
const PAGE_DELAY_MS = 1300; // ~46 запросов/мин — с запасом под лимит Jikan (60/мин)
const LIMIT = 25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchJSON = async (url, attempt = 0) => {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) {
      throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt >= 5) throw e;
    const backoff = 2000 * Math.pow(2, attempt);
    console.warn(`  ⚠️  ${e.message} -> повтор через ${backoff}мс (${attempt + 1}/5)`);
    await sleep(backoff);
    return fetchJSON(url, attempt + 1);
  }
};

// Загружает все страницы заданного типа, собирая mal_id.
const collect = async (kind, query, into, startPage) => {
  let page = startPage || 1;
  while (true) {
    const url = `${BASE}/${kind}?${query}&page=${page}&limit=${LIMIT}&sfw=false`;
    const json = await fetchJSON(url);
    const items = json.data || [];
    for (const it of items) if (it && typeof it.mal_id === "number") into.add(it.mal_id);

    const pg = json.pagination || {};
    const total = pg.items?.total ?? "?";
    if (page % 10 === 0 || !pg.has_next_page) {
      console.log(`  [${kind}] стр. ${page}/${pg.last_visible_page ?? "?"} — собрано ${into.size}/${total}`);
      saveProgress(kind, page, into);
    }
    if (!pg.has_next_page) break;
    page++;
    await sleep(PAGE_DELAY_MS);
  }
};

// --- чекпоинт ---
let progress = { anime: { page: 1, ids: [] }, manga: { page: 1, ids: [] } };
if (existsSync(PROGRESS)) {
  try {
    progress = JSON.parse(readFileSync(PROGRESS, "utf8"));
    console.log(`↩️  Возобновляю с чекпоинта: anime стр.${progress.anime.page} (${progress.anime.ids.length}), manga стр.${progress.manga.page} (${progress.manga.ids.length})`);
  } catch {}
}
const animeSet = new Set(progress.anime.ids);
const mangaSet = new Set(progress.manga.ids);

function saveProgress(kind, page, set) {
  progress[kind] = { page, ids: [...set] };
  writeFileSync(PROGRESS, JSON.stringify(progress));
}

console.log("📥 Аниме (rating=rx)...");
await collect("anime", "rating=rx", animeSet, progress.anime.page);
console.log(`✅ Аниме: ${animeSet.size}`);

console.log("📥 Манга (genres=12 Hentai)...");
await collect("manga", "genres=12", mangaSet, progress.manga.page);
console.log(`✅ Манга: ${mangaSet.size}`);

const result = {
  generated_at: new Date().toISOString(),
  source: "jikan v4: anime rating=rx, manga genres=12",
  anime: [...animeSet].sort((a, b) => a - b),
  manga: [...mangaSet].sort((a, b) => a - b),
};
writeFileSync(OUT, JSON.stringify(result));
const kb = (JSON.stringify(result).length / 1024).toFixed(0);
console.log(`\n💾 Записано: ${OUT}`);
console.log(`   anime=${result.anime.length}, manga=${result.manga.length}, размер=${kb}КБ`);
