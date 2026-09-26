/**
 * 사이트 전체 비밀번호 잠금 (Cloudflare Pages Functions)
 *
 * Cloudflare 설정 → 변수 및 비밀:
 *   SITE_PASSWORD  (비밀, 필수) 입장 비밀번호. 바꾸면 기존 로그인은 모두 풀림
 *   SESSION_HOURS  (선택)      로그인 유지 시간, 기본 12
 *
 * 로그인하지 않으면 페이지는 비밀번호 화면, 자료 목록·PDF 등은 401.
 */
const COOKIE = 'gw_auth';
const enc = new TextEncoder();

// 로그인 화면에 필요한 파일만 잠금 없이
const OPEN = [
  /^\/favicon\.ico$/,
  /^\/assets\/img\/(logo|favicon-\d+|apple-touch-icon)\.png$/,
];

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const password = env.SITE_PASSWORD;
  if (!password) {
    return text('사이트 비밀번호(SITE_PASSWORD)가 설정되지 않았습니다. Cloudflare 설정에서 추가해 주세요.', 503);
  }
  if (OPEN.some((re) => re.test(url.pathname))) return next();

  if (url.pathname === '/__login' && request.method === 'POST') return login(request, env, password);
  if (url.pathname === '/__logout') {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': cookie('', 0) } });
  }

  if (await isValid(readCookie(request), password)) return next();

  const wantsPage = request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html');
  return wantsPage ? loginPage(false) : text('로그인이 필요합니다.', 401);
}

async function login(request, env, password) {
  const form = await request.formData();
  const given = String(form.get('password') || '');
  let dest = String(form.get('next') || '/');
  if (!dest.startsWith('/') || dest.startsWith('//')) dest = '/';

  // 길이·내용이 달라도 같은 시간이 걸리도록 서명끼리 비교
  const ok = (await sign(given, 'pw')) === (await sign(password, 'pw'));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 600));
    return loginPage(true);
  }
  const hours = Number(env.SESSION_HOURS) || 12;
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  const token = `${exp}.${await sign(password, String(exp))}`;
  return new Response(null, { status: 303, headers: { Location: dest, 'Set-Cookie': cookie(token, hours * 3600) } });
}

async function isValid(token, password) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return sig === (await sign(password, exp));
}

// 비밀번호를 키로 한 HMAC — 비밀번호를 바꾸면 기존 쿠키가 모두 무효
async function sign(key, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(`gwresearch:${key}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));
}

function readCookie(request) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : '';
}

function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function text(body, status) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function loginPage(failed) {
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>입장 | 관산중학교 학생 성장 지원 로드맵</title>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;
    background:linear-gradient(180deg,#e9f1e0,#f6f9f2 60%,#fff);color:#111;
    font-family:"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;word-break:keep-all}
  .box{width:min(100%,400px);padding:40px 32px 32px;border-radius:24px;background:#fff;
    box-shadow:0 30px 80px rgba(25,40,15,.14);text-align:center}
  .logo{width:72px;height:auto;margin:0 auto 14px;display:block}
  .school{margin:0;color:#74162b;font-size:15px;font-weight:700}
  h1{margin:6px 0 26px;color:#2d3c85;font-size:24px;font-weight:800;letter-spacing:-.02em}
  label{display:block;margin-bottom:8px;text-align:left;font-size:14px;font-weight:600;color:#5d6657}
  input{width:100%;height:50px;padding:0 16px;border:1.5px solid #dfe6d8;border-radius:14px;font:inherit;font-size:17px;outline:none;transition:border-color .2s}
  input:focus{border-color:#456d2a}
  button{width:100%;height:50px;margin-top:12px;border:0;border-radius:14px;background:#456d2a;color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer;transition:background-color .2s}
  button:hover{background:#2f4c1b}
  .err{margin:12px 0 0;color:#c0392b;font-size:14px;font-weight:600}
  .note{margin:18px 0 0;color:#8a9284;font-size:13px}
</style>
</head>
<body>
  <form class="box" method="post" action="/__login">
    <img class="logo" src="/assets/img/logo.png" alt="">
    <p class="school">관산중학교</p>
    <h1>학생 성장 지원 로드맵</h1>
    <label for="pw">입장 비밀번호</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
    <input type="hidden" name="next" id="next" value="/">
    <button type="submit">입장하기</button>
    ${failed ? '<p class="err" role="alert">비밀번호가 맞지 않습니다.</p>' : ''}
    <p class="note">발표회 안내에 있는 비밀번호를 입력해 주세요.</p>
  </form>
  <script>
    // 로그인 뒤 원래 보던 화면(#항목 포함)으로 돌아가기
    var n = document.getElementById('next');
    if (location.pathname !== '/__login') n.value = location.pathname + location.search + location.hash;
    else if (sessionStorage.getItem('gw_next')) n.value = sessionStorage.getItem('gw_next');
    try { sessionStorage.setItem('gw_next', n.value); } catch (e) {}
  </script>
</body>
</html>`;
  return new Response(html, {
    status: failed ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
