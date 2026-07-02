/* Smoke test end-to-end với DOM giả lập tối giản: node js/test_dom_smoke.js
   Chạy app.js thật: render các trang, làm trọn quiz ngày, lật hết bộ thẻ, mở bài tập. */
const fs = require('fs');
const path = require('path');

const P = require('./parser.js');
const renderMd = require('./md.js');
const mdText = fs.readFileSync(path.join(__dirname, '..', 'IELTS_Grammar_7_5.md'), 'utf8');

/* ---------- DOM giả lập ---------- */
const headerHTML = `
  <span id="streakPill"></span><button id="themeBtn"></button><span id="xpPill"></span>
  <a data-route="home"></a><a data-route="learn"></a><a data-route="quiz"></a><a data-route="cards"></a><a data-route="ex"></a>`;
let htmlLog = headerHTML; // toàn bộ HTML "đang hiển thị"
let era = 0;
const cacheById = new Map();   // era:id -> stub
const cacheBySel = new Map();  // era:sel -> [stubs]

function makeStub(extra, isView) {
  const el = {
    _inner: '',
    style: { setProperty() {} }, dataset: {}, classList: { toggle() {}, add() {}, remove() {} },
    onclick: null, oninput: null, onblur: null, onkeydown: null, onchange: null,
    disabled: false, value: '', textContent: '', scrollLeft: 0, scrollWidth: 0,
    focus() {}, click() {}, scrollIntoView() {}, remove() {}, appendChild() {},
    files: [], className: '',
    querySelectorAll(sel) { return queryAllIn(this._inner, sel); },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._inner; },
    set(v) {
      this._inner = v;
      if (isView) { htmlLog = headerHTML + v; era++; cacheById.clear(); cacheBySel.clear(); }
      else htmlLog += v;
    },
  });
  Object.defineProperty(el, 'nextElementSibling', {
    get() { if (!this._next) this._next = makeStub(); return this._next; },
  });
  return Object.assign(el, extra || {});
}

const viewEl = makeStub(null, true);

function idPresent(id) { return htmlLog.includes('id="' + id + '"'); }
function byId(id) {
  if (id === 'view') return viewEl;
  if (!idPresent(id)) return null;
  const key = era + ':' + id;
  if (!cacheById.has(key)) cacheById.set(key, makeStub());
  return cacheById.get(key);
}
function countIn(html, sel) {
  const map = {
    '.q-opt': /class="q-opt"/g,
    '.toc-item': /class="toc-item/g,
    '.ans-btn': /ans-btn/g,
    '.ex-item .ans': /class="ans"/g,
    '.nav a': /data-route/g,
    '.res': /class="res"/g,
    'h3': /<h3/g,
  };
  const re = map[sel] || new RegExp('class="' + sel.replace(/^\./, '').split(' ')[0], 'g');
  return (html.match(re) || []).length;
}
function queryAllIn(html, sel) {
  const n = countIn(html, sel);
  const key = era + ':' + sel;
  if (!cacheBySel.has(key)) {
    const arr = [];
    for (let i = 0; i < n; i++) { const s = makeStub(); s.dataset.i = String(i); s.dataset.ch = 'c1'; s.dataset.route = 'home'; arr.push(s); }
    cacheBySel.set(key, arr);
  }
  return cacheBySel_get(key, n);
}
function cacheBySel_get(key, n) {
  let arr = cacheBySel.get(key);
  while (arr.length < n) { const s = makeStub(); s.dataset.i = String(arr.length); arr.push(s); }
  return arr.slice(0, n);
}

const listeners = {};
const location = { hash: '' };
const window = {
  IELTSParser: P, renderMd,
  addEventListener(ev, fn) { listeners[ev] = fn; },
  scrollTo() {},
};
const document = {
  documentElement: { dataset: {} },
  body: makeStub(),
  addEventListener() {}, removeEventListener() {},
  querySelector(sel) { return sel[0] === '#' ? byId(sel.slice(1)) : (countIn(htmlLog, sel) ? queryAllIn(htmlLog, sel)[0] : null); },
  querySelectorAll(sel) { return queryAllIn(htmlLog, sel); },
  getElementById(id) { return byId(id); },
  createElement() { return makeStub({ href: '', download: '' }); },
};
const localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
const fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve(mdText) });
const confirm = () => false, alert = () => {};
const URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
function Blob() {}
function FileReader() { this.readAsText = () => {}; }

/* ---------- chạy app.js ---------- */
const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const run = new Function('window', 'document', 'location', 'localStorage', 'fetch', 'confirm', 'alert', 'URL', 'Blob', 'FileReader', 'setTimeout', 'console', src);

let fails = 0;
const check = (n, c, info) => { if (c) console.log('PASS', n, info || ''); else { console.error('FAIL', n, info || ''); fails++; } };

function goto(hash) { location.hash = hash; listeners.hashchange(); }

