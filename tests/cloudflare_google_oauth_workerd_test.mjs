import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from '../deploy/cloudflare-worker/node_modules/miniflare/dist/src/index.js';
const root = new URL('../deploy/cloudflare-native/src/', import.meta.url);
const modules = [];
for (const name of ['index.js', 'r2-webdav.js','connected-drive.js','google-drive.js','dropbox.js','connected-dropbox.js','dropbox-oauth.js','google-oauth.js','google-login.js','google-identity.js','credential-vault.js','sessions.js'])
  modules.push({ type:'ESModule', path:`${process.cwd()}/app/${name}`, contents:await readFile(new URL(name,root),'utf8') });
const key = Buffer.alloc(32, 8).toString('base64url');
const harness = `import { handleRequest } from './app/index.js';
import { issueSession } from './app/sessions.js';
import { readGoogleConnection } from './app/credential-vault.js';
let calls = 0;
globalThis.fetch = async url => { calls++; if (String(url)!=='https://oauth2.googleapis.com/token') throw Error('unexpected host'); return Response.json({refresh_token:'synthetic-refresh'}); };
export default { async fetch(request, env) {
  const token = await issueSession(env.DB, 'alice', Math.floor(Date.now()/1000)+600);
  const config = {DB:env.DB,KOVA_CREDENTIAL_KEY:'${key}',KOVA_EXPERIMENTAL_V2:'enabled',KOVA_EXPERIMENTAL_OAUTH:'enabled',KOVA_GOOGLE_REDIRECT:'https://worker.test/v2/google-drive/oauth/callback',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'};
  const start = await handleRequest(new Request('https://worker.test/v2/google-drive/oauth/start',{method:'POST',headers:{authorization:'Bearer '+token}}),config);
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const auth = new URL((await start.json()).authorizationUrl);
  const state = auth.searchParams.get('state');
  const callback = () => new Request('https://worker.test/v2/google-drive/oauth/callback?code=example&state='+state,{headers:{cookie}});
  const finish = await handleRequest(callback(),config);
  const data = await finish.json();
  const credentials = data.connection ? await readGoogleConnection(env.DB,'${key}','alice',data.connection) : null;
  const replay = await handleRequest(callback(),config);
  return Response.json({start:start.status,finish:finish.status,replay:replay.status,connection:!!data.connection,credentials,calls});
}};`;
modules.unshift({ type:'ESModule', path:`${process.cwd()}/entry.js`, contents:harness });
const mf = new Miniflare(convertV4MiniflareOptions({modules,compatibilityDate:'2026-11-16',d1Databases:['DB']}));
try {
  const db = await mf.getD1Database('DB');
  for (const name of ['0001_access_foundation.sql','0002_sessions.sql','0004_connections.sql','0005_oauth_pending.sql','0009_google_oauth_browser_binding.sql']) {
    const sql = await readFile(new URL(`../deploy/cloudflare-native/migrations/${name}`,import.meta.url),'utf8');
    for (const statement of sql.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  await db.prepare("INSERT INTO users(id,username) VALUES('alice','alice')").run();
  const response = await mf.dispatchFetch('http://localhost/test');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{start:200,finish:201,replay:400,connection:true,credentials:{clientId:'client',clientSecret:'secret',refreshToken:'synthetic-refresh'},calls:1});
  console.log('Experimental Google OAuth workerd and D1 emulator tests passed');
} finally { await mf.dispose(); }
