const KEY = "akk-trainer-v1";
const REMOTE = "https://extendsclass.com/api/json-storage/bin/dabdfdd";
const bank = window.BANK;
const app = document.getElementById("app");

const state = load();
let screen = "home";
let quiz = null;
let study = null;
let syncing = Promise.resolve();
const INTERVALS_HOURS = [4, 24, 24, 48, 72];
const byId = Object.fromEntries(bank.questions.map((q) => [q.id, q]));

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && raw.wrongs && raw.seen) return raw;
  } catch (e) {}
  return { wrongs: [], seen: {}, updated: 0 };
}
function writeLocal() {
  localStorage.setItem(KEY, JSON.stringify(state));
}
function save(replace) {
  state.updated = Date.now();
  writeLocal();
  renderTop();
  syncing = syncing.then(() => pushRemote(replace)).catch(() => {});
}
function applyState(next) {
  state.wrongs = next.wrongs || [];
  state.seen = next.seen || {};
  state.days = next.days || state.days || {};
  state.learn = next.learn || state.learn || {};
  state.updated = next.updated || 0;
}
function saneDay(key) {
  return typeof key === "string" && key >= "2024-01-01" && key <= "2100-01-01";
}
function dayKey(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n < Date.UTC(2024, 0, 1)) return "";
  const d = new Date(n);
  const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function mergeDays(a, b) {
  const out = {};
  new Set([...Object.keys(a || {}), ...Object.keys(b || {})]).forEach((key) => {
    if (!saneDay(key)) return;
    const x = (a || {})[key] || {};
    const y = (b || {})[key] || {};
    const ok = Math.max(x.ok || 0, y.ok || 0);
    const bad = Math.max(x.bad || 0, y.bad || 0);
    if (ok || bad) out[key] = { ok, bad };
  });
  return out;
}
function ensureDays() {
  if (!state.days) {
    const days = {};
    const add = (key, field, n) => {
      if (!key) return;
      const row = days[key] || { ok: 0, bad: 0 };
      row[field] += n;
      days[key] = row;
    };
    (state.wrongs || []).forEach((w) => add(dayKey(w.at), "bad", 1));
    const oks = Object.values(state.seen || {}).reduce((n, s) => n + (s.ok || 0), 0);
    if (oks) add(dayKey(Date.now()), "ok", oks);
    state.days = days;
  }
  Object.keys(state.days).forEach((key) => { if (!saneDay(key)) delete state.days[key]; });
}
function bumpDay(ok) {
  if (!state.days) state.days = {};
  const key = dayKey(Date.now());
  if (!key) return;
  const row = state.days[key] || { ok: 0, bad: 0 };
  if (ok) row.ok += 1;
  else row.bad += 1;
  state.days[key] = row;
}
function mergeState(a, b) {
  const seen = {};
  const ids = new Set([...Object.keys(a.seen || {}), ...Object.keys(b.seen || {})]);
  ids.forEach((id) => {
    const x = (a.seen || {})[id] || {};
    const y = (b.seen || {})[id] || {};
    const ok = Math.max(x.ok || 0, y.ok || 0);
    const bad = Math.max(x.bad || 0, y.bad || 0);
    const xN = (x.ok || 0) + (x.bad || 0);
    const yN = (y.ok || 0) + (y.bad || 0);
    const last = yN > xN ? y.last : xN > yN ? x.last : ((b.updated || 0) >= (a.updated || 0) ? y.last || x.last : x.last || y.last);
    if (ok || bad) seen[id] = { ok, bad, last };
  });
  const map = new Map();
  [...(a.wrongs || []), ...(b.wrongs || [])].forEach((w) => {
    if (w && w.id) map.set(w.id + "|" + w.at, w);
  });
  const wrongs = [...map.values()].sort((p, q) => (q.at || 0) - (p.at || 0)).slice(0, 120);
  return { wrongs, seen, days: mergeDays(a.days, b.days), learn: mergeLearn(a.learn, b.learn), updated: Math.max(a.updated || 0, b.updated || 0) };
}
function mergeLearn(a, b) {
  const out = {};
  new Set([...Object.keys(a || {}), ...Object.keys(b || {})]).forEach((id) => {
    const x = (a || {})[id];
    const y = (b || {})[id];
    if (!x) out[id] = y;
    else if (!y) out[id] = x;
    else out[id] = (y.at || 0) >= (x.at || 0) ? y : x;
  });
  return out;
}
async function pullRemote() {
  const res = await fetch(REMOTE, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.wrongs || !data.seen) return null;
  return data;
}
async function pushRemote(replace) {
  if (!replace) {
    const remote = await pullRemote();
    if (remote) applyState(mergeState(state, remote));
  }
  state.updated = Date.now();
  writeLocal();
  const res = await fetch(REMOTE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wrongs: state.wrongs, seen: state.seen, days: state.days || {}, learn: state.learn || {}, updated: state.updated }),
  });
  if (!res.ok) throw new Error("sync");
}
async function refreshFromRemote() {
  try {
    const remote = await pullRemote();
    if (remote) applyState(mergeState(state, remote));
    writeLocal();
    renderTop();
    if (screen === "home") renderHome();
    else if (screen === "stats") renderStats();
    else if (screen === "wrongs") renderLearnHome();
    const pack = (s) => JSON.stringify({ wrongs: s.wrongs, seen: s.seen, days: s.days || {}, learn: s.learn || {} });
    const localKey = pack(state);
    const remoteKey = remote ? pack(remote) : "";
    if (localKey !== remoteKey) syncing = syncing.then(() => pushRemote(true)).catch(() => {});
  } catch (e) {}
}
window.addEventListener("focus", () => { refreshFromRemote(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshFromRemote();
});

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function bySubject(id) {
  return bank.questions.filter((q) => !id || q.subject === id);
}

function record(q, ok, picked) {
  const prev = state.seen[q.id] || { ok: 0, bad: 0 };
  if (ok) prev.ok += 1;
  else prev.bad += 1;
  prev.last = ok ? "ok" : "bad";
  state.seen[q.id] = prev;
  bumpDay(ok);
  if (!state.learn) state.learn = {};
  if (!ok) {
    state.wrongs.unshift({
      id: q.id,
      subject: q.subject,
      prompt: q.prompt,
      picked: picked || "—",
      answer: showAnswer(q),
      at: Date.now(),
    });
    state.wrongs = state.wrongs.slice(0, 120);
    if (!record.keepLearn) state.learn[q.id] = { stage: 0, due: Date.now(), at: Date.now() };
  } else {
    state.wrongs = state.wrongs.filter((w) => w.id !== q.id);
    const cur = state.learn[q.id];
    if (cur && cur.stage < 5 && !record.keepLearn) {
      const from = cur.stage || 0;
      state.learn[q.id] = { stage: from >= 4 ? 5 : from + 1, due: dueAfter(from), at: Date.now() };
    }
  }
  save();
}

function showAnswer(q) {
  if (q.type === "match") return q.pairs.map((p) => p[0] + " → " + p[1]).join("; ");
  if (q.type === "order") return q.steps.join(" → ");
  return q.answer;
}

function statsFor(subject) {
  const qs = bySubject(subject);
  let attempts = 0, correct = 0, failed = 0, seenCount = 0;
  qs.forEach((q) => {
    const s = state.seen[q.id];
    if (!s) return;
    seenCount += 1;
    attempts += s.ok + s.bad;
    correct += s.ok;
    if (s.last === "bad") failed += 1;
  });
  const passed = seenCount - failed;
  const share = (n) => (qs.length ? (n / qs.length) * 100 : 0);
  return {
    total: qs.length,
    attempts,
    correct,
    failed,
    seenCount,
    passed,
    acc: attempts ? Math.round((correct / attempts) * 100) : 0,
    okPct: share(passed),
    badPct: share(failed),
  };
}

function barHtml(st) {
  return `<div class="bar"><i class="ok" style="width:${st.okPct}%"></i><i class="bad" style="width:${st.badPct}%"></i></div>`;
}

function renderTop() {
  const s = statsFor(null);
  const due = dueCards(null).length;
  document.getElementById("top-stats").innerHTML =
    `<b>${s.acc}%</b> верно<br>${s.correct}/${s.attempts || 0} · к повторению ${due}`;
}

function setTab(name) {
  screen = name;
  quiz = null;
  study = null;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  if (name === "home") renderHome();
  if (name === "wrongs") renderLearnHome();
  if (name === "stats") renderStats();
}

document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

function renderHome() {
  const all = statsFor(null);
  app.innerHTML = `
    <h2>Предметы</h2>
    <p class="muted">Выбери предмет. После ответа сразу видно, верно или нет. Ошибки уходят в заучивание по предметам. Прогресс один и тот же на всех устройствах.</p>
    <div class="card" style="margin-bottom:12px">
      <div class="row">
        <div><b>Все сразу</b><div class="muted">${all.seenCount} из ${all.total} пройдено · верных ${all.acc}%</div></div>
        <button class="go" id="all">Тест</button>
      </div>
      ${barHtml(all)}
    </div>
    <div class="grid">
      ${bank.subjects.map((s) => {
        const st = statsFor(s.id);
        return `<button class="card subj" data-s="${s.id}">
          <h3>${s.id} · ${s.name}</h3>
          <div class="muted">${st.seenCount} из ${st.total} · верных ${st.acc}% · ошибок ${st.failed}</div>
          ${barHtml(st)}
        </button>`;
      }).join("")}
    </div>`;
  document.getElementById("all").onclick = () => startQuiz(null, "all");
  app.querySelectorAll(".subj").forEach((b) => b.onclick = () => startQuiz(b.dataset.s, "all"));
}

function startQuiz(subject, mode) {
  screen = "quiz";
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("on"));
  let pool = bySubject(subject);
  if (mode === "wrong") {
    const ids = new Set(state.wrongs.filter((w) => !subject || w.subject === subject).map((w) => w.id));
    pool = pool.filter((q) => ids.has(q.id) || (state.seen[q.id] && state.seen[q.id].last === "bad"));
  }
  quiz = { subject, mode, queue: shuffle(pool), index: 0, sessionOk: 0, sessionN: 0, card: null };
  if (!quiz.queue.length) {
    app.innerHTML = `<h2>Пусто</h2><p class="empty">В этом наборе нет вопросов.</p><button class="ghost" id="back">Назад</button>`;
    document.getElementById("back").onclick = () => setTab("home");
    return;
  }
  renderCard();
}

