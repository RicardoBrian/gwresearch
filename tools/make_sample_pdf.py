"""자료 팝업 테스트용 견본 PDF 를 만든다. (실제 자료가 들어오면 삭제)

- assets/docs/sample/report.pdf : A4 세로, 6쪽 보고서 형식 (표·도형 포함)
- assets/docs/sample/slides.pdf : 16:9 가로, 4쪽 발표자료 형식 (PPT → PDF 가정)

사용법: npm i pretendard && pip install pymupdf
        python3 tools/make_sample_pdf.py node_modules/pretendard/dist/public/static/alternative
"""
import pathlib
import sys

import pymupdf

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "docs" / "sample"

NAVY = (0x2D / 255, 0x3C / 255, 0x85 / 255)
GREEN = (0x45 / 255, 0x6D / 255, 0x2A / 255)
SOFT = (0xE9 / 255, 0xF1 / 255, 0xE0 / 255)
ROAD = (0xD5 / 255, 0xE1 / 255, 0xCA / 255)
GRAY = (0.35, 0.35, 0.35)
BLACK = (0.1, 0.1, 0.1)

BODY = ("본 자료는 웹 페이지의 자료 보기 화면을 시험하기 위한 견본입니다. 실제 연구학교 보고서의 내용이 아니며, "
        "페이지 넘김, 확대·축소, 내려받기 동작과 한글 글꼴 표시를 확인하는 용도로만 사용합니다. ") * 3


class Doc:
    def __init__(self, font_dir):
        self.doc = pymupdf.open()
        d = pathlib.Path(font_dir)
        self.fonts = {"r": d / "Pretendard-Regular.ttf", "b": d / "Pretendard-Bold.ttf"}

    def page(self, w, h):
        p = self.doc.new_page(width=w, height=h)
        for k, f in self.fonts.items():
            p.insert_font(fontname=f"pt{k}", fontfile=str(f))
        return p

    @staticmethod
    def text(p, x, y, s, size, bold=False, color=BLACK):
        p.insert_text((x, y), s, fontname="ptb" if bold else "ptr", fontsize=size, color=color)

    @staticmethod
    def box(p, rect, s, size, bold=False, color=BLACK, align=0, lh=1.6):
        p.insert_textbox(pymupdf.Rect(rect), s, fontname="ptb" if bold else "ptr",
                         fontsize=size, color=color, align=align, lineheight=lh)

    def save(self, path, title):
        self.doc.set_metadata({"title": title, "author": "관산중학교 (견본)"})
        path.parent.mkdir(parents=True, exist_ok=True)
        # TTF 를 써야 pdf.js 에서 글자 간격이 맞음 (OTF/CFF 는 겹쳐 보임)
        self.doc.subset_fonts()
        self.doc.save(path, garbage=4, deflate=True)
        print(path.relative_to(ROOT), f"{path.stat().st_size / 1024:.0f} KB, {len(self.doc)}쪽")


