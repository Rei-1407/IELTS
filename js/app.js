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
    data: { settings: { theme: 'dark', lastChapter: 'c1' }, checkins: {}, chapters: {}, best: { streak: 0 } },
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const d = JSON.parse(raw);
          this.data = Object.assign(this.data, d);
          this.data.settings = Object.assign({ theme: 'dark', lastChapter: 'c1' }, d.settings || {});
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
    if (!store.data.checkins[date]) store.data.checkins[date] = {};
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

  /* ================= xây quiz ================= */
  function chNumById(id) { const c = DATA.chapters.find(x => x.id === id); return c ? c.num : null; }

  function buildQuiz(seedStr, scopeNums, n) {
    n = n || 10;
    const rng = P.seededRng(seedStr);
    const inScope = ch => !scopeNums || scopeNums.has(ch);

    const pairsAll = DATA.pairs.slice();
    const formulasAll = DATA.formulas.slice();
    const exAll = [];
    DATA.exercises.forEach(set => set.items.forEach(it => {
      if (it.a) exAll.push({ set, it });
    }));

    const pairsIn = P.shuffled(pairsAll.filter(p => inScope(p.chapter)), rng);
    const pairsOut = P.shuffled(pairsAll.filter(p => !inScope(p.chapter)), rng);
    const formIn = P.shuffled(formulasAll.filter(f => inScope(f.chapter)), rng);
    const formOut = P.shuffled(formulasAll.filter(f => !inScope(f.chapter)), rng);
    const exIn = P.shuffled(exAll.filter(e => e.set.chapterRefs.length && e.set.chapterRefs.some(inScope)), rng);
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
    cardPool.slice(0, 2).forEach(f => items.push({ kind: 'card', front: f.front, back: f.back, sub: 'Chương ' + f.chapter }));
    take(exIn, exOut, 2).forEach(e => items.push({ kind: 'ex', set: e.set, it: e.it }));

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
      if (m) { r.fn(...m.slice(1)); highlightNav(h); window.scrollTo(0, 0); return; }
    }
    location.hash = '#/';
  }
  function highlightNav(h) {
    const root = h.split('/')[1] || 'home';
    const map = { '': 'home', learn: 'learn', quiz: 'quiz', cards: 'cards', ex: 'ex' };
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

  /* ================= HOME ================= */
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
        <div>
          ${ci
            ? `<span class="checkin-badge">✅ Đã điểm danh hôm nay</span>`
            : `<button class="btn big" id="checkinBtn">📍 Điểm danh hôm nay</button>`}
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
    `;

    renderHeatmap();

    const cb = $('#checkinBtn');
    if (cb) cb.onclick = () => { ensureCheckin(); updateBestStreak(); store.save(); refreshStreakPill(); renderHome(); };

    $('#exportBtn').onclick = exportProgress;
    $('#importBtn').onclick = () => $('#importFile').click();
    $('#importFile').onchange = importProgress;
    $('#resetBtn').onclick = () => {
      if (confirm('Xoá toàn bộ tiến độ (điểm danh, chương đã học)? Không thể hoàn tác.')) {
        localStorage.removeItem(KEY);
        location.reload();
      }
    };
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
          ${tocHtml}
        </div>
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
    const items = buildQuiz('daily-' + t, scope, 10);
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
    const items = buildQuiz('practice-' + Date.now(), scope, 10);
    runQuiz(items, { practice: true, label });
  }

  function runQuiz(items, opts) {
    let cur = 0, score = 0;
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
      if (opts.daily) {
        const ci = ensureCheckin();
        ci.quiz = { score, total };
        applySrsAfterDailyQuiz(score, total);
      } else {
        ensureCheckin(); // luyện tập cũng tính điểm danh
      }
      updateBestStreak();
      store.save();
      refreshStreakPill();
      const pct = score / total;
      const emoji = pct >= 0.9 ? '🏆' : pct >= 0.7 ? '🎉' : pct >= 0.5 ? '💪' : '📚';
      const msg = pct >= 0.9 ? 'Xuất sắc! Band 7.5 đang vẫy gọi.'
        : pct >= 0.7 ? 'Tốt lắm! Các chương đến hạn đã được giãn lịch ôn.'
        : pct >= 0.5 ? 'Ổn đấy — xem lại các câu sai nhé.'
        : 'Đừng nản! Đọc lại chương rồi luyện thêm ngay.';
      view().innerHTML = `
        <div class="card q-card quiz-done">
          <div class="emoji">${emoji}</div>
          <div class="big-score">${score}/${total}</div>
          <p>${msg}</p>
          ${opts.daily ? '<p class="checkin-badge">✅ Đã điểm danh hôm nay</p>' : ''}
          <div class="q-actions" style="justify-content:center">
            <button class="btn" onclick="location.hash='#/quiz/practice'">Luyện thêm 10 câu</button>
            <button class="btn ghost" onclick="location.hash='#/'">Về trang chủ</button>
          </div>
        </div>`;
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
      } else if (q.kind === 'card' || q.kind === 'ex') {
        $('#revealBtn').onclick = () => {
          const ansHtml = q.kind === 'card' ? esc(q.back) : miniMd(q.it.a);
          $('#revealZone').innerHTML = `
            <div class="q-answer-reveal">📌 ${ansHtml}</div>
            <p class="muted small" style="margin:12px 0 6px">Bạn có làm đúng / nhớ được không?</p>
            <div class="q-actions">
              <button class="btn green" id="yesBtn">✓ Đúng / Nhớ</button>
              <button class="btn red" id="noBtn">✗ Sai / Chưa nhớ</button>
            </div>`;
          $('#yesBtn').onclick = () => next(true);
          $('#noBtn').onclick = () => next(false);
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
    if (deckId === 'formulas') return DATA.formulas.map(f => ({ front: f.front, back: f.back, sub: 'Chương ' + f.chapter }));
    if (deckId === 'verbs') return DATA.verbs.map(v => ({ front: v.v1 + (v.meaning ? ' — ' + v.meaning : ''), back: 'V2: ' + v.v2 + '\nV3: ' + v.v3, sub: 'Động từ bất quy tắc' }));
    if (deckId === 'pairs') return DATA.pairs.map(p => ({ front: '❌ ' + p.wrong, back: '✅ ' + p.right + (p.note ? '\n💡 ' + p.note : ''), sub: 'Chương ' + p.chapter }));
    return [];
  }

  function renderDeck(deckId, cardsOverride) {
    const all = cardsOverride || P.shuffled(deckCards(deckId), P.seededRng(String(Date.now()))).slice(0, 20);
    if (!all.length) { location.hash = '#/cards'; return; }
    let cur = 0, known = 0;
    const missed = [];

    function show() {
      if (cur >= all.length) {
        ensureCheckin(); updateBestStreak(); store.save(); refreshStreakPill();
        view().innerHTML = `
          <a class="back-link" href="#/cards">← Chọn bộ thẻ khác</a>
          <div class="card q-card quiz-done">
            <div class="emoji">${known === all.length ? '🏆' : '👏'}</div>
            <h2>Hoàn thành phiên thẻ!</h2>
            <div class="big-score">${known}/${all.length}</div>
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
      $('#fcYes').onclick = () => { known++; cur++; show(); };
      $('#fcNo').onclick = () => { missed.push(c); cur++; show(); };
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

        window.addEventListener('hashchange', navigate);
        refreshStreakPill();
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
