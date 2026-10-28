import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {once} from 'node:events';
import {createRelay} from '../src/relay.mjs';
test('public walkthrough is allowlisted while relay API remains authenticated; video supports seeking',async()=>{
 const relay=createRelay({database:':memory:',providers:[],principals:[{id:'buyer',role:'client',tokenHash:createHash('sha256').update('c'.repeat(40)).digest('hex')}]});
 relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');const base='http://127.0.0.1:'+relay.server.address().port;
 try{
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await page.text(),/Both endpoints run in your browser/);
  for(const [path,type] of [['/favicon.svg','image/svg+xml'],['/favicon.png','image/png'],['/brand/polydesk.svg','image/svg+xml'],['/brand/zcash.svg','image/svg+xml'],['/brand/okx-ai.png','image/png']]){const asset=await fetch(base+path);assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),type);assert.ok((await asset.arrayBuffer()).byteLength>100);}
  const api=await fetch(base+'/v1/providers');assert.equal(api.status,401);
  for(const path of ['/private/client.json','/src/paid-provider.mjs','/%2e%2e/private/client.json','/web/demo.mp4','/__proto__'])assert.notEqual((await fetch(base+path)).status,200,path);
  assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
  const head=await fetch(base+'/demo.mp4',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),'video/mp4');assert.ok(Number(head.headers.get('content-length'))>1000);assert.equal((await head.arrayBuffer()).byteLength,0);
  const range=await fetch(base+'/demo.mp4',{headers:{Range:'bytes=0-63'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,64);assert.match(range.headers.get('content-range'),/^bytes 0-63\//);
  for(const range of ['bytes=4-1','bytes=999999999999-','bytes=0-1,4-5'])assert.equal((await fetch(base+'/demo.mp4',{headers:{Range:range}})).status,416);
  const evidence=await (await fetch(base+'/evidence/mainnet-pilot.json')).json();assert.equal(evidence.acceptance.network,'main');assert.equal(evidence.acceptance.reportBytes,11784);assert.equal(evidence.acceptance.tradeSubmitted,false);
  for(const field of ['txid','address','memo','privateKey','token'])assert.equal(Object.hasOwn(evidence.acceptance,field),false);
 }finally{await relay.close();}
});
