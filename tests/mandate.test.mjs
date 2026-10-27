import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {identity,seal} from '../src/envelope.mjs';
import {signingIdentity,sealSigned,openSigned} from '../src/authenticated.mjs';
import {validateMandate,oncePerMandate} from '../src/mandate.mjs';
const mandate=()=>({schema:'veildesk.mandate.v1',id:crypto.randomUUID(),mode:'dry_run',market:'secret-market',side:'YES',maxSpendUsd:'10.00',limitPrice:'0.50',expiresAt:Date.now()+300000,approval:'preview_only'});
test('encrypted mandates authenticate a pinned signer and reject unsigned messages',async()=>{
 const recipient=await identity(),signer=await signingIdentity(),attacker=await signingIdentity(),m=mandate();
 const options={signer,recipientPublicKey:recipient.publicKey,id:m.id,direction:'request'};
 const read={recipient,expectedSigner:signer.publicKey,id:m.id,direction:'request'};
 const e=await sealSigned(m,options);
 assert.deepEqual(await openSigned(e,read),m);
 await assert.rejects(openSigned(await sealSigned(m,{...options,signer:attacker}),read));
 await assert.rejects(openSigned(await seal(m,recipient.publicKey,m.id,'request'),read));
 await assert.rejects(openSigned(e,{...read,direction:'response'}));
});
test('mandates fail closed for live execution, broadened authority and expiry',()=>{
 const m=mandate();assert.equal(validateMandate(m),m);
 for(const patch of [{mode:'live'},{approval:true},{side:'SELL'},{maxSpendUsd:'1e9'},{expiresAt:Date.now()-1},{limitPrice:'1.50'},{privateKey:'secret'}])assert.throws(()=>validateMandate({...m,...patch}));
});
test('durable replay protection survives reuse and detects changed mandate',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'veildesk-test-')),m=mandate();let executions=0;
 const work=async()=>{executions++;return {ciphertext:'test-encrypted-result'}};
 const a=await oncePerMandate(dir,m,work),b=await oncePerMandate(dir,m,work);
 assert.deepEqual(a,b);assert.equal(executions,1);
 await assert.rejects(oncePerMandate(dir,{...m,maxSpendUsd:'20.00'},work));
 for(const file of await readdir(dir))assert.ok(!(await readFile(join(dir,file),'utf8')).includes(m.market));
});
test('concurrent work and crashed reservations cannot execute twice',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'veildesk-test-')),m=mandate();let calls=0,release;
 const pending=oncePerMandate(dir,m,async()=>{calls++;await new Promise(resolve=>release=resolve);return {ciphertext:'test'}});
 while(!release)await new Promise(resolve=>setTimeout(resolve,5));
 await assert.rejects(oncePerMandate(dir,m,async()=>{calls++;return {}}));release();await pending;assert.equal(calls,1);
 const failed=mandate();await assert.rejects(oncePerMandate(dir,failed,async()=>{throw Error('interrupted')}));
 await assert.rejects(oncePerMandate(dir,failed,async()=>{calls++;return {}}));assert.equal(calls,1);
});
