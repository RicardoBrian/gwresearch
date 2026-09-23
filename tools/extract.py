"""design/roadmap.pdf(1920x1080 벡터 시안)에서 웹용 에셋을 뽑아낸다.

- 텍스트(아웃라인 처리된 글자)와 번호 뱃지는 제외한다 → HTML/CSS로 다시 구성
- 배경(길, 장식) → assets/img/bg.svg
- 길 위 점선 → index.html 에 인라인 삽입 (hover 시 구간 강조를 위해 단계별 class 부여)
- 핀, 지구본 → assets/img/pins.svg (점선보다 위에 그려져야 함)
- 단계별 일러스트 → assets/img/stage-1.svg ~ stage-5.svg (각자 bbox 로 잘라냄)
- 로고 → assets/img/logo.png

사용법: pip install pymupdf && python3 tools/extract.py
"""
import base64
import json
import pathlib
import re

import pymupdf

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img"

# PDF 내부 도형 순번(get_drawings 인덱스) 기준 분류
TEXT = [(149, 155), (156, 186), (189, 193), (194, 219), (259, 267), (301, 305),
        (306, 342), (393, 397), (398, 424), (477, 483), (484, 525), (549, 553)]
STAGES = {1: (94, 146), 2: (228, 258), 3: (269, 298), 4: (344, 390), 5: (448, 474)}
ROAD_DASH_A = (4, 35)    # 학교 → 칠판 → 오른쪽 위로 이어지는 점선
ROAD_DASH_B = (37, 90)   # 책상 → 두 학생 → 트로피 점선
ROAD_DASH_TOP = (92, 93)  # 지구본 → 학교 점선


def in_ranges(i, ranges):
    return any(a <= i <= b for a, b in ranges)


def hexcolor(c):
    return "#%02x%02x%02x" % tuple(round(v * 255) for v in c)


def f(v):
    s = f"{v:.1f}"
    return s[:-2] if s.endswith(".0") else s


def path_d(items, dx=0.0, dy=0.0):
    out, cur = [], None
    for it in items:
        kind = it[0]
        if kind == "re":
            r = it[1]
            out.append(f"M{f(r.x0-dx)} {f(r.y0-dy)}H{f(r.x1-dx)}V{f(r.y1-dy)}H{f(r.x0-dx)}Z")
            cur = None
            continue
        if kind == "qu":
            q = it[1]
            pts = [q.ul, q.ur, q.lr, q.ll]
            out.append("M" + "L".join(f"{f(p.x-dx)} {f(p.y-dy)}" for p in pts) + "Z")
            cur = None
            continue
        start = it[1]
        if cur is None or abs(cur.x - start.x) > 0.01 or abs(cur.y - start.y) > 0.01:
            out.append(f"M{f(start.x-dx)} {f(start.y-dy)}")
        if kind == "l":
            p = it[2]
            out.append(f"L{f(p.x-dx)} {f(p.y-dy)}")
        elif kind == "c":
            a, b, p = it[2], it[3], it[4]
            out.append(f"C{f(a.x-dx)} {f(a.y-dy)} {f(b.x-dx)} {f(b.y-dy)} {f(p.x-dx)} {f(p.y-dy)}")
        cur = it[-1]
    return "".join(out)


def path_el(dr, dx=0.0, dy=0.0, cls=None):
    attrs = [f'd="{path_d(dr["items"], dx, dy)}"', f'fill="{hexcolor(dr["fill"])}"']
    if dr.get("even_odd"):
        attrs.append('fill-rule="evenodd"')
    if dr.get("fill_opacity", 1) < 1:
        attrs.append(f'fill-opacity="{dr["fill_opacity"]:.2f}"')
    if cls:
        attrs.append(f'class="{cls}"')
    return f"<path {' '.join(attrs)}/>"


