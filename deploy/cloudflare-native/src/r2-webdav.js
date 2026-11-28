// Isolated, read-only R2 WebDAV subset. No writes, locks or user grants.
// The binding must contain test data only; never expose a production bucket.
const encoder = new TextEncoder();
const reply = (status, text = '', extra = {}) => new Response(text || null, {status, headers: {
  'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...extra,
}});
const validSegment = s => s && s !== '.' && s !== '..' && !/[\x00-\x1f\x7f/\\]/.test(s);
const xmlEscape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

async function equalDigest(a, b) {
  const [left, right] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))]);
  const x = new Uint8Array(left), y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function validPrefix(prefix) {
  return typeof prefix === 'string' && prefix.length > 0 && prefix.endsWith('/') &&
    encoder.encode(prefix).length <= 512 && prefix.slice(0, -1).split('/').every(validSegment);
}

function readPath(pathname) {
  const raw = pathname.slice('/dav/'.length);
  if (!raw) return { segments: [], directory: true };
  const directory = raw.endsWith('/');
  const parts = (directory ? raw.slice(0, -1) : raw).split('/');
  try {
    const segments = parts.map(decodeURIComponent);
    if (!segments.every(validSegment) || encoder.encode(segments.join('/')).length > 512) return null;
    return { segments, directory };
  } catch { return null; }
}

function href(segments, directory) {
  return '/dav/' + segments.map(encodeURIComponent).join('/') + (directory && segments.length ? '/' : '');
}

function propertyResponse(segments, directory, metadata) {
  const name = segments.at(-1) || 'dav';
  const date = metadata?.uploaded instanceof Date && !Number.isNaN(metadata.uploaded.getTime()) ? metadata.uploaded.toUTCString() : null;
  const size = directory ? 0 : metadata.size;
  const tag = typeof metadata?.httpEtag === 'string' ? `<D:getetag>${xmlEscape(metadata.httpEtag)}</D:getetag>` : '';
  const modified = date ? `<D:getlastmodified>${xmlEscape(date)}</D:getlastmodified>` : '';
  return `<D:response><D:href>${xmlEscape(href(segments, directory))}</D:href><D:propstat><D:prop><D:displayname>${xmlEscape(name)}</D:displayname><D:resourcetype>${directory ? '<D:collection/>' : ''}</D:resourcetype><D:getcontentlength>${size}</D:getcontentlength>${modified}${tag}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

async function limitedBody(request) {
  if (!request.body) return true;
  const reader = request.body.getReader();
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) return true;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel().catch(() => {}); return false; }
    }
  } finally { reader.releaseLock(); }
}

export async function r2WebdavRequest(request, env) {
  if (env?.KOVA_EXPERIMENTAL_R2_DAV !== 'enabled') return reply(404);
  const user = env.KOVA_DAV_USERNAME, password = env.KOVA_DAV_PASSWORD, prefix = env.KOVA_DAV_PREFIX;
  if (!env.R2 || !validPrefix(prefix) || typeof user !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(user) ||
      typeof password !== 'string' || !/^[\x21-\x7e]{32,128}$/.test(password)) return reply(503, 'WebDAV is not configured');
  const authorization = request.headers.get('authorization') || '';
  const challenge = {'www-authenticate': 'Basic realm="Kova experimental WebDAV", charset="UTF-8"'};
  if (authorization.length > 512 || !await equalDigest(authorization, `Basic ${btoa(`${user}:${password}`)}`)) return reply(401, 'Unauthorized', challenge);
  const allowed = 'OPTIONS, GET, HEAD, PROPFIND';
  if (request.method === 'OPTIONS') return reply(200, '', {allow: allowed});
  if (!['GET', 'HEAD', 'PROPFIND'].includes(request.method)) return reply(405, '', {allow: allowed});
  const parsed = readPath(new URL(request.url).pathname);
  if (!parsed) return reply(400, 'Invalid path');
  const key = prefix + parsed.segments.join('/');
  if (encoder.encode(key).length > 1024) return reply(400, 'Invalid path');
  try {
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (parsed.directory || !parsed.segments.length) return reply(405, '', {allow: allowed});
      const obj = request.method === 'HEAD' ? await env.R2.head(key) : await env.R2.get(key);
      if (!obj) return reply(404);
      const headers = {'content-type': 'application/octet-stream', 'content-disposition': 'attachment', 'content-length': String(obj.size)};
      return request.method === 'HEAD' ? reply(200, '', headers) : new Response(obj.body, {status: 200, headers: {
        ...headers, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
      }});
    }
    const depth = request.headers.get('depth') || 'infinity';
    if (depth !== '0' && depth !== '1') return reply(403, 'Only Depth 0 and 1 are supported');
    // Ignore property selection in this limited experimental subset, but bound
    // the request body. This does not advertise WebDAV class compliance.
    if (!await limitedBody(request)) return reply(413, 'Request too large');
    let file = null, directory = parsed.directory || !parsed.segments.length;
    if (!directory) file = await env.R2.head(key);
    if (file) return reply(207, `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${propertyResponse(parsed.segments, false, file)}</D:multistatus>`, {'content-type': 'application/xml; charset=utf-8'});
    const dirPrefix = parsed.segments.length ? key + '/' : prefix;
    const list = await env.R2.list({prefix: dirPrefix, delimiter: '/', limit: 1000});
    if (list.truncated) return reply(507, 'Directory exceeds listing limit');
    const objects = list.objects || [], dirs = list.delimitedPrefixes || [];
    if (parsed.segments.length && !objects.length && !dirs.length) return reply(404);
    const children = [];
    if (depth === '1') {
      for (const obj of objects) {
        const name = obj.key.startsWith(dirPrefix) ? obj.key.slice(dirPrefix.length) : '';
        if (!name) continue; // R2 directory marker
        if (!validSegment(name) || !Number.isSafeInteger(obj.size) || obj.size < 0) return reply(502, 'Invalid storage listing');
        children.push(propertyResponse([...parsed.segments, name], false, obj));
      }
      for (const full of dirs) {
        const name = full.startsWith(dirPrefix) && full.endsWith('/') ? full.slice(dirPrefix.length, -1) : '';
        if (!validSegment(name)) return reply(502, 'Invalid storage listing');
        children.push(propertyResponse([...parsed.segments, name], true, null));
      }
    }
    const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${propertyResponse(parsed.segments, true, null)}${children.join('')}</D:multistatus>`;
    return reply(207, xml, {'content-type': 'application/xml; charset=utf-8'});
  } catch { return reply(502, 'Storage request failed'); }
}
