# 🎯 IELTS 7.5 — Grammar Trainer

Web ôn luyện **ngữ pháp IELTS** — điểm danh mỗi ngày, quiz theo ngày, flashcards và ôn lặp lại ngắt quãng để tiến bộ đều đặn.

🔗 **Bản demo:** https://rei-1407.github.io/IELTS/

---

## ✨ Tính năng

- **Điểm danh mỗi ngày** — chuỗi streak 🔥 và lịch heatmap kiểu GitHub.
- **Lộ trình học** — mỗi ngày một chương, tự động giao bài.
- **Quiz hằng ngày** — bộ câu hỏi cố định theo ngày, trộn nhiều dạng: chọn câu đúng, điền công thức, nhớ công thức, bài tập.
- **Ôn lặp lại (spaced repetition)** — chương đã học được xếp lịch ôn giãn dần; trả lời tốt thì giãn lịch, còn yếu thì ôn lại sớm.
- **Flashcards** — công thức ngữ pháp, động từ bất quy tắc, các cặp câu sai/đúng.
- **Ngân hàng bài tập** — nhiều bộ có đáp án đối chiếu từng câu.
- **Sổ từ vựng cá nhân** — thêm từ (đơn lẻ hoặc hàng loạt), ôn bằng flashcard theo SRS, từ đến hạn tự trộn vào quiz ngày.
- **Gamification** — XP, cấp độ theo band, huy hiệu, nhiệm vụ ngày, đếm ngược ngày thi.
- **Tìm kiếm toàn văn**, giao diện tối/sáng, **xuất/nhập tiến độ** (JSON) khi đổi máy.

## 🛠 Công nghệ

Web tĩnh thuần: HTML + CSS + JavaScript. Không framework, không bước build.

## 🚀 Chạy thử tại máy

```bash
python -m http.server 8000
# mở http://localhost:8000
```

> Tiến độ lưu bằng `localStorage` theo từng trình duyệt/máy. Dùng nút **Xuất/Nhập tiến độ** ở trang chủ khi chuyển máy.

---

<p align="center"><sub>Sản phẩm của <strong>ReiX&nbsp;Labs</strong> · © 2026 ReiX Labs</sub></p>
