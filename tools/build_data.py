"""자료 목록(구글 시트) → assets/data.json

읽는 곳 (위에서부터 먼저 있는 것):
  1. 환경변수 SHEET_CSV_URL  — 올리기 앱 주소?csv=업로드코드 (실시간, 권장)
                               또는 구글 시트 [파일 → 공유 → 웹에 게시 → CSV] 주소 (구글이 최대 5분 늦게 갱신)
  2. data/materials.csv       — 저장소에 둔 CSV (견본·로컬 테스트용)

시트 '자료' 탭 열 (1행 제목, 순서는 상관없음):
  단계 | 항목 | 분류 | 제목 | PDF 링크 | 유튜브 링크 | 설명
  - 단계        : 선택(시트 드롭다운용). 적으면 항목과 맞는지 확인
  - 항목        : 로드맵 항목 이름 그대로. 필수
  - 분류        : 선택. 채우면 항목을 눌렀을 때 분류 카드(국어·수학…)가 먼저 나옴
  - 제목        : 선택. 비우면 드라이브 파일 이름 / 유튜브 영상 제목을 씀
  - PDF 링크    : 구글 드라이브 PDF 파일 링크, 폴더 링크(안의 PDF 전부, 이름순, 제목=파일 이름),
                  또는 웹사이트·웹앱 주소(https, 자료 창 안에 띄움)
                  공유: 링크가 있는 모든 사용자
  - 유튜브 링크 : 영상 주소 (유튜브 또는 드라이브 영상 파일 링크). PDF 링크와 둘 중 하나만
  - 설명        : 선택
  (고급) '소분류' 열을 추가하면 같은 분류 안에서 칩 버튼으로 걸러 봄

드라이브 PDF 는 배포 때 앞부분만 확인하고(PDF 여부·공유·파일 이름), 파일은 올리지 않는다.
방문자가 열 때 Cloudflare 함수(functions/pdf/[id].js)가 드라이브에서 가져와 7일 보관한다(배포마다 새로).
썸네일(PDF 첫 쪽·영상 장면·웹 대표 이미지)은 배포 때 assets/thumbs/ 에 받아 둔다(실패하면 사이트가 원래 주소에서 받음).
링크 확인은 8개씩 동시에 한다. 문제가 있는 행은 행 번호와 함께 한국어로 알려주고 빼고 배포한다
(남는 자료가 하나도 없을 때만 실패). 파일·유튜브가 둘 다 빈 줄(입력 중)은 건너뛴다.

사용법: python3 tools/build_data.py
"""
import csv
import datetime
import functools
import hashlib
import io
import json
import os
import pathlib
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html import unescape as html_unescape

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "assets" / "docs"
THUMBS = ROOT / "assets" / "thumbs"  # 배포 때 받아 두는 썸네일 (저장소에는 올리지 않음)

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
    "썸네일": "thumb", "썸네일 링크": "thumb", "대표 이미지": "thumb",
}
NORM_COLS = {re.sub(r"\s+", "", k).lower(): v for k, v in COLS.items()}
KEY_NAMES = {"stage": "단계", "item": "항목", "group": "분류", "sub": "소분류", "title": "제목",
             "file": "PDF 링크", "youtube": "유튜브 링크", "desc": "설명",
             "thumb": "썸네일"}
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
        if text.startswith("오류:"):  # 앱 주소(?csv=코드)로 읽을 때 코드가 틀린 경우
            sys.exit(text.strip() + " Cloudflare 의 SHEET_CSV_URL 끝 코드를 업로드 코드와 맞춰 주세요.")
        if text.lstrip().startswith("<"):
            sys.exit("오류: SHEET_CSV_URL 에서 시트 내용 대신 웹 페이지가 왔습니다. "
                     "올리기 앱 주소(…/exec?csv=코드)라면 앱을 '액세스: 모든 사용자'로 배포했는지, "
                     "'웹에 게시' 주소라면 형식을 CSV로 골랐는지 확인해 주세요.")
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
        row = {}
        for k, v in zip(header, values):
            if k and k not in row:  # 같은 뜻의 열이 둘이면 왼쪽 열 (올리기 앱과 같게)
                row[k] = v.strip()
        rows.append(row)
    return rows


