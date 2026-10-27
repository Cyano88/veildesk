import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {once} from 'node:events';
import {identity} from '../src/envelope.mjs';import {signingIdentity} from '../src/authenticated.mjs';import {createRelay} from '../src/relay.mjs';import {relayClient,preparePrivateJob,sealPrivateResult,openPrivateResult} from '../src/client.mjs';
async function fixture(options={}){
 const dir=await mkdtemp(join(tmpdir(),'veildesk-faults-')),recipient=await identity(),signer=await signingIdentity();let clock=Date.now();
 const provider={id:'provider',encryptionKey:recipient.publicKey,signingKey:signer.publicKey,capabilities:['prediction.mandate.validate.v1']};
 const principals=[['client','client','c'],['provider','provider','p'],['foreign','provider','f']].map(([id,role,token])=>({id,role,tokenHash:createHash('sha256').update(token.repeat(40)).digest('hex')}));
 const relay=createRelay({database:join(dir,'jobs.db'),principals,providers:[provider,{...provider,id:'foreign'}],now:()=>clock,...options});relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');const url=`http://127.0.0.1:${relay.server.address().port}`;
 const rpc=t=>relayClient({url,token:t.repeat(40),allowLoopback:true});
 return {url,rpc,provider,signer,recipient,advance:n=>clock+=n,request:()=>preparePrivateJob({id:randomUUID(),provider,capability:provider.capabilities[0],expiresAt:clock+30000,payload:{preview:true},signer}),close:async()=>{await relay.close();await rm(dir,{recursive:true,force:true})}};
}
test('concurrent claims acquire once, canonical retries succeed, changed job and foreign provider are rejected',async()=>{
 const f=await fixture();try{
  const b=await f.request();await f.rpc('c')('/v1/jobs',{method:'POST',body:b});
  const reordered=Object.fromEntries(Object.entries(b).reverse());assert.equal((await f.rpc('c')('/v1/jobs',{method:'POST',body:reordered})).id,b.id);
  await assert.rejects(f.rpc('c')('/v1/jobs',{method:'POST',body:{...b,expiresAt:b.expiresAt+1}}),e=>e.status===409);
  const claims=await Promise.all(Array.from({length:20},()=>f.rpc('p')('/v1/provider/claim',{method:'POST',body:{}})));assert.equal(claims.filter(x=>x.job).length,1);
  assert.equal((await f.rpc('f')('/v1/provider/pending')).jobs.length,0);assert.equal((await f.rpc('f')('/v1/provider/claim',{method:'POST',body:{}})).job,null);
  const job=claims.find(x=>x.job).job,response=await sealPrivateResult(job,{status:'validated'},{signer:f.signer,recipientPublicKey:f.recipient.publicKey});
  await assert.rejects(f.rpc('f')('/v1/provider/deliver',{method:'POST',body:{client:'client',id:b.id,envelope:response}}),e=>e.status===404);
  const wrong=await signingIdentity();await assert.rejects(openPrivateResult({...job,envelope:response},{recipient:f.recipient,expectedSigner:wrong.publicKey}),/authentication/);
 }finally{await f.close()}
});
test('expired queued work is never claimed; claimed late work is visible and never authorizes execution',async()=>{
 const f=await fixture();try{
  const b=await f.request();await f.rpc('c')('/v1/jobs',{method:'POST',body:b});f.advance(31000);assert.equal((await f.rpc('c')('/v1/jobs/'+b.id)).state,'expired');assert.equal((await f.rpc('p')('/v1/provider/claim',{method:'POST',body:{}})).job,null);
  const next=await f.request();await f.rpc('c')('/v1/jobs',{method:'POST',body:next});const {job}=await f.rpc('p')('/v1/provider/claim',{method:'POST',body:{}});f.advance(31000);
  assert.equal((await f.rpc('p')('/v1/provider/claim',{method:'POST',body:{}})).job,null);
  const envelope=await sealPrivateResult(job,{status:'rejected'},{signer:f.signer,recipientPublicKey:f.recipient.publicKey});const result=await f.rpc('p')('/v1/provider/deliver',{method:'POST',body:{client:'client',id:job.id,envelope}});assert.equal(result.late,true);assert.equal(result.executionAuthorized,false);assert.equal((await f.rpc('c')('/v1/jobs/'+job.id)).late,true);
 }finally{await f.close()}
});
test('body, pending and total record quotas fail closed without deleting replay history',async()=>{
 const f=await fixture({maxPending:1,maxRecords:1});try{
  await assert.rejects(f.rpc('p')('/v1/provider/claim',{method:'POST',body:[]}),e=>e.status===400);
  await assert.rejects(f.rpc('c')('/v1/jobs',{method:'POST',body:{padding:'x'.repeat(17000)}}),e=>e.status===413);
  const b=await f.request();await f.rpc('c')('/v1/jobs',{method:'POST',body:b});await assert.rejects(f.rpc('c')('/v1/jobs',{method:'POST',body:await f.request()}),e=>e.status===503);
  f.advance(31000);assert.equal((await f.rpc('c')('/v1/jobs',{method:'POST',body:b})).state,'expired');
  await assert.rejects(f.rpc('c')('/v1/jobs',{method:'POST',body:await f.request()}),e=>e.status===503);
 }finally{await f.close()}
 const p=await fixture({maxPending:1});try{await p.rpc('c')('/v1/jobs',{method:'POST',body:await p.request()});await assert.rejects(p.rpc('c')('/v1/jobs',{method:'POST',body:await p.request()}),e=>e.status===429)}finally{await p.close()}
});
test('per-principal request limits reset after a window, and unauthenticated requests reveal nothing',async()=>{
 const f=await fixture({maxRequestsPerMinute:2});try{
  await f.rpc('c')('/v1/providers');await f.rpc('c')('/v1/providers');await assert.rejects(f.rpc('c')('/v1/providers'),e=>e.status===429);
  await f.rpc('p')('/v1/providers');f.advance(60000);await f.rpc('c')('/v1/providers');
  const r=await fetch(f.url+'/v1/providers');assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'Unauthorized'});
 }finally{await f.close()}
});

