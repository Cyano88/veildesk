import test from 'node:test';import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';
import {identity} from '../src/envelope.mjs';import {signingIdentity} from '../src/authenticated.mjs';
import {createRelay} from '../src/relay.mjs';import {relayClient,submitPrivateJob,openPrivateJob,sealPrivateResult,openPrivateResult} from '../src/client.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
test('real HTTP encrypted job lifecycle, tenant isolation, durable restart, conflict and authenticated result',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'veildesk-relay-'));let relay;
 try{
  const clientIdentity=await identity(),providerIdentity=await identity(),clientSigner=await signingIdentity(),providerSigner=await signingIdentity();
  const providers=[{id:'provider',encryptionKey:providerIdentity.publicKey,signingKey:providerSigner.publicKey,capabilities:['mandate-preview']}];
  const config={database:join(directory,'relay.db'),providers,principals:[{id:'client',role:'client',tokenHash:hash('c'.repeat(40))},{id:'other',role:'client',tokenHash:hash('o'.repeat(40))},{id:'provider',role:'provider',tokenHash:hash('p'.repeat(40))}]};
  async function start(){relay=createRelay(config);relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');return `http://127.0.0.1:${relay.server.address().port}`}
  let url=await start();const rpc=token=>relayClient({url,token:token.repeat(40),allowLoopback:true});
  const id=randomUUID(),expiresAt=Date.now()+60000;
  const submitted=await submitPrivateJob(rpc('c'),{id,provider:providers[0],capability:'mandate-preview',expiresAt,payload:{secret:'never_write_this_strategy_to_relay'},signer:clientSigner});assert.equal(submitted.state,'queued');
  await assert.rejects(rpc('o')('/v1/jobs/'+id),e=>e.status===404);await assert.rejects(rpc('x')('/v1/providers'),e=>e.status===401);
  await assert.rejects(rpc('c')('/v1/provider/claim',{method:'POST',body:{}}),e=>e.status===403);
  const claimed=await rpc('p')('/v1/provider/claim',{method:'POST',body:{}});assert.equal(claimed.job.client,'client');
  assert.equal((await rpc('p')('/v1/provider/claim',{method:'POST',body:{}})).job,null);
  const payload=await openPrivateJob(claimed.job,{recipient:providerIdentity,expectedSigner:clientSigner.publicKey});assert.equal(payload.secret,'never_write_this_strategy_to_relay');
  await assert.rejects(openPrivateJob({...claimed.job,capability:'trade'},{recipient:providerIdentity,expectedSigner:clientSigner.publicKey}),/rerouted/);
  await relay.close();relay=null;url=await start();assert.equal((await rpc('p')('/v1/provider/pending')).jobs.length,1);
  const envelope=await sealPrivateResult(claimed.job,{status:'validated'},{signer:providerSigner,recipientPublicKey:clientIdentity.publicKey});
  const delivery={client:'client',id,envelope};await rpc('p')('/v1/provider/deliver',{method:'POST',body:delivery});await rpc('p')('/v1/provider/deliver',{method:'POST',body:delivery});
  const result=await rpc('c')('/v1/jobs/'+id);assert.equal(result.state,'completed');assert.equal((await openPrivateResult(result,{recipient:clientIdentity,expectedSigner:providerSigner.publicKey})).payload.status,'validated');
  const changed=await sealPrivateResult(claimed.job,{status:'different'},{signer:providerSigner,recipientPublicKey:clientIdentity.publicKey});await assert.rejects(rpc('p')('/v1/provider/deliver',{method:'POST',body:{...delivery,envelope:changed}}),e=>e.status===409);
  await relay.close();relay=null;assert.equal((await readFile(config.database)).includes(Buffer.from(payload.secret)),false);
 }finally{if(relay)await relay.close();await rm(directory,{recursive:true,force:true})}
});