def dash_stage(i, rect):
    """점선 조각이 어느 단계로 '들어가는' 길인지 (hover 시 해당 구간 강조용)."""
    cx, cy = (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2
    if in_ranges(i, [ROAD_DASH_TOP]):
        return 1
    if in_ranges(i, [ROAD_DASH_A]):
        return 2 if cx < 735 else 3
    if cy > 740:
        return 5
    return 3 if cx < 1300 else 4


def image_png_b64(doc, xref, shrink=0):
    pix = pymupdf.Pixmap(doc, xref)
    if pix.colorspace is None or pix.colorspace.n != 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    smask = doc.xref_get_key(xref, "SMask")
    if smask[0] == "xref":
        pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, int(smask[1].split()[0])))
    if shrink:
        pix.shrink(shrink)  # 1 = 절반 크기
    return pix.tobytes("png")


def main():
    doc = pymupdf.open(ROOT / "design" / "roadmap.pdf")
    page = doc[0]
    drawings = page.get_drawings(extended=True)
    OUT.mkdir(parents=True, exist_ok=True)

    stage_of = {}
    for s, (a, b) in STAGES.items():
        for i in range(a, b + 1):
            stage_of[i] = s

    # ---- 배경 / 점선 / 핀 ----
    bg, dashes, pins = [], [], []
    for i, dr in enumerate(drawings):
        if dr["type"] != "f" or i == 1:  # 1 = 흰 배경 사각형 (CSS 배경으로 대체)
            continue
        if in_ranges(i, TEXT) or i in stage_of:
            continue
        if in_ranges(i, [ROAD_DASH_A, ROAD_DASH_B, ROAD_DASH_TOP]) and i != 92:
            dashes.append(path_el(dr, cls=f"dash dash-{dash_stage(i, dr['rect'])}"))
        elif i >= 526:
            pins.append(path_el(dr))
        else:
            bg.append(path_el(dr))

    # 핀 아래 회색 점(래스터)
    dots = [im for im in page.get_image_info(xrefs=True) if im["width"] == 70]
    data = base64.b64encode(image_png_b64(doc, dots[0]["xref"])).decode()
    uses = [f'<image href="data:image/png;base64,{data}" x="{f(im["bbox"][0])}" y="{f(im["bbox"][1])}" '
            f'width="{f(im["bbox"][2] - im["bbox"][0])}" height="{f(im["bbox"][3] - im["bbox"][1])}"/>'
            for im in dots]
    pins = uses + pins

    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">{}</svg>'
    (OUT / "bg.svg").write_text(svg.format("".join(bg)), encoding="utf-8")
    (OUT / "pins.svg").write_text(svg.format("".join(pins)), encoding="utf-8")

    html = ROOT / "index.html"
    inline = ('<svg class="map__dashes" viewBox="0 0 1920 1080" aria-hidden="true" focusable="false">'
              + "".join(dashes) + "</svg>")
    src = html.read_text(encoding="utf-8")
    src = re.sub(r"(<!-- DASHES:START -->).*?(<!-- DASHES:END -->)",
                 lambda m: m.group(1) + inline + m.group(2), src, flags=re.S)
    html.write_text(src, encoding="utf-8")

    # ---- 단계별 일러스트 ----
    layout = {}
    pad = 2
    for s, (a, b) in STAGES.items():
        parts = [drawings[i] for i in range(a, b + 1) if drawings[i]["type"] == "f"]
        r = pymupdf.Rect(parts[0]["rect"])
        for p in parts[1:]:
            r |= p["rect"]
        r = pymupdf.Rect(r.x0 - pad, r.y0 - pad, r.x1 + pad, r.y1 + pad)
        body = "".join(path_el(p, r.x0, r.y0) for p in parts)
        (OUT / f"stage-{s}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(r.width)} {f(r.height)}">{body}</svg>',
            encoding="utf-8")
        layout[f"stage-{s}"] = [round(r.x0, 1), round(r.y0, 1), round(r.width, 1), round(r.height, 1)]

    # ---- 로고 ----
    logo = [im for im in page.get_image_info(xrefs=True) if im["width"] == 608][0]
    # 원본 608px → 304px (표시 크기 87px 의 3배 이상이라 고해상도 화면에서도 선명)
    (OUT / "logo.png").write_bytes(image_png_b64(doc, logo["xref"], shrink=1))
    layout["logo"] = [round(v, 1) for v in logo["bbox"]]

    print(json.dumps(layout, indent=1))


if __name__ == "__main__":
    main()