test('pending cursors reach beyond 100 jobs without leaking another provider queue',async()=>{
 const f=await fixture({maxRequestsPerMinute:10000});try{
  const ids=new Set();for(let n=0;n<105;n++){const b=await f.request();await f.rpc('c')('/v1/jobs',{method:'POST',body:b});ids.add((await f.rpc('p')('/v1/provider/claim',{method:'POST',body:{}})).job.id)}
  const seen=new Set();let cursor=null,pages=0;
  do{const page=await f.rpc('p')('/v1/provider/pending?limit=20'+(cursor?'&after='+cursor:''));pages++;for(const j of page.jobs){assert.ok(ids.has(j.id));assert.ok(!seen.has(j.id));seen.add(j.id)}cursor=page.nextCursor}while(cursor);
  assert.equal(pages,6);assert.equal(seen.size,105);assert.equal((await f.rpc('f')('/v1/provider/pending?limit=20')).jobs.length,0);
  for(const q of ['limit=0','limit=101','limit=1&limit=2','after=bad','unknown=1'])await assert.rejects(f.rpc('p')('/v1/provider/pending?'+q),e=>e.status===400);
 }finally{await f.close()}
});

test('oversized and stalled uploads are rejected before the sender finishes',async()=>{
 const {request}=await import('node:http');const f=await fixture({bodyTimeoutMs:150});
 async function unfinished(headers,chunk,expected){
  let req;try{
   const result=await new Promise((resolve,reject)=>{
    req=request(f.url+'/v1/jobs',{method:'POST',headers:{Authorization:'Bearer '+'c'.repeat(40),...headers}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,connection:res.headers.connection,body:JSON.parse(text)}))});
    req.on('error',reject);req.setTimeout(2000,()=>req.destroy(Error('Server waited for upload completion')));req.write(chunk);
   });assert.equal(result.status,expected);assert.equal(result.connection,'close');
  }finally{req?.destroy()}
 }
 try{
  await unfinished({'Content-Length':'1000000'},'{',413);
  await unfinished({'Transfer-Encoding':'chunked'},'x'.repeat(17000),413);
  await unfinished({'Content-Length':'100'},'{',408);
  const b=await f.request();assert.equal((await f.rpc('c')('/v1/jobs',{method:'POST',body:b})).state,'queued');
 }finally{await f.close()}
});
