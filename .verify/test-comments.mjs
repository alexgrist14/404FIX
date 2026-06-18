// Тесты рендера комментариев и дедупликации fetchComments (чистая логика, Node).

const COMMENTS_PER_PAGE = 30;
const COMMENTS_LOAD_STEP = 10;

// --- точные копии хелперов рендера из 404FIX.user.js ---
const escapeAttr = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const formatCommentDate = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch (e) { return ""; }
};
const renderCommentItem = (c) => {
  const url = escapeAttr(c.user_url || "#");
  const nick = escapeAttr(c.user || "Гость");
  const avatar = escapeAttr(c.avatar || "");
  const date = formatCommentDate(c.created_at);
  const body = c.html_body || "";
  return (
    `<div class="b-comment fix404-comment" id="comment-${escapeAttr(c.id)}" ` +
    `style="display:flex;gap:12px;padding:14px 0;border-top:1px solid rgba(128,128,128,.18);">` +
    (avatar ? `<a href="${url}" style="flex:none;"><img src="${avatar}" width="48" height="48" loading="lazy" style="width:48px;height:48px;border-radius:4px;display:block;"></a>` : "") +
    `<div style="flex:1;min-width:0;">` +
    `<div style="margin-bottom:5px;"><a href="${url}" style="font-weight:bold;">${nick}</a>` +
    (date ? `<span style="opacity:.5;font-size:12px;margin-left:8px;">${date}</span>` : "") +
    `</div>` +
    `<div class="b-text_with_paragraphs" style="word-wrap:break-word;overflow-wrap:anywhere;">${body}</div>` +
    `</div></div>`
  );
};
const renderCommentsHTML = (comments) => {
  if (!Array.isArray(comments) || comments.length === 0) return "";
  return comments.slice().reverse().map(renderCommentItem).join("");
};

// --- копия логики renderTemplate (часть комментариев) ---
const FRAGMENT = `<div class="b-comments"> <div class="fix404-load-more b-link" data-topic="{{TOPIC_ID}}" data-total="{{COMMENTS_TOTAL}}" data-nextpage="{{COMMENTS_NEXT_PAGE}}" style="cursor:pointer;text-align:center;padding:12px;">Загрузить ещё {{COMMENTS_LOAD_STEP}} комментариев из {{COMMENTS_TOTAL}}</div> <div class="fix404-comments-list">{{COMMENTS}}</div> <div class="comments-hider">Скрыть {{COMMENTS_COUNT}} комментариев</div> <div class="comments-expander">Показать {{COMMENTS_COUNT}} комментариев</div> <div class="comments-collapser hidden">свернуть</div> </div>`;

