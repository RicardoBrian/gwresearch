"""자료 목록(구글 시트) → assets/data.json

읽는 곳 (위에서부터 먼저 있는 것):
  1. 환경변수 SHEET_CSV_URL  — 구글 시트 [파일 → 공유 → 웹에 게시 → CSV] 주소
  2. data/materials.csv       — 저장소에 둔 CSV (견본·로컬 테스트용)

시트 '자료' 탭 열 (1행 제목, 순서는 상관없음):
  단계 | 항목 | 분류 | 제목 | PDF 링크 | 유튜브 링크 | 설명
  - 단계        : 선택(시트 드롭다운용). 적으면 항목과 맞는지 확인
  - 항목        : 로드맵 항목 이름 그대로. 필수
  - 분류        : 선택. 채우면 항목을 눌렀을 때 분류 카드(국어·수학…)가 먼저 나옴
  - 제목        : 선택. 비우면 드라이브 파일 이름 / 유튜브 영상 제목을 씀
  - PDF 링크    : 구글 드라이브 PDF 파일 링크, 또는 폴더 링크(안의 PDF 전부, 이름순, 제목=파일 이름)
                  공유: 링크가 있는 모든 사용자
  - 유튜브 링크 : 영상 주소. PDF 링크와 둘 중 하나만
  - 설명        : 선택
  (고급) '소분류' 열을 추가하면 같은 분류 안에서 칩 버튼으로 걸러 봄

드라이브 PDF 는 배포 때 앞부분만 확인하고(PDF 여부·공유·파일 이름), 파일은 올리지 않는다.
방문자가 열 때 Cloudflare 함수(functions/pdf/[id].js)가 드라이브에서 가져와 1시간 캐시한다.
문제가 있으면 행 번호와 함께 한국어로 알려주고 실패(종료 코드 1)해서
잘못된 내용이 배포되지 않게 한다. 파일·유튜브가 둘 다 빈 줄(입력 중)은 건너뛴다.

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
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html import unescape as html_unescape

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "assets" / "docs"

# 시트 열 제목 → 내부 이름 (옛 열 제목도 받아줌)
COLS = {
    "단계": "stage",
    "항목": "item", "항목ID": "item", "ID": "item",
    "분류": "group",
    "소분류": "sub",
    "제목": "title",
    "PDF 링크": "file", "PDF": "file", "파일": "file",
    "유튜브 링크": "youtube", "유튜브": "youtube",
    "설명": "desc",
}
NORM_COLS = {re.sub(r"\s+", "", k).lower(): v for k, v in COLS.items()}
KEY_NAMES = {"stage": "단계", "item": "항목", "group": "분류", "sub": "소분류", "title": "제목",
             "file": "PDF 링크", "youtube": "유튜브 링크", "desc": "설명"}
UA = {"User-Agent": "Mozilla/5.0 (gwresearch build)"}


def norm(s):
    return re.sub(r"\s+", "", s or "")


def load_roadmap():
    """index.html 에서 [(항목id, 항목이름, 단계이름)] — 로드맵 화면이 원본"""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    out = []
    for st in re.finditer(r'<li class="stage" data-stage="\d">(.*?)(?=<li class="stage"|</ol>)', html, re.S):
        stage = re.search(r'stage__name">([^<]+)<', st.group(1)).group(1)
        for iid, name in re.findall(r'class="item" href="#([^"]+)">([^<]+)<', st.group(1)):
            out.append((iid, name, stage))
    return out


def read_rows():
    url = os.environ.get("SHEET_CSV_URL", "").strip()
    if url:
        print(f"시트 읽는 중: {url[:60]}…")
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
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

    reader = csv.reader(io.StringIO(text))
    raw_header = next(reader, [])
    header = [col_key(h) for h in raw_header]
    print("열 인식: " + ", ".join(f"{h.strip() or '(빈 칸)'}→{KEY_NAMES.get(k, '무시')}" for h, k in zip(raw_header, header)))
    if "item" not in header:
        sys.exit("오류: 시트 1행에서 '항목' 열을 찾지 못했습니다. "
                 "열 제목: 단계 | 항목 | 분류 | 제목 | PDF 링크 | 유튜브 링크 | 설명")
    if "file" not in header and "youtube" not in header:
        sys.exit("오류: 시트 1행에서 'PDF 링크'·'유튜브 링크' 열을 찾지 못했습니다. 열 제목을 확인해 주세요.")
    rows = []
    for values in reader:
        rows.append({k: v.strip() for k, v in zip(header, values) if k})
    return rows


def col_key(h):
    """열 제목 → 내부 이름. 공백·줄바꿈·특수 공백·대소문자 차이는 무시"""
    h = re.sub(r"\s+", "", h.replace("\u00a0", " ")).lower()
    if h in NORM_COLS:
        return NORM_COLS[h]
    if "pdf" in h or h in ("파일", "파일링크", "링크"):
        return "file"
    if "유튜브" in h or "youtube" in h or "영상" in h:
        return "youtube"
    return ""


def youtube_id(v):
    if re.fullmatch(r"[\w-]{11}", v):
        return v
    m = re.search(r"(?:v=|youtu\.be/|/embed/|/shorts/|/live/)([\w-]{11})", v)
    return m.group(1) if m else ""


def youtube_title(vid):
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(f"https://www.youtube.com/watch?v={vid}")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            return json.loads(r.read().decode("utf-8")).get("title", "")
    except Exception:  # noqa: BLE001  (비공개 영상이거나 접속 실패)
        return ""


def folder_id(v):
    m = re.search(r"drive\.google\.com/drive/(?:u/\d+/)?folders/([\w-]{10,})", v)
    return m.group(1) if m else ""


def natural_key(name):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def list_folder(fid, errors, warnings, where):
    """공개 드라이브 폴더 안의 PDF 목록 [(파일id, 이름)] — 이름순(01_, 02_ … 순서 지정 가능)"""
    url = f"https://drive.google.com/embeddedfolderview?id={fid}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        errors.append(f"{where}: 드라이브 폴더를 읽지 못했습니다 ({e}). 폴더 공유가 "
                      "'링크가 있는 모든 사용자'인지 확인해 주세요.")
        return None
    # 항목마다 (id, 링크, 이름). 하위 폴더는 링크가 /folders/ 라서 뺌
    entries = re.findall(r'id="entry-([\w-]+)".*?href="([^"]*)".*?class="flip-entry-title">([^<]*)<', html, re.S)
    if not entries:
        if "flip-entry" not in html and "folder-contents" not in html:
            errors.append(f"{where}: 드라이브 폴더를 열 수 없습니다. 폴더 공유를 "
                          "'링크가 있는 모든 사용자 · 뷰어'로 바꿔 주세요.")
        else:
            warnings.append(f"{where}: 폴더가 비어 있습니다.")
        return None
    files, folders = [], []
    for eid, href, name in entries:
        name = html_unescape(name).strip()
        (folders if "/folders/" in href else files).append((eid, name))
    if folders:
        warnings.append(f"{where}: 하위 폴더는 읽지 않습니다: {', '.join(n for _, n in folders)}")
    # 파일 이름이 .pdf 로 끝나지 않아도(예: '…pdf의 사본') 내려받아서 PDF 인지 확인
    return sorted(files, key=lambda x: natural_key(x[1]))


def clean_title(name):
    """파일 이름 → 제목: 확장자, 드라이브 사본 표시, 순서용 앞번호(01_, 1. , 02- 등)를 뗌"""
    name = re.sub(r"\s*의 사본$", "", name.strip())
    name = re.sub(r"^(?:Copy of|사본)\s+", "", name)
    name = re.sub(r"\.pdf$", "", name, flags=re.I)
    return re.sub(r"^\d+\s*[._\-)]\s*", "", name).strip() or name


def drive_id(v):
    m = re.search(r"drive\.google\.com/(?:file/d/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})", v)
    return m.group(1) if m else ""


def filename_of(headers):
    """Content-Disposition 에서 파일 이름. 한글 이름이 든 filename*= 를 먼저 씀."""
    cd = headers.get("Content-Disposition", "")
    m = re.search(r"filename\*=(?:UTF-8|utf-8)''([^;]+)", cd)
    if m:
        name = urllib.parse.unquote(m.group(1).strip().strip('"'))
    else:
        m = re.search(r'filename="?([^";]+)"?', cd)
        name = m.group(1) if m else ""
    return re.sub(r"\.pdf$", "", name, flags=re.I).strip()


_probe_cache = {}


def probe_drive(fid):
    """드라이브 파일 앞부분(1KB)만 읽어 (PDF 여부, 파일 이름, 오류) 확인. 파일 전체는 받지 않음.
    실제 PDF 는 방문자가 열 때 Cloudflare 함수(functions/pdf/[id].js)가 드라이브에서 가져옴."""
    if fid in _probe_cache:
        return _probe_cache[fid]
    url = f"https://drive.google.com/uc?export=download&id={fid}"
    req = urllib.request.Request(url, headers={**UA, "Range": "bytes=0-1023"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            head = r.read(1024)
            result = (head.startswith(b"%PDF"), filename_of(r.headers), "")
    except Exception as e:  # noqa: BLE001
        result = (False, "", str(e))
    _probe_cache[fid] = result
    return result


def local_pdf(f, errors, where):
    """저장소 안 PDF (견본용). 실제 자료는 드라이브 링크를 씀."""
    path = DOCS / f
    if not path.exists():
        errors.append(f"{where}: PDF 링크가 드라이브 파일 링크가 아닙니다: {f}")
        return None
    if path.suffix.lower() != ".pdf":
        errors.append(f"{where}: PDF만 올릴 수 있습니다 ({path.suffix}).")
        return None
    return path, path.stem


def main():
    roadmap = load_roadmap()
    ids = [i for i, _, _ in roadmap]
    by_name = {norm(n): i for i, n, _ in roadmap}
    stage_of = {i: s for i, _, s in roadmap}
    name_of = {i: n for i, n, _ in roadmap}

    errors, warnings, out = [], [], []
    for n, row in enumerate(read_rows(), start=2):  # 시트 기준 행 번호 (1행은 제목)
        if not any(row.values()):
            continue
        where = f"{n}행({row.get('title') or row.get('item') or '제목 없음'})"

        raw = row.get("item", "")
        item = raw if raw in ids else by_name.get(norm(raw), "")
        if not item:
            if not raw:
                warnings.append(f"{where}: 항목이 비어 있어 이번 반영에서 뺐습니다.")
            else:
                errors.append(f"{where}: 항목 '{raw}'이(가) 로드맵에 없습니다. 드롭다운에서 골라 주세요.")
            continue

        stage = row.get("stage", "")
        if stage and norm(re.sub(r"^\d+", "", stage)) != norm(stage_of[item]):
            errors.append(f"{where}: '{name_of[item]}'은(는) '{stage_of[item]}' 단계 항목입니다. 단계를 확인해 주세요.")
            continue

        f, yt = row.get("file", ""), row.get("youtube", "")
        if not f and not yt:
            warnings.append(f"{where}: PDF 링크·유튜브 링크가 비어 있어 이번 반영에서 뺐습니다.")
            continue
        if f and yt:
            errors.append(f"{where}: PDF 링크와 유튜브 링크 중 하나만 적어 주세요.")
            continue

        m = {"item": item}
        if yt:
            vid = youtube_id(yt)
            if not vid:
                errors.append(f"{where}: 유튜브 주소를 알아볼 수 없습니다: {yt}")
                continue
            title = row.get("title") or youtube_title(vid)
            m.update(type="video", youtube=vid)
        else:
            if folder_id(f):
                # 폴더 링크: 안의 PDF 를 이름순으로 모두 (제목 = 파일 이름). 앞부분만 동시에 확인
                files = list_folder(folder_id(f), errors, warnings, where) or []
                with ThreadPoolExecutor(max_workers=8) as pool:
                    probes = list(pool.map(lambda x: probe_drive(x[0]), files))
                for (fid, name), (is_pdf, _, err) in zip(files, probes):
                    if not is_pdf:
                        warnings.append(f"{where} '{name}': " + (f"확인하지 못해 뺐습니다 ({err})" if err else "PDF가 아니어서 뺐습니다."))
                        continue
                    fm = {"item": item, "type": "pdf", "file": f"pdf/{fid}", "title": clean_title(name)}
                    for key in ("group", "sub"):
                        if row.get(key):
                            fm[key] = row[key]
                    out.append(fm)
                continue
            if drive_id(f):
                is_pdf, fname, err = probe_drive(drive_id(f))
                if err:
                    errors.append(f"{where}: 드라이브 파일을 확인하지 못했습니다 ({err}). 파일이 지워졌는지 확인해 주세요.")
                    continue
                if not is_pdf:
                    errors.append(f"{where}: PDF를 받을 수 없습니다. 파일이 PDF인지, 공유 설정이 "
                                  "'링크가 있는 모든 사용자'인지 확인해 주세요.")
                    continue
                title = row.get("title") or clean_title(fname)
                m.update(type="pdf", file=f"pdf/{drive_id(f)}")
            else:
                got = local_pdf(f, errors, where)
                if not got:
                    continue
                path, fname = got
                title = row.get("title") or clean_title(fname)
                m.update(type="pdf", file=path.relative_to(ROOT).as_posix())

        if not title:
            errors.append(f"{where}: 제목을 알아낼 수 없습니다. 제목 칸을 채워 주세요.")
            continue
        m["title"] = title
        for key in ("group", "sub", "desc"):
            if row.get(key):
                m[key] = row[key]
        out.append(m)

    empty = [name_of[i] for i in ids if i not in {m["item"] for m in out}]
    if empty:
        warnings.append(f"자료 없는 항목 {len(empty)}개 (‘자료 준비 중’으로 표시): {', '.join(empty)}")

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
