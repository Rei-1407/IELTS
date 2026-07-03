/* Node test cho logic thuần trong app.js (không cần DOM): node js/test_app_logic.js */
const fs = require('fs');
const path = require('path');
const P = require('./parser.js');

const md = fs.readFileSync(path.join(__dirname, '..', 'IELTS_Grammar_7_5.md'), 'utf8');
const DATA = P.parse(md);

// Trích phần logic từ app.js: từ "function esc" đến trước "/* ================= router"
const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const start = src.indexOf('function esc(');
const end = src.indexOf('/* ================= router');
if (start < 0 || end < 0) { console.error('FAIL: không trích được logic'); process.exit(1); }
const logic = src.slice(start, end);

// stub môi trường
const localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
const sandbox = { P, DATA, localStorage, console };
const fn = new Function('P', 'DATA', 'localStorage', 'console',
  'function refreshStreakPill(){}\nfunction refreshXpPill(){}\nfunction toast(){}\nfunction confetti(){}\nconst document = { querySelector: () => null, querySelectorAll: () => [] };\n' + logic + `
  return { dstr, addDays, store, streak, isCheckedIn, ensureCheckin, markLearned, dueChapters, todayChapter,
           applySrsAfterDailyQuiz, buildQuiz, dailyQuizScope, today, chNumById, updateBestStreak,
           gam, counters, addXp, levelInfo, awardBadges, missionState, checkMissionBonus,
           recordItem, prioritize, reviewStats, addVocab, delVocab, dueVocabList, vocabList };
`);
const A = fn(P, DATA, localStorage, console);

let fails = 0;
function check(name, cond, info) {
  if (cond) console.log('PASS', name, info || '');
  else { console.error('FAIL', name, info || ''); fails++; }
}

// date utils
check('addDays qua tháng', A.addDays('2026-06-30', 1) === '2026-07-01' && A.addDays('2026-01-01', -1) === '2025-12-31',
  A.addDays('2026-06-30', 1));
check('addDays qua năm', A.addDays('2026-12-31', 1) === '2027-01-01');

// streak
const t = A.today();
A.store.data.checkins = {};
check('streak = 0 khi trống', A.streak() === 0);
A.store.data.checkins[t] = {};
A.store.data.checkins[A.addDays(t, -1)] = {};
A.store.data.checkins[A.addDays(t, -2)] = {};
check('streak = 3 liên tiếp', A.streak() === 3, '=' + A.streak());
delete A.store.data.checkins[t]; // hôm nay chưa học → vẫn giữ chuỗi từ hôm qua
check('streak = 2 (hôm nay chưa học)', A.streak() === 2, '=' + A.streak());
A.store.data.checkins = {};

// today chapter / scope khi mới bắt đầu
A.store.data.chapters = {};
const tc = A.todayChapter();
check('chương hôm nay = 1', tc && tc.num === 1, tc && tc.id);
const scope0 = A.dailyQuizScope();
check('scope ngày đầu = {1}', scope0.size === 1 && scope0.has(1));

// mark learned + due
A.markLearned('c1');
check('c1 next = mai', A.store.data.chapters.c1.next === A.addDays(t, 1));
check('chương hôm nay = 2 sau khi học c1', A.todayChapter().num === 2);
A.store.data.chapters.c1.next = t; // ép đến hạn
check('c1 đến hạn', A.dueChapters().includes('c1'));

// SRS pass/fail
A.applySrsAfterDailyQuiz(8, 10);
check('SRS pass: interval x2', A.store.data.chapters.c1.interval === 2 && A.store.data.chapters.c1.next === A.addDays(t, 2),
  JSON.stringify(A.store.data.chapters.c1));
A.store.data.chapters.c1.next = t;
A.applySrsAfterDailyQuiz(3, 10);
check('SRS fail: interval về 1', A.store.data.chapters.c1.interval === 1 && A.store.data.chapters.c1.next === A.addDays(t, 1));

// buildQuiz
const q1 = A.buildQuiz('daily-2026-07-02', new Set([3]), 10);
check('quiz đủ 10 câu (scope hẹp)', q1.length === 10, '=' + q1.length);
const kinds = q1.reduce((m, q) => (m[q.kind] = (m[q.kind] || 0) + 1, m), {});
check('quiz đủ loại câu', kinds.mcq >= 4 && (kinds.cloze || 0) >= 1 && (kinds.card || 0) >= 1 && (kinds.ex || 0) >= 1,
  JSON.stringify(kinds));
const sig = q => q.map(x => x.kind + ':' + (x.pair ? x.pair.id : x.f ? x.f.id : x.it ? x.it.id : x.front)).join('|');
const q2 = A.buildQuiz('daily-2026-07-02', new Set([3]), 10);
check('quiz cố định theo seed', sig(q1) === sig(q2));
const q3 = A.buildQuiz('daily-2026-07-03', new Set([3]), 10);
check('seed khác → quiz khác', sig(q1) !== sig(q3));

