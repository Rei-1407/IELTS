/* ============================================================
   IELTS Grammar Trainer — parser.js
   Đọc IELTS_Grammar_7_5.md → cấu trúc dữ liệu cho web.
   Chạy được cả trong browser lẫn Node (để test).
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.IELTSParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- helpers ---------- */

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Bỏ markdown inline (* ** ` ) nhưng giữ nguyên chữ
  function stripMd(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isTableRow(line) { return /^\s*\|.*\|\s*$/.test(line); }
  function isTableSep(line) { return /^\s*\|[\s\-:|]+\|\s*$/.test(line); }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  }

  /* ---------- parse chính ---------- */

  function parse(md) {
    const lines = md.split(/\r?\n/);

    const chapters = [];      // {id, kind, num, letter, title, lines:[], part}
    let currentPart = null;   // 'I' | 'II' | 'III' | 'APP'
    let cur = null;

    function pushChapter(ch) { if (ch) chapters.push(ch); }

    // Chương mở đầu (trước PHẦN I)
    cur = { id: 'intro', kind: 'intro', num: 0, title: 'Giới thiệu & Mục lục', part: null, lines: [] };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const mPart = line.match(/^# PH(?:ẦN|ỤC) ?(I{1,3}|LỤC)?/);
      if (/^# PHẦN (I{1,3})\b/.test(line)) {
        pushChapter(cur); cur = null;
        currentPart = line.match(/^# PHẦN (I{1,3})\b/)[1];
        continue;
      }
      if (/^# PHỤ LỤC/.test(line)) {
        pushChapter(cur); cur = null;
        currentPart = 'APP';
        continue;
      }
      if (/^# PART\b/.test(line)) continue; // dòng tiếng Anh đi kèm

      const mNum = line.match(/^## (\d+)\.\s+(.+?)\s*$/);
      const mApp = line.match(/^## Phụ lục ([A-Z]) — (.+?)\s*$/);
      if (mNum) {
        pushChapter(cur);
        cur = { id: 'c' + mNum[1], kind: 'chapter', num: parseInt(mNum[1], 10), title: mNum[2], part: currentPart, lines: [line] };
        continue;
      }
      if (mApp) {
        pushChapter(cur);
        cur = { id: 'app' + mApp[1], kind: 'appendix', letter: mApp[1], title: 'Phụ lục ' + mApp[1] + ' — ' + mApp[2], part: 'APP', lines: [line] };
        continue;
      }
      // '## 🔑 ĐÁP ÁN' và mọi dòng khác: thuộc chương hiện tại
      if (cur) cur.lines.push(line);
    }
    pushChapter(cur);

    // Trang giới thiệu: bỏ khối MỤC LỤC (sidebar web đã thay thế)
    const intro = chapters.find(c => c.id === 'intro');
    if (intro) {
      const tocAt = intro.lines.findIndex(l => /^## MỤC LỤC/.test(l));
      if (tocAt > 0) intro.lines = intro.lines.slice(0, tocAt);
    }

    chapters.forEach(ch => { ch.md = ch.lines.join('\n'); });

    /* ----- trích xuất cặp ❌/✅ ----- */
    const pairs = [];
    function addPair(wrong, right, note, chNum) {
      wrong = stripMd(wrong.replace(/[❌✅]/g, ''));
      right = stripMd(right.replace(/[❌✅]/g, ''));
      if (!wrong || !right || wrong.length < 3 || right.length < 3) return;
      if (wrong.toLowerCase() === right.toLowerCase()) return;
      pairs.push({ id: 'p' + hash(wrong + '|' + right), wrong, right, note: note || '', chapter: chNum });
    }

    chapters.filter(c => c.kind === 'chapter').forEach(ch => {
      const ls = ch.lines;
      for (let i = 0; i < ls.length; i++) {
        const line = ls[i];

        // Dạng bảng
        if (isTableRow(line) && !isTableSep(line)) {
          // Header có ❌ và ✅ ở 2 cột → các dòng dưới là cặp
          const cells = splitRow(line);
          const wIdx = cells.findIndex(c => c.includes('❌'));
          const rIdx = cells.findIndex(c => c.includes('✅'));
          const isHeader = i + 1 < ls.length && isTableSep(ls[i + 1]);
          if (isHeader && wIdx >= 0 && rIdx >= 0 && wIdx !== rIdx) {
            // đọc các dòng dữ liệu
            let j = i + 2;
            while (j < ls.length && isTableRow(ls[j])) {
              if (!isTableSep(ls[j])) {
                const dc = splitRow(ls[j]);
                if (dc.length > Math.max(wIdx, rIdx)) {
                  const note = dc.filter((_, k) => k !== wIdx && k !== rIdx).map(stripMd).filter(Boolean).join(' — ');
                  addPair(dc[wIdx], dc[rIdx], note, ch.num);
                }
              }
              j++;
            }
            i = j - 1;
            continue;
          }
          // Dòng lẻ trong bảng có cả ❌ lẫn ✅
          if (wIdx >= 0 && rIdx >= 0 && wIdx !== rIdx) {
            addPair(cells[wIdx], cells[rIdx], '', ch.num);
            continue;
          }
        }

        // Dạng inline: ❌ ... → ✅ ...
        const m = line.match(/❌\s*(.+?)\s*→\s*✅\s*(.+?)\s*$/);
        if (m) {
          let right = m[2], note = '';
          const mn = right.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
          if (mn && mn[2].length > 3) { right = mn[1]; note = mn[2]; }
          addPair(m[1], right, note, ch.num);
        }
      }
    });

    /* ----- công thức (flashcards + cloze) ----- */
    const formulas = [];
    function addFormula(front, back, chNum) {
      front = stripMd(front); back = stripMd(back);
      if (!front || !back) return;
      formulas.push({ id: 'f' + hash(front + '|' + back), front, back, chapter: chNum });
    }

    chapters.filter(c => c.kind === 'chapter').forEach(ch => {
      let curSection = ch.title;
      ch.lines.forEach(line => {
        const mh = line.match(/^### (.+?)\s*$/);
        if (mh) curSection = mh[1].replace(/[⭐🎯]/g, '').trim();
        const mf = line.match(/^\*\*Công thức(?: chung)?:\*\*\s*(.+)$/);
        if (mf) addFormula(curSection, mf[1], ch.num);
      });
    });

    // Bảng 12 thì (chương 3)
    const ch3 = chapters.find(c => c.num === 3);
    if (ch3) {
      const ls = ch3.lines;
      for (let i = 0; i < ls.length; i++) {
        if (isTableRow(ls[i]) && ls[i].includes('Perfect Continuous')) {
          const header = splitRow(ls[i]); // ['', Simple, Continuous, Perfect, Perfect Continuous]
          let j = i + 2;
          while (j < ls.length && isTableRow(ls[j])) {
            const row = splitRow(ls[j]);
            const time = stripMd(row[0]);
            for (let k = 1; k < row.length && k < header.length; k++) {
              const aspect = stripMd(header[k]).split('(')[0].trim();
              if (time && row[k]) addFormula('Công thức thì ' + time + ' ' + aspect, row[k], 3);
            }
            j++;
          }
          break;
        }
      }
    }

    // Bảng câu điều kiện (chương 5)
    const ch5 = chapters.find(c => c.num === 5);
    if (ch5) {
      const ls = ch5.lines;
      for (let i = 0; i < ls.length; i++) {
        if (isTableRow(ls[i]) && /Loại/.test(ls[i]) && /Cấu trúc/.test(ls[i])) {
          const header = splitRow(ls[i]);
          const tIdx = header.findIndex(c => /Loại/.test(c));
          const sIdx = header.findIndex(c => /Cấu trúc/.test(c));
          const uIdx = header.findIndex(c => /Dùng/.test(c));
          let j = i + 2;
          while (j < ls.length && isTableRow(ls[j])) {
            const row = splitRow(ls[j]);
            if (row[tIdx] && row[sIdx]) {
              const use = uIdx >= 0 && row[uIdx] ? ' (' + stripMd(row[uIdx]) + ')' : '';
              addFormula('Câu điều kiện ' + stripMd(row[tIdx]) + use, row[sIdx], 5);
            }
            j++;
          }
          break;
        }
      }
    }

    /* ----- động từ bất quy tắc (Phụ lục A) ----- */
    const verbs = [];
    const appA = chapters.find(c => c.id === 'appA');
    if (appA) {
      const ls = appA.lines;
      for (let i = 0; i < ls.length; i++) {
        if (isTableRow(ls[i]) && /V1/.test(ls[i]) && /V2/.test(ls[i])) {
          let j = i + 2;
          while (j < ls.length && isTableRow(ls[j])) {
            const row = splitRow(ls[j]).map(stripMd);
            if (row.length >= 3 && row[0] && row[1]) {
              verbs.push({ id: 'v' + hash(row[0]), v1: row[0], v2: row[1], v3: row[2] || '', meaning: row[3] || '' });
            }
            j++;
          }
          break;
        }
      }
    }

    /* ----- ngân hàng bài tập (Phụ lục D & F) ----- */
    const exercises = []; // {setId, title, chapterRefs, items:[{n, q, a}]}

    function parseExerciseRegion(chLines, setRe, ansHeadRe, ansBlockRe, setIdFn) {
      const sets = [];
      const answers = {}; // setKey -> {n: answerText}
      let mode = 'q';
      let curSet = null, curAnsKey = null, lastItem = null;

      for (let i = 0; i < chLines.length; i++) {
        const line = chLines[i];
        if (ansHeadRe.test(line)) { mode = 'a'; curSet = null; lastItem = null; continue; }

        if (mode === 'q') {
          const ms = line.match(setRe);
          if (ms) {
            curSet = { setId: setIdFn(ms), title: stripMd(ms[2] || ''), chapterRefs: [], items: [] };
            if (ms[3]) curSet.chapterRefs = ms[3].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
            sets.push(curSet); lastItem = null;
            continue;
          }
          if (/^###|^## /.test(line)) { curSet = null; lastItem = null; continue; }
          if (curSet) {
            const mi = line.match(/^(\d+)\.\s+(.+)$/);
            if (mi) { lastItem = { n: parseInt(mi[1], 10), q: mi[2].trim(), a: '' }; curSet.items.push(lastItem); continue; }
            if (lastItem && /^\s+\S/.test(line)) { lastItem.q += '\n' + line.trim(); continue; }
            if (line.trim() === '' || line.trim() === '---') { lastItem = null; }
          }
        } else {
          const mb = line.match(ansBlockRe);
          if (mb) { curAnsKey = mb[1]; answers[curAnsKey] = {}; lastItem = null; continue; }
          if (/^## /.test(line)) { curAnsKey = null; lastItem = null; continue; }
          if (curAnsKey) {
            const mi = line.match(/^(\d+)\.\s+(.+)$/);
            if (mi) { answers[curAnsKey][mi[1]] = mi[2].trim(); lastItem = mi[1]; continue; }
            if (lastItem && /^\s+\S/.test(line)) { answers[curAnsKey][lastItem] += '\n' + line.trim(); }
          }
        }
      }
      // Ghép đáp án vào câu hỏi
      sets.forEach(set => {
        const key = set._ansKey || set.setId.replace(/^D/, '').replace(/^F/, '');
        const ans = answers[key] || answers[set.setId] || {};
        set.items.forEach(it => { it.a = ans[it.n] || ''; });
      });
      return sets;
    }

    const appD = chapters.find(c => c.id === 'appD');
    if (appD) {
      const sets = parseExerciseRegion(
        appD.lines,
        /^### Bài tập (\d+) — (.+?)(?:\s*\[Mục ([^\]]+)\])?\s*$/,
        /^## 🔑 ĐÁP ÁN(?!.*PHỤ LỤC F)/,
        /^\*\*Bài (\d+)[^:]*:\*\*/,
        ms => 'D' + ms[1]
      );
      sets.forEach(s => exercises.push(s));
    }

    const appF = chapters.find(c => c.id === 'appF');
    if (appF) {
      const sets = parseExerciseRegion(
        appF.lines,
        /^### Dạng F(\d+) — (.+?)\s*$/,
        /^## 🔑 ĐÁP ÁN PHỤ LỤC F/,
        /^\*\*Dạng F(\d+)[^:]*:\*\*/,
        ms => 'F' + ms[1]
      );
      sets.forEach(s => { s.title = 'F' + s.setId.slice(1) + ' — ' + s.title; exercises.push(s); });
    }

    // Gắn id ổn định cho từng câu bài tập
    exercises.forEach(set => set.items.forEach(it => { it.id = 'e' + hash(set.setId + '#' + it.n + '#' + it.q.slice(0, 40)); }));

    /* ----- mục lục ----- */
    const partNames = { I: 'Phần I — Ngữ pháp cốt lõi', II: 'Phần II — Bổ sung & nâng cao', III: 'Phần III — Nâng cao chuyên sâu', APP: 'Phụ lục' };
    const toc = [];
    ['I', 'II', 'III', 'APP'].forEach(p => {
      const chs = chapters.filter(c => c.part === p);
      if (chs.length) toc.push({ part: p, name: partNames[p], chapters: chs.map(c => ({ id: c.id, num: c.num, title: c.kind === 'chapter' ? c.num + '. ' + c.title : c.title })) });
    });

    return { chapters, toc, pairs, formulas, verbs, exercises };
  }

  /* ---------- sinh cloze từ công thức ---------- */
  function makeCloze(formula, rng) {
    // Lấy vế đầu (trước dấu '|' nếu có), tách theo ' + '
    const base = formula.split('|')[0].trim();
    const parts = base.split(/\s\+\s/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const candidates = parts
      .map((p, idx) => ({ p, idx }))
      .filter(o => o.p.length > 1 && !/^S$/i.test(o.p) && !/^V\??$/i.test(o.p));
    if (!candidates.length) return null;
    const pick = candidates[Math.floor(rng() * candidates.length)];
    const shown = parts.map((p, idx) => (idx === pick.idx ? '______' : p)).join(' + ');
    // Đáp án: bỏ phần chú thích trong ngoặc
    const answer = pick.p.replace(/\([^)]*\)/g, '').trim();
    return { shown, answer };
  }

  // So sánh đáp án cloze (dễ tính: bỏ hoa thường, khoảng trắng thừa)
  function clozeMatch(user, answer) {
    const norm = s => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;]/g, '').trim();
    if (!user) return false;
    const u = norm(user), a = norm(answer);
    if (u === a) return true;
    // chấp nhận 1 trong các biến thể "have/has" → "have" hoặc "has"
    if (a.includes('/')) return a.split('/').map(x => x.trim()).some(x => x === u || (x + ' ' + a.split(' ').slice(1).join(' ')).trim() === u);
    return false;
  }

  /* ---------- RNG có seed (quiz cố định theo ngày) ---------- */
  function seededRng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  return { parse, makeCloze, clozeMatch, seededRng, shuffled, hash };
});
