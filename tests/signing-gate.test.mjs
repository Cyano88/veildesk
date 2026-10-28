import test from 'node:test';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {signingIdentity} from '../src/authenticated.mjs';import {createSigningGate,signAuthorization} from '../src/signing-gate.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'veildesk-signing-')),agent=await signingIdentity(),message=Buffer.from('strictly-decoded-test-message');let calls=0,time=Date.now();
 const policy={customer:'customer',sourceAccount:'customer-token-account',mint:'usdc',decimals:6,maxTotalUnits:'21000000',maxFeeLamports:'5000',recipients:['merchant','treasury'],signingKey:agent.publicKey};
 const a={schema:'veildesk.sponsor-transfer.v1',id:randomUUID(),agent:'buyer',network:'solana:devnet',sponsor:'sponsor',customer:policy.customer,sourceAccount:policy.sourceAccount,mint:policy.mint,decimals:6,transfers:[{recipientAccount:'merchant',amountUnits:'20700000'},{recipientAccount:'treasury',amountUnits:'522'}],messageHash:hash(message),maxFeeLamports:'5000',expiresAt:time+60000};
 const options={database:join(dir,'gate.db'),network:a.network,sponsor:a.sponsor,agents:{buyer:policy},now:()=>time,
 inspectTransaction:async wire=>({message:wire,feePayer:a.sponsor,customer:a.customer,customerSigned:true,sourceAccount:a.sourceAccount,mint:a.mint,decimals:a.decimals,transfers:a.transfers}),
 quoteFee:async wire=>({network:a.network,messageHash:hash(wire),lamports:'5000',checkedAt:time,blockhashValid:true}),signMessage:async bytes=>{calls++;assert.deepEqual(bytes,message);return Buffer.alloc(64,7);}};
 return {dir,agent,message,policy,a,options,calls:()=>calls,advance:n=>time+=n,input:async changes=>({signed:await signAuthorization({...a,...changes},agent),transaction:message.toString('base64')}),close:()=>rm(dir,{recursive:true,force:true})};
}

test('gate signs once, persists replay across restart and refuses changed ID reuse',async()=>{const f=await fixture();let gate=createSigningGate(f.options);try{assert.throws(()=>createSigningGate({...f.options,database:':memory:'}),/durable/);const input=await f.input();const first=await gate.authorizeAndSign(input);assert.equal(first.replayed,false);assert.equal(first.broadcast,false);gate.close();gate=createSigningGate(f.options);assert.equal((await gate.authorizeAndSign(input)).signature,first.signature);assert.equal(f.calls(),1);await assert.rejects(gate.authorizeAndSign(await f.input({maxFeeLamports:'4999'})),/conflict/);assert.equal(f.calls(),1);}finally{gate.close();await f.close();}});

test('agent identity, sponsor separation, asset, network, amount, recipient and expiration fail before signing',async()=>{const f=await fixture(),gate=createSigningGate(f.options);try{
 for(const change of [{customer:'sponsor'},{sourceAccount:'sponsor-token-account'},{network:'solana:mainnet-beta'},{mint:'other-token'},{transfers:[{recipientAccount:'attacker',amountUnits:'20700000'}]},{transfers:[{recipientAccount:'merchant',amountUnits:'21000001'}]},{expiresAt:0},{maxFeeLamports:'5001'},{messageHash:'0'.repeat(64)},{unexpected:true}])await assert.rejects(gate.authorizeAndSign(await f.input(change)));
 const input=await f.input();input.signed=await signAuthorization(f.a,await signingIdentity());await assert.rejects(gate.authorizeAndSign(input),/signature/);assert.equal(f.calls(),0);
}finally{gate.close();await f.close();}});

test('actual message summary must match approved instructions; fee and freshness failures block signing',async()=>{const f=await fixture();try{
 for(const change of [{feePayer:'attacker'},{customerSigned:false},{transfers:[{recipientAccount:'attacker',amountUnits:'20700000'}]},{mint:'wrong-mint'}]){const inspect=f.options.inspectTransaction;const gate=createSigningGate({...f.options,inspectTransaction:async b=>({...await inspect(b),...change})});try{await assert.rejects(gate.authorizeAndSign(await f.input()),/match/);}finally{gate.close();}}
 for(const change of [{lamports:'5001'},{blockhashValid:false},{checkedAt:0},{network:'solana:mainnet-beta'},{messageHash:'0'.repeat(64)}]){const quote=f.options.quoteFee;const gate=createSigningGate({...f.options,quoteFee:async b=>({...await quote(b),...change})});try{await assert.rejects(gate.authorizeAndSign(await f.input()),/quote/);}finally{gate.close();}}
 const gate=createSigningGate({...f.options,quoteFee:async b=>{const q=await f.options.quoteFee(b);f.advance(60000);return {...q,checkedAt:q.checkedAt+60000};}});try{await assert.rejects(gate.authorizeAndSign(await f.input()));}finally{gate.close();}assert.equal(f.calls(),0);
}finally{await f.close();}});

test('concurrent requests reach signer at most once; ambiguous failure survives restart',async()=>{const f=await fixture();let gate,second;try{
 let enter,release,count=0;const entered=new Promise(r=>enter=r),hold=new Promise(r=>release=r);
 const options={...f.options,signMessage:async()=>{count++;enter();await hold;throw Error('Signer response lost');}};
 gate=createSigningGate(options);second=createSigningGate(options);const input=await f.input(),first=gate.authorizeAndSign(input);const rejected=assert.rejects(first,/lost/);await entered;
 await assert.rejects(second.authorizeAndSign(input),/reconciliation/);release();await rejected;gate.close();gate=createSigningGate(options);await assert.rejects(gate.authorizeAndSign(input),/reconciliation/);assert.equal(count,1);
}finally{gate?.close();second?.close();await f.close();}});

test('host callbacks cannot mutate the bytes signed; mutable request fields are snapshotted',async()=>{const f=await fixture();const gate=createSigningGate({...f.options,quoteFee:async bytes=>{const quote=await f.options.quoteFee(bytes);bytes.fill(0);return quote;}});try{
 const input=await f.input();const pending=gate.authorizeAndSign(input);input.signed.body='{}';input.signed.signature='bad';await pending;assert.equal(f.calls(),1);
}finally{gate.close();await f.close();}});
