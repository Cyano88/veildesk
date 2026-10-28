import test from 'node:test';import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {once} from 'node:events';
import {createRelay} from '../src/relay.mjs';import {createPaidProvider} from '../src/paid-provider.mjs';import {createLightWalletSettlement} from '../src/settlement.mjs';import {nativePaymentFixture} from './fixtures/native-payment.mjs';import {relayClient} from '../src/client.mjs';
import {createIdentity,createHttpTransport,pinProvider,prepareResearchRequest,encryptMessage,decryptMessage,verifyResult,readResearchReport,verifyResearchInvoice,verifyResearchReceipt} from '../examples/encrypted-http-agent.mjs';
const token=c=>c.repeat(40),digest=x=>createHash('sha256').update(x).digest('hex');
const capability='polydesk.research.testnet-paid.v1',txid='a'.repeat(64),account='00000000-0000-4000-8000-000000000002';
const request=()=>({schema:'veildesk.service-request.v1',service:'polydesk.market-research.v1',input:{marketId:'fixture-market',outcome:'YES',side:'BUY'},disclosure:'polydesk-provider-disclosure-v2',executionAuthorized:false});

test('standalone encrypted HTTP buyer: pinned discovery, paid PolyDesk delivery, attack rejection and durable replay (synthetic chain)',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'veildesk-wire-'));let relay,worker;
 const originalFetch=globalThis.fetch;let external=0;
 globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(u.hostname!=='127.0.0.1'||u.protocol!=='http:'){external++;throw Error('No external calls in acceptance');}return originalFetch(input,options);};
 try{
  const buyer=await createIdentity(),provider=await createIdentity(),attacker=await createIdentity();
  const pin={id:'polydesk',encryptionKey:provider.encryption.publicKey,signingKey:provider.signing.publicKey,capabilities:[capability]};
  const config={database:join(dir,'relay.db'),providers:[{...pin,capabilityClients:{[capability]:['buyer']}}],principals:[['buyer','client','b'],['other','client','o'],['polydesk','provider','p']].map(([id,role,c])=>({id,role,tokenHash:digest(token(c))}))};
  async function start(){relay=createRelay(config);relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');return `http://127.0.0.1:${relay.server.address().port}`;}
  let url=await start(),rpc=createHttpTransport({url,token:token('b'),allowLoopback:true}),other=createHttpTransport({url,token:token('o'),allowLoopback:true});
  let providerRpc=relayClient({url,token:token('p'),allowLoopback:true});
  const discovered=await rpc('/v1/providers');assert.deepEqual(pinProvider(discovered,pin,capability),pin);
  assert.throws(()=>pinProvider(discovered,{...pin,signingKey:attacker.signing.publicKey},capability),/pin/);
  assert.equal((await other('/v1/providers')).providers.length,0);
  const purchase={id:randomUUID(),expiresAt:Date.now()+600000,request:request()};
  const job=await prepareResearchRequest({...purchase,provider:pin,capability,request:purchase.request,signer:buyer.signing});
  await writeFile(join(dir,'outbox.json'),JSON.stringify(job),{flag:'wx',mode:0o600});
  await assert.rejects(other('/v1/jobs',{method:'POST',body:job}),e=>e.status===403);
  await assert.rejects(createHttpTransport({url,allowLoopback:true,token:token('x')})('/v1/providers'),e=>e.status===401);
  await assert.rejects(rpc('/v1/jobs',{method:'POST',body:{...job,request:purchase.request}}),e=>e.status===400);
  await assert.rejects(rpc('/v1/jobs',{method:'POST',body:{...job,envelope:{plaintext:'secret'}}}),e=>e.status===400);
  await assert.rejects(rpc('/v1/jobs',{method:'POST',body:{...job,padding:'x'.repeat(17000)}}),e=>e.status===413);
  assert.equal((await rpc('/v1/jobs',{method:'POST',body:job})).state,'queued');
  assert.equal((await rpc('/v1/jobs',{method:'POST',body:JSON.parse(await readFile(join(dir,'outbox.json'),'utf8'))})).state,'queued');
  await assert.rejects(rpc('/v1/jobs',{method:'POST',body:{...job,expiresAt:job.expiresAt+1}}),e=>e.status===409);
  await assert.rejects(other('/v1/jobs/'+job.id),e=>e.status===404);
  const claimed=(await providerRpc('/v1/provider/claim',{method:'POST',body:{}})).job;
  let calls=0,engine;
  if(process.env.VEILDESK_POLYDESK_ENGINE_FIXTURE){const module=await import(pathToFileURL(process.env.VEILDESK_POLYDESK_ENGINE_FIXTURE).href);engine=module.createEngineTestService();}
  let research=async input=>{calls++;if(engine)return engine.research(input);return {schema:'polydesk-a2a-market-research-v1',researchStatus:'AVAILABLE',opinion:'synthetic private report '.repeat(350),orderAuthorized:false,orderSubmitted:false};};
  if(process.env.VEILDESK_POLYDESK_ADAPTER){const {createVeilDeskResearchService}=await import(pathToFileURL(process.env.VEILDESK_POLYDESK_ADAPTER).href);const run=research;research=createVeilDeskResearchService({runResearch:async input=>({ok:true,data:await run(input)})});}
  const address='synthetic-testnet-recipient',native=nativePaymentFixture({address,txid,now:Date.now});
  const context={database:join(dir,'payments.db'),network:'test',account,address,amount:'0.0002',recipient:provider.encryption,signer:provider.signing,peers:{buyer:{encryptionKey:buyer.encryption.publicKey,signingKey:buyer.signing.publicKey}},research,settlement:createLightWalletSettlement({capture:native.capture,accountId:0,address})};
  worker=createPaidProvider(context);
  const forged=await prepareResearchRequest({...purchase,provider:pin,capability,request:purchase.request,signer:attacker.signing});
  await assert.rejects(worker.process({...claimed,envelope:forged.envelope},{rpc:providerRpc}),/authentication/);
  const tampered=structuredClone(claimed);const bytes=Buffer.from(tampered.envelope.ciphertext,'base64');bytes[0]^=1;tampered.envelope.ciphertext=bytes.toString('base64');await assert.rejects(worker.process(tampered,{rpc:providerRpc}));
  await assert.rejects(worker.process({...claimed,id:randomUUID()},{rpc:providerRpc}));assert.equal(calls,0);
  assert.equal((await worker.process(claimed,{rpc:providerRpc})).state,'awaiting_payment');assert.equal(calls,0);
  const pending=await rpc('/v1/jobs/'+job.id),identity={recipient:buyer.encryption,expectedSigner:pin.signingKey};
  const policy={purchase,network:'test',maxPaymentZat:'20000'},quote=await verifyResearchInvoice(job,pending.invoiceEnvelope,identity,policy);
  await assert.rejects(verifyResearchInvoice(job,pending.invoiceEnvelope,identity,{...policy,maxPaymentZat:'1'}),/policy/);
  await assert.rejects(verifyResearchInvoice(job,pending.invoiceEnvelope,identity,{...policy,purchase:{...purchase,request:{...purchase.request,input:{...purchase.request.input,outcome:'NO'}}}}),/binding/);
  await assert.rejects(rpc(`/v1/jobs/${job.id}/artifacts/0`),e=>e.status===404);
  // A fixture hint references synthetic chain evidence; this never broadcasts a payment.
  const hint={envelope:await encryptMessage({schema:'veildesk.payment-hint.v1',provider:job.provider,capability,invoiceHash:quote.invoiceHash,requestHash:quote.requestHash,txid},{signer:buyer.signing,recipientPublicKey:pin.encryptionKey,id:job.id})};
  await rpc(`/v1/jobs/${job.id}/payment`,{method:'POST',body:hint});
  const funded=(await providerRpc('/v1/provider/pending')).jobs[0];
  assert.equal((await worker.process(funded,{rpc:providerRpc})).state,'awaiting_payment');assert.equal(calls,0);
  native.setInvoice(quote.invoice);await worker.process(funded,{rpc:providerRpc});assert.equal(calls,1);
  const delivered=await rpc('/v1/jobs/'+job.id),result=await verifyResult(job,delivered.envelope,identity);
  const payment=verifyResearchReceipt(result,{quote,network:'test',txid});assert.equal(payment.requestHash,quote.requestHash);
  assert.throws(()=>verifyResearchReceipt(result,{quote,network:'test',txid:'b'.repeat(64)}),/binding/);
  const report=await readResearchReport(job,result,rpc,identity);assert.equal(report.researchStatus,'AVAILABLE');assert.equal(report.orderSubmitted,false);
  await assert.rejects(other(`/v1/jobs/${job.id}/artifacts/0`),e=>e.status===404);
  await assert.rejects(verifyResult(job,delivered.envelope,{...identity,expectedSigner:attacker.signing.publicKey}),/authentication/);
  await assert.rejects(decryptMessage(delivered.envelope,{...identity,recipient:attacker.encryption,id:job.id}));
  await assert.rejects(readResearchReport(job,result,async path=>{const value=await rpc(path);value.envelope.ciphertext=Buffer.alloc(4112).toString('base64');return value;},identity));
  worker.close();worker=createPaidProvider(context);await worker.process(funded,{rpc:providerRpc});assert.equal(calls,1);
  await relay.close();relay=null;
  const disk=await readFile(config.database);assert.equal(disk.includes(Buffer.from('fixture-market')),false);assert.equal(disk.includes(Buffer.from('synthetic private report')),false);
  url=await start();rpc=createHttpTransport({url,token:token('b'),allowLoopback:true});
  assert.equal((await rpc('/v1/jobs',{method:'POST',body:JSON.parse(await readFile(join(dir,'outbox.json'),'utf8'))})).state,'completed');
  assert.deepEqual((await rpc('/v1/jobs/'+job.id)).envelope,delivered.envelope);assert.deepEqual(await readResearchReport(job,result,rpc,identity),report);
  if(engine){assert.equal(engine.inspect().engineCalls,1);assert.equal(engine.inspect().modelCalls,1);assert.equal(report.researchOnly,true);}
  assert.equal(external,0);
 }finally{worker?.close();if(relay)await relay.close();globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}
});

test('standalone transport rejects insecure endpoints and provider or cross-origin routes',async()=>{
 for(const url of ['http://example.com','https://user:password@example.com','https://example.com/path'])assert.throws(()=>createHttpTransport({url,token:token('b')}));
 const rpc=createHttpTransport({url:'https://example.com',token:token('b')});
 for(const path of ['//evil.example/v1/jobs','/v1/provider/claim','/v1/jobs?secret=x'])await assert.rejects(rpc(path),/route/);
});
