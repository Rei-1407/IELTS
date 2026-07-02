/* Node smoke-test: node js/test_parser.js */
const fs = require('fs');
const path = require('path');
const P = require('./parser.js');

const md = fs.readFileSync(path.join(__dirname, '..', 'IELTS_Grammar_7_5.md'), 'utf8');
const data = P.parse(md);

let fails = 0;
function check(name, cond, info) {
  if (cond) console.log('PASS', name, info || '');
  else { console.error('FAIL', name, info || ''); fails++; }
}

const numbered = data.chapters.filter(c => c.kind === 'chapter');
check('30 chương', numbered.length === 30, '=' + numbered.length);
check('6 phụ lục', data.chapters.filter(c => c.kind === 'appendix').length === 6);
check('TOC 4 phần', data.toc.length === 4, JSON.stringify(data.toc.map(t => t.part + ':' + t.chapters.length)));

check('pairs >= 50', data.pairs.length >= 50, '=' + data.pairs.length);
check('pairs có chapter', data.pairs.every(p => p.chapter >= 1 && p.chapter <= 30));
console.log('  ví dụ pair:', JSON.stringify(data.pairs[0]));
console.log('  pair từ bảng:', JSON.stringify(data.pairs.find(p => p.wrong.includes('information'))));

check('formulas >= 20', data.formulas.length >= 20, '=' + data.formulas.length);
console.log('  ví dụ formula:', JSON.stringify(data.formulas[0]));
console.log('  formula bảng 12 thì:', JSON.stringify(data.formulas.find(f => f.front.includes('Past') && f.front.includes('Perfect'))));
console.log('  formula điều kiện:', JSON.stringify(data.formulas.find(f => f.front.includes('Type 2'))));

check('verbs >= 40', data.verbs.length >= 40, '=' + data.verbs.length);
console.log('  ví dụ verb:', JSON.stringify(data.verbs[0]), JSON.stringify(data.verbs[data.verbs.length - 1]));

check('exercises 15 bộ (12 D + 3 F)', data.exercises.length === 15, '=' + data.exercises.length + ' → ' + data.exercises.map(e => e.setId + '(' + e.items.length + ')').join(', '));
const withAns = data.exercises.reduce((n, s) => n + s.items.filter(i => i.a).length, 0);
const total = data.exercises.reduce((n, s) => n + s.items.length, 0);
check('bài tập có đáp án >= 90%', withAns / total >= 0.9, withAns + '/' + total);
const missing = [];
data.exercises.forEach(s => s.items.forEach(i => { if (!i.a) missing.push(s.setId + '#' + i.n); }));
if (missing.length) console.log('  thiếu đáp án:', missing.join(', '));
const d4 = data.exercises.find(e => e.setId === 'D4');
console.log('  D4 refs:', JSON.stringify(d4 && d4.chapterRefs), 'item1:', JSON.stringify(d4 && d4.items[0]));
const f1 = data.exercises.find(e => e.setId === 'F1');
console.log('  F1 item1:', JSON.stringify(f1 && f1.items[0]));

// cloze
const rng = P.seededRng('2026-07-02');
let clozeOk = 0;
data.formulas.forEach(f => { const c = P.makeCloze(f.back, rng); if (c) clozeOk++; });
check('cloze sinh được >= 10', clozeOk >= 10, '=' + clozeOk);
const sample = P.makeCloze('S + have/has + V3 (past participle)', P.seededRng('x'));
console.log('  cloze mẫu:', JSON.stringify(sample));
check('clozeMatch have/has', P.clozeMatch('have', 'have/has') && P.clozeMatch('HAS ', 'have/has') && !P.clozeMatch('had', 'have/has'));

// quiz cố định theo ngày
const a = P.shuffled([1,2,3,4,5,6,7,8], P.seededRng('2026-07-02')).join(',');
const b = P.shuffled([1,2,3,4,5,6,7,8], P.seededRng('2026-07-02')).join(',');
check('seed ổn định', a === b, a);

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
