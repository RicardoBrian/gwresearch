"""고산자체(Gosanja)를 index.html 제목에 쓰인 글자만 남겨 woff2 로 줄인다.

원본 폰트는 13MB 라 그대로 쓰면 첫 화면이 매우 느려진다.
제목 글자(학교명, 큰 제목, 단계 제목, 번호)를 바꾸면 이 스크립트를 다시 실행해야 한다.

사용법:
  npm i @noonnu/gosanja        # 원본 폰트 (눈누 배포본)
  pip install fonttools brotli
  python3 tools/subset_font.py node_modules/@noonnu/gosanja/fonts/gosanja-normal.woff
"""
import html
import pathlib
import re
import sys

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
TITLE_CLASSES = ("school__name", "map__title", "stage__name", "badge")


def title_text():
    src = (ROOT / "index.html").read_text(encoding="utf-8")
    chars = set()
    for cls in TITLE_CLASSES:
        for m in re.finditer(rf'class="{cls}"[^>]*>(.*?)</', src, flags=re.S):
            chars |= set(html.unescape(re.sub(r"<[^>]+>", "", m.group(1))))
    return "".join(sorted(chars - {"\n"})) + " 0123456789"


def main():
    src_font = sys.argv[1]
    out = ROOT / "assets" / "fonts" / "gosanja-subset.woff2"
    out.parent.mkdir(parents=True, exist_ok=True)
    text = title_text()
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    font = subset.load_font(src_font, opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    subset.save_font(font, str(out), opts)
    print(f"{len(text)} glyphs → {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.1f} KB)")
    print(text)


if __name__ == "__main__":
    main()
