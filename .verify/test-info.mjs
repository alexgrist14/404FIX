// Тест рендера инфо-блока (тип/количество/длительность/существительное) — чистая логика.

const FRAGMENT = `<div class='key'>Тип:</div><div class='value'>{{TYPE}}</div>|{{COUNT_BLOCK}}|<div class='line'>{{DURATION_BLOCK}}</div>|<div class="key">У {{ENTITY_NOUN}}:</div>`;

const KIND_RU = { tv:"TV Сериал", movie:"Фильм", ova:"OVA", ona:"ONA", special:"Спецвыпуск", tv_special:"TV Спецвыпуск", music:"Клип", pv:"PV", cm:"CM", manga:"Манга", manhwa:"Манхва", manhua:"Маньхуа", novel:"Ранобэ", one_shot:"Ваншот", doujin:"Додзинси" };

function render(content_type, INFO) {
  const isAnime = content_type === "anime";
  const isRanobe = content_type === "ranobe";
  let html = FRAGMENT;
  html = html.replaceAll("{{TYPE}}", KIND_RU[INFO.TYPE] || INFO.TYPE || "?");
  html = html.replaceAll("{{ENTITY_NOUN}}", isAnime ? "аниме" : (isRanobe ? "ранобэ" : "манги"));
  const lineRow = (k,v) => `<div class='line-container'> <div class='line'> <div class='key'>${k}:</div> <div class='value'>${v}</div> </div> </div>`;
  const countBlock = isAnime
    ? lineRow("Эпизоды", INFO.EPISODES_TOTAL || "?")
    : lineRow("Тома", INFO.VOLUMES_TOTAL || "?") + lineRow("Главы", INFO.CHAPTERS_TOTAL || "?");
  html = html.replaceAll("{{COUNT_BLOCK}}", countBlock);
  html = html.replaceAll("{{DURATION_BLOCK}}", INFO.DURATION_BLOCK || "");
  return html;
}

const results = [];
const assert = (n,c,d)=>results.push({n,p:!!c,d});

// 1. Манга
{
  const h = render("manga", { TYPE:"manga", VOLUMES_TOTAL:13, CHAPTERS_TOTAL:117, DURATION_BLOCK:"" });
  assert("Манга: Тип -> 'Манга'", h.includes(">Манга<"), h);
  assert("Манга: отдельные строки 'Тома: 13' и 'Главы: 117'",
    h.includes(">Тома:</div> <div class='value'>13<") && h.includes(">Главы:</div> <div class='value'>117<"), h);
  assert("Манга: НЕТ длительности (нет 'мин')", !h.includes("мин"), h);
  assert("Манга: 'У манги:'", h.includes("У манги:"), h);
}
// 2. Ранобэ (novel)
{
  const h = render("ranobe", { TYPE:"novel", VOLUMES_TOTAL:17, CHAPTERS_TOTAL:127, DURATION_BLOCK:"" });
  assert("Ранобэ: Тип -> 'Ранобэ'", h.includes(">Ранобэ<"), h);
  assert("Ранобэ: 'Тома: 17' + 'Главы: 127'", h.includes(">17<") && h.includes(">127<"), h);
  assert("Ранобэ: 'У ранобэ:'", h.includes("У ранобэ:"), h);
}
// 3. Аниме
{
  const h = render("anime", { TYPE:"tv", EPISODES_TOTAL:26, DURATION_BLOCK:"<div class='key'>Длительность:</div><div class='value'>24 мин.</div>" });
  assert("Аниме: Тип -> 'TV Сериал'", h.includes(">TV Сериал<"), h);
  assert("Аниме: 'Эпизоды: 26', нет 'Тома/Главы'", h.includes(">Эпизоды:</div> <div class='value'>26<") && !h.includes("Тома:") && !h.includes("Главы:"), h);
  assert("Аниме: длительность показана ('24 мин.')", h.includes("24 мин."), h);
  assert("Аниме: 'У аниме:'", h.includes("У аниме:"), h);
}
// 4. Неизвестные тома/главы -> '?'
{
  const h = render("manga", { TYPE:"manga", VOLUMES_TOTAL:0, CHAPTERS_TOTAL:0, DURATION_BLOCK:"" });
  assert("Неизвестно -> 'Тома: ?' / 'Главы: ?'", h.includes(">Тома:</div> <div class='value'>?<") && h.includes(">Главы:</div> <div class='value'>?<"), h);
}

console.log("\n=== РЕЗУЛЬТАТЫ (инфо-блок) ===");
let ok=true;
for(const r of results){ console.log(`${r.p?"✅":"❌"} ${r.n}  ${r.p?"":"-> "+r.d}`); if(!r.p)ok=false; }
console.log(ok?"\nВСЕ ТЕСТЫ ПРОЙДЕНЫ":"\nЕСТЬ ПРОВАЛЫ");
process.exit(ok?0:1);
