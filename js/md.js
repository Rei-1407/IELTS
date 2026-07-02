/* ============================================================
   Mini Markdown renderer — đủ cho IELTS_Grammar_7_5.md
   (headers, bold/italic/code, bảng, list lồng 1 cấp, blockquote,
    hr, link). Không phụ thuộc thư viện ngoài, chạy offline.
   Node-compatible để test.
   ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.renderMd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MARK = String.fromCharCode(1); // ký tự placeholder không xuất hiện trong tài liệu

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(s) {
    let out = escapeHtml(s);
    // code spans trước (bảo vệ nội dung)
    const codes = [];
    out = out.replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return MARK + (codes.length - 1) + MARK; });
    // links: http → mở tab mới; anchor nội bộ → chỉ giữ chữ
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) =>
      /^https?:\/\//.test(href) ? '<a href="' + href + '" target="_blank" rel="noopener">' + txt + '</a>' : txt);
    // bold rồi italic
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*(?!\s)([^*]+?)\*/g, '<em>$1</em>');
    // trả code spans
    out = out.replace(new RegExp(MARK + '(\\d+)' + MARK, 'g'), function (_, i) { return '<code>' + codes[+i] + '</code>'; });
    return out;
  }

  function isTableRow(l) { return /^\s*\|.*\|\s*$/.test(l); }
  function isTableSep(l) { return /^\s*\|[\s\-:|]+\|\s*$/.test(l); }
  function splitRow(l) {
    let s = l.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  }

  function render(md) {
    const lines = md.split(/\r?\n/);
    const html = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // trống
      if (/^\s*$/.test(line)) { i++; continue; }

      // hr
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { html.push('<hr>'); i++; continue; }

      // heading
      const mh = line.match(/^(#{1,6})\s+(.*)$/);
      if (mh) {
        const lv = mh[1].length;
        html.push('<h' + lv + '>' + inline(mh[2]) + '</h' + lv + '>');
        i++; continue;
      }

      // bảng
      if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = splitRow(line);
        let t = '<table><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
        i += 2;
        while (i < lines.length && isTableRow(lines[i])) {
          if (!isTableSep(lines[i])) {
            t += '<tr>' + splitRow(lines[i]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
          }
          i++;
        }
        html.push(t + '</tbody></table>');
        continue;
      }

      // blockquote
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
        html.push('<blockquote>' + render(buf.join('\n')) + '</blockquote>');
        continue;
      }

      // list (ul/ol, lồng 1 cấp theo indent)
      const mList = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (mList) {
        const ordered = /\d/.test(mList[2]);
        const tag = ordered ? 'ol' : 'ul';
        let out = '<' + tag + '>';
        let sub = null, subTag = '';
        const closeSub = () => { if (sub !== null) { out += '<' + subTag + '>' + sub + '</' + subTag + '>'; sub = null; } };
        let open = false;
        while (i < lines.length) {
          const l = lines[i];
          const m = l.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
          if (m) {
            const indent = m[1].length;
            if (indent >= 2) { // mục con
              const st = /\d/.test(m[2]) ? 'ol' : 'ul';
              if (sub === null) { sub = ''; subTag = st; }
              sub += '<li>' + inline(m[3]) + '</li>';
              i++; continue;
            }
            closeSub();
            if (open) out += '</li>';
            out += '<li>' + inline(m[3]);
            open = true;
            i++; continue;
          }
          // dòng nối tiếp trong cùng item (thụt đầu dòng, không phải mục mới)
          if (open && /^\s{2,}\S/.test(l) && !isTableRow(l)) {
            out += '<br>' + inline(l.trim());
            i++; continue;
          }
          break;
        }
        closeSub();
        if (open) out += '</li>';
        out += '</' + tag + '>';
        html.push(out);
        continue;
      }

      // đoạn văn: gom các dòng thường liên tiếp
      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,6})\s/.test(lines[i]) && !/^>\s?/.test(lines[i]) &&
             !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) && !isTableRow(lines[i]) &&
             !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      html.push('<p>' + buf.map(inline).join('<br>') + '</p>');
    }

    return html.join('\n');
  }

  return render;
});
