import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {setTimeout} from 'node:timers/promises';
import {identity} from '../src/envelope.mjs';import {signingIdentity} from '../src/authenticated.mjs';import {preparePrivateJob,openPrivateResult} from '../src/client.mjs';import {processClaim} from '../src/provider.mjs';
async function setup(){
 const stateDirectory=await mkdtemp(join(tmpdir(),'veildesk-provider-')),recipient=await identity(),client=await identity(),signer=await signingIdentity(),sender=await signingIdentity(),id=randomUUID(),expiresAt=Date.now()+1000;
 const mandate={schema:'veildesk.mandate.v1',id,mode:'dry_run',market:'private-provider-test',side:'YES',maxSpendUsd:'5.00',limitPrice:'0.5',expiresAt,approval:'preview_only'};
 const request=await preparePrivateJob({id,provider:{id:'provider',encryptionKey:recipient.publicKey},capability:'prediction.mandate.validate.v1',expiresAt,payload:mandate,signer:sender});
 return {job:{...request,client:'client',state:'processing',late:false},context:{stateDirectory,recipient,signer,peers:{client:{encryptionKey:client.publicKey,signingKey:sender.publicKey}}},client,cleanup:()=>rm(stateDirectory,{recursive:true,force:true})};
}
test('lost delivery response retries identical persisted ciphertext even after expiry',async()=>{
 const f=await setup();try{
  let sent;
  await assert.rejects(processClaim(f.job,{...f.context,rpc:async(_,{body})=>{sent=body;throw Error('Transport timeout')}}),/timeout/);
  await setTimeout(1100);let retry;
  await processClaim({...f.job,late:true},{...f.context,rpc:async(_,{body})=>{retry=body;return {state:'completed'}}});
  assert.deepEqual(retry,sent);
  assert.equal((await openPrivateResult({...f.job,envelope:retry.envelope},{recipient:f.client,expectedSigner:f.context.signer.publicKey})).payload.status,'validated');
 }finally{await f.cleanup()}
});
test('interrupted provider result creation leaves reconciliation reservation, not automatic re-execution',async()=>{
 const f=await setup();try{
  const context={...f.context,signer:{...f.context.signer,privateKey:null},rpc:async()=>assert.fail('Uncertain work must not deliver')};
  await assert.rejects(processClaim(f.job,context));await assert.rejects(processClaim(f.job,context),/Pending reconciliation/);
 }finally{await f.cleanup()}
});
