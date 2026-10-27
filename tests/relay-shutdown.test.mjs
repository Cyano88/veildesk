import test from 'node:test';import assert from 'node:assert/strict';import {request} from 'node:http';import {once} from 'node:events';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {createRelay} from '../src/relay.mjs';import {identity} from '../src/envelope.mjs';import {signingIdentity} from '../src/authenticated.mjs';import {preparePrivateJob,relayClient} from '../src/client.mjs';
test('shutdown drains an accepted upload, bounds a stalled connection and preserves committed work',{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'veildesk-drain-')),token='c'.repeat(40),recipient=await identity(),signer=await signingIdentity();let relay,first,stalled,closing;
 const provider={id:'provider',encryptionKey:recipient.publicKey,signingKey:signer.publicKey,capabilities:['prediction.mandate.validate.v1']};
 const config={database:join(dir,'relay.db'),principals:[{id:'client',role:'client',tokenHash:createHash('sha256').update(token).digest('hex')},{id:'provider',role:'provider',tokenHash:'a'.repeat(64)}],providers:[provider]};
 async function start(){relay=createRelay(config);relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');return 'http://127.0.0.1:'+relay.server.address().port}
 try{
  const url=await start(),body=await preparePrivateJob({id:randomUUID(),provider,capability:provider.capabilities[0],expiresAt:Date.now()+60000,payload:{private:'shutdown-fixture'},signer}),json=JSON.stringify(body),half=Math.floor(json.length/2);
  let seen=0;const received=new Promise(resolve=>relay.server.on('request',()=>{if(++seen===2)resolve()}));
  const response=new Promise((resolve,reject)=>{first=request(url+'/v1/jobs',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Length':Buffer.byteLength(json)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});first.on('error',reject);first.write(json.slice(0,half))});
  stalled=request(url+'/v1/jobs',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Length':'100'}},res=>res.resume());stalled.on('error',()=>{});stalled.write('{');
  await received;const started=performance.now();closing=relay.close();await delay(50);first.end(json.slice(half));assert.equal(await response,201);await closing;closing=null;relay=null;
  assert.ok(performance.now()-started<7500,'shutdown must bound stalled sockets');
  const restarted=await start(),rpc=relayClient({url:restarted,token,allowLoopback:true});assert.equal((await rpc('/v1/jobs/'+body.id)).state,'queued');assert.equal((await rpc('/v1/jobs',{method:'POST',body})).id,body.id);
 }finally{first?.destroy();stalled?.destroy();if(closing)await closing;else if(relay)await relay.close();await rm(dir,{recursive:true,force:true})}
});
