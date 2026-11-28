import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from '../deploy/cloudflare-worker/node_modules/miniflare/dist/src/index.js';
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey); Object.assign(publicKey,{kid:'key',alg:'RS256',use:'sig'});
const privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey);
const key=Buffer.alloc(32,4).toString('base64url');
const root = new URL('../deploy/cloudflare-native/src/',import.meta.url);
const modules=[];
for (const name of ['index.js', 'r2-webdav.js','connected-drive.js','google-drive.js','dropbox.js','connected-dropbox.js','dropbox-oauth.js','google-oauth.js','google-login.js','google-identity.js','credential-vault.js','sessions.js'])
  modules.push({type:'ESModule',path:`${process.cwd()}/app/${name}`,contents:await readFile(new URL(name,root),'utf8')});
const harness=`import {handleRequest} from './app/index.js';
import {createGoogleConnection} from './app/credential-vault.js';
const key = '${key}'; let nonce;
const encode = x => btoa(JSON.stringify(x)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
globalThis.fetch = async (url, options) => {
 if (String(url)==='https://api.dropboxapi.com/oauth2/token') {
  if(options.body.get('grant_type')==='authorization_code') return Response.json({refresh_token:'refresh-token',access_token:'fresh-dropbox'});
  if(options.body.get('grant_type')!=='refresh_token' || options.body.get('refresh_token')!=='refresh-token') throw Error('invalid refresh');
  return Response.json({access_token:'fresh-dropbox'});
 }
 if (String(url)==='https://api.dropboxapi.com/2/files/list_folder') return Response.json({entries:[{'.tag':'file',name:'Ảnh',path_display:'/Ảnh',size:2}],cursor:'next',has_more:false});
 if (String(url)==='https://content.dropboxapi.com/2/files/upload') {
  const arg=JSON.parse(options.headers['dropbox-api-arg']);
  if (arg.path!=='/new.txt' || arg.mode!=='add' || arg.autorename!==false || arg.strict_conflict!==true || new TextDecoder().decode(options.body)!=='abc') throw Error('invalid upload');
  return Response.json({name:'new.txt',path_display:'/new.txt',size:3});
 }
 if (String(url)==='https://content.dropboxapi.com/2/files/download') {
  if (JSON.parse(options.headers['dropbox-api-arg']).path !== '/Ảnh') throw Error('invalid Dropbox path');
  return new Response('ok');
 }
 if (String(url)==='https://www.googleapis.com/oauth2/v3/certs') return Response.json({keys:[${JSON.stringify(publicKey)}]});
 if (String(url).startsWith('https://www.googleapis.com/drive/v3/files?')) {
  if (new URL(url).searchParams.get('q') !== "'root' in parents and trashed = false and name contains 'My'") throw Error('unexpected query');
  return Response.json({files:[{id:'f',name:'My file',mimeType:'text/plain'}]});
 }
 if (String(url).startsWith('https://www.googleapis.com/drive/v3/files/f/export?')) {
  if (new URL(url).searchParams.get('mimeType') !== 'application/pdf') throw Error('invalid export format');
  return new Response('pdf');
 }
 if (String(url).startsWith('https://www.googleapis.com/drive/v3/files/f?')) {
  if (options.headers.range !== 'bytes=2-4') throw Error('missing range');
  return new Response('cde',{status:206,headers:{'content-range':'bytes 2-4/6','content-length':'3'}});
 }
 if (String(url)!=='https://oauth2.googleapis.com/token') throw Error('unexpected host');
 if (options.body.get('grant_type')==='refresh_token') return Response.json({access_token:'synthetic-access'});
 const now=Math.floor(Date.now()/1000), h=encode({alg:'RS256',kid:'key'}), p=encode({iss:'https://accounts.google.com',aud:'client',sub:'google-subject',nonce,iat:now,exp:now+300});
 const k=await crypto.subtle.importKey('jwk',${JSON.stringify(privateKey)},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signed=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',k,new TextEncoder().encode(h+'.'+p)));
 const sig=btoa(String.fromCharCode(...signed)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
 return Response.json({id_token:h+'.'+p+'.'+sig});
};
export default {async fetch(req,env){
 const config={DB:env.DB,KOVA_CREDENTIAL_KEY:key,KOVA_EXPERIMENTAL_V2:'enabled',KOVA_EXPERIMENTAL_LOGIN:'enabled',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',KOVA_LOGIN_REDIRECT:'https://worker.test/v2/auth/google/callback',KOVA_EXPERIMENTAL_DROPBOX:'enabled',KOVA_EXPERIMENTAL_DROPBOX_V2:'enabled',KOVA_EXPERIMENTAL_DROPBOX_WRITES:'enabled',KOVA_EXPERIMENTAL_DROPBOX_OAUTH:'enabled',DROPBOX_CLIENT_ID:'key',DROPBOX_CLIENT_SECRET:'secret',KOVA_DROPBOX_REDIRECT:'https://worker.test/v2/dropbox/oauth/callback',DROPBOX_ACCESS_TOKEN:'test-token',KOVA_NATIVE_TOKEN:'test-only-native-token-at-least-32-characters'};
 const dropHeaders={authorization:'Bearer '+config.KOVA_NATIVE_TOKEN};
 const dropList=await handleRequest(new Request('https://worker.test/v1/dropbox/files',{headers:dropHeaders}),config);
 const dropFile=await handleRequest(new Request('https://worker.test/v1/dropbox/file?path='+encodeURIComponent('/Ảnh'),{headers:dropHeaders}),config);
 const dropbox={listing:await dropList.json(),status:dropFile.status,body:await dropFile.text()};
 const start=await handleRequest(new Request('https://worker.test/v2/auth/google/start',{method:'POST',headers:{origin:'https://worker.test','content-type':'application/json'}}),config);
 const cookie=start.headers.get('set-cookie').split(';')[0], auth=new URL((await start.json()).authorizationUrl); nonce=auth.searchParams.get('nonce');
 const callback=()=>new Request('https://worker.test/v2/auth/google/callback?code=code&state='+auth.searchParams.get('state'),{headers:{cookie}});
 const finish=await handleRequest(callback(),config); const data=await finish.json();
 const userHeaders={authorization:'Bearer '+data.token,'content-type':'application/json'};
 const createdDropbox=await handleRequest(new Request('https://worker.test/v2/dropbox/connections',{method:'POST',headers:userHeaders,body:JSON.stringify({accessToken:'workerd-dropbox-token'})}),config);
 const dropId=(await createdDropbox.json()).id;
 const connectedList=await handleRequest(new Request('https://worker.test/v2/dropbox/files?connection='+dropId,{headers:userHeaders}),config);
 const connectedDrop=await connectedList.json();
 const uploaded=await handleRequest(new Request('https://worker.test/v2/dropbox/file?connection='+dropId+'&path=%2Fnew.txt',{method:'PUT',headers:{authorization:'Bearer '+data.token,'content-length':'3'},body:'abc'}),config);
 const uploadedData=await uploaded.json();
 const removedDropbox=await handleRequest(new Request('https://worker.test/v2/dropbox/connections?id='+dropId,{method:'DELETE',headers:userHeaders}),config);
 const refreshedConnection=await handleRequest(new Request('https://worker.test/v2/dropbox/connections',{method:'POST',headers:userHeaders,body:JSON.stringify({appKey:'key',appSecret:'secret',refreshToken:'refresh-token'})}),config);
 const refreshId=(await refreshedConnection.json()).id;
 const refreshList=await handleRequest(new Request('https://worker.test/v2/dropbox/files?connection='+refreshId,{headers:userHeaders}),config);
 const dropStart=await handleRequest(new Request('https://worker.test/v2/dropbox/oauth/start',{method:'POST',headers:userHeaders}),config);
 const dropCookie=dropStart.headers.get('set-cookie').split(';')[0], dropAuth=new URL((await dropStart.json()).authorizationUrl);
 const dropFinish=await handleRequest(new Request('https://worker.test/v2/dropbox/oauth/callback?code=test&state='+dropAuth.searchParams.get('state'),{headers:{cookie:dropCookie}}),config);
 const dropIdOAuth=(await dropFinish.json()).connection;
 const dropOauthList=await handleRequest(new Request('https://worker.test/v2/dropbox/files?connection='+dropIdOAuth,{headers:userHeaders}),config);
 const dropV2={created:createdDropbox.status,entries:connectedDrop.entries,upload:uploaded.status,uploadedData,removed:removedDropbox.status,refresh:refreshList.status,oauth:dropFinish.status,oauthList:dropOauthList.status};
 const me=await handleRequest(new Request('https://worker.test/v2/me',{headers:{authorization:'Bearer '+data.token}}),config);
 const connection=await createGoogleConnection(env.DB,key,'alice',{clientId:'client',clientSecret:'secret',refreshToken:'synthetic-refresh'});
 const connections=await handleRequest(new Request('https://worker.test/v2/connections',{headers:{authorization:'Bearer '+data.token}}),config);
 const listData=await connections.json();
 const drive=await handleRequest(new Request('https://worker.test/v2/google-drive/files?connection='+connection+'&name=My',{headers:{authorization:'Bearer '+data.token}}),config);
 const listing=await drive.json();
 const part=await handleRequest(new Request('https://worker.test/v2/google-drive/file?connection='+connection+'&id=f',{headers:{authorization:'Bearer '+data.token,range:'bytes=2-4'}}),config);
 const rangeResult={status:part.status,range:part.headers.get('content-range'),body:await part.text()};
 const exported=await handleRequest(new Request('https://worker.test/v2/google-drive/export?connection='+connection+'&id=f&format=pdf',{headers:{authorization:'Bearer '+data.token}}),config);
 const exportResult={status:exported.status,body:await exported.text()};
 const disconnect=await handleRequest(new Request('https://worker.test/v2/connections?id='+connection,{method:'DELETE',headers:{authorization:'Bearer '+data.token}}),config);
 const disconnected=await disconnect.json();
 const driveAfter=await handleRequest(new Request('https://worker.test/v2/google-drive/files?connection='+connection,{headers:{authorization:'Bearer '+data.token}}),config);
 const logout=await handleRequest(new Request('https://worker.test/v2/logout',{method:'POST',headers:{authorization:'Bearer '+data.token}}),config);
 const after=await handleRequest(new Request('https://worker.test/v2/me',{headers:{authorization:'Bearer '+data.token}}),config);
 const replay=(await handleRequest(callback(),config)).status;
 const browserConfig={...config,KOVA_EXPERIMENTAL_BROWSER_AUTH:'enabled'};
 const browserStart=await handleRequest(new Request('https://worker.test/v2/auth/google/start',{method:'POST',headers:{origin:'https://worker.test','content-type':'application/json'}}),browserConfig);
 const browserBinding=browserStart.headers.get('set-cookie').split(';')[0], browserAuth=new URL((await browserStart.json()).authorizationUrl);nonce=browserAuth.searchParams.get('nonce');
 const browserFinish=await handleRequest(new Request('https://worker.test/v2/auth/google/callback?code=code&state='+browserAuth.searchParams.get('state'),{headers:{cookie:browserBinding}}),browserConfig);
 const cookies=browserFinish.headers.getSetCookie();
 const sessionCookie=cookies.find(x=>x.startsWith('__Host-kova_session=')).split(';')[0];
 const browserMe=await handleRequest(new Request('https://worker.test/v2/me',{headers:{cookie:sessionCookie}}),browserConfig);
 const browserLogout=await handleRequest(new Request('https://worker.test/v2/logout',{method:'POST',headers:{cookie:sessionCookie,origin:'https://worker.test'}}),browserConfig);
 const browserAfter=await handleRequest(new Request('https://worker.test/v2/me',{headers:{cookie:sessionCookie}}),browserConfig);
 const browser={finish:browserFinish.status,location:browserFinish.headers.get('location'),me:browserMe.status,logout:browserLogout.status,after:browserAfter.status};
 return Response.json({dropbox,dropV2,browser,start:start.status,finish:finish.status,me:await me.json(),connections:connections.status,connectionListed:listData.connections.length === 1 && listData.connections[0].id === connection && listData.connections[0].provider === 'google_drive',drive:drive.status,listing,rangeResult,exportResult,disconnect:disconnect.status,disconnected,driveAfter:driveAfter.status,logout:logout.status,after:after.status,replay});
}};`;
modules.unshift({type:'ESModule',path:`${process.cwd()}/entry.js`,contents:harness});
const mf=new Miniflare(convertV4MiniflareOptions({modules,compatibilityDate:'2026-11-16',d1Databases:['DB']}));
try {
 const db=await mf.getD1Database('DB');
 for (const name of ['0001_access_foundation.sql','0002_sessions.sql','0004_connections.sql','0006_identity.sql','0007_dropbox_connections.sql','0008_dropbox_oauth_pending.sql']) {
  const sql=await readFile(new URL(`../deploy/cloudflare-native/migrations/${name}`,import.meta.url),'utf8');
  for (const statement of sql.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
 }
 await db.batch([db.prepare("INSERT INTO users(id,username) VALUES('alice','alice')"),db.prepare("INSERT INTO external_identities VALUES('google','google-subject','alice')")]);
 const response=await mf.dispatchFetch('http://localhost/test'); assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{dropbox:{listing:{entries:[{type:'file',name:'Ảnh',path:'/Ảnh',size:2}],nextCursor:null},status:200,body:'ok'},dropV2:{created:201,entries:[{type:'file',name:'Ảnh',path:'/Ảnh',size:2}],upload:201,uploadedData:{name:'new.txt',path:'/new.txt',size:3},removed:200,refresh:200,oauth:201,oauthList:200},browser:{finish:303,location:'/',me:200,logout:200,after:401},start:200,finish:200,me:{id:'alice'},connections:200,connectionListed:true,drive:200,listing:{files:[{id:'f',name:'My file',mimeType:'text/plain'}],nextPageToken:null},rangeResult:{status:206,range:'bytes 2-4/6',body:'cde'},exportResult:{status:200,body:'pdf'},disconnect:200,disconnected:{ok:true,providerRevoked:false},driveAfter:404,logout:200,after:401,replay:400});
 console.log('Experimental Google login workerd and D1 emulator tests passed');
} finally {await mf.dispose();}