function current() {
  return quiz.queue[quiz.index];
}

function renderCard() {
  const q = current();
  if (!q) return renderDone();
  const name = quiz.subject ? bank.subjects.find((s) => s.id === quiz.subject).name : "Все предметы";
  const kind = { text: "Открытый", choice: "Открытый", mcq: "Тест", match: "Соответствие", order: "Порядок" }[q.type];
  quiz.card = { q, locked: false, built: buildCard(q) };
  app.innerHTML = `
    <div class="row">
      <div><div class="badge">${kind} · ${q.subject}</div><div class="muted">${name} · ${quiz.index + 1} / ${quiz.queue.length}</div></div>
      <button class="ghost" id="quit">Выйти</button>
    </div>
    <div class="qcard" id="card"></div>`;
  document.getElementById("quit").onclick = () => setTab("home");
  paintCard();
}

function buildCard(q) {
  if (q.type === "mcq") {
    const letters = ["а", "б", "в", "г", "д", "е"];
    return { options: q.options.map((text, i) => ({ text, letter: letters[i] || String(i + 1) })) };
  }
  if (q.type === "text" || q.type === "choice") return {};
  if (q.type === "match") {
    return { rights: shuffle(q.pairs.map((p) => p[1])) };
  }
  if (q.type === "order") return { left: shuffle(q.steps), picked: [] };
  return {};
}

