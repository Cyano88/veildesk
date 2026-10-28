import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createRelay} from '../src/relay.mjs';
import {identity} from '../src/envelope.mjs';
import {signingIdentity} from '../src/authenticated.mjs';
import {relayClient,submitPrivateJob} from '../src/client.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
test('private paid capability is hidden and rejects outsiders while public validation stays available',async()=>{
 const key=await identity(),signer=await signingIdentity();
 const provider={id:'provider',encryptionKey:key.publicKey,signingKey:signer.publicKey,capabilities:['public','private'],capabilityClients:{private:['buyer']}};
 const config={database:':memory:',providers:[provider],principals:['provider','buyer','other'].map(id=>({id,role:id==='provider'?'provider':'client',tokenHash:hash(id.repeat(40))}))};
 for(const clients of [[],['missing'],['buyer','buyer']])assert.throws(()=>createRelay({...config,providers:[{...provider,capabilityClients:{private:clients}}]}),/enrollment/);
 const relay=createRelay(config);relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');
 try{
  const rpc=id=>relayClient({url:`http://127.0.0.1:${relay.server.address().port}`,token:id.repeat(40),allowLoopback:true});
  assert.deepEqual((await rpc('other')('/v1/providers')).providers[0].capabilities,['public']);
  const visible=(await rpc('buyer')('/v1/providers')).providers[0];
  assert.deepEqual(visible.capabilities,['public','private']);assert.equal(visible.capabilityClients,undefined);
  const submit=(id,capability)=>submitPrivateJob(rpc(id),{id:randomUUID(),provider,capability,expiresAt:Date.now()+60000,payload:{},signer});
  await assert.rejects(submit('other','private'),e=>e.status===403);
  assert.equal((await submit('other','public')).state,'queued');
  assert.equal((await submit('buyer','private')).state,'queued');
 }finally{await relay.close();}
});
