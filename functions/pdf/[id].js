/**
 * /pdf/<드라이브 파일 id> — 드라이브 PDF 전달 (로그인은 _middleware.js 가 먼저 확인)
 *
 * 빠르게 보여주려고:
 * - Cloudflare KV(PDF_STORE)에 한 번 받은 파일을 계속 보관 → 두 번째부터 드라이브를 거치지 않음
 *   (하루 지난 파일은 보여준 뒤 뒤에서 드라이브에서 새로 받아 둠)
 * - Range(부분 요청) 지원 → pdf.js 가 전체를 기다리지 않고 첫 쪽부터 그림
 * - PDF_STORE 연결이 없으면 예전처럼 Cloudflare 캐시(1시간)만 사용
 * - assets/data.json 에 있는 파일만 (아무 드라이브 파일이나 중계하지 않도록)
 */
const FRESH = 24 * 3600;
const TTL = 3600;

export async function onRequestGet({ params, request, env, waitUntil }) {
  const id = String(params.id || '');
  if (!/^[\w-]{20,}$/.test(id)) return fail('잘못된 요청입니다.', 400);
  if (!(await isListed(id, request, env))) return fail('자료 목록에 없는 파일입니다.', 404);

  const store = env.PDF_STORE;
  if (store) {
    const { value, metadata } = await store.getWithMetadata(id, { type: 'arrayBuffer', cacheTtl: TTL });
    if (value) {
      if (Date.now() / 1000 - ((metadata && metadata.t) || 0) > FRESH) waitUntil(saveFromDrive(store, id));
      return send(value, metadata && metadata.cd, request);
    }
    const got = await fromDrive(id);
    if (!got) return fail('드라이브에서 PDF를 가져오지 못했습니다. 파일 공유 설정을 확인해 주세요.', 502);
    waitUntil(store.put(id, got.body, { metadata: { t: Math.floor(Date.now() / 1000), cd: got.cd } }));
    return send(got.body, got.cd, request);
  }

  // PDF_STORE 가 없을 때: Cloudflare 캐시만
  const cache = caches.default;
  const key = new Request(new URL(`/pdf/${id}`, request.url).toString());
  const hit = await cache.match(key);
  if (hit) return send(await hit.arrayBuffer(), hit.headers.get('Content-Disposition'), request);
  const got = await fromDrive(id);
  if (!got) return fail('드라이브에서 PDF를 가져오지 못했습니다. 파일 공유 설정을 확인해 주세요.', 502);
  waitUntil(cache.put(key, new Response(got.body, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': got.cd, 'Cache-Control': `max-age=${TTL}` },
  })));
  return send(got.body, got.cd, request);
}

export async function isListed(id, request, env) {
  const list = await env.ASSETS.fetch(new URL('/assets/data.json', request.url));
  const data = list.ok ? await list.json() : { materials: [] };
  return data.materials.some((m) => m.file === `pdf/${id}`)
    || Object.values(data.intros || {}).includes(`pdf/${id}`);
}

export async function fromDrive(id) {
  const up = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { redirect: 'follow' });
  if (!up.ok) return null;
  const body = await up.arrayBuffer();
  if (String.fromCharCode(...new Uint8Array(body.slice(0, 4))) !== '%PDF') return null;
  const cd = (up.headers.get('Content-Disposition') || 'inline').replace(/^attachment/i, 'inline');
  return { body, cd };
}

export async function saveFromDrive(store, id) {
  const got = await fromDrive(id);
  if (got) await store.put(id, got.body, { metadata: { t: Math.floor(Date.now() / 1000), cd: got.cd } });
  return Boolean(got);
}

// 전체 또는 요청한 구간만 (Range: bytes=a-b)
function send(body, cd, request) {
  const size = body.byteLength;
  const headers = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': cd || 'inline',
    'Accept-Ranges': 'bytes',
    'Cache-Control': `private, max-age=${TTL}`,
  };
  const m = (request.headers.get('Range') || '').match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(body.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(body, { headers: { ...headers, 'Content-Length': String(size) } });
}

function fail(message, status) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
