import {backupPayments,restorePayments} from '../src/payment-backup.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,cp} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {once} from 'node:events';import {randomUUID,createHash} from 'node:crypto';
import {createRelay} from '../src/relay.mjs';import {createMandateClient} from '../src/mandate-client.mjs';import {relayClient} from '../src/client.mjs';import {loadEndpointIdentity} from '../src/endpoint-identity.mjs';import {createPaidProvider,PAID_CAPABILITY} from '../src/paid-provider.mjs';import {sealSigned} from '../src/authenticated.mjs';
async function identity(){async function pair(name,usage){const k=await crypto.subtle.generateKey({name,namedCurve:'P-256'},true,usage);return {privateKey:await crypto.subtle.exportKey('jwk',k.privateKey),publicKey:Buffer.from(await crypto.subtle.exportKey('raw',k.publicKey)).toString('base64')}}return {encryption:await pair('ECDH',['deriveBits']),signing:await pair('ECDSA',['sign','verify'])}}
const txid='a'.repeat(64),blockhash='b'.repeat(64),account='00000000-0000-4000-8000-000000000002';
async function setup(){
 const directory=await mkdtemp(join(tmpdir(),'veildesk-paid-')),clientIdentity=await identity(),providerIdentity=await identity();let now=Date.now();
 const provider={id:'provider',encryptionKey:providerIdentity.encryption.publicKey,signingKey:providerIdentity.signing.publicKey,capabilities:[PAID_CAPABILITY]};
 const relay=createRelay({database:join(directory,'relay.db'),principals:[{id:'client',role:'client',tokenHash:createHash('sha256').update('c'.repeat(40)).digest('hex')},{id:'provider',role:'provider',tokenHash:createHash('sha256').update('p'.repeat(40)).digest('hex')}],providers:[provider],now:()=>now});relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');const url=`http://127.0.0.1:${relay.server.address().port}`;
 const client=await createMandateClient({config:{url,allowLoopback:true,token:'c'.repeat(40),identity:clientIdentity,provider,capability:PAID_CAPABILITY,maxPaymentZat:'1000000'},stateDirectory:join(directory,'client')});
 const rpc=relayClient({url,allowLoopback:true,token:'p'.repeat(40)});
 const chain={chain:'test',blocks:100,estimatedheight:100,verificationprogress:1,bestblockhash:blockhash,consensus:{chaintip:'5437f330'}};const status={locked:false,node_tip:{height:100,blockhash},wallet_tip:{height:100,blockhash},fully_synced_height:100};
 const view={txid,status:'mined',confirmations:3,blockhash,outputs:[]};const raw={txid,version:5,height:98,confirmations:3,blockhash,vin:[],vout:[],vjoinsplit:[],vShieldedSpend:[],vShieldedOutput:[],orchard:{actions:[{}],flags:{enableSpends:true,enableOutputs:true}}};
 const recipientRecord={account_uuid:account,addresses:[{ua:'testnet-fixture-recipient'}]};
 const nodeRpc=async method=>({getblockchaininfo:chain,getrawtransaction:raw,getblockhash:raw.blockhash})[method],walletRpc=async method=>({getwalletstatus:status,z_viewtransaction:view,z_getaccount:recipientRecord})[method];
 const context={database:join(directory,'payments.db'),network:'test',account,address:'testnet-fixture-recipient',amount:'0.01',nodeRpc,walletRpc,...await loadEndpointIdentity(providerIdentity),peers:{client:{encryptionKey:clientIdentity.encryption.publicKey,signingKey:clientIdentity.signing.publicKey}},now:()=>now};
 let paid=createPaidProvider(context);
 const id=randomUUID(),mandate={schema:'veildesk.mandate.v1',id,mode:'dry_run',market:'private-payment-fixture',side:'YES',maxSpendUsd:'5.00',limitPrice:'0.5',expiresAt:now+600000,approval:'preview_only'};
 await client.submit(mandate);const {job}=await rpc('/v1/provider/claim',{method:'POST',body:{}});
 return {client,rpc,job,chain,status,view,raw,context,recipientRecord,clientRpc:relayClient({url,allowLoopback:true,token:'c'.repeat(40)}),makeClient:maxPaymentZat=>createMandateClient({config:{url,allowLoopback:true,token:'c'.repeat(40),identity:clientIdentity,provider,capability:PAID_CAPABILITY,maxPaymentZat},stateDirectory:join(directory,'client')}),process:(j=job,r=rpc)=>paid.process(j,{rpc:r}),restart:()=>{paid.close();paid=createPaidProvider(context)},advance:n=>now+=n,
  async restoreClient(){const stateDirectory=join(directory,'restored-client');await cp(join(directory,'client'),stateDirectory,{recursive:true,errorOnExist:true,force:false});return createMandateClient({config:{url,allowLoopback:true,token:'c'.repeat(40),identity:clientIdentity,provider,capability:PAID_CAPABILITY,maxPaymentZat:'1000000'},stateDirectory})},
  async restoreSnapshot(){await backupPayments(context.database,join(directory,'snapshot'));paid.close();const restored=await restorePayments(join(directory,'snapshot'),join(directory,'restored'));context.database=restored.database;paid=createPaidProvider(context);return restored},
  async fund(){await paid.process(job,{rpc});const quote=(await client.get(id)).payment;view.outputs=[{pool:'orchard',action:0,account_uuid:account,address:quote.invoice.address,outgoing:false,walletInternal:false,valueZat:Number(quote.invoice.amountZat),memo:Buffer.from(quote.invoice.memo).toString('hex').padEnd(1024,'0')}];await client.submitPaymentHint(id,txid);return (await rpc('/v1/provider/pending')).jobs[0]},
  close:async()=>{paid.close();await relay.close();await rm(directory,{recursive:true,force:true})}};
}