function render(template, data) {
  let html = template;
  const renderedComments = Array.isArray(data.COMMENTS) ? data.COMMENTS : [];
  const renderedCount = renderedComments.length;
  const commentsTotal = Number.isFinite(data.INFO.COMMENTS_TOTAL) ? data.INFO.COMMENTS_TOTAL : renderedCount;
  html = html.replaceAll("{{COMMENTS_COUNT}}", commentsTotal);
  html = html.replaceAll("{{COMMENTS_TOTAL}}", commentsTotal);
  html = html.replaceAll("{{COMMENTS_RENDERED}}", renderedCount);
  html = html.replaceAll("{{COMMENTS_NEXT_PAGE}}", 1);
  html = html.replaceAll("{{COMMENTS_LOAD_STEP}}", Math.min(COMMENTS_LOAD_STEP, Math.max(0, commentsTotal - renderedCount)));
  html = html.replaceAll("{{TOPIC_ID}}", data.INFO.TOPIC_ID || "");
  if (commentsTotal <= renderedCount) {
    html = html.replace(/<div class="fix404-load-more[\s\S]*?<\/div>/, "");
  }
  html = html.replaceAll("{{COMMENTS}}", renderCommentsHTML(renderedComments));
  return html;
}

// --- копия логики fetchComments (дедуп пагинации) ---
async function fetchComments(apiRequest, topicId, maxComments, startPage = 1, seen = new Set()) {
  if (!topicId) return [];
  const all = [];
  let page = startPage;
  while (all.length < maxComments) {
    const batch = await apiRequest(page);
    if (!Array.isArray(batch) || batch.length === 0) break;
    let added = 0;
    for (const c of batch) {
      if (c && !seen.has(c.id)) { seen.add(c.id); all.push(c); added++; }
    }
    if (added === 0) break;
    page++;
  }
  return all.slice(0, maxComments);
}

const results = [];
const assert = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

const mkComment = (id) => ({
  id, html_body: `text ${id}`, user: `u${id}`, user_url: `/u${id}`,
  avatar: `/a${id}.png`, created_at: "2025-08-26T21:34:41.589+03:00",
});

// 1. 0 комментов -> список пуст, кнопки нет.
{
  const html = render(FRAGMENT, { COMMENTS: [], INFO: { COMMENTS_TOTAL: 0, TOPIC_ID: 1 } });
  assert("0 комментов: нет кнопки, счётчик 0, пустой список",
    !html.includes("fix404-load-more") && !html.includes("fix404-comment\"") && html.includes("Скрыть 0"),
    html.slice(0, 200));
}

// 2. 3 коммента, все показаны -> рендерятся, кнопки нет, хронологический порядок.
{
  const comments = [mkComment(30), mkComment(20), mkComment(10)]; // новые->старые
  const html = render(FRAGMENT, { COMMENTS: comments, INFO: { COMMENTS_TOTAL: 3, TOPIC_ID: 5 } });
  const i10 = html.indexOf("comment-10"), i20 = html.indexOf("comment-20"), i30 = html.indexOf("comment-30");
  assert("3 коммента: отрендерены, кнопки нет",
    html.includes('id="comment-10"') && html.includes('id="comment-20"') && html.includes('id="comment-30"') && !html.includes("fix404-load-more"),
    "");
  assert("Порядок хронологический (старые сверху: 10 < 20 < 30)", i10 < i20 && i20 < i30, `i10=${i10} i20=${i20} i30=${i30}`);
  assert("Тело и ник присутствуют", html.includes("text 10") && html.includes(">u10<"), "");
}

// 3. По умолчанию 3, всего больше -> кнопка "Загрузить ещё 10 ... из 120", nextpage=1.
{
  const comments = [mkComment(120), mkComment(119), mkComment(118)]; // 3 по умолчанию
  const html = render(FRAGMENT, { COMMENTS: comments, INFO: { COMMENTS_TOTAL: 120, TOPIC_ID: 77 } });
  const ok = html.includes("fix404-load-more") &&
    html.includes('data-total="120"') &&
    html.includes('data-topic="77"') &&
    html.includes('data-nextpage="1"') &&
    html.includes("Загрузить ещё 10 комментариев из 120");
  assert("3 по умолчанию: кнопка 'ещё 10 из 120', nextpage=1", ok, html.match(/fix404-load-more[\s\S]*?<\/div>/)?.[0]);
  // показаны ровно 3 (считаем по id="comment-, не путая с контейнером fix404-comments-list)
  const shown = (html.match(/id="comment-/g) || []).length;
  assert("Показано ровно 3 коммента по умолчанию", shown === 3, `shown=${shown}`);
  // кнопка ВЫШЕ списка комментариев
  assert("Кнопка 'Загрузить ещё' выше списка комментариев",
    html.indexOf("fix404-load-more") < html.indexOf("fix404-comments-list"),
    `btn=${html.indexOf("fix404-load-more")} list=${html.indexOf("fix404-comments-list")}`);
}

// 4. Экранирование XSS в нике/url (html_body намеренно НЕ экранируем — это готовый html от API).
{
  const html = renderCommentItem({ id: 9, user: 'A"><script>', user_url: 'x"', avatar: "", html_body: "<b>ok</b>" });
  assert("Экранирование ника/url (нет инъекции через атрибуты)",
    !html.includes('"><script>') && html.includes("A&quot;&gt;&lt;script&gt;") && html.includes('href="x&quot;"') && html.includes("<b>ok</b>"),
    html);
}

// 5. fetchComments: дедуп перекрывающихся страниц (последний id страницы = первый следующей).
{
  // эмулируем shikimori: page N возвращает [N*10..(N-1)*10] с перекрытием
  const pages = {
    1: [mkComment(60), mkComment(55), mkComment(50)],
    2: [mkComment(50), mkComment(45), mkComment(40)], // 50 — дубль
    3: [mkComment(40), mkComment(35), mkComment(30)], // 40 — дубль
    4: [mkComment(30)], // только дубль -> конец
  };
  const api = async (p) => pages[p] || [];
  const out = await fetchComments(api, 999, 50);
  const ids = out.map((c) => c.id);
  const uniq = new Set(ids).size === ids.length;
  assert("fetchComments: дедуп перекрытий (нет дублей, все собраны)",
    uniq && ids.join(",") === "60,55,50,45,40,35,30",
    ids.join(","));
}

// 6. fetchComments: уважает maxComments.
{
  const pages = { 1: Array.from({ length: 30 }, (_, i) => mkComment(100 - i)), 2: Array.from({ length: 30 }, (_, i) => mkComment(70 - i)) };
  const api = async (p) => pages[p] || [];
  const out = await fetchComments(api, 999, 40);
  assert("fetchComments: не больше maxComments (40)", out.length === 40, `len=${out.length}`);
}

console.log("\n=== РЕЗУЛЬТАТЫ (комментарии) ===");
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.name}`);
  if (!r.pass) { ok = false; console.log("   ->", r.detail); }
}
console.log(ok ? "\nВСЕ ТЕСТЫ ПРОЙДЕНЫ" : "\nЕСТЬ ПРОВАЛЫ");
process.exit(ok ? 0 : 1);
