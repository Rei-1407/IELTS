/* ============================================================
   IELTS Grammar Trainer — app.js
   ============================================================ */
(function () {
  'use strict';

  const P = window.IELTSParser;
  let DATA = null;          // kết quả parse
  let SEARCH_INDEX = [];    // {chId, chTitle, secTitle, body, secIdx}

  /* ================= utils ================= */
  const $ = sel => document.querySelector(sel);
  const view = () => $('#view');

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // markdown inline mini (cho câu bài tập / đáp án)
  function miniMd(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dstr(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(str, n) {
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 12);
    dt.setDate(dt.getDate() + n);
    return dstr(dt);
  }
  function fmtVN(str) {
    const [y, m, d] = str.split('-');
    return d + '/' + m + '/' + y;
  }
  const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

  /* ================= store ================= */
  const KEY = 'ielts75_v1';
  const store = {
    data: { settings: { theme: 'dark', lastChapter: 'c1' }, checkins: {}, chapters: {}, best: { streak: 0 }, gam: { xp: 0, examDate: null, badges: {}, counters: {} }, items: {}, vocab: [] },
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const d = JSON.parse(raw);
          this.data = Object.assign(this.data, d);
          this.data.settings = Object.assign({ theme: 'dark', lastChapter: 'c1' }, d.settings || {});
          this.data.gam = Object.assign({ xp: 0, examDate: null, badges: {}, counters: {} }, d.gam || {});
          if (!this.data.items) this.data.items = {};
          if (!this.data.vocab) this.data.vocab = [];
        }
      } catch (e) { console.warn('store load', e); }
    },
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { console.warn('store save', e); } }
  };

  /* ================= tiến độ / SRS ================= */
  function today() { return dstr(); }

  function numberedChapters() { return DATA.chapters.filter(c => c.kind === 'chapter'); }

  function learnedIds() { return Object.keys(store.data.chapters); }

  function dueChapters(onDate) {
    onDate = onDate || today();
    return Object.entries(store.data.chapters)
      .filter(([id, st]) => st.next <= onDate)
      .map(([id]) => id);
  }

  function todayChapter() {
    const learned = new Set(learnedIds());
    return numberedChapters().find(c => !learned.has(c.id)) || null;
  }

  function ensureCheckin(date) {
    date = date || today();
    if (!store.data.checkins[date]) {
      const c = counters();
      const days = Object.keys(store.data.checkins).sort();
      const last = days[days.length - 1];
      if (last && date > last) {
        const gap = Math.round((new Date(date + 'T12:00') - new Date(last + 'T12:00')) / 86400000);
        if (gap >= 4) c.comeback = true; // nghỉ >= 3 ngày rồi vẫn quay lại
      }
      store.data.checkins[date] = {};
      const h = new Date().getHours();
      if (h < 7) c.early = true;
      if (h >= 23) c.night = true;
      addXp(10, 'checkin');
    }
    return store.data.checkins[date];
  }

  function isCheckedIn(date) { return !!store.data.checkins[date || today()]; }

  function streak() {
    let d = today();
    if (!isCheckedIn(d)) d = addDays(d, -1);
    let n = 0;
    while (isCheckedIn(d)) { n++; d = addDays(d, -1); }
    return n;
  }

  function updateBestStreak() {
    const s = streak();
    if (s > (store.data.best.streak || 0)) store.data.best.streak = s;
  }

  function markLearned(chId) {
    const t = today();
    store.data.chapters[chId] = { learnedOn: t, interval: 1, next: addDays(t, 1) };
    const ci = ensureCheckin(t);
    ci.learned = ci.learned || [];
    if (!ci.learned.includes(chId)) ci.learned.push(chId);
    updateBestStreak();
    addXp(50, 'chương mới');
    awardBadges();
    checkMissionBonus();
    store.save();
    refreshStreakPill();
  }

  function unmarkLearned(chId) {
    delete store.data.chapters[chId];
    store.save();
  }

  function applySrsAfterDailyQuiz(score, total) {
    const t = today();
    const passed = total > 0 && score / total >= 0.7;
    dueChapters(t).forEach(id => {
      const st = store.data.chapters[id];
      if (!st) return;
      if (passed) {
        st.interval = Math.min((st.interval || 1) * 2, 64);
      } else {
        st.interval = 1;
      }
      st.next = addDays(t, st.interval);
    });
  }

  /* ================= SRS từng mục (Leitner) + từ vựng ================= */
  const BOX_DAYS = [1, 2, 4, 7, 15, 30]; // box 0..5

  function itemsStore() {
    if (!store.data.items) store.data.items = {};
    return store.data.items;
  }

  // Ghi kết quả 1 mục: đúng → lên box, giãn lịch; sai → về box 0, mai ôn lại
  function recordItem(id, ok) {
    if (!id) return;
    const st = itemsStore();
    const e = st[id] || { b: 0, s: 0, c: 0, n: today() };
    e.s = (e.s || 0) + 1;
    if (ok) { e.c = (e.c || 0) + 1; e.b = Math.min((e.b || 0) + 1, 5); }
    else e.b = 0;
    e.n = addDays(today(), BOX_DAYS[e.b]);
    st[id] = e;
    store.save();
  }

  // Sắp xếp pool ôn tập: đến hạn → chưa gặp → còn lại (trộn trong từng nhóm)
  function prioritize(arr, rng, idFn) {
    const t = today(), st = itemsStore();
    const due = [], unseen = [], rest = [];
    arr.forEach(x => {
      const e = st[idFn ? idFn(x) : x.id];
      if (!e) unseen.push(x);
      else if (e.n <= t) due.push(x);
      else rest.push(x);
    });
    return P.shuffled(due, rng).concat(P.shuffled(unseen, rng), P.shuffled(rest, rng));
  }

  // Độ phủ tài liệu: tổng mục có thể ôn / đã gặp / đã thuộc (box >= 3) / đến hạn
  function reviewStats() {
    const ids = [];
    DATA.pairs.forEach(p => ids.push(p.id));
    DATA.formulas.forEach(f => ids.push(f.id));
    DATA.verbs.forEach(v => ids.push(v.id));
    DATA.exercises.forEach(set => set.items.forEach(it => { if (it.a) ids.push(it.id); }));
    const t = today(), st = itemsStore();
    let seen = 0, known = 0, due = 0;
    ids.forEach(id => {
      const e = st[id];
      if (e) { seen++; if ((e.b || 0) >= 3) known++; if (e.n <= t) due++; }
    });
    return { total: ids.length, seen, known, due };
  }

  /* ----- sổ từ vựng ----- */
  function vocabList() {
    if (!store.data.vocab) store.data.vocab = [];
    return store.data.vocab;
  }
  function addVocab(w, m, ex) {
    w = (w || '').trim(); m = (m || '').trim(); ex = (ex || '').trim();
    if (!w || !m) return null;
    const id = 'w' + P.hash(w.toLowerCase());
    const list = vocabList();
    const existing = list.find(v => v.id === id);
    if (existing) { existing.m = m; if (ex) existing.ex = ex; store.save(); return existing; }
    const v = { id, w, m, ex, addedOn: today() };
    list.push(v);
    const c = counters();
    c.vocabAdded = (c.vocabAdded || 0) + 1;
    addXp(2, 'thêm từ');
    awardBadges();
    store.save();
    return v;
  }
  function delVocab(id) {
    store.data.vocab = vocabList().filter(v => v.id !== id);
    store.save();
  }
  // Từ đến hạn ôn (từ mới chưa ôn lần nào cũng tính là đến hạn)
  function dueVocabList() {
    const t = today(), st = itemsStore();
    return vocabList().filter(v => { const e = st[v.id]; return !e || e.n <= t; });
  }

  /* ================= gamification ================= */
  const LEVELS = [
    { band: '3.0', name: 'Khởi động', xp: 0 },
    { band: '3.5', name: 'Làm quen', xp: 100 },
    { band: '4.0', name: 'Người học chăm', xp: 250 },
    { band: '4.5', name: 'Vượt vỡ lòng', xp: 450 },
    { band: '5.0', name: 'Nửa chặng đường', xp: 700 },
    { band: '5.5', name: 'Tăng tốc', xp: 1000 },
    { band: '6.0', name: 'Vững ngữ pháp', xp: 1400 },
    { band: '6.5', name: 'Sát mục tiêu', xp: 1900 },
    { band: '7.0', name: 'Chạm ngưỡng', xp: 2500 },
    { band: '7.5', name: 'MỤC TIÊU ĐẠT! 🎯', xp: 3200 },
    { band: '8.0', name: 'Vượt kỳ vọng', xp: 4100 },
    { band: '8.5', name: 'Cao thủ', xp: 5100 },
    { band: '9.0', name: 'Huyền thoại ngữ pháp', xp: 6300 },
  ];
  function gam() {
    if (!store.data.gam) store.data.gam = { xp: 0, examDate: null, badges: {}, counters: {} };
    const g = store.data.gam;
    if (!g.counters) g.counters = {};
    if (!g.badges) g.badges = {};
    return g;
  }
  function counters() { return gam().counters; }
  function levelInfo(xp) {
    let idx = 0;
    for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) idx = i;
    const cur = LEVELS[idx], next = LEVELS[idx + 1] || null;
    const pct = next ? Math.min(100, Math.round((xp - cur.xp) / (next.xp - cur.xp) * 100)) : 100;
    return { idx, cur, next, pct };
  }
  function addXp(n, reason) {
    const g = gam();
    const before = levelInfo(g.xp).idx;
    g.xp += n;
    const after = levelInfo(g.xp);
    if (after.idx > before) { toast('⬆️ Thăng cấp: Band ' + after.cur.band + ' — ' + after.cur.name); confetti(); }
    store.save();
    refreshXpPill();
    return n;
  }
  function rangeLearned(a, b) { for (let i = a; i <= b; i++) if (!store.data.chapters['c' + i]) return false; return true; }
  const BADGES = [
    { id: 'streak3', ic: '🔥', nm: 'Nhóm lửa', ds: 'Chuỗi 3 ngày liên tiếp', test: () => streak() >= 3 },
    { id: 'streak7', ic: '⚡', nm: 'Tuần rực cháy', ds: 'Chuỗi 7 ngày liên tiếp', test: () => streak() >= 7 },
    { id: 'streak30', ic: '🌋', nm: 'Không thể cản', ds: 'Chuỗi 30 ngày liên tiếp', test: () => streak() >= 30 },
    { id: 'quiz1', ic: '📝', nm: 'Phát súng đầu', ds: 'Hoàn thành quiz đầu tiên', test: c => (c.quizzes || 0) >= 1 },
    { id: 'perfect1', ic: '💯', nm: 'Tuyệt đối', ds: 'Một quiz đúng 100%', test: c => (c.perfect || 0) >= 1 },
    { id: 'great10', ic: '🏆', nm: 'Thợ săn điểm', ds: '10 quiz đạt từ 90% trở lên', test: c => (c.great || 0) >= 10 },
    { id: 'correct100', ic: '🎯', nm: 'Trăm phát trăm trúng', ds: 'Tổng 100 câu trả lời đúng', test: c => (c.correct || 0) >= 100 },
    { id: 'correct500', ic: '🧠', nm: 'Bộ não ngữ pháp', ds: 'Tổng 500 câu trả lời đúng', test: c => (c.correct || 0) >= 500 },
    { id: 'part1', ic: '📗', nm: 'Nền móng vững', ds: 'Học xong Phần I (chương 1–10)', test: () => rangeLearned(1, 10) },
    { id: 'part2', ic: '📘', nm: 'Bậc thang nâng cao', ds: 'Học xong Phần II (chương 11–21)', test: () => rangeLearned(11, 21) },
    { id: 'part3', ic: '📙', nm: 'Tinh thông chuyên sâu', ds: 'Học xong Phần III (chương 22–30)', test: () => rangeLearned(22, 30) },
    { id: 'all30', ic: '🎓', nm: 'Tốt nghiệp giáo trình', ds: 'Hoàn thành cả 30 chương', test: () => rangeLearned(1, 30) },
    { id: 'cards10', ic: '🃏', nm: 'Vua lật thẻ', ds: 'Hoàn thành 10 phiên flashcard', test: c => (c.cards || 0) >= 10 },
    { id: 'early', ic: '🌅', nm: 'Chim sớm', ds: 'Điểm danh trước 7 giờ sáng', test: c => !!c.early },
    { id: 'night', ic: '🦉', nm: 'Cú đêm', ds: 'Điểm danh sau 23 giờ', test: c => !!c.night },
    { id: 'comeback', ic: '💪', nm: 'Trở lại lợi hại hơn', ds: 'Quay lại học sau khi nghỉ 3 ngày trở lên', test: c => !!c.comeback },
    { id: 'vocab50', ic: '📚', nm: 'Kho từ vựng', ds: 'Thêm 50 từ vào sổ từ vựng', test: c => (c.vocabAdded || 0) >= 50 },
    { id: 'known100', ic: '🗝️', nm: 'Khắc cốt ghi tâm', ds: 'Thuộc 100 mục kiến thức (box 3+)', test: () => reviewStats().known >= 100 },
  ];
  function awardBadges() {
    const g = gam();
    BADGES.forEach(b => {
      if (!g.badges[b.id] && b.test(counters())) {
        g.badges[b.id] = today();
        toast('🏅 Huy hiệu mới: ' + b.nm + '!');
        confetti();
      }
    });
    store.save();
  }
  function missionState() {
    const t = today();
    const ci = store.data.checkins[t] || {};
    const tc = todayChapter();
    return [
      { label: 'Điểm danh', done: !!store.data.checkins[t], go: '' },
      { label: 'Làm quiz ngày (10 câu)', done: !!ci.quiz, go: '#/quiz' },
      { label: tc ? 'Học chương mới hoặc luyện thêm' : 'Luyện tập / flashcard', done: !!((ci.learned && ci.learned.length) || ci.extra), go: tc ? '#/learn/' + tc.id : '#/cards' },
    ];
  }
  function checkMissionBonus() {
    const ci = store.data.checkins[today()];
    if (!ci || ci.bonus) return;
    if (missionState().every(m => m.done)) {
      ci.bonus = true;
      addXp(20, 'bonus ngày');
      toast('🎁 Trọn vẹn ngày — đủ 3 nhiệm vụ: +20 XP');
      store.save();
    }
  }

  /* ================= xây quiz ================= */
  function chNumById(id) { const c = DATA.chapters.find(x => x.id === id); return c ? c.num : null; }

  function buildQuiz(seedStr, scopeNums, n, withVocab) {
    n = n || 10;
    const rng = P.seededRng(seedStr);
    const inScope = ch => !scopeNums || scopeNums.has(ch);

    const pairsAll = DATA.pairs.slice();
    const formulasAll = DATA.formulas.slice();
    const exAll = [];
    DATA.exercises.forEach(set => set.items.forEach(it => {
      if (it.a) exAll.push({ set, it });
    }));

    // ưu tiên: mục đến hạn ôn → mục chưa gặp → còn lại
    const pairsIn = prioritize(pairsAll.filter(p => inScope(p.chapter)), rng);
    const pairsOut = P.shuffled(pairsAll.filter(p => !inScope(p.chapter)), rng);
    const formIn = prioritize(formulasAll.filter(f => inScope(f.chapter)), rng);
    const formOut = P.shuffled(formulasAll.filter(f => !inScope(f.chapter)), rng);
    const exIn = prioritize(exAll.filter(e => e.set.chapterRefs.length && e.set.chapterRefs.some(inScope)), rng, e => e.it.id);
    const exOut = P.shuffled(exAll.filter(e => !(e.set.chapterRefs.length && e.set.chapterRefs.some(inScope))), rng);

    function take(inArr, outArr, k) {
      const res = inArr.slice(0, k);
      if (res.length < k) res.push(...outArr.slice(0, k - res.length));
      return res;
    }

    const items = [];
    take(pairsIn, pairsOut, 4).forEach(p => {
      const opts = P.shuffled([{ text: p.right, correct: true }, { text: p.wrong, correct: false }], rng);
      items.push({ kind: 'mcq', pair: p, opts });
    });
    const formsForCloze = take(formIn, formOut, 8); // dư để lọc cloze hợp lệ
    let clozeCount = 0;
    const usedForCloze = new Set();
    for (const f of formsForCloze) {
      if (clozeCount >= 2) break;
      const c = P.makeCloze(f.back, rng);
      if (c) { items.push({ kind: 'cloze', f, c }); usedForCloze.add(f.id); clozeCount++; }
    }
    const cardPool = take(formIn, formOut, 10).filter(f => !usedForCloze.has(f.id));
    cardPool.slice(0, 2).forEach(f => items.push({ kind: 'card', id: f.id, front: f.front, back: f.back, sub: 'Chương ' + f.chapter }));
    take(exIn, exOut, 2).forEach(e => items.push({ kind: 'ex', set: e.set, it: e.it }));

    // trộn từ vựng đến hạn vào quiz (tối đa 2 từ)
    if (withVocab) {
      P.shuffled(dueVocabList(), rng).slice(0, 2).forEach(v => items.push({ kind: 'vcard', v }));
    }

    // bù nếu thiếu
    let idx = 4;
    while (items.length < n && pairsIn.concat(pairsOut)[idx]) {
      const p = pairsIn.concat(pairsOut)[idx++];
      const opts = P.shuffled([{ text: p.right, correct: true }, { text: p.wrong, correct: false }], rng);
      items.push({ kind: 'mcq', pair: p, opts });
    }
    return P.shuffled(items, rng).slice(0, n);
  }

  function dailyQuizScope() {
    const due = dueChapters().map(chNumById).filter(Boolean);
    if (due.length) return new Set(due);
    const learned = learnedIds().map(chNumById).filter(Boolean);
    if (learned.length) return new Set(learned);
    const tc = todayChapter();
    return new Set([tc ? tc.num : 1]);
  }

  /* ================= router ================= */
  const routes = [];
  function route(re, fn) { routes.push({ re, fn }); }
  function navigate() {
    const h = location.hash.replace(/^#/, '') || '/';
    for (const r of routes) {
      const m = h.match(r.re);
      if (m) {
        view().classList.remove('wide');
        r.fn(...m.slice(1)); highlightNav(h); window.scrollTo(0, 0); return;
      }
    }
    location.hash = '#/';
  }
  function highlightNav(h) {
    const root = h.split('/')[1] || 'home';
    const map = { '': 'home', learn: 'learn', quiz: 'quiz', cards: 'cards', ex: 'ex', awards: 'awards', vocab: 'vocab' };
    document.querySelectorAll('.nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.route === (map[root] || 'home'));
    });
  }

  function refreshStreakPill() {
    const s = streak();
    const pill = $('#streakPill');
    pill.textContent = '🔥 ' + s;
    pill.classList.toggle('lit', s > 0 && isCheckedIn());
  }

  function refreshXpPill() {
    const el = $('#xpPill');
    if (!el) return;
    const g = gam(), li = levelInfo(g.xp);
    el.innerHTML = '<span class="band">Band ' + li.cur.band + '</span> · ' + g.xp + ' XP';
  }

  function toast(msg) {
    let z = document.querySelector('.toast-zone');
    if (!z) { z = document.createElement('div'); z.className = 'toast-zone'; document.body.appendChild(z); }
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    z.appendChild(t);
    setTimeout(() => t.remove(), 4300);
  }

  function confetti() {
    const z = document.createElement('div');
    z.className = 'confetti-zone';
    const colors = ['#7c96ff', '#34d399', '#fbbf24', '#f87171', '#b18cff', '#5eead4'];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-p';
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = (1.6 + Math.random() * 1.7) + 's';
      p.style.animationDelay = (Math.random() * 0.5) + 's';
      z.appendChild(p);
    }
    document.body.appendChild(z);
    setTimeout(() => z.remove(), 4000);
  }

  /* ================= HOME ================= */
  function countdownHtml() {
    const ed = gam().examDate;
    if (!ed) return `<span class="countdown-chip" id="examChip">🎯 Đặt ngày thi</span>`;
    const days = Math.ceil((new Date(ed + 'T00:00') - new Date(today() + 'T00:00')) / 86400000);
    if (days < 0) return `<span class="countdown-chip urgent" id="examChip">📅 Kỳ thi đã qua — đặt lại?</span>`;
    if (days === 0) return `<span class="countdown-chip urgent" id="examChip">🔥 HÔM NAY LÀ NGÀY THI — CHIẾN!</span>`;
    return `<span class="countdown-chip ${days <= 14 ? 'urgent' : ''}" id="examChip" title="Bấm để đổi ngày thi">📅 Còn ${days} ngày tới kỳ thi</span>`;
  }

  function renderHome() {
    const t = today();
    const d = new Date();
    const ci = store.data.checkins[t];
    const tc = todayChapter();
    const learnedCount = learnedIds().length;
    const totalCh = numberedChapters().length;
    const due = dueChapters();
    const s = streak();
    const totalDays = Object.keys(store.data.checkins).length;
    const quizDone = ci && ci.quiz;
    const g = gam(), li = levelInfo(g.xp), ms = missionState();
    const rs = reviewStats();
    const msDone = ms.filter(m => m.done).length;

    const dueChips = due.map(id => {
      const c = DATA.chapters.find(x => x.id === id);
      return `<span class="chip due" onclick="location.hash='#/learn/${id}'">↻ ${esc(c ? (c.num + '. ' + c.title) : id)}</span>`;
    }).join('');

    view().innerHTML = `
      <div class="hero">
        <div>
          <h1>Chào Long 👋</h1>
          <div class="sub">${WEEKDAYS[d.getDay()]}, ${fmtVN(t)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px">
          ${countdownHtml()}
          ${ci
            ? `<span class="checkin-badge">✅ Đã điểm danh hôm nay</span>`
            : `<button class="btn big" id="checkinBtn">📍 Điểm danh hôm nay</button>`}
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <h3 style="margin:0 0 12px">🎯 Nhiệm vụ hôm nay — ${msDone}/3${(ci && ci.bonus) ? ' · 🎁 +20 XP bonus' : ''}</h3>
        <div class="missions">
          <div class="mission-ring">
            <svg width="86" height="86" viewBox="0 0 86 86">
              <circle cx="43" cy="43" r="36" fill="none" stroke="var(--surface2)" stroke-width="9"/>
              <circle cx="43" cy="43" r="36" fill="none" stroke="var(--green)" stroke-width="9"
                stroke-linecap="round" stroke-dasharray="${(msDone / 3 * 226.2).toFixed(1)} 226.2"/>
            </svg>
            <div class="pct">${msDone}/3</div>
          </div>
          <div class="mission-list">
            ${ms.map(m => `
              <div class="mission ${m.done ? 'done' : ''}">
                <span class="tick">${m.done ? '✅' : '⬜'}</span>
                <span>${esc(m.label)}</span>
                ${m.go && !m.done ? `<a class="go" href="${m.go}">Làm ngay →</a>` : ''}
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="grid cols2">
        <div class="card today-card">
          <h3>📖 Bài học hôm nay</h3>
          ${tc ? `
            <div class="title">Chương ${tc.num}: ${esc(tc.title)}</div>
            <div class="progressbar"><i style="width:${Math.round(learnedCount / totalCh * 100)}%"></i></div>
            <div class="muted small">Đã học ${learnedCount}/${totalCh} chương</div>
            <div class="q-actions">
              <button class="btn" onclick="location.hash='#/learn/${tc.id}'">Học ngay →</button>
            </div>`
            : `
            <div class="title">🎓 Bạn đã học hết 30 chương!</div>
            <div class="muted small">Giờ là lúc ôn tập vòng lặp — quiz mỗi ngày sẽ tự chọn chương đến hạn ôn.</div>
            <div class="q-actions"><button class="btn ghost" onclick="location.hash='#/learn'">Đọc lại tài liệu</button></div>`}
        </div>

        <div class="card quiz-card">
          <h3>📝 Quiz hôm nay</h3>
          ${quizDone
            ? `<div class="title">Đã hoàn thành: ${ci.quiz.score}/${ci.quiz.total} câu ${ci.quiz.score / ci.quiz.total >= 0.7 ? '🎉' : '💪'}</div>
               <div class="muted small">Muốn luyện thêm? Làm bộ ngẫu nhiên không giới hạn.</div>
               <div class="q-actions"><button class="btn ghost" onclick="location.hash='#/quiz/practice'">Luyện thêm 10 câu</button></div>`
            : `<div class="title">10 câu ôn tập đang chờ bạn</div>
               <div class="muted small">${due.length ? 'Hôm nay ôn lại: ' + due.length + ' chương đến hạn.' : 'Câu hỏi lấy từ các chương bạn đang học.'}</div>
               <div class="q-actions"><button class="btn green" onclick="location.hash='#/quiz'">Làm quiz ngay →</button></div>`}
          ${due.length ? `<div class="due-chips">${dueChips}</div>` : ''}
        </div>

        <div class="card review-card">
          <h3>🧠 Ghi nhớ tài liệu</h3>
          <div class="title">Thuộc ${rs.known}/${rs.total} mục</div>
          <div class="progressbar"><i style="width:${rs.total ? Math.round(rs.known / rs.total * 100) : 0}%"></i></div>
          <div class="muted small">Đã gặp ${rs.seen}/${rs.total} · ${rs.due ? '⏰ ' + rs.due + ' mục đến hạn ôn hôm nay' : 'Không có mục nào đến hạn'}</div>
          <div class="q-actions">
            <button class="btn ${rs.due ? '' : 'ghost'}" onclick="location.hash='#/quiz/practice'">↻ Ôn ngay 10 câu</button>
          </div>
        </div>

        <div class="card vocab-card">
          <h3>📚 Sổ từ vựng</h3>
          <div class="title">${vocabList().length} từ · ${dueVocabList().length} đến hạn</div>
          <div class="muted small">Gặp từ hay ở đâu cứ ném vào đây — web sẽ nhắc bạn ôn đúng lúc.</div>
          <div class="q-actions">
            <button class="btn ghost" onclick="location.hash='#/vocab'">+ Thêm từ</button>
            ${vocabList().length ? `<button class="btn" onclick="location.hash='#/cards/vocab'">🃏 Ôn từ vựng</button>` : ''}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="level-wrap">
          <div class="level-band">Band ${li.cur.band}</div>
          <div class="level-info">
            <div class="name">⭐ ${esc(li.cur.name)} — ${g.xp} XP</div>
            <div class="xp-bar"><i style="width:${li.pct}%"></i></div>
            <div class="muted small">${li.next ? 'Còn ' + (li.next.xp - g.xp) + ' XP nữa lên Band ' + li.next.band : 'Cấp tối đa — Huyền thoại!'} · <a href="#/awards">Xem thành tích →</a></div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 4px">🔥 Chuỗi ngày học</h3>
        <div class="stat-row">
          <div class="stat"><b>${s}</b><span>chuỗi hiện tại</span></div>
          <div class="stat"><b>${Math.max(store.data.best.streak || 0, s)}</b><span>chuỗi dài nhất</span></div>
          <div class="stat"><b>${totalDays}</b><span>tổng ngày học</span></div>
          <div class="stat"><b>${learnedCount}/${totalCh}</b><span>chương đã học</span></div>
        </div>
        <div class="heatmap" id="heatmap"></div>
        <div class="hm-legend">Ít <span class="hm-cell"></span><span class="hm-cell l1"></span><span class="hm-cell l2"></span><span class="hm-cell l3"></span> Nhiều &nbsp;•&nbsp; ô có viền = hôm nay</div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 8px">💾 Dữ liệu học tập</h3>
        <p class="muted small" style="margin:0 0 10px">Tiến độ lưu trong trình duyệt này. Xuất file JSON để sao lưu hoặc chuyển sang máy khác.</p>
        <div class="tools-row">
          <button class="btn ghost sm" id="exportBtn">⬇ Xuất tiến độ</button>
          <button class="btn ghost sm" id="importBtn">⬆ Nhập tiến độ</button>
          <input type="file" id="importFile" accept=".json" style="display:none">
          <button class="btn ghost sm" id="resetBtn" style="color:var(--red)">🗑 Xoá tiến độ</button>
        </div>
      </div>

      <p class="footer-note">Nguồn: IELTS_Grammar_7_5.md — cập nhật tài liệu chỉ cần thay file và push lại repo.</p>

      <dialog id="examDlg">
        <h3 style="margin:0 0 10px">🎯 Ngày thi IELTS của bạn</h3>
        <p class="muted small" style="margin:0 0 12px">Đặt ngày thi để web đếm ngược mỗi ngày — deadline là động lực tốt nhất.</p>
        <input type="date" id="examInput" class="q-input" value="${g.examDate || ''}">
        <div class="q-actions" style="margin-top:14px">
          <button class="btn" id="examSave">Lưu</button>
          <button class="btn ghost" id="examClear">Bỏ ngày thi</button>
          <button class="btn ghost" id="examCancel">Đóng</button>
        </div>
      </dialog>
    `;

    renderHeatmap();

    const cb = $('#checkinBtn');
    if (cb) cb.onclick = () => { ensureCheckin(); updateBestStreak(); awardBadges(); checkMissionBonus(); store.save(); refreshStreakPill(); renderHome(); };

    $('#exportBtn').onclick = exportProgress;
    $('#importBtn').onclick = () => $('#importFile').click();
    $('#importFile').onchange = importProgress;
    $('#resetBtn').onclick = () => {
      if (confirm('Xoá toàn bộ tiến độ (điểm danh, chương đã học, từ vựng, XP)? Không thể hoàn tác.')) {
        localStorage.removeItem(KEY);
        location.reload();
      }
    };

    const chip = $('#examChip');
    if (chip) chip.onclick = () => { const d = $('#examDlg'); if (d && d.showModal) d.showModal(); };
    const eSave = $('#examSave');
    if (eSave) eSave.onclick = () => { const v = $('#examInput').value; if (v) { gam().examDate = v; store.save(); } $('#examDlg').close(); renderHome(); };
    const eClear = $('#examClear');
    if (eClear) eClear.onclick = () => { gam().examDate = null; store.save(); $('#examDlg').close(); renderHome(); };
    const eCancel = $('#examCancel');
    if (eCancel) eCancel.onclick = () => $('#examDlg').close();
  }

  function renderHeatmap() {
    const el = $('#heatmap');
    if (!el) return;
    const t = today();
    const weeks = 20;
    // bắt đầu từ thứ Hai của (hôm nay - weeks*7)
    const [y, m, d] = t.split('-').map(Number);
    const td = new Date(y, m - 1, d, 12);
    const start = new Date(td);
    start.setDate(start.getDate() - (weeks * 7 - 1));           // lùi ~20 tuần
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // căn về thứ Hai để cột thẳng hàng
    let html = '';
    const cur = new Date(start);
    while (cur <= td) {
      const ds = dstr(cur);
      const ci = store.data.checkins[ds];
      let lv = 0, tip = fmtVN(ds) + ' — chưa học';
      if (ci) {
        if (ci.quiz) { lv = ci.quiz.score / ci.quiz.total >= 0.9 ? 3 : 2; tip = fmtVN(ds) + ' — Quiz ' + ci.quiz.score + '/' + ci.quiz.total; }
        else { lv = 1; tip = fmtVN(ds) + ' — đã điểm danh' + (ci.learned ? ', học ' + ci.learned.length + ' chương' : ''); }
      }
      html += `<div class="hm-cell ${lv ? 'l' + lv : ''} ${ds === t ? 'today' : ''}" title="${tip}"></div>`;
      cur.setDate(cur.getDate() + 1);
    }
    el.innerHTML = html;
    el.scrollLeft = el.scrollWidth;
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ielts-progress-' + today() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importProgress(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(fr.result);
        if (!d.checkins && !d.chapters) throw new Error('sai định dạng');
        store.data = Object.assign(store.data, d);
        store.save();
        alert('Đã nhập tiến độ thành công!');
        location.reload();
      } catch (err) { alert('File không hợp lệ: ' + err.message); }
    };
    fr.readAsText(file);
  }

  /* ================= LEARN ================= */
  function renderLearn(chId) {
    view().classList.add('wide');
    chId = chId || store.data.settings.lastChapter || 'c1';
    let ch = DATA.chapters.find(c => c.id === chId) || DATA.chapters.find(c => c.id === 'c1');
    store.data.settings.lastChapter = ch.id;
    store.save();

    const learned = new Set(learnedIds());
    const tocHtml = ['<div class="toc-item' + (ch.id === 'intro' ? ' active' : '') + '" data-ch="intro">📖 Giới thiệu</div>']
      .concat(DATA.toc.map(part => {
        const items = part.chapters.map(c =>
          `<div class="toc-item ${c.id === ch.id ? 'active' : ''}" data-ch="${c.id}">
             ${esc(c.title)}${learned.has(c.id) ? '<span class="done">✓</span>' : ''}
           </div>`).join('');
        return `<div class="part">${esc(part.name)}</div>${items}`;
      })).join('');

    view().innerHTML = `
      <div class="learn-wrap">
        <div class="card sidebar">
          <div class="searchbox">
            <input type="search" id="searchInput" placeholder="🔍 Tìm kiếm (vd: đảo ngữ, wish)…" autocomplete="off">
            <div class="search-results" id="searchResults" style="display:none"></div>
          </div>
          <button class="btn ghost sm toc-toggle" id="tocToggle">☰ Mục lục chương</button>
          <div class="toc-list" id="tocList">${tocHtml}</div>
        </div>
        <div class="resizer" id="tocResizer" title="Kéo để chỉnh độ rộng mục lục"></div>
        <div class="content">
          <div class="card">
            <div class="md" id="mdContent"></div>
            <div class="chapter-actions" id="chapterActions"></div>
          </div>
        </div>
      </div>
    `;

    // render markdown
    const mdEl = $('#mdContent');
    mdEl.innerHTML = window.renderMd
      ? window.renderMd(ch.md)
      : '<pre style="white-space:pre-wrap">' + esc(ch.md) + '</pre>';
    // gán id cho h3 để search nhảy tới
    mdEl.querySelectorAll('h3').forEach((h, i) => { h.id = 'sec-' + ch.id + '-' + i; });

    // actions
    const acts = $('#chapterActions');
    const all = DATA.chapters;
    const idx = all.findIndex(c => c.id === ch.id);
    const prev = all[idx - 1], next = all[idx + 1];
    let btns = '';
    if (prev) btns += `<button class="btn ghost" onclick="location.hash='#/learn/${prev.id}'">← ${esc(shortTitle(prev))}</button>`;
    if (ch.kind === 'chapter') {
      btns += learned.has(ch.id)
        ? `<button class="btn ghost" id="unlearnBtn" title="Học ${fmtVN(store.data.chapters[ch.id].learnedOn)}, ôn lại ${fmtVN(store.data.chapters[ch.id].next)}">✓ Đã học — bỏ đánh dấu</button>`
        : `<button class="btn green" id="learnBtn">✓ Đánh dấu đã học</button>`;
      btns += `<button class="btn" onclick="location.hash='#/quiz/practice/${ch.id}'">🎯 Luyện chương này</button>`;
    }
    if (next) btns += `<button class="btn ghost" onclick="location.hash='#/learn/${next.id}'">${esc(shortTitle(next))} →</button>`;
    acts.innerHTML = btns;

    const lb = $('#learnBtn');
    if (lb) lb.onclick = () => { markLearned(ch.id); renderLearn(ch.id); };
    const ub = $('#unlearnBtn');
    if (ub) ub.onclick = () => { unmarkLearned(ch.id); renderLearn(ch.id); };

    // TOC click
    document.querySelectorAll('.toc-item').forEach(el => {
      el.onclick = () => { location.hash = '#/learn/' + el.dataset.ch; };
    });

    // nút mục lục trên mobile
    const tt = $('#tocToggle');
    if (tt) tt.onclick = () => $('#tocList').classList.toggle('open');

    // kéo chỉnh độ rộng mục lục (lưu lại cho lần sau)
    const wrap = document.querySelector('.learn-wrap');
    if (wrap && wrap.style.setProperty) wrap.style.setProperty('--toc-w', (store.data.settings.tocWidth || 320) + 'px');
    const rz = $('#tocResizer');
    if (rz) rz.onmousedown = e => {
      e.preventDefault();
      rz.classList.add('dragging');
      document.body.classList.add('resizing');
      const move = ev => {
        const w = Math.min(560, Math.max(200, ev.clientX - wrap.getBoundingClientRect().left));
        wrap.style.setProperty('--toc-w', w + 'px');
        store.data.settings.tocWidth = w;
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        rz.classList.remove('dragging');
        document.body.classList.remove('resizing');
        store.save();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };

    setupSearch();
  }

  function shortTitle(c) {
    const t = c.kind === 'chapter' ? c.num + '. ' + c.title : c.title;
    return t.length > 26 ? t.slice(0, 24) + '…' : t;
  }

  function buildSearchIndex() {
    SEARCH_INDEX = [];
    DATA.chapters.forEach(ch => {
      const parts = ch.md.split(/^### /m);
      parts.forEach((p, i) => {
        if (i === 0) {
          SEARCH_INDEX.push({ chId: ch.id, chTitle: ch.title, secIdx: -1, secTitle: ch.title, body: p.toLowerCase() });
        } else {
          const nl = p.indexOf('\n');
          const title = (nl > 0 ? p.slice(0, nl) : p).replace(/[⭐🎯]/g, '').trim();
          SEARCH_INDEX.push({ chId: ch.id, chTitle: ch.title, secIdx: i - 1, secTitle: title, body: p.toLowerCase() });
        }
      });
    });
  }

  function setupSearch() {
    const input = $('#searchInput');
    const box = $('#searchResults');
    if (!input) return;
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { box.style.display = 'none'; return; }
      const hits = [];
      for (const s of SEARCH_INDEX) {
        const inTitle = s.secTitle.toLowerCase().includes(q);
        const inBody = s.body.includes(q);
        if (inTitle || inBody) hits.push({ s, score: inTitle ? 0 : 1 });
        if (hits.length > 40) break;
      }
      hits.sort((a, b) => a.score - b.score);
      const top = hits.slice(0, 12);
      if (!top.length) { box.innerHTML = '<div class="res"><span>Không tìm thấy…</span></div>'; box.style.display = 'block'; return; }
      box.innerHTML = top.map((h, i) =>
        `<div class="res" data-i="${i}"><b>${esc(h.s.secTitle)}</b><span>${esc(h.s.chTitle)}</span></div>`).join('');
      box.style.display = 'block';
      box.querySelectorAll('.res').forEach((el, i) => {
        el.onclick = () => {
          const hit = top[i].s;
          box.style.display = 'none';
          input.value = '';
          gotoSection(hit.chId, hit.secIdx);
        };
      });
    };
    input.onblur = () => setTimeout(() => { box.style.display = 'none'; }, 250);
  }

  function gotoSection(chId, secIdx) {
    const cur = store.data.settings.lastChapter;
    const scroll = () => {
      if (secIdx >= 0) {
        const h = document.getElementById('sec-' + chId + '-' + secIdx);
        if (h) { h.scrollIntoView({ behavior: 'smooth', block: 'start' }); h.classList.add('flash'); setTimeout(() => h.classList.remove('flash'), 1700); }
      }
    };
    if (cur === chId && location.hash.startsWith('#/learn')) { scroll(); }
    else { location.hash = '#/learn/' + chId; setTimeout(scroll, 350); }
  }

  /* ================= QUIZ ================= */
  function renderQuizLanding() {
    const t = today();
    const ci = store.data.checkins[t];
    if (ci && ci.quiz) {
      view().innerHTML = `
        <div class="card q-card quiz-done">
          <div class="emoji">${ci.quiz.score / ci.quiz.total >= 0.7 ? '🎉' : '💪'}</div>
          <h2>Quiz hôm nay đã xong!</h2>
          <div class="big-score">${ci.quiz.score}/${ci.quiz.total}</div>
          <p class="muted">Quay lại vào ngày mai để giữ chuỗi 🔥, hoặc luyện thêm ngay bây giờ.</p>
          <div class="q-actions" style="justify-content:center">
            <button class="btn" onclick="location.hash='#/quiz/practice'">Luyện thêm 10 câu</button>
            <button class="btn ghost" onclick="location.hash='#/'">Về trang chủ</button>
          </div>
        </div>`;
      return;
    }
    const scope = dailyQuizScope();
    const items = buildQuiz('daily-' + t, scope, 10, true);
    runQuiz(items, { daily: true });
  }

  function renderPractice(chId) {
    let scope = null, label = 'toàn bộ tài liệu';
    if (chId) {
      const n = chNumById(chId);
      if (n) { scope = new Set([n]); const c = DATA.chapters.find(x => x.id === chId); label = 'chương ' + n + ': ' + c.title; }
    } else if (learnedIds().length) {
      scope = new Set(learnedIds().map(chNumById).filter(Boolean));
      label = 'các chương đã học';
    }
    const items = buildQuiz('practice-' + Date.now(), scope, 10, true);
    runQuiz(items, { practice: true, label });
  }

  function runQuiz(items, opts) {
    let cur = 0, score = 0;
    const itemId = q => q.kind === 'mcq' ? q.pair.id : q.kind === 'cloze' ? q.f.id : q.kind === 'ex' ? q.it.id : q.kind === 'vcard' ? q.v.id : q.id;
    const results = new Array(items.length).fill(null);

    function progressHtml() {
      return items.map((_, i) => {
        let cls = '';
        if (results[i] === true) cls = 'ok';
        else if (results[i] === false) cls = 'bad';
        else if (i === cur) cls = 'cur';
        return `<i class="${cls}"></i>`;
      }).join('');
    }

    function header() {
      return `
        <div class="quiz-head">
          <b>${opts.daily ? '📝 Quiz ngày ' + fmtVN(today()) : '🎯 Luyện tập' + (opts.label ? ' — ' + esc(opts.label) : '')}</b>
          <span class="muted small">Câu ${Math.min(cur + 1, items.length)}/${items.length}</span>
        </div>
        <div class="q-progress">${progressHtml()}</div>`;
    }

    function finish() {
      const total = items.length;
      const pct = total ? score / total : 0;
      const c = counters();
      c.quizzes = (c.quizzes || 0) + 1;
      c.correct = (c.correct || 0) + score;
      if (score === total) c.perfect = (c.perfect || 0) + 1;
      if (pct >= 0.9) c.great = (c.great || 0) + 1;
      let xpGain;
      if (opts.daily) {
        const ci = ensureCheckin();
        ci.quiz = { score, total };
        applySrsAfterDailyQuiz(score, total);
        xpGain = 5 * score + (pct >= 0.9 ? 25 : 0);
      } else {
        const ci = ensureCheckin(); // luyện tập cũng tính điểm danh
        ci.extra = true;
        xpGain = 3 * score;
      }
      addXp(xpGain, 'quiz');
      updateBestStreak();
      awardBadges();
      checkMissionBonus();
      store.save();
      refreshStreakPill();
      const emoji = pct >= 0.9 ? '🏆' : pct >= 0.7 ? '🎉' : pct >= 0.5 ? '💪' : '📚';
      const msg = pct >= 0.9 ? 'Xuất sắc! Band 7.5 đang vẫy gọi.'
        : pct >= 0.7 ? 'Tốt lắm! Các chương đến hạn đã được giãn lịch ôn.'
        : pct >= 0.5 ? 'Ổn đấy — xem lại các câu sai nhé.'
        : 'Đừng nản! Đọc lại chương rồi luyện thêm ngay.';
      view().innerHTML = `
        <div class="card q-card quiz-done">
          <div class="emoji">${emoji}</div>
          <div class="big-score">${score}/${total}</div>
          <div class="xp-gain">+${xpGain} XP</div>
          <p>${msg}</p>
          ${opts.daily ? '<p class="checkin-badge">✅ Đã điểm danh hôm nay</p>' : ''}
          <div class="q-actions" style="justify-content:center">
            <button class="btn" onclick="location.hash='#/quiz/practice'">Luyện thêm 10 câu</button>
            <button class="btn ghost" onclick="location.hash='#/'">Về trang chủ</button>
          </div>
        </div>`;
      if (pct >= 0.7) confetti();
      window.scrollTo(0, 0);
    }

    function next(ok) {
      results[cur] = ok;
      if (ok) score++;
      cur++;
      if (cur >= items.length) finish();
      else show();
    }

    function show() {
      const q = items[cur];
      let body = '';
      if (q.kind === 'mcq') {
        body = `
          <div class="q-type">Chọn câu ĐÚNG ngữ pháp</div>
          <div class="q-options">
            ${q.opts.map((o, i) => `<button class="q-opt" data-i="${i}">${esc(o.text)}</button>`).join('')}
          </div>
          <div id="qFeedback"></div>`;
      } else if (q.kind === 'cloze') {
        body = `
          <div class="q-type">Điền vào chỗ trống</div>
          <div class="q-text">${esc(q.f.front)}</div>
          <div class="q-formula">${esc(q.c.shown)}</div>
          <input class="q-input" id="clozeInput" placeholder="Gõ phần còn thiếu…" autocomplete="off">
          <div id="qFeedback"></div>
          <div class="q-actions"><button class="btn" id="checkBtn">Kiểm tra</button></div>`;
      } else if (q.kind === 'card') {
        body = `
          <div class="q-type">Nhớ lại công thức</div>
          <div class="q-text">${esc(q.front)}</div>
          <div id="revealZone">
            <div class="q-actions"><button class="btn" id="revealBtn">Hiện đáp án</button></div>
          </div>`;
      } else if (q.kind === 'vcard') {
        body = `
          <div class="q-type">📚 Ôn từ vựng của bạn</div>
          <div class="q-text">${esc(q.v.w)}</div>
          <p class="muted small">Từ này nghĩa là gì? Nhớ lại rồi đối chiếu.</p>
          <div id="revealZone">
            <div class="q-actions"><button class="btn" id="revealBtn">Hiện nghĩa</button></div>
          </div>`;
      } else if (q.kind === 'ex') {
        body = `
          <div class="q-type">Bài tập — ${esc(q.set.title)}</div>
          <div class="q-text">${miniMd(q.it.q)}</div>
          <p class="muted small">Làm trong đầu hoặc ra giấy, sau đó đối chiếu đáp án.</p>
          <div id="revealZone">
            <div class="q-actions"><button class="btn" id="revealBtn">Hiện đáp án</button></div>
          </div>`;
      }

      view().innerHTML = `${header()}<div class="card q-card" style="margin-top:14px">${body}</div>`;

      if (q.kind === 'mcq') {
        document.querySelectorAll('.q-opt').forEach(btn => {
          btn.onclick = () => {
            const i = +btn.dataset.i;
            const ok = q.opts[i].correct;
            recordItem(itemId(q), ok);
            document.querySelectorAll('.q-opt').forEach((b, j) => {
              b.disabled = true;
              if (q.opts[j].correct) b.classList.add('correct');
              else if (j === i) b.classList.add('wrong');
            });
            $('#qFeedback').innerHTML = `
              <div class="q-feedback ${ok ? 'ok' : 'bad'}">
                ${ok ? '✅ Chính xác!' : '❌ Chưa đúng.'}
                ${q.pair.note ? '<br>💡 ' + esc(q.pair.note) : ''}
                <span class="muted small" style="display:block;margin-top:4px">Chương ${q.pair.chapter} — <a href="#/learn/c${q.pair.chapter}">xem lại lý thuyết</a></span>
              </div>
              <div class="q-actions"><button class="btn" id="nextBtn">Câu tiếp →</button></div>`;
            $('#nextBtn').onclick = () => next(ok);
            $('#nextBtn').focus();
          };
        });
      } else if (q.kind === 'cloze') {
        const input = $('#clozeInput');
        input.focus();
        const check = () => {
          const ok = P.clozeMatch(input.value, q.c.answer);
          recordItem(itemId(q), ok);
          input.disabled = true;
          $('#checkBtn').style.display = 'none';
          $('#qFeedback').innerHTML = `
            <div class="q-feedback ${ok ? 'ok' : 'bad'}">
              ${ok ? '✅ Chính xác!' : '❌ Chưa đúng.'} Đáp án: <b>${esc(q.c.answer)}</b>
              <span class="muted small" style="display:block;margin-top:4px">Công thức đầy đủ: ${esc(q.f.back)}</span>
            </div>
            <div class="q-actions"><button class="btn" id="nextBtn">Câu tiếp →</button></div>`;
          $('#nextBtn').onclick = () => next(ok);
          $('#nextBtn').focus();
        };
        $('#checkBtn').onclick = check;
        input.onkeydown = e => { if (e.key === 'Enter' && !input.disabled) check(); };
      } else if (q.kind === 'card' || q.kind === 'ex' || q.kind === 'vcard') {
        $('#revealBtn').onclick = () => {
          const ansHtml = q.kind === 'card' ? esc(q.back)
            : q.kind === 'vcard' ? esc(q.v.m) + (q.v.ex ? '<br><em class="muted">' + esc(q.v.ex) + '</em>' : '')
            : miniMd(q.it.a);
          $('#revealZone').innerHTML = `
            <div class="q-answer-reveal">📌 ${ansHtml}</div>
            <p class="muted small" style="margin:12px 0 6px">Bạn có làm đúng / nhớ được không?</p>
            <div class="q-actions">
              <button class="btn green" id="yesBtn">✓ Đúng / Nhớ</button>
              <button class="btn red" id="noBtn">✗ Sai / Chưa nhớ</button>
            </div>`;
          $('#yesBtn').onclick = () => { recordItem(itemId(q), true); next(true); };
          $('#noBtn').onclick = () => { recordItem(itemId(q), false); next(false); };
        };
      }
    }

    show();
  }

  /* ================= FLASHCARDS ================= */
  function renderDecks() {
    const decks = [
      { id: 'formulas', icon: '🧮', name: 'Công thức ngữ pháp', desc: 'Thì, câu điều kiện, cấu trúc… tự trích từ tài liệu.', count: DATA.formulas.length },
      { id: 'verbs', icon: '🔤', name: 'Động từ bất quy tắc', desc: 'V1 → V2 / V3 + nghĩa tiếng Việt (Phụ lục A).', count: DATA.verbs.length },
      { id: 'pairs', icon: '🩹', name: 'Sửa câu sai', desc: 'Nhìn câu sai kinh điển → nhớ lại câu đúng.', count: DATA.pairs.length },
      { id: 'vocab', icon: '📚', name: 'Sổ từ vựng của bạn', desc: vocabList().length ? dueVocabList().length + ' từ đến hạn ôn hôm nay.' : 'Chưa có từ nào — vào tab Từ vựng để thêm.', count: vocabList().length },
    ];
    view().innerHTML = `
      <h1 class="page-title">🃏 Flashcards</h1>
      <p class="muted">Mỗi phiên 20 thẻ ngẫu nhiên. Nhấn vào thẻ để lật.</p>
      <div class="deck-grid">
        ${decks.map(d => `
          <div class="card deck-card" onclick="location.hash='#/cards/${d.id}'">
            <h3>${d.icon} ${d.name}</h3>
            <p class="muted small" style="margin:0 0 8px">${d.desc}</p>
            <span class="chip">${d.count} thẻ</span>
          </div>`).join('')}
      </div>`;
  }

  function deckCards(deckId) {
    if (deckId === 'formulas') return DATA.formulas.map(f => ({ id: f.id, front: f.front, back: f.back, sub: 'Chương ' + f.chapter }));
    if (deckId === 'verbs') return DATA.verbs.map(v => ({ id: v.id, front: v.v1 + (v.meaning ? ' — ' + v.meaning : ''), back: 'V2: ' + v.v2 + '\nV3: ' + v.v3, sub: 'Động từ bất quy tắc' }));
    if (deckId === 'pairs') return DATA.pairs.map(p => ({ id: p.id, front: '❌ ' + p.wrong, back: '✅ ' + p.right + (p.note ? '\n💡 ' + p.note : ''), sub: 'Chương ' + p.chapter }));
    if (deckId === 'vocab') return vocabList().map(v => ({ id: v.id, front: v.w, back: v.m + (v.ex ? '\n*' + v.ex + '*' : ''), sub: 'Sổ từ vựng' }));
    return [];
  }

  function renderDeck(deckId, cardsOverride) {
    const rngD = P.seededRng(String(Date.now()));
    const all = cardsOverride || prioritize(deckCards(deckId), rngD).slice(0, 20); // đến hạn & chưa gặp lên trước
    if (!all.length) { location.hash = '#/cards'; return; }
    let cur = 0, known = 0;
    const missed = [];

    function show() {
      if (cur >= all.length) {
        const ci = ensureCheckin();
        ci.extra = true;
        const c = counters();
        c.cards = (c.cards || 0) + 1;
        const sesXp = 15 + (known === all.length ? 10 : 0);
        addXp(sesXp, 'flashcards');
        updateBestStreak();
        awardBadges();
        checkMissionBonus();
        store.save();
        refreshStreakPill();
        view().innerHTML = `
          <a class="back-link" href="#/cards">← Chọn bộ thẻ khác</a>
          <div class="card q-card quiz-done">
            <div class="emoji">${known === all.length ? '🏆' : '👏'}</div>
            <h2>Hoàn thành phiên thẻ!</h2>
            <div class="big-score">${known}/${all.length}</div>
            <div class="xp-gain">+${15 + (known === all.length ? 10 : 0)} XP</div>
            <p class="muted">thẻ bạn đã nhớ</p>
            <div class="q-actions" style="justify-content:center">
              ${missed.length ? `<button class="btn" id="retryMissed">Học lại ${missed.length} thẻ chưa nhớ</button>` : ''}
              <button class="btn ghost" onclick="location.hash='#/cards'">Bộ thẻ khác</button>
            </div>
          </div>`;
        const rm = $('#retryMissed');
        if (rm) rm.onclick = () => renderDeck(deckId, missed.slice());
        return;
      }
      const c = all[cur];
      view().innerHTML = `
        <a class="back-link" href="#/cards">← Bộ thẻ</a>
        <div class="quiz-head"><b>🃏 Thẻ ${cur + 1}/${all.length}</b><span class="muted small">${known} đã nhớ</span></div>
        <div class="fc-stage">
          <div class="fc" id="fc">
            <div class="fc-face front">
              <span class="label">Mặt trước — nhấn để lật</span>
              <div class="main">${miniMd(c.front)}</div>
              <div class="sub">${esc(c.sub || '')}</div>
            </div>
            <div class="fc-face back">
              <span class="label">Đáp án</span>
              <div class="main">${miniMd(c.back)}</div>
            </div>
          </div>
        </div>
        <div class="fc-controls" id="fcControls" style="visibility:hidden">
          <button class="btn red" id="fcNo">✗ Chưa nhớ</button>
          <button class="btn green" id="fcYes">✓ Nhớ rồi</button>
        </div>`;
      const fc = $('#fc');
      fc.onclick = () => { fc.classList.toggle('flipped'); $('#fcControls').style.visibility = 'visible'; };
      $('#fcYes').onclick = () => { recordItem(c.id, true); known++; cur++; show(); };
      $('#fcNo').onclick = () => { recordItem(c.id, false); missed.push(c); cur++; show(); };
    }
    show();
  }

  /* ================= EXERCISES ================= */
  function renderExList() {
    view().innerHTML = `
      <h1 class="page-title">✍️ Ngân hàng bài tập</h1>
      <p class="muted">Từ Phụ lục D & F của tài liệu — có đáp án đối chiếu từng câu.</p>
      <div class="ex-grid">
        ${DATA.exercises.map(s => `
          <div class="card deck-card" onclick="location.hash='#/ex/${s.setId}'">
            <h3>${esc(s.setId.startsWith('D') ? 'Bài tập ' + s.setId.slice(1) : s.title.split(' — ')[0])}</h3>
            <p class="muted small" style="margin:0 0 8px">${esc(s.setId.startsWith('D') ? s.title : s.title.split(' — ').slice(1).join(' — '))}</p>
            <span class="chip">${s.items.length} câu</span>
            ${s.chapterRefs.map(r => `<span class="chip">Mục ${r}</span>`).join(' ')}
          </div>`).join('')}
      </div>`;
  }

  function renderExSet(setId) {
    const set = DATA.exercises.find(s => s.setId === setId);
    if (!set) { location.hash = '#/ex'; return; }
    view().innerHTML = `
      <a class="back-link" href="#/ex">← Danh sách bài tập</a>
      <h1 class="page-title">${esc(set.title)}</h1>
      <div class="q-actions" style="margin-bottom:16px">
        <button class="btn ghost sm" id="toggleAll">👁 Hiện tất cả đáp án</button>
        ${set.chapterRefs.map(r => `<span class="chip" onclick="location.hash='#/learn/c${r}'">📖 Lý thuyết mục ${r}</span>`).join('')}
      </div>
      ${set.items.map((it, i) => `
        <div class="card ex-item">
          <div class="q"><span class="ex-num">${it.n}.</span>${miniMd(it.q)}</div>
          <button class="btn ghost sm ans-btn" data-i="${i}">Hiện đáp án</button>
          <div class="ans" style="display:none">✅ ${miniMd(it.a || '(không có đáp án)')}</div>
        </div>`).join('')}
    `;
    document.querySelectorAll('.ans-btn').forEach(btn => {
      btn.onclick = () => {
        const ans = btn.nextElementSibling;
        const shown = ans.style.display !== 'none';
        ans.style.display = shown ? 'none' : 'block';
        btn.textContent = shown ? 'Hiện đáp án' : 'Ẩn đáp án';
      };
    });
    let allShown = false;
    $('#toggleAll').onclick = () => {
      allShown = !allShown;
      document.querySelectorAll('.ex-item .ans').forEach(a => { a.style.display = allShown ? 'block' : 'none'; });
      document.querySelectorAll('.ans-btn').forEach(b => { b.textContent = allShown ? 'Ẩn đáp án' : 'Hiện đáp án'; });
      $('#toggleAll').textContent = allShown ? '🙈 Ẩn tất cả đáp án' : '👁 Hiện tất cả đáp án';
    };
  }

  /* ================= VOCAB ================= */
  function renderVocab(filter) {
    const list = vocabList();
    const dueSet = new Set(dueVocabList().map(v => v.id));
    const q = (filter || '').toLowerCase();
    const shown = list
      .filter(v => !q || v.w.toLowerCase().includes(q) || v.m.toLowerCase().includes(q))
      .sort((a, b) => (dueSet.has(b.id) - dueSet.has(a.id)) || (b.addedOn > a.addedOn ? 1 : -1));
    const stI = itemsStore();

    view().innerHTML = `
      <h1 class="page-title">📚 Sổ từ vựng</h1>
      <div class="grid cols2">
        <div class="card">
          <h3 style="margin:0 0 10px">➕ Thêm từ mới <span class="muted small">(+2 XP mỗi từ)</span></h3>
          <div class="vocab-form">
            <input class="q-input" id="vw" placeholder="Từ / cụm từ (vd: ubiquitous)">
            <input class="q-input" id="vm" placeholder="Nghĩa (vd: có mặt khắp nơi)">
            <input class="q-input full" id="vex" placeholder="Ví dụ (không bắt buộc)">
            <div class="full q-actions" style="margin:0">
              <button class="btn green" id="vocabAdd">Thêm vào sổ</button>
              <button class="btn ghost sm" id="bulkToggle">📋 Thêm nhiều từ một lúc</button>
            </div>
            <div class="full" id="bulkZone" style="display:none">
              <textarea class="q-input" id="bulkText" rows="5" placeholder="Mỗi dòng một từ, dạng:&#10;word: nghĩa&#10;word - nghĩa"></textarea>
              <div class="q-actions"><button class="btn" id="bulkAdd">Nhập tất cả</button></div>
            </div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin:0 0 10px">🃏 Ôn tập</h3>
          <div class="stat-row">
            <div class="stat"><b>${list.length}</b><span>từ trong sổ</span></div>
            <div class="stat"><b>${dueSet.size}</b><span>đến hạn hôm nay</span></div>
            <div class="stat"><b>${list.filter(v => (stI[v.id] || {}).b >= 3).length}</b><span>đã thuộc (box 3+)</span></div>
          </div>
          <div class="q-actions">
            ${list.length ? `<button class="btn" onclick="location.hash='#/cards/vocab'">Ôn flashcard ngay →</button>` : '<span class="muted small">Thêm từ trước đã nhé!</span>'}
          </div>
          <p class="muted small" style="margin-bottom:0">Từ đến hạn cũng tự chen vào Quiz ngày (tối đa 2 từ/quiz).</p>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="searchbox" style="max-width:340px">
          <input type="search" id="vocabSearch" placeholder="🔍 Lọc từ…" value="${esc(filter || '')}" autocomplete="off">
        </div>
        <div id="vocabListZone">
          ${shown.length ? shown.map(v => {
            const e = stI[v.id];
            const box = e ? (e.b || 0) : -1;
            return `<div class="vocab-item">
              <span class="w">${esc(v.w)}</span>
              <span class="m">${esc(v.m)}${v.ex ? `<br><em class="muted small">${esc(v.ex)}</em>` : ''}</span>
              <span class="meta small ${dueSet.has(v.id) ? 'due-tag' : 'muted'}">${dueSet.has(v.id) ? '⏰ đến hạn' : 'box ' + box + ' · ôn ' + fmtVN(e.n)}</span>
              <span class="edit" data-id="${v.id}" title="Sửa (nạp lại vào form)">✏️</span>
              <span class="del" data-id="${v.id}" title="Xóa">🗑</span>
            </div>`;
          }).join('') : '<p class="muted">Chưa có từ nào' + (q ? ' khớp bộ lọc' : '') + '.</p>'}
        </div>
      </div>`;

    const doAdd = () => {
      const w = $('#vw').value, m = $('#vm').value, ex = $('#vex').value;
      if (!w.trim() || !m.trim()) { alert('Cần nhập cả từ và nghĩa nhé!'); return; }
      addVocab(w, m, ex);
      toast('📚 Đã thêm "' + w.trim() + '" (+2 XP)');
      renderVocab($('#vocabSearch').value);
    };
    $('#vocabAdd').onclick = doAdd;
    ['vw', 'vm', 'vex'].forEach(id => { $('#' + id).onkeydown = e => { if (e.key === 'Enter') doAdd(); }; });

    $('#bulkToggle').onclick = () => { const z = $('#bulkZone'); z.style.display = z.style.display === 'none' ? 'block' : 'none'; };
    $('#bulkAdd').onclick = () => {
      const lines = $('#bulkText').value.split('\n');
      let n = 0;
      lines.forEach(line => {
        const m = line.match(/^(.+?)\s*[:\-–—]\s*(.+)$/);
        if (m && addVocab(m[1], m[2], '')) n++;
      });
      toast('📚 Đã nhập ' + n + ' từ (+' + (n * 2) + ' XP)');
      renderVocab();
    };

    const search = $('#vocabSearch');
    search.oninput = () => renderVocab(search.value);

    document.querySelectorAll('.vocab-item .del').forEach(el => {
      el.onclick = () => {
        const v = vocabList().find(x => x.id === el.dataset.id);
        if (v && confirm('Xóa từ "' + v.w + '"?')) { delVocab(v.id); renderVocab($('#vocabSearch').value); }
      };
    });
    document.querySelectorAll('.vocab-item .edit').forEach(el => {
      el.onclick = () => {
        const v = vocabList().find(x => x.id === el.dataset.id);
        if (!v) return;
        delVocab(v.id);
        renderVocab('');
        $('#vw').value = v.w; $('#vm').value = v.m; $('#vex').value = v.ex || '';
        $('#vw').focus();
      };
    });
  }

  /* ================= AWARDS ================= */
  function renderAwards() {
    const g = gam(), li = levelInfo(g.xp), c = counters();
    const earned = Object.keys(g.badges).length;
    view().innerHTML = `
      <h1 class="page-title">🏅 Thành tích</h1>
      <div class="card">
        <div class="level-wrap">
          <div class="level-band">Band ${li.cur.band}</div>
          <div class="level-info">
            <div class="name">⭐ ${esc(li.cur.name)}</div>
            <div class="xp-bar"><i style="width:${li.pct}%"></i></div>
            <div class="muted small">${g.xp} XP · ${li.next ? 'Còn ' + (li.next.xp - g.xp) + ' XP nữa lên Band ' + li.next.band + ' — ' + esc(li.next.name) : 'Cấp tối đa!'}</div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 4px">📊 Số liệu tích lũy</h3>
        <div class="stat-row">
          <div class="stat"><b>${g.xp}</b><span>tổng XP</span></div>
          <div class="stat"><b>${Object.keys(store.data.checkins).length}</b><span>ngày đã học</span></div>
          <div class="stat"><b>${learnedIds().length}/${numberedChapters().length}</b><span>chương</span></div>
          <div class="stat"><b>${c.quizzes || 0}</b><span>quiz đã làm</span></div>
          <div class="stat"><b>${c.correct || 0}</b><span>câu đúng</span></div>
          <div class="stat"><b>${c.cards || 0}</b><span>phiên thẻ</span></div>
          <div class="stat"><b>${vocabList().length}</b><span>từ vựng</span></div>
          <div class="stat"><b>${reviewStats().known}</b><span>mục đã thuộc</span></div>
        </div>
      </div>

      <h2 style="margin:26px 0 12px">Huy hiệu — ${earned}/${BADGES.length}</h2>
      <div class="badge-grid">
        ${BADGES.map(b => {
          const got = g.badges[b.id];
          return `<div class="badge ${got ? 'earned' : 'locked'}">
            <div class="ic">${b.ic}</div>
            <div class="nm">${esc(b.nm)}</div>
            <div class="ds">${esc(b.ds)}</div>
            ${got ? `<div class="dt">✓ Đạt ngày ${fmtVN(got)}</div>` : '<div class="dt" style="color:var(--muted)">🔒 Chưa mở</div>'}
          </div>`;
        }).join('')}
      </div>`;
  }

  /* ================= boot ================= */
  function applyTheme() {
    document.documentElement.dataset.theme = store.data.settings.theme || 'dark';
    $('#themeBtn').textContent = store.data.settings.theme === 'light' ? '☀️' : '🌙';
  }

  function boot() {
    store.load();
    applyTheme();
    $('#themeBtn').onclick = () => {
      store.data.settings.theme = store.data.settings.theme === 'light' ? 'dark' : 'light';
      store.save();
      applyTheme();
    };

    fetch('IELTS_Grammar_7_5.md', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(md => {
        DATA = P.parse(md);
        buildSearchIndex();

        route(/^\/$/, renderHome);
        route(/^\/learn\/([\w-]+)$/, renderLearn);
        route(/^\/learn$/, () => renderLearn());
        route(/^\/quiz$/, renderQuizLanding);
        route(/^\/quiz\/practice\/([\w-]+)$/, renderPractice);
        route(/^\/quiz\/practice$/, () => renderPractice());
        route(/^\/cards\/(\w+)$/, id => renderDeck(id));
        route(/^\/cards$/, renderDecks);
        route(/^\/ex\/(\w+)$/, renderExSet);
        route(/^\/ex$/, renderExList);
        route(/^\/awards$/, renderAwards);
        route(/^\/vocab$/, () => renderVocab());

        window.addEventListener('hashchange', navigate);
        refreshStreakPill();
        refreshXpPill();
        navigate();
      })
      .catch(err => {
        view().innerHTML = `
          <div class="card" style="max-width:560px;margin:40px auto;text-align:center">
            <h2>⚠️ Không tải được tài liệu</h2>
            <p class="muted">Lỗi: ${esc(err.message)}</p>
            <p class="muted small">Nếu bạn mở file trực tiếp (file://), trình duyệt sẽ chặn việc đọc file .md.
            Hãy chạy web qua một server nhỏ, ví dụ:<br><code>python -m http.server</code> trong thư mục dự án,
            rồi mở <code>http://localhost:8000</code> — hoặc dùng bản online trên GitHub Pages.</p>
          </div>`;
      });
  }

  boot();
})();