function paintCard() {
  const { q, built, locked } = quiz.card;
  const card = document.getElementById("card");
  let body = `<div class="q-prompt">${escapeHtml(q.prompt)}</div>`;
  if (q.type === "mcq") {
    body += `<div class="options">${built.options.map((o, i) =>
      `<button class="opt" data-i="${i}">${o.letter ? `<b>${o.letter})</b> ` : ""}${escapeHtml(o.text)}</button>`
    ).join("")}</div>`;
  } else if (q.type === "text" || q.type === "choice") {
    body += `<input class="answer" id="ans" autocomplete="off" placeholder="напиши ответ">
      <div class="actions"><button class="go" id="check">Проверить</button></div>`;
  } else if (q.type === "match") {
    body += q.pairs.map((p, i) => `
      <div class="pair">
        <div>${escapeHtml(p[0])}</div>
        <select data-i="${i}"><option value="">выбери</option>${built.rights.map((r) => `<option>${escapeHtml(r)}</option>`).join("")}</select>
      </div>`).join("") + `<div class="actions"><button class="go" id="check">Проверить</button></div>`;
  } else if (q.type === "order") {
    body += `<div class="muted">Нажимай шаги в правильном порядке</div>
      <div class="picked" id="picked"></div>
      <div class="chips" id="pool"></div>
      <div class="actions"><button class="ghost" id="undo">Сбросить</button><button class="go" id="check">Проверить</button></div>`;
  }
  body += `<div id="feedback"></div>`;
  card.innerHTML = body;
  if (q.type === "mcq") {
    card.querySelectorAll(".opt").forEach((b) => b.onclick = () => {
      if (quiz.card.locked) return;
      const picked = built.options[b.dataset.i].text;
      const ok = norm(picked) === norm(q.answer);
      quiz.card.locked = true;
      b.classList.add(ok ? "good" : "bad");
      if (!ok) {
        card.querySelectorAll(".opt").forEach((x) => {
          if (norm(built.options[x.dataset.i].text) === norm(q.answer)) x.classList.add("good");
        });
      }
      finish(ok, picked);
    });
  } else if (q.type === "text" || q.type === "choice") {
    const input = document.getElementById("ans");
    const check = () => {
      if (quiz.card.locked) return;
      const picked = input.value.trim();
      const ok = norm(picked) === norm(q.answer);
      quiz.card.locked = true;
      input.disabled = true;
      finish(ok, picked || "—");
    };
    document.getElementById("check").onclick = check;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
    input.focus();
  } else if (q.type === "match") {
    document.getElementById("check").onclick = () => {
      if (quiz.card.locked) return;
      const selects = [...card.querySelectorAll("select")];
      const ok = q.pairs.every((p, i) => norm(selects[i].value) === norm(p[1]));
      quiz.card.locked = true;
      const picked = selects.map((s, i) => q.pairs[i][0] + "→" + (s.value || "—")).join("; ");
      finish(ok, picked);
    };
  } else {
    const draw = () => {
      document.getElementById("picked").innerHTML = built.picked.map((s, i) => `<button class="chip" data-p="${i}">${i + 1}. ${escapeHtml(s)}</button>`).join("");
      document.getElementById("pool").innerHTML = built.left.map((s, i) => `<button class="chip" data-l="${i}">${escapeHtml(s)}</button>`).join("");
      document.querySelectorAll("#picked .chip").forEach((b) => b.onclick = () => {
        if (quiz.card.locked) return;
        built.left.push(built.picked.splice(b.dataset.p, 1)[0]);
        draw();
      });
      document.querySelectorAll("#pool .chip").forEach((b) => b.onclick = () => {
        if (quiz.card.locked) return;
        built.picked.push(built.left.splice(b.dataset.l, 1)[0]);
        draw();
      });
    };
    draw();
    document.getElementById("undo").onclick = () => {
      if (quiz.card.locked) return;
      built.left = shuffle(q.steps);
      built.picked = [];
      draw();
    };
    document.getElementById("check").onclick = () => {
      if (quiz.card.locked) return;
      const ok = built.picked.length === q.steps.length && built.picked.every((s, i) => norm(s) === norm(q.steps[i]));
      quiz.card.locked = true;
      finish(ok, built.picked.join(" → ") || "—");
    };
  }
}