def col_key(h):
    """열 제목 → 내부 이름. 공백·줄바꿈·특수 공백·대소문자 차이는 무시"""
    h = re.sub(r"[(\[（].*?[)\]）]", "", h)  # '제목(폴더 업로드시 생략)' 같은 괄호 설명은 무시
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


@functools.lru_cache(maxsize=None)
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


@functools.lru_cache(maxsize=None)
def folder_html(fid):
    """(폴더 페이지 html, 오류)"""
    url = f"https://drive.google.com/embeddedfolderview?id={fid}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            return r.read().decode("utf-8", "replace"), ""
    except Exception as e:  # noqa: BLE001
        return "", str(e) or "접속 실패"


def list_folder(fid, errors, warnings, where):
    """공개 드라이브 폴더 안의 PDF 목록 [(파일id, 이름)] — 이름순(01_, 02_ … 순서 지정 가능)"""
    html, e = folder_html(fid)
    if e:
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
    name = re.sub(r"\.(pdf|mp4|mov|m4v|avi|wmv|mkv|webm)$", "", name, flags=re.I)
    return re.sub(r"^\d+\s*[._\-)]\s*", "", name).strip() or name


def web_url(f):
    """웹 주소로 보이면 https 주소로 정리 (예: 'kakainfo.com/견본' → 'https://kakainfo.com/%EA%B2%AC%EB%B3%B8')
    드라이브 링크나 웹 주소가 아니면 '' """
    f = f.strip()
    if drive_id(f) or folder_id(f):
        return ""
    if not re.match(r"https?://", f, re.I):
        # 'www.x.com', 'x.co.kr/경로' 처럼 앞에 https:// 를 안 붙인 주소
        if not re.match(r"[\w-]+(\.[\w-]+)+(:\d+)?(/|$)", f) or f.lower().endswith(".pdf") and "/" not in f:
            return ""
        f = "https://" + f
    # 구글 시트·문서·슬라이드 → 창 안에 띄울 수 있는 보기 전용 화면
    g = re.match(r"https?://docs\.google\.com/(spreadsheets|document|presentation)/d/([\w-]{20,})", f, re.I)
    if g:
        return f"https://docs.google.com/{g.group(1)}/d/{g.group(2)}/preview"
    # 한글·공백이 섞인 주소도 브라우저와 똑같이 처리되도록 인코딩 (이미 인코딩된 % 는 그대로)
    return urllib.parse.quote(f, safe=":/?#[]@!$&'()*+,;=%~")


@functools.lru_cache(maxsize=None)
def probe_web(url):
    """웹 페이지 (제목, 창 안에 띄우기 허용 여부, 대표 이미지 주소)
    - 띄우기: X-Frame-Options / frame-ancestors
    - 대표 이미지: og:image / twitter:image (카톡에 링크 보낼 때 뜨는 그림). 없으면 '' """
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            xfo = (r.headers.get("X-Frame-Options") or "").lower()
            csp = (r.headers.get("Content-Security-Policy") or "").lower()
            html = r.read(300_000).decode("utf-8", "replace")
            final = r.geturl()
    except urllib.error.URLError as e:
        # 주소 자체가 없음(예: www 를 잘못 붙임) → 고칠 것. 그 밖의 접속 실패는 일단 띄워 봄
        if isinstance(e.reason, socket.gaierror):
            return "", True, "", "nohost"
        return "", True, ""
    except Exception:  # noqa: BLE001  (확인 못 하면 일단 띄워 봄)
        return "", True, ""
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    title = html_unescape(m.group(1)).strip() if m else ""
    fa = re.search(r"frame-ancestors([^;]*)", csp)
    blocked = xfo in ("deny", "sameorigin") or (fa and "*" not in fa.group(1) and "https:" not in fa.group(1))
    return title, not blocked, meta_image(html, final)