test('paid HTTP lifecycle: signed invoice, encrypted tx hint, durable verified receipt, no trading authority (wallet fixtures)',async()=>{
 const f=await setup();try{
  assert.equal((await f.process()).state,'awaiting_payment');const initial=await f.client.get(f.job.id);assert.equal(initial.state,'processing');assert.equal(initial.payment.network,'test');
  const job=await f.fund();await f.client.submitPaymentHint(f.job.id,txid);await assert.rejects(f.client.submitPaymentHint(f.job.id,'d'.repeat(64)),/different contents/);
  f.restart();await f.process(job);const done=await f.client.get(job.id);assert.equal(done.state,'completed');assert.equal(done.result.payload.paymentVerified,true);assert.equal(done.result.payload.payment.txid,txid);assert.equal(done.result.executionAuthorized,false);assert.equal(done.result.payload.tradeSubmitted,false);
  // If delivery succeeded but its HTTP response was lost, exact replay remains idempotent.
  assert.equal((await f.process(job)).state,'completed');assert.deepEqual((await f.client.get(job.id)).result,done.result);
 }finally{await f.close()}
});
test('sync-locked wallet cannot issue an actionable invoice',async()=>{
 const f=await setup();try{f.status.locked=true;await assert.rejects(f.process(),/synced/);assert.equal((await f.client.get(f.job.id)).payment,undefined)}finally{await f.close()}
});
test('missing, wrong-value, unconfirmed and unsupported-format evidence cannot deliver',async()=>{
 for(const mutate of [f=>f.view.outputs=[],f=>f.view.outputs[0].valueZat++,f=>f.raw.confirmations=0,f=>f.raw.version=6]){
  const f=await setup();try{const job=await f.fund();mutate(f);try{const r=await f.process(job);assert.notEqual(r.state,'completed')}catch(error){assert.match(error.message,/confirmed|Unsupported/)}assert.equal((await f.client.get(job.id)).state,'processing')}finally{await f.close()}
 }
});
test('late and duplicate notes enter review without completing the mandate',async()=>{
 for(const duplicate of [false,true]){
  const f=await setup();try{const job=await f.fund();if(duplicate)f.view.outputs.push({...f.view.outputs[0],action:1});else f.advance(600001);const r=await f.process(job);assert.equal(r.state,'payment_review');assert.equal((await f.client.get(job.id)).state,'processing')}finally{await f.close()}
 }
});
test('saved result is rechecked after delivery timeout; reorg stays in review across restart',async()=>{
 const f=await setup();try{
  const job=await f.fund();let deliverAttempts=0;
  const disconnected=async(path,options)=>{if(path==='/v1/provider/deliver'){deliverAttempts++;throw Error('Transport timeout')}return f.rpc(path,options)};
  await assert.rejects(f.process(job,disconnected),/timeout/);assert.equal(deliverAttempts,1);
  f.raw.blockhash=f.view.blockhash='c'.repeat(64);f.restart();assert.equal((await f.process(job)).reason,'reorg_review');assert.equal((await f.client.get(job.id)).paymentReview.reason,'reorg_review');
  f.raw.blockhash=f.view.blockhash=blockhash;assert.equal((await f.process(job)).state,'payment_review');assert.equal((await f.client.get(job.id)).state,'processing');
 }finally{await f.close()}
});

test('unknown upgrade refuses invoicing even when synced',async()=>{
 const f=await setup();try{f.chain.consensus.chaintip='ffffffff';await assert.rejects(f.process(),/unsupported/);assert.equal((await f.client.get(f.job.id)).payment,undefined)}finally{await f.close()}
});