function finish(ok, picked) {
  const q = quiz.card.q;
  quiz.sessionN += 1;
  if (ok) quiz.sessionOk += 1;
  record(q, ok, picked);
  const card = document.getElementById("card");
  card.querySelectorAll(".actions").forEach((el) => el.remove());
  card.querySelectorAll("select, input, button").forEach((el) => { el.disabled = true; });
  const box = document.getElementById("feedback");
  box.innerHTML = `<div class="banner ${ok ? "good" : "bad"}">
    <b>${ok ? "Верно" : "Неверно"}</b>
    <div>${ok ? "" : "Правильно: " + escapeHtml(showAnswer(q))}</div>
  </div>
  <div class="actions"><button class="go" id="next">${quiz.index + 1 >= quiz.queue.length ? "Итог" : "Дальше"}</button></div>`;
  document.getElementById("next").onclick = () => {
    quiz.index += 1;
    renderCard();
  };
}

function renderDone() {
  const acc = quiz.sessionN ? Math.round((quiz.sessionOk / quiz.sessionN) * 100) : 0;
  app.innerHTML = `
    <h2>Сессия</h2>
    <div class="card"><b>${acc}%</b><div class="muted">${quiz.sessionOk} верных из ${quiz.sessionN}</div></div>
    <div class="actions">
      <button class="go" id="again">Ещё раз</button>
      <button class="ghost" id="wrong">Заучить ошибки</button>
      <button class="ghost" id="home">К предметам</button>
    </div>`;
  document.getElementById("again").onclick = () => startQuiz(quiz.subject, "all");
  document.getElementById("wrong").onclick = () => startStudy(quiz.subject);
  document.getElementById("home").onclick = () => setTab("home");
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function dueAfter(stage) {
  const hours = INTERVALS_HOURS[Math.min(stage, INTERVALS_HOURS.length - 1)];
  return Date.now() + hours * 3600000;
}
function whenLabel(ts) {
  const days = Math.round((startOfDay(ts) - startOfDay(Date.now())) / 86400000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  return "через " + days + " дн.";
}
function ensureLearn() {
  if (!state.learn) state.learn = {};
  const now = Date.now();
  const ids = new Set((state.wrongs || []).map((w) => w.id));
  Object.keys(state.seen || {}).forEach((id) => {
    if (state.seen[id].last === "bad") ids.add(id);
  });
  ids.forEach((id) => {
    if (!byId[id] || state.learn[id]) return;
    state.learn[id] = { stage: 0, due: now, at: now };
  });
  Object.keys(state.learn).forEach((id) => {
    const rec = state.learn[id];
    if (!rec || rec.stage >= 5) return;
    const cap = now + INTERVALS_HOURS[Math.min(rec.stage, 4)] * 3600000;
    if (rec.due > cap) {
      rec.due = cap;
      rec.at = now;
    }
  });
}
function dueCards(subject) {
  ensureLearn();
  const now = Date.now();
  return bank.questions.filter((q) => {
    if (subject && q.subject !== subject) return false;
    const rec = state.learn[q.id];
    return rec && rec.stage < 5 && rec.due <= now;
  });
}
function deckSummary(id) {
  ensureLearn();
  const now = Date.now();
  const sum = { due: 0, later: 0, learned: 0, soon: null };
  bank.questions.forEach((q) => {
    if (q.subject !== id) return;
    const rec = state.learn[q.id];
    if (!rec) return;
    if (rec.stage >= 5) sum.learned += 1;
    else if (rec.due <= now) sum.due += 1;
    else {
      sum.later += 1;
      if (sum.soon === null || rec.due < sum.soon) sum.soon = rec.due;
    }
  });
  return sum;
}
function renderLearnHome() {
  screen = "wrongs";
  study = null;
  ensureLearn();
  const due = dueCards(null);
  const rows = bank.subjects.map((s) => ({ s, sum: deckSummary(s.id) })).filter((r) => r.sum.due || r.sum.later || r.sum.learned);
  app.innerHTML = `
    <h2>Заучивание</h2>
    <p class="muted">Сначала смотришь ответ, потом вспоминаешь. Ошибка в пачке вернётся через пару карточек и ещё раз сегодня. Верный ответ тоже вернётся сегодня, потом на следующий день: за неделю карточка доходит до «выучено».</p>
    <div class="card" style="margin-bottom:12px">
      <div class="row">
        <div><b>${due.length}</b><div class="muted">к повторению сегодня</div></div>
        <button class="go" id="go-all" ${due.length ? "" : "disabled"}>Учить</button>
      </div>
    </div>
    <div class="list">
      ${rows.length ? rows.map(({ s, sum }) => `
        <button class="card deck" data-s="${s.id}" ${sum.due ? "" : "disabled"}>
          <h3>${s.id} · ${s.name}</h3>
          <div class="muted">${sum.due} к повторению${sum.later ? ` · ${sum.later} ждут, ближайшее ${whenLabel(sum.soon)}` : ""}${sum.learned ? ` · ${sum.learned} выучено` : ""}</div>
        </button>`).join("") : `<div class="empty">Пока нечего учить. Ошибки из тестов сами разложатся по предметам.</div>`}
    </div>`;
  const all = document.getElementById("go-all");
  if (all) all.onclick = () => startStudy(null);
  app.querySelectorAll(".deck").forEach((b) => {
    if (b.disabled) return;
    b.onclick = () => startStudy(b.dataset.s);
  });
}
function startStudy(subject) {
  const batch = shuffle(dueCards(subject)).slice(0, 7);
  if (!batch.length) return renderLearnHome();
  const previews = shuffle(batch.filter((q) => (state.learn[q.id].stage || 0) === 0)).map((q) => ({ id: q.id, tier: 0 }));
  screen = "study";
  study = {
    subject,
    batch,
    queue: previews,
    later: [],
    tries: {},
    finished: [],
    current: null,
    built: null,
    locked: false,
    phase: previews.length ? "preview" : "test",
  };
  if (!previews.length) study.queue = testQueue(batch);
  nextStudy();
}
function testQueue(batch) {
  return shuffle(batch.map((q) => ({ id: q.id, tier: q.type === "order" || q.type === "match" ? 2 : 1 })));
}
function nextStudy() {
  if (!study.queue.length && study.phase === "preview") {
    study.phase = "test";
    study.queue = testQueue(study.batch);
  } else if (!study.queue.length && study.phase === "test") {
    study.phase = "prod";
    study.queue = shuffle(study.later);
    study.later = [];
  }
  if (!study.queue.length) return renderStudyDone();
  study.current = study.queue.shift();
  study.locked = false;
  study.built = buildStudy(byId[study.current.id], study.current.tier);
  renderStudyCard();
}
function choicesFor(q) {
  if (q.type === "mcq") return q.options.slice();
  const pool = bank.questions
    .filter((x) => x.subject === q.subject && x.id !== q.id && x.answer && norm(x.answer) !== norm(q.answer) && x.answer.length < 90)
    .map((x) => x.answer);
  return [q.answer, ...shuffle([...new Set(pool)]).slice(0, 3)];
}
function buildStudy(q, tier) {
  if (tier === 0) return {};
  if (tier === 2 && q.type === "order") return { left: shuffle(q.steps.slice()), picked: [] };
  if (tier === 2 && q.type === "match") return { rights: shuffle(q.pairs.map((p) => p[1])) };
  if (tier === 1) return { options: shuffle(choicesFor(q)) };
  return {};
}
function revealHtml(q) {
  if (q.type === "order") return `<ol class="steps-view">${q.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`;
  if (q.type === "match") return q.pairs.map((p) => `<div class="pair-line"><span>${escapeHtml(p[0])}</span><span>${escapeHtml(p[1])}</span></div>`).join("");
  return `<div class="reveal">${escapeHtml(q.answer)}</div>`;
}
function renderStudyCard() {
  const item = study.current;
  const q = byId[item.id];
  const name = bank.subjects.find((s) => s.id === q.subject).name;
  const kind = item.tier === 0 ? "Запомни" : item.tier === 1 ? "Узнай" : "Вспомни";
  app.innerHTML = `
    <div class="row">
      <div><div class="badge">${kind} · ${q.subject}</div><div class="muted">${name} · ${study.finished.length} / ${study.batch.length}</div></div>
      <button class="ghost" id="quit">Выйти</button>
    </div>
    <div class="qcard" id="card"></div>`;
  document.getElementById("quit").onclick = () => setTab("wrongs");
  const card = document.getElementById("card");
  let body = `<div class="q-prompt">${escapeHtml(q.prompt)}</div>`;
  if (item.tier === 0) {
    body += `${revealHtml(q)}<div class="actions"><button class="go" id="next">Запомнил</button></div>`;
  } else if (item.tier === 1) {
    body += `<div class="options">${study.built.options.map((text, i) => `<button class="opt" data-i="${i}">${escapeHtml(text)}</button>`).join("")}</div>`;
  } else if (q.type === "order") {
    body += `<div class="muted">Нажимай шаги в правильном порядке</div><div class="picked" id="picked"></div><div class="chips" id="pool"></div>
      <div class="actions"><button class="ghost" id="undo">Сбросить</button><button class="go" id="check">Проверить</button></div>`;
  } else if (q.type === "match") {
    body += q.pairs.map((p, i) => `<div class="pair"><div>${escapeHtml(p[0])}</div><select data-i="${i}"><option value="">выбери</option>${study.built.rights.map((r) => `<option>${escapeHtml(r)}</option>`).join("")}</select></div>`).join("") +
      `<div class="actions"><button class="go" id="check">Проверить</button></div>`;
  } else {
    body += `<input class="answer" id="ans" autocomplete="off" placeholder="напиши ответ"><div class="actions"><button class="go" id="check">Проверить</button></div>`;
  }
  body += `<div id="feedback"></div>`;
  card.innerHTML = body;
  if (item.tier === 0) document.getElementById("next").onclick = () => nextStudy();
  else if (item.tier === 1) card.querySelectorAll(".opt").forEach((b) => b.onclick = () => {
    if (study.locked) return;
    studyGrade(norm(study.built.options[b.dataset.i]) === norm(q.answer), study.built.options[b.dataset.i]);
  });
  else if (q.type === "order") bindOrder(q);
  else if (q.type === "match") document.getElementById("check").onclick = () => {
    if (study.locked) return;
    const selects = [...card.querySelectorAll("select")];
    const ok = q.pairs.every((p, i) => norm(selects[i].value) === norm(p[1]));
    studyGrade(ok, selects.map((s, i) => q.pairs[i][0] + "→" + (s.value || "—")).join("; "));
  };
  else {
    const check = () => {
      if (study.locked) return;
      const picked = document.getElementById("ans").value.trim();
      studyGrade(norm(picked) === norm(q.answer), picked || "—");
    };
    document.getElementById("check").onclick = check;
    document.getElementById("ans").addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
    document.getElementById("ans").focus();
  }
}
function bindOrder(q) {
  const draw = () => {
    document.getElementById("picked").innerHTML = study.built.picked.map((s, i) => `<button class="chip" data-p="${i}">${i + 1}. ${escapeHtml(s)}</button>`).join("");
    document.getElementById("pool").innerHTML = study.built.left.map((s, i) => `<button class="chip" data-l="${i}">${escapeHtml(s)}</button>`).join("");
    document.querySelectorAll("#picked .chip").forEach((b) => b.onclick = () => {
      if (study.locked) return;
      study.built.left.push(study.built.picked.splice(b.dataset.p, 1)[0]);
      draw();
    });
    document.querySelectorAll("#pool .chip").forEach((b) => b.onclick = () => {
      if (study.locked) return;
      study.built.picked.push(study.built.left.splice(b.dataset.l, 1)[0]);
      draw();
    });
  };
  draw();
  document.getElementById("undo").onclick = () => {
    if (study.locked) return;
    study.built.left = shuffle(q.steps.slice());
    study.built.picked = [];
    draw();
  };
  document.getElementById("check").onclick = () => {
    if (study.locked) return;
    const ok = study.built.picked.length === q.steps.length && study.built.picked.every((s, i) => norm(s) === norm(q.steps[i]));
    studyGrade(ok, study.built.picked.join(" → ") || "—");
  };
}
function studyGrade(ok, picked) {
  const item = study.current;
  const q = byId[item.id];
  study.locked = true;
  const card = document.getElementById("card");
  card.querySelectorAll("select, input, button").forEach((el) => { el.disabled = true; });
  if (ok && item.tier === 1) study.later.push({ id: item.id, tier: 2 });
  else if (ok) commitStudy(q, true, picked);
  else {
    const key = item.id + "|" + item.tier;
    study.tries[key] = (study.tries[key] || 0) + 1;
    if (study.tries[key] < 2) study.queue.splice(Math.min(study.queue.length, 2), 0, { id: item.id, tier: item.tier });
    else commitStudy(q, false, picked);
  }
  document.getElementById("feedback").innerHTML = `<div class="banner ${ok ? "good" : "bad"}"><b>${ok ? "Верно" : "Неверно"}</b><div>${ok ? "" : escapeHtml(showAnswer(q))}</div></div><div class="actions"><button class="go" id="next">Дальше</button></div>`;
  document.getElementById("next").onclick = () => nextStudy();
}
function commitStudy(q, ok, picked) {
  const from = (state.learn[q.id] && state.learn[q.id].stage) || 0;
  if (ok) state.learn[q.id] = { stage: from >= 4 ? 5 : from + 1, due: dueAfter(from), at: Date.now() };
  else state.learn[q.id] = { stage: 0, due: Date.now() + 3 * 3600000, at: Date.now() };
  if (!study.finished.includes(q.id)) study.finished.push(q.id);
  record.keepLearn = true;
  record(q, ok, picked);
  record.keepLearn = false;
}
function renderStudyDone() {
  const again = dueCards(study.subject).length;
  app.innerHTML = `
    <h2>Пачка готова</h2>
    <div class="card"><b>${study.finished.length}</b><div class="muted">карточек закрыто · ещё сегодня ${again}</div></div>
    <div class="actions">
      <button class="go" id="more" ${again ? "" : "disabled"}>Ещё пачку</button>
      <button class="ghost" id="home">К предметам</button>
    </div>`;
  document.getElementById("more").onclick = () => startStudy(study.subject);
  document.getElementById("home").onclick = () => setTab("wrongs");
}

function dayRows() {
  return Object.keys(state.days || {}).filter(saneDay).sort().map((key) => ({
    key,
    ok: state.days[key].ok || 0,
    bad: state.days[key].bad || 0,
  }));
}

function chartsHtml() {
  const rows = dayRows()
    .map((r) => ({ ...r, n: r.ok + r.bad }))
    .filter((r) => r.n > 100)
    .map((r) => ({ ...r, pct: Math.round((r.ok / r.n) * 100) }));
  if (!rows.length) {
    return `<div class="card chart"><b>Процент верных по дням</b><div class="empty">График ведётся с дня, в котором решено больше 100 вопросов.</div></div>`;
  }
  return `
    <div class="card chart">
      <b>Процент верных по дням</b>
      <div class="muted">Средний процент правильных. День попадает сюда, только если за него решено больше 100 вопросов.</div>
      ${percentChart(rows)}
    </div>`;
}

function percentChart(rows) {
  const w = Math.max(320, rows.length * 72);
  const h = 180;
  const padL = 36, padR = 16, padT = 22, padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const yOf = (pct) => padT + innerH - (pct / 100) * innerH;
  const xOf = (i) => padL + (rows.length === 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);
  const grids = [100, 50, 0].map((pct) => {
    const y = yOf(pct);
    return `<line class="grid" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}"></line>
      <text x="${padL - 8}" y="${y + 4}" text-anchor="end">${pct}</text>`;
  }).join("");
  const pts = rows.map((r, i) => ({ x: xOf(i), y: yOf(r.pct), ...r }));
  const line = `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}"></polyline>`;
  const dots = pts.map((p) => {
    const label = p.key.slice(8) + "." + p.key.slice(5, 7);
    return `<circle cx="${p.x}" cy="${p.y}" r="4"></circle>
      <text class="count" x="${p.x}" y="${Math.max(14, p.y - 10)}" text-anchor="middle">${p.pct}%</text>
      <text x="${p.x}" y="${h - 8}" text-anchor="middle">${label}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" role="img">${grids}${line}${dots}</svg>`;
}

function renderStats() {
  const all = statsFor(null);
  app.innerHTML = `
    <h2>Статистика</h2>
    ${chartsHtml()}
    <div class="card" style="margin-bottom:12px"><b>Общая ${all.acc}%</b><div class="muted">${all.correct} верных / ${all.attempts} попыток · вопросов ${all.total} · сейчас не закрыто ${all.failed}</div></div>
    <table>
      <tr><th>Предмет</th><th>Верно</th><th>%</th><th>Не закрыто</th></tr>
      ${bank.subjects.map((s) => {
        const st = statsFor(s.id);
        return `<tr><td>${s.id} ${s.name}</td><td>${st.correct}/${st.attempts || 0}</td><td>${st.acc}%</td><td>${st.failed}</td></tr>`;
      }).join("")}
    </table>
    <div class="actions"><button class="ghost" id="reset">Сбросить всё</button></div>`;
  document.getElementById("reset").onclick = () => {
    if (!confirm("Сбросить статистику и ошибки?")) return;
    state.wrongs = [];
    state.seen = {};
    state.days = {};
    state.learn = {};
    save(true);
    renderStats();
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

ensureDays();
renderTop();
setTab("home");
refreshFromRemote();
