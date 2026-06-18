// Тест источника постера связанных тайтлов (GraphQL отдаёт poster:null для 18+).

// Точная копия логики из processRelated.
function posterUrls(rel) {
  const item = rel.anime || rel.manga;
  const relType = rel.anime ? "animes" : "mangas";
  const posterUrl =
    (item.poster && item.poster.mainUrl) ||
    `/system/${relType}/preview/${item.id}.jpg`;
  const posterX48 =
    (item.poster && item.poster.miniAltUrl) ||
    `/system/${relType}/x48/${item.id}.jpg`;
  return { posterUrl, posterX48 };
}

const results = [];
const assert = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

// 1. GraphQL poster=null (18+ аниме) -> URL по шаблону /system/animes/...
{
  const r = posterUrls({ anime: { id: 51722, poster: null } });
  assert("anime poster=null -> /system/animes/preview/51722.jpg",
    r.posterUrl === "/system/animes/preview/51722.jpg" && r.posterX48 === "/system/animes/x48/51722.jpg",
    JSON.stringify(r));
}

// 2. GraphQL poster=null для манги -> /system/mangas/...
{
  const r = posterUrls({ manga: { id: 999, poster: null } });
  assert("manga poster=null -> /system/mangas/preview/999.jpg",
    r.posterUrl === "/system/mangas/preview/999.jpg",
    JSON.stringify(r));
}

// 3. GraphQL poster присутствует -> используем его (не шаблон).
{
  const r = posterUrls({ anime: { id: 1, poster: { mainUrl: "https://x/p.jpg", miniAltUrl: "https://x/s.jpg" } } });
  assert("poster есть -> берём mainUrl/miniAltUrl",
    r.posterUrl === "https://x/p.jpg" && r.posterX48 === "https://x/s.jpg",
    JSON.stringify(r));
}

// 4. poster объект есть, но mainUrl пуст -> фолбэк на шаблон.
{
  const r = posterUrls({ anime: { id: 7, poster: { mainUrl: null } } });
  assert("poster без mainUrl -> шаблон",
    r.posterUrl === "/system/animes/preview/7.jpg",
    JSON.stringify(r));
}

console.log("\n=== РЕЗУЛЬТАТЫ (постеры связанных) ===");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}  ${r.pass ? "" : "-> " + r.detail}`);
  if (!r.pass) ok = false;
}
console.log(ok ? "\nВСЕ ТЕСТЫ ПРОЙДЕНЫ" : "\nЕСТЬ ПРОВАЛЫ");
process.exit(ok ? 0 : 1);
