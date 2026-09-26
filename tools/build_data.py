"""자료 목록(구글 시트) → assets/data.json

읽는 곳 (위에서부터 먼저 있는 것):
  1. 환경변수 SHEET_CSV_URL  — 구글 시트 [파일 → 공유 → 웹에 게시 → CSV] 주소
  2. data/materials.csv       — 시트를 CSV로 내려받아 저장소에 올린 파일

시트 열 (첫 줄 제목 그대로):
  항목 | 분류 | 소분류 | 제목 | 파일 | 유튜브 | 설명
  - 항목   : 로드맵 항목 이름 그대로 (예: KLS 기초 한국어 선이수제). 필수
             (열 제목을 '항목ID'/'ID'로 하고 영문 ID를 적어도 됨)
  - 분류   : 비우면 분류 없음. 채우면 항목 안에서 분류 카드로 묶임
  - 소분류 : 선택. 같은 분류 안에서 칩 버튼(전체/1학년/2학년…)으로 걸러 봄
  - 제목   : 필수
  - 파일   : PDF. assets/docs/ 아래 경로(예: kls/국어-계획.pdf) 또는 구글 드라이브 공유 링크
  - 유튜브 : 영상 주소. 파일과 유튜브 중 하나만
  - 설명   : 선택

드라이브 링크는 배포할 때 내려받아 assets/docs/drive/ 에 저장한다
(공유 설정이 '링크가 있는 모든 사용자'여야 함).

문제가 있으면 한국어로 알려주고 실패(종료 코드 1)해서 잘못된 내용이 배포되지 않게 한다.
사용법: python3 tools/build_data.py
"""
import csv
import datetime
import io
import json
import os
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "assets" / "docs"
MAX_MB = 25  # Cloudflare Pages 파일 하나당 한도

COLS = {"항목ID": "item", "분류": "group", "소분류": "sub", "제목": "title", "파일": "file", "유튜브": "youtube", "설명": "desc"}


def load_items():
    """로드맵 항목: [(id, 이름)] — index.html 이 원본"""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    return re.findall(r'class="item" href="#([^"]+)">([^<]+)<', html)


def norm(s):
    return re.sub(r"\s+", "", s)


def read_rows():
    url = os.environ.get("SHEET_CSV_URL", "").strip()
    if url:
        print(f"시트 읽는 중: {url[:60]}…")
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                text = r.read().decode("utf-8-sig")
        except Exception as e:  # noqa: BLE001
            sys.exit(f"오류: 시트를 읽지 못했습니다 ({e}). 시트의 '웹에 게시'가 CSV로 되어 있는지, "
                     "게시한 탭을 지우거나 이름을 바꾸지 않았는지 확인해 주세요.")
        if text.lstrip().startswith("<"):
            sys.exit("오류: 시트 주소가 CSV가 아닙니다. '웹에 게시'에서 형식을 CSV로 골라 나온 주소를 넣어 주세요.")
    else:
        path = ROOT / "data" / "materials.csv"
        print(f"파일 읽는 중: {path.relative_to(ROOT)}")
        text = path.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    # 첫 칸을 'ID' 로 쓴 시트도 받아줌
    # 첫 열 제목은 '항목'(한글 이름) / '항목ID' / 'ID' 모두 받아줌
    if reader.fieldnames and "항목ID" not in reader.fieldnames:
        reader.fieldnames = ["항목ID" if f.strip() in ("항목", "ID") else f.strip() for f in reader.fieldnames]
    missing = [c for c in ("항목ID", "제목") if c not in (reader.fieldnames or [])]
    if missing:
        sys.exit(f"오류: 시트 첫 줄에 {', '.join(missing).replace('항목ID', '항목')} 열이 없습니다. "
                 "열 제목: 항목 | 분류 | 소분류 | 제목 | 파일 | 유튜브 | 설명")
    return list(reader)


def youtube_id(v):
    if re.fullmatch(r"[\w-]{11}", v):
        return v
    m = re.search(r"(?:v=|youtu\.be/|/embed/|/shorts/|/live/)([\w-]{11})", v)
    return m.group(1) if m else ""


def drive_id(v):
    m = re.search(r"drive\.google\.com/(?:file/d/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})", v)
    return m.group(1) if m else ""