(async () => {
  run(window, document, location, localStorage, fetch, confirm, alert, URL, Blob, FileReader, (fn) => fn(), console);
  await new Promise(r => setImmediate(r));

  // HOME
  check('home render', htmlLog.includes('Chào Long') && htmlLog.includes('Bài học hôm nay'));
  check('home: chương 1 được giao', htmlLog.includes('Chương 1:'));
  check('heatmap render', (htmlLog.match(/hm-cell/g) || []).length > 100);

  // LEARN
  goto('#/learn/c3');
  check('learn c3 render', htmlLog.includes('Thì động từ') && htmlLog.includes('Present Simple'));
  check('learn có nút luyện chương', htmlLog.includes('Luyện chương này'));
  check('learn có thanh kéo cột', htmlLog.includes('tocResizer'));
  goto('#/learn/appD');
  check('learn phụ lục D render', htmlLog.includes('Ngân hàng bài tập'));

  // đánh dấu đã học c1 (giả lập nút)
  goto('#/learn/c1');
  const lb = byId('learnBtn');
  check('nút đánh dấu đã học tồn tại', !!lb);
  lb.onclick();
  check('c1 đã học → nút đổi', htmlLog.includes('bỏ đánh dấu'));

  // QUIZ NGÀY — làm trọn 10 câu
  goto('#/quiz');
  let steps = 0;
  while (!htmlLog.includes('quiz-done') && steps < 30) {
    steps++;
    if (idPresent('clozeInput')) {
      const inp = byId('clozeInput');
      inp.value = 'xyz';
      byId('checkBtn').onclick();
      byId('nextBtn').onclick();
    } else if (idPresent('revealBtn')) {
      byId('revealBtn').onclick();
      byId('yesBtn').onclick();
    } else {
      const opts = document.querySelectorAll('.q-opt');
      if (!opts.length) break;
      opts[0].onclick();
      byId('nextBtn').onclick();
    }
  }
  check('quiz ngày hoàn thành (10 câu)', htmlLog.includes('quiz-done'), 'steps=' + steps);
  const state = JSON.parse(localStorage._d.ielts75_v1);
  const today = Object.keys(state.checkins).sort().pop();
  check('điểm danh ghi nhận quiz', state.checkins[today] && !!state.checkins[today].quiz, JSON.stringify(state.checkins[today]));

  // vào lại #/quiz → màn "đã xong"
  goto('#/quiz');
  check('quiz landing khi đã xong', htmlLog.includes('Quiz hôm nay đã xong'));

  // PRACTICE
  goto('#/quiz/practice/c3');
  check('practice c3 chạy', htmlLog.includes('Luyện tập') && (htmlLog.includes('q-opt') || idPresent('revealBtn') || idPresent('clozeInput')));

  // FLASHCARDS — lật trọn bộ
  goto('#/cards');
  check('decks render', htmlLog.includes('Động từ bất quy tắc'));
  goto('#/cards/verbs');
  let cardSteps = 0;
  while (!htmlLog.includes('Hoàn thành phiên thẻ') && cardSteps < 25) {
    cardSteps++;
    const fc = byId('fc');
    if (!fc) break;
    fc.onclick();
    byId('fcYes').onclick();
  }
  check('lật hết 20 thẻ verbs', htmlLog.includes('Hoàn thành phiên thẻ'), 'steps=' + cardSteps);

  // EXERCISES
  goto('#/ex');
  check('ds bài tập render', htmlLog.includes('Ngân hàng bài tập') && htmlLog.includes('D1') === false ? true : htmlLog.includes('câu'));
  goto('#/ex/D4');
  check('bài D4 render', htmlLog.includes('Câu điều kiện') && htmlLog.includes('Hiện đáp án'));
  const ansBtns = document.querySelectorAll('.ans-btn');
  check('D4 có 6 nút đáp án', ansBtns.length === 6, '=' + ansBtns.length);
  ansBtns[0].onclick();
  byId('toggleAll').onclick();
  goto('#/ex/F1');
  check('bài F1 render', htmlLog.includes('Viết lại câu'));

  // AWARDS
  goto('#/awards');
  check('trang thành tích render', htmlLog.includes('Huy hiệu') && htmlLog.includes('Band'));
  check('có huy hiệu đã mở', htmlLog.includes('badge earned'), (htmlLog.match(/badge earned/g) || []).length + ' earned');

  // HOME sau khi học
  goto('#/');
  check('home: quiz đã xong hiển thị', htmlLog.includes('Đã hoàn thành:'));
  check('home: streak >= 1', htmlLog.includes('Đã điểm danh hôm nay'));
  check('home: nhiệm vụ ngày hiển thị', htmlLog.includes('Nhiệm vụ hôm nay'));
  check('home: 3/3 nhiệm vụ xong', htmlLog.includes('3/3'), (htmlLog.match(/Nhiệm vụ hôm nay — \d\/3/) || [''])[0]);
  check('home: nút đặt ngày thi', htmlLog.includes('Đặt ngày thi'));
  check('home: thẻ cấp độ Band', htmlLog.includes('level-band'));
  const st2 = JSON.parse(localStorage._d.ielts75_v1);
  check('XP tích lũy > 0', st2.gam && st2.gam.xp > 0, 'xp=' + (st2.gam && st2.gam.xp));
  check('có huy hiệu trong store', Object.keys(st2.gam.badges).length >= 1, Object.keys(st2.gam.badges).join(','));

  console.log(fails === 0 ? '\nALL PASS (' + steps + ' quiz steps)' : '\n' + fails + ' FAILED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
