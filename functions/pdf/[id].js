/**
 * /pdf/<드라이브 파일 id> — 드라이브 PDF 를 가져와 전달 (로그인은 _middleware.js 가 먼저 확인)
 * - assets/data.json 에 있는 파일만 (아무 드라이브 파일이나 중계하지 않도록)
 * - Cloudflare 캐시에 1시간 보관 → 두 번째부터는 드라이브를 거치지 않음
 */
const TTL = 3600;

export async function onRequestGet({ params, request, env, waitUntil }) {
  const id = String(params.id || '');
  if (!/^[\w-]{20,}$/.test(id)) return fail('잘못된 요청입니다.', 400);

  const cache = caches.default;
  const key = new Request(new URL(`/pdf/${id}`, request.url).toString());
  const hit = await cache.match(key);
  if (hit) return forBrowser(hit);

  const list = await env.ASSETS.fetch(new URL('/assets/data.json', request.url));
  const data = list.ok ? await list.json() : { materials: [] };
  if (!data.materials.some((m) => m.file === `pdf/${id}`)) return fail('자료 목록에 없는 파일입니다.', 404);

  const up = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { redirect: 'follow' });
  const body = await up.arrayBuffer();
  const head = String.fromCharCode(...new Uint8Array(body.slice(0, 4)));
  if (!up.ok || head !== '%PDF') {
    return fail('드라이브에서 PDF를 가져오지 못했습니다. 파일 공유 설정을 확인해 주세요.', 502);
  }

  const disposition = (up.headers.get('Content-Disposition') || 'inline').replace(/^attachment/i, 'inline');
  const res = new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': disposition,
      'Cache-Control': `max-age=${TTL}`,
    },
  });
  waitUntil(cache.put(key, res.clone()));
  return forBrowser(res);
}

// 브라우저·중간 캐시에는 로그인한 사람만 보도록 private
function forBrowser(res) {
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', `private, max-age=${TTL}`);
  return out;
}

function fail(message, status) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
