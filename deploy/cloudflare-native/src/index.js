// Experimental standalone Cloudflare-native R2 API. This is NOT the Kova
// API or a production-ready server. Do not attach production data.
import { googleDriveRequest } from './google-drive.js';
import { dropboxRequest } from './dropbox.js';
import { connectedDropboxRequest } from './connected-dropbox.js';
import { dropboxOauthRequest } from './dropbox-oauth.js';
import { connectedDriveRequest } from './connected-drive.js';
import { googleOauthRequest } from './google-oauth.js';
import { googleLoginRequest } from './google-login.js';
import { r2WebdavRequest } from './r2-webdav.js';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const json = (status, payload) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});

async function authorized(request, token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 1024) return false;
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') || '');
  if (!match || match[1].length > 1024) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(token)),
    crypto.subtle.digest('SHA-256', encoder.encode(match[1])),
  ]);
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function safeText(value, max) {
  return value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  // Static UI is deliberately opt-in through a separately bound asset set.
  // API routes never fall through to assets and unknown files stay private.
  if ((request.method === 'GET' || request.method === 'HEAD') && env?.ASSETS && ['/', '/app.css', '/app.js'].includes(url.pathname)) {
    try {
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
      headers.set('x-content-type-options', 'nosniff');
      headers.set('referrer-policy', 'no-referrer');
      headers.set('cache-control', 'no-store');
      return new Response(asset.body, {status: asset.status, headers});
    } catch { return json(503, {error:'UI unavailable'}); }
  }
  if (url.pathname.startsWith('/dav/')) return r2WebdavRequest(request, env);
  if (url.pathname === '/dav') return env?.KOVA_EXPERIMENTAL_R2_DAV === 'enabled'
    ? new Response(null, { status: 308, headers: { location: '/dav/', 'cache-control': 'no-store' } })
    : json(404, { error: 'Not found' });
  if (request.method === 'GET' && url.pathname === '/ping') return json(200, { ok: true, experimental: true });
  if (url.pathname.startsWith('/v2/auth/google/')) return googleLoginRequest(request, env);
  if (url.pathname.startsWith('/v2/google-drive/oauth/')) return googleOauthRequest(request, env);
  if (url.pathname.startsWith('/v2/dropbox/oauth/')) return dropboxOauthRequest(request, env);
  if (url.pathname.startsWith('/v2/dropbox/')) return connectedDropboxRequest(request, env);
  if (url.pathname.startsWith('/v2/')) return connectedDriveRequest(request, env);
  if (typeof env?.KOVA_NATIVE_TOKEN !== 'string' || env.KOVA_NATIVE_TOKEN.length < 32 || env.KOVA_NATIVE_TOKEN.length > 1024) {
    return json(503, { error: 'Experimental backend is not configured' });
  }
  if (!await authorized(request, env.KOVA_NATIVE_TOKEN)) return json(401, { error: 'Unauthorized' });
  if (request.method !== 'GET' && request.method !== 'PUT') return json(405, { error: 'Method not allowed' });
  if (url.pathname.startsWith('/v1/google-drive/')) {
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    return googleDriveRequest(url, env, request.headers);
  }
  if (url.pathname.startsWith('/v1/dropbox/')) {
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    return dropboxRequest(url, env);
  }
  if (!env.R2) return json(503, { error: 'R2 is not configured' });
  try {
    if (request.method === 'PUT') {
      if (url.pathname !== '/v1/object') return json(404, { error: 'Not found' });
      if (env.KOVA_NATIVE_WRITES !== 'enabled') return json(403, { error: 'Writes are disabled' });
      const key = url.searchParams.get('key');
      if (!key || !safeText(key, 1024) || new TextEncoder().encode(key).length > 1024) return json(400, { error: 'Invalid request' });
      // Content-Length is required, but independently count bytes: a client can lie.
      const lengthText = request.headers.get('content-length');
      if (!lengthText || !/^(0|[1-9][0-9]{0,7})$/.test(lengthText)) return json(411, { error: 'Valid Content-Length required' });
      const length = Number(lengthText);
      if (length > MAX_UPLOAD_BYTES) return json(413, { error: 'Upload too large' });
      if (!request.body && length !== 0) return json(400, { error: 'Invalid body length' });
      const chunks = [];
      let total = 0;
      if (request.body) {
        const reader = request.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > length || total > MAX_UPLOAD_BYTES) {
              await reader.cancel().catch(() => {});
              return json(413, { error: 'Upload exceeds declared length or limit' });
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      if (total !== length) return json(400, { error: 'Invalid body length' });
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      // Header-form conditional follows HTTP If-None-Match: * semantics.
      const result = await env.R2.put(key, bytes, { onlyIf: new Headers({ 'If-None-Match': '*' }) });
      if (!result) return json(409, { error: 'Object already exists' });
      return json(201, { key, size: total });
    }
    if (url.pathname === '/v1/objects') {
      const prefix = url.searchParams.get('prefix') || '';
      const cursor = url.searchParams.get('cursor') || '';
      if (!safeText(prefix, 1024) || !safeText(cursor, 4096)) return json(400, { error: 'Invalid request' });
      const options = { prefix, limit: 100 };
      if (cursor) options.cursor = cursor;
      const result = await env.R2.list(options);
      return json(200, { objects: result.objects.map(object => ({ key: object.key, size: object.size, uploaded: object.uploaded.toISOString() })), cursor: result.truncated ? result.cursor : null });
    }
    if (url.pathname === '/v1/object') {
      const key = url.searchParams.get('key');
      if (!key || !safeText(key, 1024)) return json(400, { error: 'Invalid request' });
      const object = await env.R2.get(key);
      if (!object) return json(404, { error: 'Not found' });
      return new Response(object.body, { status: 200, headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment',
        'content-length': String(object.size),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      } });
    }
    return json(404, { error: 'Not found' });
  } catch {
    return json(502, { error: 'Storage request failed' });
  }
}

export default { fetch: handleRequest };
