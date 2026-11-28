import assert from 'node:assert/strict';
import { handleRequest } from '../deploy/cloudflare-native/src/index.js';

const username = 'test-user', password = 'test-password-32-characters-long!';
const auth = `Basic ${btoa(`${username}:${password}`)}`;
const accesses = [];
const fixtures = new Map([
  ['sandbox/file & one.txt', 'hello'],
  ['sandbox/folder/other.txt', 'other'],
  ['outside/secret.txt', 'secret'],
]);
const object = key => fixtures.has(key) ? { key, size: fixtures.get(key).length, uploaded: new Date('2026-01-01T00:00:00Z'), httpEtag: '"test"' } : null;
const bucket = {
  async head(key) { accesses.push(['head', key]); return object(key); },
  async get(key) { accesses.push(['get', key]); const metadata = object(key); return metadata ? { ...metadata, body: new Response(fixtures.get(key)).body } : null; },
  async list({prefix, delimiter, limit, cursor}) {
    accesses.push(['list', prefix]);
    assert.equal(delimiter, '/'); assert.equal(limit, 1000); assert.equal(cursor, undefined);
    const objects = [], prefixes = new Set();
    for (const key of fixtures.keys()) if (key.startsWith(prefix)) {
      const remain = key.slice(prefix.length), slash = remain.indexOf('/');
      if (slash >= 0) prefixes.add(prefix + remain.slice(0, slash + 1));
      else objects.push(object(key));
    }
    return { objects, delimitedPrefixes: [...prefixes], truncated: false };
  },
};
const env = { R2: bucket, KOVA_EXPERIMENTAL_R2_DAV: 'enabled', KOVA_DAV_PREFIX: 'sandbox/', KOVA_DAV_USERNAME: username, KOVA_DAV_PASSWORD: password };
const req = (route = '/dav/', method = 'PROPFIND', headers = {}, body) => new Request('https://test.example' + route, { method, headers: { authorization: auth, ...headers }, ...(body === undefined ? {} : {body}) });
assert.equal((await handleRequest(req(), {...env, KOVA_EXPERIMENTAL_R2_DAV: undefined})).status, 404);
assert.equal((await handleRequest(req('/dav/', 'PROPFIND', {authorization: 'Basic bogus'}), env)).status, 401);
assert.equal(accesses.length, 0);
assert.equal((await handleRequest(req('/dav/', 'OPTIONS'), env)).status, 200);
assert.equal((await handleRequest(req('/dav/', 'PUT'), env)).status, 405);
assert.equal((await handleRequest(req('/dav/', 'PROPFIND', {depth: '1'}, 'x'.repeat(16385)), env)).status, 413);
assert.equal((await handleRequest(req('/dav/', 'PROPFIND', {depth: '1'}, 'x'.repeat(16384)), env)).status, 207);
assert.equal((await handleRequest(req('/dav/', 'PROPFIND', {depth: 'infinity'}), env)).status, 403);
assert.equal((await handleRequest(req('/dav/a%2Fb', 'GET'), env)).status, 400);
assert.equal((await handleRequest(req('/dav/%00', 'GET'), env)).status, 400);
assert.equal((await handleRequest(req('/dav/%252e%252e%252fsecret', 'GET'), env)).status, 404);
const response = await handleRequest(req('/dav/', 'PROPFIND', {depth: '1'}), env);
assert.equal(response.status, 207);
const xml = await response.text();
assert.match(xml, /file &amp; one\.txt/);
assert.match(xml, /file%20%26%20one\.txt/);
assert.match(xml, /folder\//);
assert.doesNotMatch(xml, /secret\.txt|sandbox\//);
assert.match(xml, /DAV:/);
const get = await handleRequest(req('/dav/file%20%26%20one.txt', 'GET'), env);
assert.equal(get.status, 200); assert.equal(await get.text(), 'hello');
assert.equal(get.headers.get('content-disposition'), 'attachment');
assert.equal(get.headers.get('cache-control'), 'private, no-store');
const head = await handleRequest(req('/dav/file%20%26%20one.txt', 'HEAD'), env);
assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '5'); assert.equal(await head.text(), '');
assert.equal((await handleRequest(req('/dav/not-found', 'GET'), env)).status, 404);
assert.ok(accesses.every(([, key]) => key.startsWith('sandbox/')));
assert.equal((await handleRequest(req('/dav/', 'PROPFIND', {depth:'0'}), {...env, KOVA_DAV_PREFIX:'../'})).status, 503);
const unsafe = { ...env, KOVA_DAV_PREFIX: '' };
assert.equal((await handleRequest(req(), unsafe)).status, 503);
const paged = { ...env, R2: { ...bucket, async list() {return {objects: [], delimitedPrefixes: [], truncated: true, cursor:'more'};} } };
assert.equal((await handleRequest(req('/dav/', 'PROPFIND', {depth: '1'}), paged)).status, 507);
console.log('Experimental R2 WebDAV authorization, confinement, bounds and read-only tests passed');