const qDay1 = A.buildQuiz('daily-x', new Set([1]), 10);
check('quiz ngày đầu vẫn đủ 10 câu', qDay1.length === 10, '=' + qDay1.length);
check('mcq có 1 đáp án đúng', q1.filter(q => q.kind === 'mcq').every(q => q.opts.filter(o => o.correct).length === 1));

// quiz toàn cục
const qAll = A.buildQuiz('p-1', null, 10);
check('quiz không scope đủ 10 câu', qAll.length === 10);

// ===== gamification =====
A.store.data.checkins = {}; A.store.data.chapters = {};
A.store.data.gam = { xp: 0, examDate: null, badges: {}, counters: {} };
check('level 0 XP = Band 3.0', A.levelInfo(0).cur.band === '3.0');
check('level 100 XP = Band 3.5', A.levelInfo(100).cur.band === '3.5');
check('level max không có next', A.levelInfo(9999).next === null);
A.markLearned('c1');
check('XP sau học chương = 60 (10 điểm danh + 50 chương)', A.gam().xp === 60, '=' + A.gam().xp);
A.ensureCheckin();
check('điểm danh lần 2 cùng ngày không cộng XP', A.gam().xp === 60, '=' + A.gam().xp);
A.counters().quizzes = 1;
A.awardBadges();
check('huy hiệu quiz1 mở', !!A.gam().badges.quiz1);
check('huy hiệu chưa đạt vẫn khóa', !A.gam().badges.streak30);
const ms = A.missionState();
check('missionState 3 nhiệm vụ', ms.length === 3, JSON.stringify(ms.map(m => m.done)));
check('nhiệm vụ điểm danh + học done', ms[0].done && ms[2].done && !ms[1].done);
A.store.data.checkins[t].quiz = { score: 8, total: 10 };
const xpBefore = A.gam().xp;
A.checkMissionBonus();
check('bonus 3 nhiệm vụ +20 XP', A.gam().xp === xpBefore + 20 && A.store.data.checkins[t].bonus === true, '=' + A.gam().xp);
A.checkMissionBonus();
check('bonus không cộng 2 lần', A.gam().xp === xpBefore + 20);
// comeback
A.store.data.checkins = {}; A.store.data.gam.counters = {};
A.store.data.checkins[A.addDays(t, -10)] = {};
A.ensureCheckin();
check('comeback flag sau nghỉ dài', A.counters().comeback === true);

// ===== SRS từng mục + từ vựng =====
A.store.data.items = {};
A.recordItem('itemX', true);
check('recordItem đúng: box 1, hạn +2 ngày', A.store.data.items.itemX.b === 1 && A.store.data.items.itemX.n === A.addDays(t, 2),
  JSON.stringify(A.store.data.items.itemX));
A.recordItem('itemX', true);
check('đúng tiếp: box 2, hạn +4 ngày', A.store.data.items.itemX.b === 2 && A.store.data.items.itemX.n === A.addDays(t, 4));
A.recordItem('itemX', false);
check('sai: về box 0, mai ôn lại', A.store.data.items.itemX.b === 0 && A.store.data.items.itemX.n === A.addDays(t, 1));

const rs = A.reviewStats();
check('reviewStats tổng >= 250 mục', rs.total >= 250, '=' + rs.total);
check('reviewStats seen đếm đúng', rs.seen === 0, 'seen=' + rs.seen + ' (itemX không thuộc tài liệu)');

// prioritize: mục due lên đầu
const fakePool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
A.store.data.items = { b: { b: 1, n: t, s: 1, c: 1 }, c: { b: 2, n: A.addDays(t, 5), s: 1, c: 1 } };
const ordered = A.prioritize(fakePool, P.seededRng('x'));
check('prioritize: due → unseen → rest', ordered[0].id === 'b' && ordered[1].id === 'a' && ordered[2].id === 'c',
  ordered.map(o => o.id).join(','));

// vocab
A.store.data.vocab = []; A.store.data.items = {};
const xpV = A.gam().xp;
const v1 = A.addVocab('ubiquitous', 'có mặt khắp nơi', 'Smartphones are ubiquitous.');
check('thêm từ ok +2 XP', v1 && A.vocabList().length === 1 && A.gam().xp === xpV + 2);
const v2 = A.addVocab('Ubiquitous', 'phổ biến khắp nơi', '');
check('trùng từ → cập nhật nghĩa, không nhân đôi', A.vocabList().length === 1 && A.vocabList()[0].m === 'phổ biến khắp nơi');
check('từ mới nằm trong danh sách đến hạn', A.dueVocabList().length === 1);
A.recordItem(v1.id, true);
check('ôn xong hết đến hạn', A.dueVocabList().length === 0);
A.delVocab(v1.id);
check('xóa từ ok', A.vocabList().length === 0);
A.counters().vocabAdded = 50;
A.awardBadges();
check('huy hiệu vocab50 mở', !!A.gam().badges.vocab50);

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
process.exit(fails ? 1 : 0);
