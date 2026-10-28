import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createRelay} from '../src/relay.mjs';
import {checkMarketplaceSurface} from '../src/marketplace-surface.mjs';

test('integration package is public without exposing enrolled provider access',async()=>{
 const relay=createRelay({database:':memory:',providers:[],principals:[{id:'buyer',role:'client',tokenHash:createHash('sha256').update('b'.repeat(40)).digest('hex')}]});
 relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');
 const base='http://127.0.0.1:'+relay.server.address().port;
 try{
  const report=await checkMarketplaceSurface({fetchImpl:(url,options)=>{
   assert.equal(new URL(url).origin,'https://veildesk-relay.onrender.com');
   assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);
   return fetch(base+new URL(url).pathname,options);
  }});
  assert.equal(report.publicIntegrationSurfaceReady,true,JSON.stringify(report));
  assert.equal(report.marketplaceReadiness,'not-established');
  const manifest=await (await fetch(base+'/agent-integration.json')).json();
  assert.equal(manifest.settlement.marketplaceNativeCheckout,false);
  assert.equal(manifest.marketplace.okxListed,false);
  assert.equal(manifest.capabilities.find(c=>c.id==='polydesk.research.mainnet-paid.v1').access,'restricted-pilot');
  const serialized=JSON.stringify(manifest);assert.doesNotMatch(serialized,/"(?:token|privateKey|seed|mnemonic|txid|memo)"/);
  assert.equal((await fetch(base+'/agent-integration.json',{method:'POST'})).status,405);
 }finally{await relay.close();}
});

test('probe fails closed on missing resources, exposed discovery, bad JSON and oversized responses',async()=>{
 const manifest=await readFile(new URL('../web/agent-integration.json',import.meta.url),'utf8');
 const spec=await readFile(new URL('../web/openapi.json',import.meta.url),'utf8');
 const replies={'/':['VeilDesk','text/html',200],'/agent-integration.json':[manifest,'application/json',200],'/agent-integration.md':['Do not send plaintext briefs','text/markdown',200],'/openapi.json':[spec,'application/json',200],'/v1/providers':['{}','application/json',401]};
 for(const [path,override] of [
  ['/agent-integration.json',['{}','application/json',404]],
  ['/v1/providers',['{}','application/json',200]],
  ['/agent-integration.json',['bad JSON','application/json',200]],
  ['/openapi.json',['x'.repeat(131073),'application/json',200]],
 ]){
  const report=await checkMarketplaceSurface({fetchImpl:async url=>{const p=new URL(url).pathname;const [body,type,status]=p===path?override:replies[p];return new Response(body,{status,headers:{'Content-Type':type}});}});
  assert.equal(report.publicIntegrationSurfaceReady,false);assert.equal(report.marketplaceReadiness,'not-established');
  assert.equal(report.checks.find(c=>c.path===path).ok,false);
  assert.doesNotMatch(JSON.stringify(report),/bad JSON|xxxxxxxx/);
 }
});