def report(font_dir):
    d = Doc(font_dir)
    W, H = 595, 842  # A4

    # 표지
    p = d.page(W, H)
    p.draw_rect(pymupdf.Rect(0, 0, W, H), color=None, fill=SOFT)
    p.draw_rect(pymupdf.Rect(0, 0, W, 16), color=None, fill=GREEN)
    d.text(p, 60, 120, "견본 자료", 14, True, GREEN)
    d.text(p, 60, 210, "이중언어 교육", 40, True, NAVY)
    d.text(p, 60, 262, "운영 계획 및 결과 보고서", 26, True, NAVY)
    d.text(p, 60, 300, "3단계 · 학습 지원", 14, False, GRAY)
    p.draw_circle((W - 150, H - 260), 120, color=None, fill=ROAD)
    p.draw_circle((W - 110, H - 200), 60, color=None, fill=GREEN)
    d.text(p, 60, H - 80, "관산중학교 · 연구학교 발표회 · 웹 표시 시험용", 11, False, GRAY)

    sections = [
        ("1. 운영 목적", "이중언어 교육의 운영 목적을 적는 자리입니다."),
        ("2. 운영 계획", "학기별 운영 계획과 대상, 시수를 적는 자리입니다."),
        ("3. 운영 결과", "운영 결과와 학생 변화를 정리하는 자리입니다."),
        ("4. 성과와 과제", "성과와 앞으로의 과제를 정리하는 자리입니다."),
    ]
    for i, (head, lead) in enumerate(sections, start=2):
        p = d.page(W, H)
        d.text(p, 60, 50, "이중언어 교육 운영 보고서 · 견본", 9, False, GRAY)
        p.draw_line((60, 60), (W - 60, 60), color=ROAD, width=1)
        d.text(p, 60, 110, head, 22, True, NAVY)
        d.box(p, (60, 130, W - 60, 200), lead, 12, False, GREEN)
        d.box(p, (60, 200, W - 60, 420), BODY, 11)
        if i == 3:
            # 표
            rows = [("구분", "대상", "시수", "비고"), ("1학기", "1학년 12명", "주 2시간", "방과후"),
                    ("2학기", "1·2학년 18명", "주 3시간", "정규 연계"), ("방학", "희망자 9명", "집중 20시간", "캠프형")]
            x0, y0, cw, rh = 60, 440, (W - 120) / 4, 34
            for r, row in enumerate(rows):
                for c, cell in enumerate(row):
                    rect = pymupdf.Rect(x0 + c * cw, y0 + r * rh, x0 + (c + 1) * cw, y0 + (r + 1) * rh)
                    p.draw_rect(rect, color=ROAD, fill=SOFT if r == 0 else None, width=0.8)
                    d.box(p, (rect.x0, rect.y0 + 10, rect.x1, rect.y1), cell, 10.5, r == 0, align=1)
        if i == 4:
            # 막대그래프
            vals = [("사전", 42), ("중간", 61), ("사후", 78)]
            base, x = 700, 110
            d.text(p, 60, 450, "기초 어휘 이해도 · 견본 수치", 12, True)
            p.draw_line((80, base), (W - 80, base), color=GRAY, width=0.8)
            for label, v in vals:
                p.draw_rect(pymupdf.Rect(x, base - v * 2.6, x + 70, base), color=None, fill=GREEN)
                d.box(p, (x - 10, base - v * 2.6 - 22, x + 80, base), f"{v}", 11, True, NAVY, align=1)
                d.box(p, (x - 10, base + 8, x + 80, base + 30), label, 11, align=1)
                x += 140
        d.text(p, W / 2 - 8, H - 40, str(i), 9, False, GRAY)

    p = d.page(W, H)
    d.text(p, 60, 110, "붙임", 22, True, NAVY)
    d.box(p, (60, 140, W - 60, 400), "붙임 자료가 들어가는 자리입니다. " + BODY, 11)
    d.text(p, W / 2 - 8, H - 40, "6", 9, False, GRAY)
    d.save(OUT / "report.pdf", "이중언어 교육 운영 보고서 (견본)")


def slides(font_dir):
    d = Doc(font_dir)
    W, H = 960, 540
    titles = ["KLS 기초 한국어 선이수제", "운영 개요", "주요 활동", "성과"]
    for i, t in enumerate(titles):
        p = d.page(W, H)
        if i == 0:
            p.draw_rect(pymupdf.Rect(0, 0, W, H), color=None, fill=NAVY)
            d.text(p, 70, 230, "견본 발표자료", 18, True, ROAD)
            d.text(p, 70, 300, t, 44, True, (1, 1, 1))
            d.text(p, 70, 350, "1단계 · 초기 적응 지원", 18, False, ROAD)
            continue
        p.draw_rect(pymupdf.Rect(0, 0, 14, H), color=None, fill=GREEN)
        d.text(p, 60, 90, t, 32, True, NAVY)
        for k in range(3):
            y = 150 + k * 110
            p.draw_rect(pymupdf.Rect(60, y, W - 60, y + 90), color=None, fill=SOFT, radius=0.15)
            d.text(p, 90, y + 40, f"{k + 1}. 항목 제목 자리", 20, True, GREEN)
            d.text(p, 90, y + 70, "발표자료를 PDF로 저장했을 때 가로 페이지 표시를 확인합니다.", 14)
        d.text(p, W - 60, H - 24, f"{i + 1}", 12, False, GRAY)
    d.save(OUT / "slides.pdf", "KLS 기초 한국어 선이수제 발표자료 (견본)")


if __name__ == "__main__":
    report(sys.argv[1])
    slides(sys.argv[1])
