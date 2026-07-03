# IELTS 7.5 — Grammar Trainer 🎯

Web ôn luyện ngữ pháp IELTS cá nhân, xây từ tài liệu `IELTS_Grammar_7_5.md`.

## Tính năng
- **Điểm danh mỗi ngày** — chuỗi streak 🔥 + lịch heatmap kiểu GitHub
- **Lộ trình học** — mỗi ngày 1 chương (30 chương), tự động giao bài
- **Quiz hằng ngày** — 10 câu cố định theo ngày, trộn 4 dạng: chọn câu đúng (từ các cặp ❌/✅), điền công thức, nhớ công thức, bài tập phụ lục
- **Ôn lặp lại (spaced repetition)** — chương đã học được xếp lịch ôn 1→2→4→…→64 ngày; trả lời đúng ≥70% thì giãn lịch, sai thì ôn lại ngay hôm sau
- **Flashcards** — công thức ngữ pháp, 66 động từ bất quy tắc, 63 cặp câu sai/đúng
- **Ngân hàng bài tập** — 15 bộ (Phụ lục D & F) với 116 câu kèm đáp án từng câu
- **Ôn tập từng mục (Leitner SRS)** — mỗi câu hỏi/công thức có hộp ôn tập riêng (1→2→4→7→15→30 ngày); quiz và flashcard ưu tiên mục đến hạn và mục chưa gặp; trang chủ hiển thị đã thuộc bao nhiêu/269 mục
- **Sổ từ vựng cá nhân** — thêm từ (đơn lẻ hoặc hàng loạt), ôn bằng flashcard theo SRS, từ đến hạn tự trộn vào quiz ngày
- **Gamification** — XP, cấp độ theo Band 3.0→9.0, 18 huy hiệu, nhiệm vụ ngày, đếm ngược ngày thi
- **Tìm kiếm toàn văn**, giao diện tối/sáng, xuất/nhập tiến độ (JSON)

## Cập nhật nội dung
Chỉ cần sửa/thay `IELTS_Grammar_7_5.md` rồi push — web tự parse lại toàn bộ
(chương, công thức, cặp câu sai/đúng, bài tập) khi tải trang. Không cần build.

## Chạy local
```bash
python -m http.server 8000
# mở http://localhost:8000
```

## Kiểm thử
```bash
node js/test_parser.js      # parser với tài liệu thật
node js/test_md.js          # renderer markdown
node js/test_app_logic.js   # logic ngày/streak/SRS/quiz
node js/test_dom_smoke.js   # smoke test end-to-end
```

## Lưu ý
Tiến độ lưu bằng `localStorage` theo từng trình duyệt/máy. Dùng nút
**Xuất/Nhập tiến độ** ở trang chủ khi đổi máy.
