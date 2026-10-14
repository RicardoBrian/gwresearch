/**
 * 모든 요청 앞에서 (Cloudflare Pages Functions)
 * - 짧은 주소: gwansan.com/연구입력 → 자료 올리기 앱
 * - 페이지(HTML)는 늘 새로 받게
 *
 * 사이트는 공개 (로그인 없음). 예전 비밀번호 잠금은 커밋 1522495 의 이 파일에 있음.
 */

// gwansan.com/연구입력 → 자료 올리기 앱 (앱은 업로드 코드로 잠겨 있음)
// 앱을 [배포 관리 → 수정 → 새 버전]으로 고치면 주소가 그대로라 여기는 안 바꿔도 됨
const SHORTCUTS = {
  '/연구입력': 'https://script.google.com/macros/s/AKfycby4VTU5X9WWb91WUkrPG_f0klDqD8I9ulMKZrg6IOYgc6DwnKY7RoRj0myGp7UgmyAlTw/exec',
};

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  const shortcut = SHORTCUTS[safeDecode(url.pathname).replace(/\/+$/, '')];
  if (shortcut) return Response.redirect(shortcut, 302);
  // 예전 로그인 주소로 들어와도 첫 화면으로
  if (url.pathname === '/__login' || url.pathname === '/__logout') return Response.redirect(new URL('/', url), 303);
  return fresh(await next());
}

function safeDecode(path) {
  try { return decodeURIComponent(path); } catch (e) { return path; }
}

// 페이지(HTML)는 늘 새로 받게 → 배포하면 바로 새 화면 파일(?v=배포번호)을 가리킴
function fresh(res) {
  if (!(res.headers.get('Content-Type') || '').includes('text/html')) return res;
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-cache');
  return out;
}