def meta_image(html, base):
    for tag in re.findall(r"<meta\b[^>]*>", html, re.I):
        if re.search(r"""(?:property|name)\s*=\s*["'](?:og:image|og:image:url|twitter:image)["']""", tag, re.I):
            m = re.search(r"""content\s*=\s*["']([^"']+)["']""", tag, re.I)
            if m:
                url = urllib.parse.urljoin(base, html_unescape(m.group(1)).strip())
                if url.startswith("https://"):
                    return url
    return ""


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
        # 드라이브는 한글 이름을 UTF-8 그대로 보내는데 파이썬은 latin-1 로 읽음 → 되돌림
        try:
            name = name.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return re.sub(r"\.pdf$", "", name, flags=re.I).strip()


_probe_cache = {}


def drive_page_title(fid):
    """드라이브 파일 페이지 <title> 에서 파일 이름 (큰 파일은 다운로드 응답에 이름이 없음)"""
    url = f"https://drive.google.com/file/d/{fid}/view"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            html = r.read(200_000).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return ""
    m = re.search(r"<title>(.*?)</title>", html, re.S)
    if not m:
        return ""
    name = html_unescape(m.group(1)).strip()
    name = re.sub(r"\s*-\s*Google\s*(Drive|드라이브)\s*$", "", name, flags=re.I)
    return "" if name.lower() in ("google drive", "google 드라이브", "") else name


VIDEO_RE = re.compile(r"\.(mp4|mov|m4v|avi|wmv|mkv|webm)$", re.I)


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
            result = (head.startswith(b"%PDF"), filename_of(r.headers) or drive_page_title(fid), "")
    except Exception as e:  # noqa: BLE001
        result = (False, "", str(e))
    _probe_cache[fid] = result
    return result


def local_pdf(f, errors, where):
    """저장소 안 PDF (견본용). 실제 자료는 드라이브 링크를 씀."""
    path = DOCS / f
    if not path.exists():
        errors.append(f"{where}: 링크를 알아볼 수 없습니다: '{f}' — 칸에 주소(https://…)를 그대로 붙여 넣어 주세요. "
                      "글자에 링크를 걸거나 스마트칩으로 넣으면 주소를 읽을 수 없습니다.")
        return None
    if path.suffix.lower() != ".pdf":
        errors.append(f"{where}: PDF만 올릴 수 있습니다 ({path.suffix}).")
        return None
    return path, path.stem


def intro_file(f, errors, warnings, where):
    """카드뉴스 PDF 링크 → 사이트 경로. 문제가 있으면 errors/warnings 에 넣고 None"""
    if not f:
        warnings.append(f"{where}: 카드뉴스 PDF 링크가 비어 있어 뺐습니다.")
        return None
    if drive_id(f):
        is_pdf, _, err = probe_drive(drive_id(f))
        if is_pdf:
            return f"pdf/{drive_id(f)}"
        errors.append(f"{where}: 카드뉴스 PDF를 받을 수 없습니다. 공유 설정을 확인해 주세요. {err}")
        return None
    if local_pdf(f, errors, where):
        return (DOCS / f).relative_to(ROOT).as_posix()
    return None


def prefetch(rows):
    """링크 확인(드라이브·폴더·웹·유튜브 제목)을 8개씩 동시에 미리 해 둠.
    결과는 캐시에 남고, 아래 본 처리는 같은 순서·같은 규칙으로 그 결과를 씀 (검사 내용은 그대로, 시간만 줄임)"""
    jobs, folders = [], []
    for row in rows:
        f, yt = row.get("file", ""), row.get("youtube", "")
        for v in (f, yt):
            if drive_id(v):
                jobs.append((probe_drive, drive_id(v)))
        if folder_id(f):
            folders.append(folder_id(f))
        elif web_url(f) and not web_url(f).startswith("https://docs.google.com/"):
            jobs.append((probe_web, web_url(f)))
        if yt and not drive_id(yt) and youtube_id(yt) and not row.get("title"):
            jobs.append((youtube_title, youtube_id(yt)))
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(folder_html, folders))
        for fid in folders:  # 폴더 안 파일들도
            jobs += [(probe_drive, x) for x, _ in list_folder(fid, [], [], "") or []]
        list(pool.map(lambda j: j[0](j[1]), jobs))


