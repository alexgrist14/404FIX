import { chromium } from "playwright";

// Харнесс с ТОЧНОЙ копией setupCommentsLoadMore + renderCommentItem из 404FIX.user.js.
const HARNESS = `
const error = () => {}, log = () => {};
const COMMENTS_LOAD_STEP = 10;
const escapeAttr = (s) => String(s==null?"":s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const renderCommentItem = (c) => (
  '<div class="b-comment fix404-comment" id="comment-'+escapeAttr(c.id)+'">'+
  '<div><a href="'+escapeAttr(c.user_url||"#")+'">'+escapeAttr(c.user||"Гость")+'</a></div>'+
  '<div class="b-text_with_paragraphs">'+(c.html_body||"")+'</div></div>'
);

// мок /api/comments по страницам limit=10 (перекрытие last==first следующей).
const PAGES = {
  1: [25,24,23,22,21,20,19,18,17,16],
  2: [16,15,14,13,12,11,10,9,8,7],
  3: [7,6,5,4,3,2,1],
  4: [],
};
const mk = (id) => ({ id, html_body: "t"+id, user: "u"+id, user_url: "/u"+id, created_at: "x" });
const apiRequest = async (url) => {
  const m = url.match(/page=(\\d+)/); const p = m ? Number(m[1]) : 1;
  return (PAGES[p] || []).map(mk);
};

const setupCommentsLoadMore = () => {
  document.body.addEventListener("click", async (e) => {
    const btn = e.target.closest && e.target.closest(".fix404-load-more");
    if (!btn || btn.dataset.loading === "1") return;
    const topic = btn.dataset.topic;
    const total = Number(btn.dataset.total) || 0;
    let page = Number(btn.dataset.nextpage) || 1;
    const list = document.querySelector(".fix404-comments-list");
    if (!topic || !list) return;
    btn.dataset.loading = "1";
    let origText = btn.textContent;
    btn.textContent = "Загрузка…";
    try {
      const seen = new Set(Array.from(list.querySelectorAll(".fix404-comment")).map((el)=>Number(el.id.replace("comment-",""))));
      const fresh = [];
      for (let tries=0; tries<3 && fresh.length===0; tries++, page++) {
        const batch = await apiRequest("/comments?commentable_id="+topic+"&commentable_type=Topic&page="+page+"&limit="+COMMENTS_LOAD_STEP+"&order=created_at&order_direction=desc");
        if (!Array.isArray(batch) || batch.length===0) break;
        for (const c of batch) { if (c && !seen.has(c.id)) { seen.add(c.id); fresh.push(c); } }
      }
      btn.dataset.nextpage = String(page);
      if (fresh.length) {
        const mapped = fresh.map((c)=>({ id:c.id, html_body:c.html_body||c.body||"", user:c.user?c.user:"Гость", user_url:"/u"+c.id, avatar:"", created_at:c.created_at }));
        list.insertAdjacentHTML("afterbegin", mapped.slice().reverse().map(renderCommentItem).join(""));
      }
      const shown = list.querySelectorAll(".fix404-comment").length;
      const remaining = total - shown;
      if (!fresh.length || remaining <= 0) { btn.style.display = "none"; }
      else { btn.textContent = "Загрузить ещё "+Math.min(COMMENTS_LOAD_STEP, remaining)+" комментариев из "+total; origText = btn.textContent; }
    } catch (err) { error(err); }
    finally { btn.dataset.loading="0"; if (btn.textContent==="Загрузка…") btn.textContent=origText; }
  });
};

// старт: показаны новейшие 3 (25,24,23) хронологически -> DOM: 23,24,25
document.body.innerHTML =
  '<div class="fix404-comments-list">' +
  renderCommentItem(mk(23)) + renderCommentItem(mk(24)) + renderCommentItem(mk(25)) +
  '</div>' +
  '<div class="fix404-load-more" data-topic="99" data-total="25" data-nextpage="1">Загрузить ещё 10 комментариев из 25</div>';
setupCommentsLoadMore();
window.__ids = () => Array.from(document.querySelectorAll(".fix404-comment")).map(el=>el.id.replace("comment-",""));
window.__btn = () => { const b=document.querySelector(".fix404-load-more"); return { text:b.textContent, hidden:b.style.display==="none" }; };
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("about:blank");
await page.evaluate(HARNESS);

const results = [];
const assert = (name, cond, detail) => results.push({ name, pass: !!cond, detail });
const clickAndWait = async () => { await page.click(".fix404-load-more"); await page.waitForTimeout(80); };

assert("Старт: показаны ровно 3 (23,24,25)",
  JSON.stringify(await page.evaluate(() => window.__ids())) === '["23","24","25"]',
  JSON.stringify(await page.evaluate(() => window.__ids())));

await clickAndWait(); // page1 -> +16..22 (7 новых)
const idsAfter1 = await page.evaluate(() => window.__ids());
const btn1 = await page.evaluate(() => window.__btn());
assert("Клик 1: добавлены 16..22 сверху (хронологически)",
  JSON.stringify(idsAfter1) === '["16","17","18","19","20","21","22","23","24","25"]', JSON.stringify(idsAfter1));
assert("Клик 1: текст кнопки 'Загрузить ещё 10 комментариев из 25'",
  btn1.text === "Загрузить ещё 10 комментариев из 25" && !btn1.hidden, JSON.stringify(btn1));

await clickAndWait(); // page2 -> +7..15
await clickAndWait(); // page3 -> +1..6, shown=25 -> hide
const finalIds = await page.evaluate(() => window.__ids());
const btnF = await page.evaluate(() => window.__btn());
const expected = JSON.stringify(Array.from({length:25},(_,i)=>String(i+1)));
assert("Все 25 по порядку 1..25", JSON.stringify(finalIds) === expected, JSON.stringify(finalIds));
assert("Нет дублей", new Set(finalIds).size === finalIds.length, "");
assert("Кнопка скрыта когда всё показано", btnF.hidden, JSON.stringify(btnF));

await browser.close();
console.log("\n=== РЕЗУЛЬТАТЫ (догрузка по 10) ===");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}  ${r.pass ? "" : "-> " + r.detail}`);
  if (!r.pass) ok = false;
}
console.log(ok ? "\nВСЕ ТЕСТЫ ПРОЙДЕНЫ" : "\nЕСТЬ ПРОВАЛЫ");
process.exit(ok ? 0 : 1);