def fetch_drive(fid, errors, where):
    dest = DOCS / "drive" / f"{fid}.pdf"
    if dest.exists():
        return dest
    url = f"https://drive.google.com/uc?export=download&id={fid}"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read(MAX_MB * 1024 * 1024 + 1)
    except Exception as e:  # noqa: BLE001
        errors.append(f"{where}: 드라이브 파일을 내려받지 못했습니다 ({e})")
        return None
    if not data.startswith(b"%PDF"):
        errors.append(f"{where}: 드라이브 파일이 PDF가 아니거나 공유가 막혀 있습니다. "
                      "공유 설정을 '링크가 있는 모든 사용자'로 바꾸거나, 파일을 assets/docs/ 에 직접 올려 주세요.")
        return None
    if len(data) > MAX_MB * 1024 * 1024:
        errors.append(f"{where}: 파일이 {MAX_MB}MB를 넘습니다. 압축해서 다시 올려 주세요.")
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest


def main():
    pairs = load_items()
    ids = [i for i, _ in pairs]
    by_name = {norm(name): i for i, name in pairs}
    rows = read_rows()
    errors, warnings, out = [], [], []

    for n, raw in enumerate(rows, start=2):  # 시트 기준 행 번호 (1행은 제목)
        row = {COLS[k]: (v or "").strip() for k, v in raw.items() if k in COLS}
        if not any(row.values()):
            continue
        where = f"{n}행({row.get('title') or '제목 없음'})"
        raw_item = row.get("item", "")
        item = raw_item if raw_item in ids else by_name.get(norm(raw_item), "")
        if not item:
            errors.append(f"{where}: 항목 '{raw_item}'이(가) 로드맵에 없습니다. 드롭다운에서 골라 주세요.")
            continue
        if not row.get("title"):
            errors.append(f"{where}: 제목이 비어 있습니다.")
            continue

        f, yt = row.get("file", ""), row.get("youtube", "")
        if bool(f) == bool(yt):
            errors.append(f"{where}: '파일'과 '유튜브' 중 하나만 적어 주세요.")
            continue

        m = {"item": item, "title": row["title"]}
        if row.get("group"):
            m["group"] = row["group"]
        if row.get("sub"):
            m["sub"] = row["sub"]

        if yt:
            vid = youtube_id(yt)
            if not vid:
                errors.append(f"{where}: 유튜브 주소를 알아볼 수 없습니다: {yt}")
                continue
            m.update(type="video", youtube=vid)
        else:
            if "drive.google.com/drive/folders" in f:
                errors.append(f"{where}: 폴더 링크입니다. 폴더 안의 PDF 파일을 열어서 그 파일의 링크를 붙여 주세요.")
                continue
            if drive_id(f):
                path = fetch_drive(drive_id(f), errors, where)
                if not path:
                    continue
            else:
                path = DOCS / f
                if not path.exists():
                    errors.append(f"{where}: 파일이 없습니다: assets/docs/{f}")
                    continue
                if path.suffix.lower() != ".pdf":
                    errors.append(f"{where}: PDF만 올릴 수 있습니다 ({path.suffix}). 한글·PPT는 PDF로 저장해 주세요.")
                    continue
                if path.stat().st_size > MAX_MB * 1024 * 1024:
                    errors.append(f"{where}: 파일이 {MAX_MB}MB를 넘습니다. 압축해서 다시 올려 주세요.")
                    continue
            m.update(type="pdf", file=path.relative_to(ROOT).as_posix())

        if row.get("desc"):
            m["desc"] = row["desc"]
        out.append(m)

    used = {m["item"] for m in out}
    empty = [i for i in ids if i not in used]
    if empty:
        names = dict(pairs)
        warnings.append(f"자료 없는 항목 {len(empty)}개 (‘자료 준비 중’으로 표시): {', '.join(names[i] for i in empty)}")

    for w in warnings:
        print("참고:", w)
    if errors:
        print(f"\n고칠 것 {len(errors)}개 — 배포하지 않았습니다.")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    data = {"updated": datetime.date.today().isoformat(), "materials": out}
    (ROOT / "assets" / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"완료: 자료 {len(out)}개 → assets/data.json")


if __name__ == "__main__":
    main()
