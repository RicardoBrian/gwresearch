"""앱스스크립트 HTML 파일 점검 — 붙여 넣기 전에 실행: python3 tools/sheet/check_html.py

앱스스크립트는 HTML 안 <script> 의 '//' 를 줄 끝까지 주석으로 지우고 화면에 씀
(문자열 'https://…' 도 잘림 → "Invalid or unexpected token"). 그래서
1) 스크립트 안에 '//' 가 없는지, 2) 구글처럼 '//' 뒤를 지워도 문법이 맞는지 node 로 확인
"""
import pathlib
import re
import subprocess
import sys
import tempfile

ok = True
for f in sorted(pathlib.Path(__file__).parent.glob("*.html")):
    for i, body in enumerate(re.findall(r"<script>(.*?)</script>", f.read_text(encoding="utf-8"), re.S)):
        if "//" in body:
            ok = False
            print(f"{f.name}: 스크립트 안에 '//' 가 있습니다 →", [l.strip() for l in body.splitlines() if "//" in l][:3])
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as t:
            t.write(re.sub(r"//.*", "", body))
        r = subprocess.run(["node", "--check", t.name], capture_output=True, text=True)
        if r.returncode:
            ok = False
            print(f"{f.name}: 문법 오류\n{r.stderr[:400]}")
print("이상 없음" if ok else "고칠 것이 있습니다")
sys.exit(0 if ok else 1)