def write_report(count, errors, warnings):
    """반영 결과 페이지(report.html, 사이트 주소/report) — 업로드하는 선생님들이 배포 기록 대신 봄.
    사이트 어디에도 링크하지 않고 시트 메뉴 [반영 결과 보기]로만 엶. 로그인은 사이트와 같음"""
    from html import escape
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    def block(title, items, cls):
        if not items:
            return ""
        lis = "".join(f"<li>{escape(x)}</li>" for x in items)
        return f'<h2 class="{cls}">{title} <small>{len(items)}</small></h2><ul>{lis}</ul>'
    body = (block("고칠 것 — 이 행은 사이트에 반영되지 않았습니다", errors, "bad")
            + block("참고", warnings, "note")) or '<p class="ok">문제없이 모두 반영했습니다.</p>'
    (ROOT / "report.html").write_text(f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>반영 결과</title>
<link rel="icon" href="favicon.ico">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<style>
  body {{ margin: 0; background: #f6f8f3; color: #1f2a1a; font: 16px/1.6 "Pretendard Variable", Pretendard, system-ui, sans-serif; }}
  main {{ max-width: 860px; margin: 0 auto; padding: 32px 16px 64px; }}
  h1 {{ margin: 0 0 4px; color: #1f3a8a; font-size: 26px; }}
  .meta {{ margin: 0 0 24px; color: #5b6655; }}
  h2 {{ margin: 28px 0 8px; font-size: 18px; }}
  h2 small {{ color: #5b6655; font-size: 14px; font-weight: 600; }}
  h2.bad {{ color: #b42318; }}
  h2.note {{ color: #456d2a; }}
  ul {{ margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }}
  li {{ padding: 12px 14px; background: #fff; border: 1px solid #dfe5d8; border-radius: 10px; overflow-wrap: anywhere; }}
  .ok {{ padding: 16px; background: #fff; border: 1px solid #dfe5d8; border-radius: 10px; color: #456d2a; font-weight: 600; }}
  .tip {{ margin-top: 32px; color: #5b6655; font-size: 14px; }}
</style></head>
<body><main>
<h1>사이트 반영 결과</h1>
<p class="meta">마지막 반영: {now.month}월 {now.day}일 {now:%H:%M} · 자료 {count}개 반영</p>
{body}
<p class="tip">시트를 고친 뒤 [사이트 반영 → 지금 사이트에 반영하기]를 누르고, 2~3분 뒤 이 페이지를 새로고침해 확인해 주세요.</p>
</main></body></html>
""", encoding="utf-8")


def thumb_source(m):
    """썸네일 원래 주소 (js/viewer.js thumbOf 와 같은 규칙)"""
    if m.get("image"):
        return m["image"]
    if m.get("type") == "pdf":
        mm = re.match(r"pdf/([\w-]+)$", m.get("file", ""))
        return f"https://drive.google.com/thumbnail?id={mm.group(1)}&sz=w800" if mm else ""
    if m.get("type") == "video":
        if m.get("drive"):
            return f"https://drive.google.com/thumbnail?id={m['drive']}&sz=w800"
        if m.get("youtube"):
            return f"https://i.ytimg.com/vi/{m['youtube']}/hqdefault.jpg"
    return ""


def fetch_thumb(url):
    """그림을 받아 assets/thumbs/ 에 저장 → 사이트 경로. 그림이 아니거나 실패하면 '' """
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            body = r.read(3_000_001)
    except Exception:  # noqa: BLE001
        return ""
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get(ctype)
    if not ext or len(body) < 500 or len(body) > 3_000_000:
        return ""
    path = THUMBS / f"{hashlib.sha1(url.encode()).hexdigest()[:16]}.{ext}"
    try:
        THUMBS.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    except OSError:
        return ""
    return path.relative_to(ROOT).as_posix()


def save_thumbs(materials):
    """썸네일을 배포에 넣어 두면 방문자가 구글을 거치지 않고 바로 받음.
    받지 못한 것은 그대로 두고(사이트가 원래 주소에서 받음), 이 단계 때문에 배포가 멈추지 않게 함"""
    try:
        THUMBS.mkdir(parents=True, exist_ok=True)
        urls = sorted({u for u in map(thumb_source, materials) if u.startswith("https://")})
        with ThreadPoolExecutor(max_workers=8) as pool:
            got = dict(zip(urls, pool.map(fetch_thumb, urls)))
        for m in materials:
            path = got.get(thumb_source(m))
            if path:
                m["thumb"] = path
        print(f"썸네일: {sum(1 for p in got.values() if p)}/{len(urls)}개 미리 받음")
    except Exception as e:  # noqa: BLE001
        print(f"참고: 썸네일을 미리 받지 못했습니다 ({e}). 사이트가 원래 주소에서 받습니다.")


def main():
    roadmap = load_roadmap()
    ids = [i for i, _, _ in roadmap]
    by_name = {norm(n): i for i, n, _ in roadmap}
    stage_of = {i: s for i, _, s in roadmap}
    name_of = {i: n for i, n, _ in roadmap}

    stage_names = list(dict.fromkeys(s for _, _, s in roadmap))
    errors, warnings, out, intros = [], [], [], {}
    rows = read_rows()
    prefetch(rows)
    for n, row in enumerate(rows, start=2):  # 시트 기준 행 번호 (1행은 제목)
        if not any(row.values()):
            continue
        where = f"{n}행({row.get('title') or row.get('item') or '제목 없음'})"

        raw = row.get("item", "")
        if norm(raw) in ("단계소개", "소개"):
            # 단계 소개 카드뉴스 (정사각형 PDF, 한 쪽 = 카드 한 장)
            sname = norm(re.sub(r"^\d+", "", row.get("stage", "")))
            num = next((k + 1 for k, s in enumerate(stage_names) if norm(s) == sname), 0)
            if not num:
                errors.append(f"{where}: 단계 소개는 단계를 골라야 합니다.")
            else:
                path = intro_file(row.get("file", ""), errors, warnings, where)
                if path:
                    intros[f"stage-{num}"] = path
            continue
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

        if norm(row.get("group", "")) == "소개":
            # 항목 소개 카드뉴스: 분류 칸에 '소개'
            path = intro_file(row.get("file", ""), errors, warnings, where)
            if path:
                intros[item] = path
            continue

        f, yt = row.get("file", ""), row.get("youtube", "")
        if not f and not yt:
            warnings.append(f"{where}: PDF 링크·유튜브 링크가 비어 있어 이번 반영에서 뺐습니다.")
            continue
        if f and yt:
            errors.append(f"{where}: PDF 링크와 유튜브 링크 중 하나만 적어 주세요.")
            continue

        m = {"item": item}
        if yt and drive_id(yt):
            # 드라이브 영상: 드라이브 재생기로 틀어줌. 제목이 없으면 파일 이름
            did = drive_id(yt)
            title = row.get("title")
            if not title:
                _, fname, err = probe_drive(did)
                title = clean_title(fname) if fname else ""
                if not title:
                    title = row.get("group") or "영상"
                    warnings.append(f"{where}: 드라이브 영상 이름을 알 수 없어 '{title}'(으)로 표시합니다. "
                                    "제목 칸에 적으면 그 이름으로 나옵니다." + (f" ({err})" if err else ""))
            m.update(type="video", drive=did)
        elif yt:
            vid = youtube_id(yt)
            if not vid:
                errors.append(f"{where}: 영상 주소를 알아볼 수 없습니다 (유튜브 또는 드라이브 파일 링크): {yt}")
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
            if re.search(r"(youtube\.com|youtu\.be)/", f) and youtube_id(f):
                # PDF 링크 칸에 넣은 유튜브 주소 → 영상으로 (유튜브 링크 칸에 넣은 것과 같게)
                vid = youtube_id(f)
                title = row.get("title") or youtube_title(vid)
                m.update(type="video", youtube=vid)
            elif web_url(f):
                f = web_url(f)
                # 웹사이트·웹앱: 자료 창 안에 띄움 (막힌 사이트는 '새 창에서 열기' 카드)
                if f.lower().startswith("http://"):
                    warnings.append(f"{where}: http:// 주소는 창 안에 띄울 수 없어 새 창으로만 엽니다. https:// 주소를 권합니다.")
                # 구글 문서는 그날만 공유를 열 수도 있어 확인하지 않고 그대로 띄움 (제목은 시트 '제목' 칸)
                gdoc = re.match(r"https://docs\.google\.com/\w+/d/([\w-]+)", f)
                if gdoc:
                    # 드라이브 미리보기 그림 (공유가 꺼져 있으면 사이트에서 기본 그림으로 대신함)
                    page_title, embed, image = "", True, f"https://drive.google.com/thumbnail?id={gdoc.group(1)}&sz=w800"
                else:
                    got = probe_web(f)
                    if len(got) > 3:
                        errors.append(f"{where}: 웹 주소 '{urllib.parse.urlsplit(f).hostname}'를 찾을 수 없습니다. "
                                      "주소를 확인해 주세요 (www 를 빼거나 붙여 보기, 브라우저 주소창에서 열어 보기).")
                        continue
                    page_title, embed, image = got
                # 제목 칸이 비면 사이트 제목 → 사이트 주소(분류 이름을 제목으로 쓰면 '웹' 같은 카드가 여러 개 생김)
                title = row.get("title") or page_title or urllib.parse.urlsplit(f).hostname or "웹 페이지"
                m.update(type="web", url=f, embed=embed and f.lower().startswith("https://"))
                # 시트 '썸네일' 칸(드라이브 그림 파일 또는 그림 주소)이 있으면 그것을 먼저
                thumb = row.get("thumb", "")
                if thumb:
                    if drive_id(thumb):
                        image = f"https://drive.google.com/thumbnail?id={drive_id(thumb)}&sz=w800"
                    elif web_url(thumb).startswith("https://"):
                        image = web_url(thumb)
                    else:
                        warnings.append(f"{where}: 썸네일 링크를 알아볼 수 없어 기본 그림으로 보입니다 (드라이브 그림 파일 링크를 넣어 주세요).")
                if image:
                    m["image"] = image
            elif drive_id(f):
                is_pdf, fname, err = probe_drive(drive_id(f))
                if err:
                    errors.append(f"{where}: 드라이브 파일을 확인하지 못했습니다 ({err}). 파일이 지워졌는지 확인해 주세요.")
                    continue
                if not is_pdf and VIDEO_RE.search(fname or ""):
                    # PDF 링크 칸에 넣은 드라이브 동영상 → 영상으로 (유튜브 링크 칸에 넣은 것과 같게)
                    title = row.get("title") or clean_title(fname)
                    m.update(type="video", drive=drive_id(f))
                elif not is_pdf:
                    errors.append(f"{where}: PDF를 받을 수 없습니다. 파일이 PDF인지, 공유 설정이 "
                                  "'링크가 있는 모든 사용자'인지 확인해 주세요."
                                  + (f" (파일 이름: {fname})" if fname else ""))
                    continue
                else:
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

    empty = [name_of[i] for i in ids if i not in {m["item"] for m in out} and i not in intros]
    if empty:
        warnings.append(f"자료 없는 항목 {len(empty)}개 (‘자료 준비 중’으로 표시): {', '.join(empty)}")

    for w in warnings:
        print("참고:", w)
    if errors:
        # 한 사람의 실수로 전체 반영이 멈추지 않도록, 문제 있는 행만 빼고 배포
        # (드라이브 장애 등으로 남는 자료가 하나도 없을 때만 멈춤 → 사이트가 빈 채로 바뀌지 않게)
        stop = not out and not intros
        print(f"\n고칠 것 {len(errors)}개 — " + ("자료가 하나도 없어 배포하지 않았습니다." if stop else "이 행들만 빼고 배포합니다."))
        for e in errors:
            print(" -", e)
        if stop:
            sys.exit(1)
    write_report(len(out), errors, warnings)

    save_thumbs(out)
    # version: 배포마다 바뀜 → 문서 보관(functions/pdf)이 배포 때마다 새로 받게
    data = {"updated": datetime.date.today().isoformat(), "version": datetime.datetime.now().strftime("%Y%m%d%H%M%S"),
            "materials": out, "intros": intros}
    (ROOT / "assets" / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"완료: 자료 {len(out)}개 → assets/data.json")


if __name__ == "__main__":
    main()
