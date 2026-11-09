const KEY = "akk-trainer-v1";
const REMOTE = "https://extendsclass.com/api/json-storage/bin/dabdfdd";
const bank = window.BANK;
const app = document.getElementById("app");

const state = load();
let screen = "home";
let wrongFilter = "all";
let quiz = null;
let syncing = Promise.resolve();

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
  state.updated = next.updated || 0;
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
  return { wrongs, seen, updated: Math.max(a.updated || 0, b.updated || 0) };
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
    body: JSON.stringify({ wrongs: state.wrongs, seen: state.seen, updated: state.updated }),
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
    else if (screen === "wrongs") renderWrongs(wrongFilter);
    const localKey = JSON.stringify({ wrongs: state.wrongs, seen: state.seen });
    const remoteKey = remote ? JSON.stringify({ wrongs: remote.wrongs, seen: remote.seen }) : "";
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
  let attempts = 0, correct = 0, failed = 0;
  qs.forEach((q) => {
    const s = state.seen[q.id];
    if (!s) return;
    attempts += s.ok + s.bad;
    correct += s.ok;
    if (s.last === "bad") failed += 1;
  });
  return { total: qs.length, attempts, correct, failed, acc: attempts ? Math.round((correct / attempts) * 100) : 0 };
}

function renderTop() {
  const s = statsFor(null);
  document.getElementById("top-stats").innerHTML =
    `<b>${s.acc}%</b> верно<br>${s.correct}/${s.attempts || 0} · ошибок в банке ${state.wrongs.length}`;
}

function setTab(name) {
  screen = name;
  quiz = null;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  if (name === "home") renderHome();
  if (name === "wrongs") renderWrongs("all");
  if (name === "stats") renderStats();
}

document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

function renderHome() {
  const all = statsFor(null);
  app.innerHTML = `
    <h2>Предметы</h2>
    <p class="muted">Выбери предмет. После ответа сразу видно, верно или нет. Ошибки копятся в банке. Прогресс один и тот же на всех устройствах.</p>
    <div class="card" style="margin-bottom:12px">
      <div class="row">
        <div><b>Все сразу</b><div class="muted">${all.total} вопросов · ${all.acc}% · не закрыто ${all.failed}</div></div>
        <button class="go" id="all">Тест</button>
      </div>
      <div class="bar"><i style="width:${all.acc}%"></i></div>
    </div>
    <div class="grid">
      ${bank.subjects.map((s) => {
        const st = statsFor(s.id);
        return `<button class="card subj" data-s="${s.id}">
          <h3>${s.id} · ${s.name}</h3>
          <div class="muted">${st.total} вопросов · ${st.acc}% · ошибок ${st.failed}</div>
          <div class="bar"><i style="width:${st.acc}%"></i></div>
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
  const kind = { text: "Открытый", choice: "Ответ", mcq: "Тест", match: "Соответствие", order: "Порядок" }[q.type];
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
  if (q.type === "choice") {
    const pool = bank.questions
      .filter((x) => (x.type === "choice" || x.type === "mcq") && norm(x.answer) !== norm(q.answer))
      .map((x) => x.answer);
    const uniq = shuffle([...new Set(pool)]).slice(0, 3);
    while (uniq.length < 3) uniq.push("—");
    return { options: shuffle([q.answer, ...uniq]).map((text) => ({ text })) };
  }
  if (q.type === "text") return {};
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
  if (q.type === "mcq" || q.type === "choice") {
    body += `<div class="options">${built.options.map((o, i) =>
      `<button class="opt" data-i="${i}">${o.letter ? `<b>${o.letter})</b> ` : ""}${escapeHtml(o.text)}</button>`
    ).join("")}</div>`;
  } else if (q.type === "text") {
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
  if (q.type === "mcq" || q.type === "choice") {
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
  } else if (q.type === "text") {
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
      <button class="ghost" id="wrong">Только ошибки</button>
      <button class="ghost" id="home">К предметам</button>
    </div>`;
  document.getElementById("again").onclick = () => startQuiz(quiz.subject, "all");
  document.getElementById("wrong").onclick = () => startQuiz(quiz.subject, "wrong");
  document.getElementById("home").onclick = () => setTab("home");
}

function renderWrongs(filter) {
  wrongFilter = filter;
  const items = state.wrongs.filter((w) => filter === "all" || w.subject === filter);
  app.innerHTML = `
    <h2>Ошибки</h2>
    <div class="filters">
      <button class="ghost ${filter === "all" ? "on" : ""}" data-f="all">Все</button>
      ${bank.subjects.map((s) => `<button class="ghost ${filter === s.id ? "on" : ""}" data-f="${s.id}">${s.id}</button>`).join("")}
    </div>
    <div class="actions" style="margin-top:0;margin-bottom:12px">
      <button class="go" id="drill">Пройти эти</button>
      <button class="ghost" id="clear">Очистить банк</button>
    </div>
    <div class="list">
      ${items.length ? items.slice(0, 80).map((w) => `
        <div class="card wrong">
          <div class="muted">${w.subject} · ${new Date(w.at).toLocaleString("ru")}</div>
          <div>${escapeHtml(w.prompt)}</div>
          <div class="was">твой: ${escapeHtml(w.picked)}</div>
          <div class="need">нужно: ${escapeHtml(w.answer)}</div>
        </div>`).join("") : `<div class="empty">Пока чисто.</div>`}
    </div>`;
  app.querySelectorAll(".filters button").forEach((b) => b.onclick = () => renderWrongs(b.dataset.f));
  document.getElementById("drill").onclick = () => startQuiz(filter === "all" ? null : filter, "wrong");
  document.getElementById("clear").onclick = () => {
    if (!confirm("Удалить сохранённые ошибки? Счёт попыток останется.")) return;
    state.wrongs = filter === "all" ? [] : state.wrongs.filter((w) => w.subject !== filter);
    save(true);
    renderWrongs(filter);
  };
}

function renderStats() {
  const all = statsFor(null);
  app.innerHTML = `
    <h2>Статистика</h2>
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
    save(true);
    renderStats();
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

renderTop();
setTab("home");
refreshFromRemote();
