/* Node test cho renderer markdown: node js/test_md.js */
const fs = require('fs');
const path = require('path');
const renderMd = require('./md.js');
const md = fs.readFileSync(path.join(__dirname, '..', 'IELTS_Grammar_7_5.md'), 'utf8');
const html = renderMd(md);

let fails = 0;
const check = (n, c, info) => { if (c) console.log('PASS', n, info || ''); else { console.error('FAIL', n, info || ''); fails++; } };
const count = re => (html.match(re) || []).length;
const srcCount = re => (md.match(re) || []).length;

check('h2 khớp nguồn', count(/<h2>/g) === srcCount(/^## /gm), count(/<h2>/g) + ' vs ' + srcCount(/^## /gm));
check('h3 khớp nguồn', count(/<h3>/g) === srcCount(/^### /gm), count(/<h3>/g) + ' vs ' + srcCount(/^### /gm));
check('có >= 25 bảng', count(/<table>/g) >= 25, '=' + count(/<table>/g));
check('bảng đóng đủ', count(/<table>/g) === count(/<\/table>/g));
check('ul/ol đóng đủ', count(/<ul>/g) === count(/<\/ul>/g) && count(/<ol>/g) === count(/<\/ol>/g), 'ul=' + count(/<ul>/g) + ' ol=' + count(/<ol>/g));
check('li đóng đủ', count(/<li>/g) === count(/<\/li>/g), '=' + count(/<li>/g));
check('không sót **', !/\*\*[^<>]{3,40}\*\*/.test(html), (html.match(/\*\*[^<>]{3,40}\*\*/) || [''])[0]);
check('không có script tag', !/<script/i.test(html));
check('chỉ tag hợp lệ', !/<(?!\/?(h[1-6]|p|ul|ol|li|table|thead|tbody|tr|th|td|strong|em|code|blockquote|hr|br|a)\b)[a-z]/i.test(html));
check('placeholder sạch', html.indexOf(String.fromCharCode(1)) < 0);
check('bold render', html.includes('<strong>goes</strong>'));
check('nested list render', /<li>[^]*?<ul><li>/.test(html));
check('bảng 12 thì có nội dung', html.includes('have/has been + V-ing'));
check('không link anchor nội bộ', !/href="#/.test(html));

const idx = html.indexOf('Present Simple');
console.log('\n--- sample ---\n' + html.slice(Math.max(0, idx - 60), idx + 500) + '\n---');
console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILED');
process.exit(fails ? 1 : 0);
