import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from '../deploy/cloudflare-worker/node_modules/miniflare/dist/src/index.js';

const source = await readFile(new URL('../deploy/cloudflare-native/src/r2-webdav.js', import.meta.url), 'utf8');
const harness = `import {r2WebdavRequest} from './r2-webdav.js'; export default {fetch: r2WebdavRequest};`;
const modules = [
  {type: 'ESModule', path: `${process.cwd()}/entry.js`, contents: harness},
  {type: 'ESModule', path: `${process.cwd()}/r2-webdav.js`, contents: source},
];
const mf = new Miniflare(convertV4MiniflareOptions({
  modules, compatibilityDate: '2026-11-16', r2Buckets: ['R2'], bindings: {
    KOVA_EXPERIMENTAL_R2_DAV: 'enabled', KOVA_DAV_PREFIX: 'test-root/',
    KOVA_DAV_USERNAME: 'test', KOVA_DAV_PASSWORD: 'local-test-password-32-characters!',
  },
}));
try {
  const bucket = await mf.getR2Bucket('R2');
  await bucket.put('test-root/one.txt', 'hello');
  await bucket.put('test-root/sub/two.txt', 'world');
  await bucket.put('private/hidden.txt', 'secret');
  const auth = `Basic ${btoa('test:local-test-password-32-characters!')}`;
  const request = (url, method, extra = {}) => mf.dispatchFetch(`http://localhost${url}`, {method, headers: {authorization: auth, ...extra}});
  assert.equal((await request('/dav/', 'PROPFIND', {authorization: 'Basic bad', depth:'1'})).status, 401);
  const listing = await request('/dav/', 'PROPFIND', {depth:'1'});
  assert.equal(listing.status, 207);
  const body = await listing.text();
  assert.match(body, /one\.txt/); assert.match(body, /sub\//); assert.doesNotMatch(body, /hidden|test-root/);
  const get = await request('/dav/one.txt', 'GET');
  assert.equal(get.status, 200); assert.equal(await get.text(), 'hello');
  assert.equal((await request('/dav/one.txt', 'PUT')).status, 405);
  assert.equal((await request('/dav/private%2Fhidden.txt', 'GET')).status, 400);
  assert.equal(await (await bucket.get('test-root/one.txt')).text(), 'hello');
  console.log('Experimental R2 WebDAV workerd/local R2 tests passed');
} finally { await mf.dispose(); }
