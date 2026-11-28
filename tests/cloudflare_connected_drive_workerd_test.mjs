import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from '../deploy/cloudflare-worker/node_modules/miniflare/dist/src/index.js';

const root = new URL('../deploy/cloudflare-native/src/', import.meta.url);
const modules = [];
for (const name of ['index.js', 'r2-webdav.js', 'connected-drive.js', 'google-drive.js','dropbox.js','connected-dropbox.js','dropbox-oauth.js', 'google-oauth.js', 'google-login.js', 'google-identity.js', 'credential-vault.js', 'sessions.js']) {
  modules.push({ type: 'ESModule', path: `${process.cwd()}/app/${name}`, contents: await readFile(new URL(name, root), 'utf8') });
}
const key = Buffer.alloc(32, 7).toString('base64url');
const harness = `import { handleRequest } from './app/index.js';
import { issueSession } from './app/sessions.js';
import { createGoogleConnection } from './app/credential-vault.js';
let calls = 0;
globalThis.fetch = async (url) => {
  calls++;
  if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-access' });
  if (String(url).startsWith('https://www.googleapis.com/drive/v3/files?')) return Response.json({ files: [{id:'f1',name:'Test',mimeType:'text/plain'}] });
  throw new Error('unexpected network target');
};
export default { async fetch(request, env) {
  const now = Math.floor(Date.now()/1000);
  const id = await createGoogleConnection(env.DB, '${key}', 'alice', { clientId:'id', clientSecret:'secret', refreshToken:'refresh' }, now);
  const alice = await issueSession(env.DB, 'alice', now+600, now);
  const bob = await issueSession(env.DB, 'bob', now+600, now);
  const config = { DB:env.DB, KOVA_CREDENTIAL_KEY:'${key}', KOVA_EXPERIMENTAL_V2:'enabled' };
  const call = token => handleRequest(new Request('https://worker.test/v2/google-drive/files?connection='+id, {headers:{authorization:'Bearer '+token}}), config);
  const unauthorized = await call(bob);
  const authorized = await call(alice);
  return Response.json({ unauthorized:unauthorized.status, authorized:authorized.status, payload:await authorized.json(), calls });
}};`;
modules.unshift({ type: 'ESModule', path: `${process.cwd()}/entry.js`, contents: harness });
const mf = new Miniflare(convertV4MiniflareOptions({ modules, compatibilityDate: '2026-11-16', d1Databases: ['DB'] }));
try {
  const db = await mf.getD1Database('DB');
  for (const name of ['0001_access_foundation.sql', '0002_sessions.sql', '0004_connections.sql']) {
    const migration = await readFile(new URL(`../deploy/cloudflare-native/migrations/${name}`, import.meta.url), 'utf8');
    for (const sql of migration.replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
  await db.prepare("INSERT INTO users(id,username) VALUES('alice','alice'),('bob','bob')").run();
  const response = await mf.dispatchFetch('http://localhost/test');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { unauthorized:404, authorized:200, payload:{files:[{id:'f1',name:'Test',mimeType:'text/plain'}],nextPageToken:null}, calls:2 });
  console.log('Experimental connected-drive workerd/D1 tests passed');
} finally { await mf.dispose(); }