test('NU7 Ironwood receipt completes an authenticated paid mandate (synthetic wallet evidence)',async()=>{
 const f=await setup();try{
  f.chain.consensus.chaintip='77190ad9';const job=await f.fund();
  f.view.version=6;f.view.outputs[0].pool='ironwood';f.raw.version=6;f.raw.versiongroupid='d884b698';f.raw.ironwood=f.raw.orchard;delete f.raw.orchard;
  f.restart();assert.equal((await f.process(job)).state,'completed');
  const result=(await f.client.get(job.id)).result;assert.equal(result.payload.payment.noteId,txid+':ironwood:0');assert.equal(result.executionAuthorized,false);
 }finally{await f.close()}
});
test('client amount cap and payment-hint signer are enforced',async()=>{
 const f=await setup();try{
  await f.process();const limited=await f.makeClient('1');await assert.rejects(limited.get(f.job.id),/authorization/);
  const quote=(await f.client.get(f.job.id)).payment;
  const bad=await sealSigned({schema:'veildesk.payment-hint.v1',provider:f.job.provider,capability:PAID_CAPABILITY,invoiceHash:quote.invoiceHash,mandateHash:quote.mandateHash,txid},{signer:f.context.signer,recipientPublicKey:f.context.recipient.publicKey,id:f.job.id,direction:'request'});
  await f.clientRpc('/v1/jobs/'+f.job.id+'/payment',{method:'POST',body:{envelope:bad}});
  const job=(await f.rpc('/v1/provider/pending')).jobs[0];await assert.rejects(f.process(job),/authentication/);assert.equal((await f.client.get(job.id)).state,'processing');
 }finally{await f.close()}
});
test('concurrent paid workers cannot replace a reserved result or consume a note twice',async()=>{
 const f=await setup();try{
  const job=await f.fund();const runs=await Promise.allSettled([f.process(job),f.process(job)]);assert.ok(runs.some(r=>r.status==='fulfilled'&&r.value.state==='completed'));assert.equal((await f.client.get(job.id)).result.payload.paymentVerified,true);
 }finally{await f.close()}
});



test('untracked recipient cannot issue or republish an invoice',async()=>{
 for(const existing of [false,true]){
  const f=await setup();try{
   if(existing)await f.process();
   f.recipientRecord.addresses=[];
   let publications=0;
   const rpc=async(path,options)=>{if(path==='/v1/provider/invoice')publications++;return f.rpc(path,options)};
   await assert.rejects(f.process(f.job,rpc),/not a unified address/);assert.equal(publications,0);
   if(!existing)assert.equal((await f.client.get(f.job.id)).payment,undefined);
  }finally{await f.close()}
 }
});


test('restored payment snapshot preserves saved ciphertext and rechecks finality before retry',async()=>{
 for(const reorg of [false,true]){
  const f=await setup();try{
   const job=await f.fund();let original;
   const lost=async(path,options)=>{if(path==='/v1/provider/deliver'){original=options.body.envelope;throw Error('delivery lost')}return f.rpc(path,options)};
   await assert.rejects(f.process(job,lost),/delivery lost/);
   const restored=await f.restoreSnapshot();assert.equal(restored.notes,1);assert.equal(restored.jobs,1);assert.equal(restored.automaticResume,false);
   if(reorg){f.raw.blockhash=f.view.blockhash='c'.repeat(64);assert.equal((await f.process(job)).reason,'reorg_review');assert.equal((await f.client.get(job.id)).state,'processing')}
   else {let retried;await f.process(job,async(path,options)=>{if(path==='/v1/provider/deliver')retried=options.body.envelope;return f.rpc(path,options)});assert.deepEqual(retried,original);assert.equal((await f.client.get(job.id)).state,'completed')}
  }finally{await f.close()}
 }
});

test('restored uncertain payment reservation never automatically recreates a result',async()=>{
 const f=await setup();try{
  const job=await f.fund(),key=f.context.signer.privateKey;f.context.signer.privateKey=null;
  await assert.rejects(f.process(job));f.context.signer.privateKey=key;
  await f.restoreSnapshot();await assert.rejects(f.process(job),/pending reconciliation/);
  assert.equal((await f.client.get(job.id)).state,'processing');
 }finally{await f.close()}
});


test('restored client outbox retains mandate and payment-hint binding',async()=>{
 const f=await setup();try{
  const job=await f.fund(),restored=await f.restoreClient();
  assert.deepEqual((await restored.get(job.id)).payment,(await f.client.get(job.id)).payment);
  await restored.submitPaymentHint(job.id,txid);
  await assert.rejects(restored.submitPaymentHint(job.id,'d'.repeat(64)),/different contents/);
  await f.process(job);assert.deepEqual((await restored.get(job.id)).result,(await f.client.get(job.id)).result);
 }finally{await f.close()}
});
