import test from 'node:test';
import {paidResearchCapability} from '../src/zcash-network.mjs';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {createRelay} from '../src/relay.mjs';
import {createPaidResearchClient} from '../src/mandate-client.mjs';
import {createPaidProvider,paymentHash} from '../src/paid-provider.mjs';
import {relayClient,preparePrivateJob} from '../src/client.mjs';
import {loadEndpointIdentity} from '../src/endpoint-identity.mjs';
import {sealSigned} from '../src/authenticated.mjs';
import {PAID_RESEARCH,RESEARCH_DISCLOSURE} from '../src/service-rehearsal.mjs';
import {backupPayments,restorePayments} from '../src/payment-backup.mjs';
import {createBuyerProcess} from './fixtures/buyer-process.mjs';
import {createProviderDispatcher} from '../src/provider-dispatcher.mjs';

const txid='a'.repeat(64),blockhash='b'.repeat(64),account='00000000-0000-4000-8000-000000000002';
const request=()=>({schema:'veildesk.service-request.v1',service:'polydesk.market-research.v1',
  input:{marketId:'fixture-market',outcome:'YES',side:'BUY'},disclosure:RESEARCH_DISCLOSURE,executionAuthorized:false});
async function keys(){
  async function pair(name,usage){const p=await crypto.subtle.generateKey({name,namedCurve:'P-256'},true,usage);
    return {privateKey:await crypto.subtle.exportKey('jwk',p.privateKey),publicKey:Buffer.from(await crypto.subtle.exportKey('raw',p.publicKey)).toString('base64')};}
  return {encryption:await pair('ECDH',['deriveBits']),signing:await pair('ECDSA',['sign','verify'])};
}
async function setup({engine,isolatedBuyer=false,network='test',settlement}={}){
  const directory=await mkdtemp(join(tmpdir(),'veildesk-paid-research-'));
  const buyerKeys=await keys(),providerKeys=await keys(),buyerIdentity=await loadEndpointIdentity(buyerKeys);
  let now=Date.now(),calls=0,work=async()=>({schema:'polydesk-a2a-market-research-v1',researchStatus:'AVAILABLE',opinion:'synthetic-private-research 🛡️'.repeat(300),orderAuthorized:false,orderSubmitted:false});
  const descriptor={id:'polydesk',encryptionKey:providerKeys.encryption.publicKey,signingKey:providerKeys.signing.publicKey,capabilities:[paidResearchCapability(network)]};
  const relay=createRelay({database:join(directory,'relay.db'),now:()=>now,providers:[descriptor],principals:
    [['test-agent','client','c'],['polydesk','provider','p']].map(([id,role,token])=>({id,role,tokenHash:createHash('sha256').update(token.repeat(40)).digest('hex')}))});
  relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');
  const url=`http://127.0.0.1:${relay.server.address().port}`,rpc=relayClient({url,allowLoopback:true,token:'p'.repeat(40)});
  const config={url,allowLoopback:true,token:'c'.repeat(40),identity:buyerKeys,provider:descriptor,network,capability:paidResearchCapability(network),maxPaymentZat:'1000000'};
  const stateDirectory=join(directory,'buyer'),client=await (isolatedBuyer?createBuyerProcess:createPaidResearchClient)({config,stateDirectory}),buyerRpc=relayClient(config);
  const chain={chain:'test',blocks:100,estimatedheight:100,verificationprogress:1,bestblockhash:blockhash,consensus:{chaintip:'77190ad9'}};
  const status={locked:false,node_tip:{height:100,blockhash},wallet_tip:{height:100,blockhash},fully_synced_height:100};
  const view={txid,status:'mined',confirmations:3,blockhash,outputs:[]};
  const raw={txid,version:5,height:98,confirmations:3,blockhash,vin:[],vout:[],vjoinsplit:[],vShieldedSpend:[],vShieldedOutput:[],orchard:{actions:[{}],flags:{enableSpends:true,enableOutputs:true}}};
  let research=async input=>{calls++;assert.deepEqual(input,request().input);return engine?engine.research(input):work();};
  if(process.env.VEILDESK_POLYDESK_ADAPTER){const {createVeilDeskResearchService}=await import(pathToFileURL(process.env.VEILDESK_POLYDESK_ADAPTER).href);
    const fixture=research;research=createVeilDeskResearchService({runResearch:async input=>({ok:true,data:await fixture(input)})});}
  const context={database:join(directory,'payments.db'),network,settlement,account,address:'testnet-fixture-recipient',amount:'0.01',
    nodeRpc:async method=>({getblockchaininfo:chain,getrawtransaction:raw,getblockhash:raw.blockhash})[method],
    walletRpc:async method=>({getwalletstatus:status,z_viewtransaction:view,z_getaccount:{account_uuid:account,addresses:[{ua:'testnet-fixture-recipient'}]}})[method],
    ...await loadEndpointIdentity(providerKeys),peers:{'test-agent':{encryptionKey:buyerKeys.encryption.publicKey,signingKey:buyerKeys.signing.publicKey}},now:()=>now,research};
  let paid=createPaidProvider(context);
  async function submit(){const purchase={id:randomUUID(),expiresAt:now+600000,request:request()};await client.submit(purchase);
    return {purchase,job:(await rpc('/v1/provider/claim',{method:'POST',body:{}})).job};}
  const initial=await submit();
  return {...initial,client,buyerRpc,rpc,config,stateDirectory,context,descriptor,buyerIdentity,raw,view,status,submit,
    calls:()=>calls,setWork:fn=>work=fn,advance:n=>now+=n,
    process:(job=initial.job,transport=rpc)=>paid.process(job,{rpc:transport}),
    restart:()=>{paid.close();paid=createPaidProvider(context);},
    async restore(){await backupPayments(context.database,join(directory,'snapshot'));paid.close();
      context.database=(await restorePayments(join(directory,'snapshot'),join(directory,'restored'))).database;paid=createPaidProvider(context);},
    async fund(job=initial.job){await paid.process(job,{rpc});const quote=(await client.get(job.id)).payment;
      view.outputs=[{pool:'orchard',action:0,account_uuid:account,address:quote.invoice.address,outgoing:false,walletInternal:false,
        valueZat:Number(quote.invoice.amountZat),memo:Buffer.from(quote.invoice.memo).toString('hex').padEnd(1024,'0')}];
      await client.submitPaymentHint(job.id,txid);return (await rpc('/v1/provider/pending')).jobs.find(j=>j.id===job.id);},
    close:async()=>{await client.close?.();paid.close();await relay.close();await rm(directory,{recursive:true,force:true});}};
}

test('service-bound testnet receipt gates research, encrypted report and restart replay (synthetic wallet)',async()=>{
  const f=await setup();try{
    assert.equal((await f.process()).state,'awaiting_payment');assert.equal(f.calls(),0);
    const quote=(await f.client.get(f.job.id)).payment;
    assert.equal(quote.requestHash,paymentHash(f.purchase));assert.equal(quote.mandateHash,undefined);
    const small=await createPaidResearchClient({config:{...f.config,maxPaymentZat:'1'},stateDirectory:f.stateDirectory});
    await assert.rejects(small.get(f.job.id),/authorization/);
    const job=await f.fund();
    await assert.rejects(f.process(job,async(path,options)=>{const result=await f.rpc(path,options);
      if(path==='/v1/provider/artifact'&&options.body.index===1)throw Error('lost upload response');return result;}),/lost upload/);
    assert.equal(f.calls(),1);assert.equal((await f.client.get(job.id)).state,'processing');
    await assert.rejects(f.buyerRpc(`/v1/jobs/${job.id}/artifacts/0`),e=>e.status===404);
    f.restart();await f.restore();await f.process(job);const result=await f.client.get(job.id);
    assert.equal(result.result.payload.payment.requestHash,paymentHash(f.purchase));
    assert.equal(result.result.payload.paymentVerified,true);assert.equal(result.result.payload.report.orderAuthorized,false);
    assert.ok(result.result.payload.report.opinion.length>4096);assert.equal(result.executionAuthorized,false);
    await f.process(job);assert.equal(f.calls(),1);
    const restarted=await createPaidResearchClient({config:f.config,stateDirectory:f.stateDirectory});
    assert.deepEqual(await restarted.get(job.id),result);
    const next=await f.submit(),duplicate=await f.fund(next.job);
    assert.equal((await f.process(duplicate)).reason,'note_already_bound_review');assert.equal(f.calls(),1);
  }finally{await f.close();}
});

test('changed requests and payment hashes cannot purchase research',async()=>{
  const f=await setup();try{
    const job=await f.fund();
    await assert.rejects(f.client.submit({...f.purchase,request:{...request(),input:{...request().input,outcome:'NO'}}}),/different contents/);
    const changed=await preparePrivateJob({id:job.id,provider:f.descriptor,capability:PAID_RESEARCH,expiresAt:job.expiresAt,
      payload:{...request(),input:{...request().input,outcome:'NO'}},signer:f.buyerIdentity.signer});
    await assert.rejects(f.process({...job,envelope:changed.envelope}),/binding conflict/);
    const quote=(await f.client.get(job.id)).payment;
    const hint=await sealSigned({schema:'veildesk.payment-hint.v1',provider:job.provider,capability:job.capability,
      invoiceHash:quote.invoiceHash,requestHash:'0'.repeat(64),txid},
      {signer:f.buyerIdentity.signer,recipientPublicKey:f.descriptor.encryptionKey,id:job.id,direction:'request'});
    await assert.rejects(f.process({...job,paymentHint:hint}),/binding failed/);assert.equal(f.calls(),0);
  }finally{await f.close();}
});

test('missing or insufficient wallet evidence never invokes research',async()=>{
  for(const mutate of [f=>f.view.outputs=[],f=>f.view.outputs[0].valueZat++,f=>f.raw.confirmations=0]){
    const f=await setup();try{const job=await f.fund();mutate(f);
      try{assert.notEqual((await f.process(job)).state,'completed');}catch(error){assert.match(error.message,/confirmed/);}
      assert.equal(f.calls(),0);assert.equal((await f.client.get(job.id)).state,'processing');
    }finally{await f.close();}
  }
});

test('reorg during artifact upload prevents report release and stays in review',async()=>{
  const f=await setup();try{const job=await f.fund();
    const result=await f.process(job,async(path,options)=>{const result=await f.rpc(path,options);
      if(path==='/v1/provider/artifact')f.raw.blockhash=f.view.blockhash='c'.repeat(64);return result;});
    assert.equal(result.reason,'finality_or_expiry_review');assert.equal(f.calls(),1);
    await assert.rejects(f.buyerRpc(`/v1/jobs/${job.id}/artifacts/0`),e=>e.status===404);
    f.restart();f.raw.blockhash=f.view.blockhash=blockhash;
    assert.equal((await f.process(job)).state,'payment_review');assert.equal(f.calls(),1);
    assert.equal((await f.client.get(job.id)).paymentReview.paymentVerified,false);
  }finally{await f.close();}
});

test('upstream failure after verified payment requires reconciliation, never repeat work',async()=>{
  const f=await setup();try{const job=await f.fund();f.setWork(async()=>{throw Error('synthetic upstream failure');});
    await assert.rejects(f.process(job));f.restart();await assert.rejects(f.process(job),/reconciliation/);
    assert.equal(f.calls(),1);assert.equal((await f.client.get(job.id)).state,'processing');
  }finally{await f.close();}
});

test('concurrent paid research workers reserve once before upstream work',async()=>{
  const f=await setup();let competing;
  try{const job=await f.fund();let enter,release;
    const entered=new Promise(resolve=>enter=resolve),hold=new Promise(resolve=>release=resolve);
    f.setWork(async()=>{enter();await hold;return {schema:'polydesk-a2a-market-research-v1',researchStatus:'AVAILABLE',orderAuthorized:false,orderSubmitted:false};});
    competing=createPaidProvider(f.context);
    const first=f.process(job);await entered;
    try{await assert.rejects(competing.process(job,{rpc:f.rpc}),/reconciliation/);}finally{release();}
    await first;assert.equal(f.calls(),1);assert.equal((await f.client.get(job.id)).state,'completed');
  }finally{competing?.close();await f.close();}
});

test('expired paid research enters review without invoking service; default provider cannot fulfill it',async()=>{
  const f=await setup();let validationOnly;
  try{validationOnly=createPaidProvider({...f.context,research:undefined});
    await assert.rejects(validationOnly.process(f.job,{rpc:f.rpc}),/Unsupported/);
    const job=await f.fund();f.advance(600001);
    assert.equal((await f.process(job)).state,'payment_review');assert.equal(f.calls(),0);
    assert.equal((await f.client.get(job.id)).paymentReview.paymentVerified,false);
  }finally{validationOnly?.close();await f.close();}
});

test('host dispatcher routes paid research through receipt verification and artifact delivery',async()=>{
  const f=await setup();let dispatcher;
  try{
    const {context}=f;
    dispatcher=await createProviderDispatcher({config:{peers:context.peers,stateDirectory:dirname(context.database),
      researchService:{enabled:true},testnetPayment:{enabled:true,network:'test',account,address:context.address,
        amount:context.amount,node:'node',wallet:'wallet'}},keys:{recipient:context.recipient,signer:context.signer},
      rpc:f.rpc,research:context.research,createRpc:role=>role==='node'?context.nodeRpc:context.walletRpc});
    assert.equal((await dispatcher.process(f.job)).state,'awaiting_payment');assert.equal(f.calls(),0);
    const quote=(await f.client.get(f.job.id)).payment;
    f.view.outputs=[{pool:'orchard',action:0,account_uuid:account,address:quote.invoice.address,outgoing:false,walletInternal:false,
      valueZat:Number(quote.invoice.amountZat),memo:Buffer.from(quote.invoice.memo).toString('hex').padEnd(1024,'0')}];
    await f.client.submitPaymentHint(f.job.id,txid);
    const job=(await f.rpc('/v1/provider/pending')).jobs.find(job=>job.id===f.job.id);
    await dispatcher.process(job);assert.equal(f.calls(),1);
    assert.equal((await f.client.get(job.id)).result.payload.paymentVerified,true);
    await dispatcher.process(job);assert.equal(f.calls(),1);
  }finally{dispatcher?.close();await f.close();}
});

test('independent buyer process receives actual PolyDesk engine report through paid encrypted delivery',
  {skip:!process.env.VEILDESK_POLYDESK_ENGINE_FIXTURE},async()=>{
  const originalFetch=globalThis.fetch;let blockedExternalRequests=0;
  globalThis.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'){
      blockedExternalRequests++;throw Error('External network forbidden in offline engine acceptance');
    }
    return originalFetch(input,options);
  };
  let f;
  try{
    const {createEngineTestService}=await import(pathToFileURL(process.env.VEILDESK_POLYDESK_ENGINE_FIXTURE).href);
    const engine=createEngineTestService();f=await setup({engine,isolatedBuyer:true});
    assert.notEqual(f.client.pid,process.pid);
    await f.process();assert.equal(engine.inspect().engineCalls,0);
    const job=await f.fund();await f.process(job);
    const received=await f.client.get(job.id),report=received.result.payload.report;
    assert.equal(report.selected.market.conditionId,engine.inspect().conditionId);
    assert.equal(report.researchStatus,'AVAILABLE');assert.equal(report.researchOnly,true);
    assert.equal(report.screeningMandate,null);assert.equal(report.orderAuthorized,false);assert.equal(report.orderSubmitted,false);
    assert.equal(report.agentHandoff.nextAction,'REVIEW_EVIDENCE');assert.equal(report.agentHandoff.decisionId,null);
    assert.match(report.next,/VeilDesk request/);assert.doesNotMatch(report.next,/accepted A2A task/);
    assert.ok(report.evidence.zeroScout);assert.equal('decision' in report,false);
    assert.equal(received.result.payload.payment.requestHash,paymentHash(f.purchase));
    f.restart();await f.process(job);assert.deepEqual(await f.client.get(job.id),received);
    assert.equal(engine.inspect().engineCalls,1);assert.equal(engine.inspect().modelCalls,1);
    assert.equal(blockedExternalRequests,0);
  }finally{try{await f?.close();}finally{globalThis.fetch=originalFetch;}}
});

test('native receipt backend gates encrypted PolyDesk research and replay (synthetic chain evidence)',async()=>{
  const {createLightWalletSettlement}=await import('../src/settlement.mjs');
  const {nativePaymentFixture}=await import('./fixtures/native-payment.mjs');
  let engine;if(process.env.VEILDESK_POLYDESK_ENGINE_FIXTURE){const module=await import(pathToFileURL(process.env.VEILDESK_POLYDESK_ENGINE_FIXTURE).href);engine=module.createEngineTestService();}
  const f=await setup({engine,isolatedBuyer:true});try{
    const fixture=nativePaymentFixture({address:f.context.address,txid,now:f.context.now});
    f.context.settlement=createLightWalletSettlement({capture:fixture.capture,accountId:0,address:f.context.address,now:f.context.now});
    f.context.nodeRpc=f.context.walletRpc=()=>{throw Error('Native research must not call Zallet')};f.restart();
    await f.process();assert.equal(f.calls(),0);
    const quote=(await f.client.get(f.job.id)).payment;
    fixture.setInvoice({...quote.invoice,memo:'wrong-memo'});const job=await f.fund();
    assert.equal((await f.process(job)).state,'awaiting_payment');assert.equal(f.calls(),0);
    fixture.setInvoice(quote.invoice);await f.process(job);
    const received=await f.client.get(job.id);
    assert.equal(received.result.payload.paymentVerified,true);assert.equal(received.result.payload.tradeSubmitted,false);
    assert.equal(received.result.payload.report.orderAuthorized,false);assert.equal(received.result.payload.report.orderSubmitted,false);
    assert.equal(received.result.payload.payment.requestHash,paymentHash(f.purchase));
    assert.equal(received.result.payload.payment.noteId,txid+':ironwood:0');
    f.restart();await f.process(job);assert.deepEqual(await f.client.get(job.id),received);assert.equal(f.calls(),1);
    if(engine){assert.equal(engine.inspect().engineCalls,1);assert.equal(engine.inspect().modelCalls,1);assert.equal(received.result.payload.report.researchStatus,'AVAILABLE');}
  }finally{await f.close();}
});

test('mainnet research invoice and encrypted receipt stay bound to explicit network (synthetic evidence)',async()=>{
 const {createLightWalletSettlement}=await import('../src/settlement.mjs');
 const {nativePaymentFixture}=await import('./fixtures/native-payment.mjs');
 const address='testnet-fixture-recipient';
 const native=nativePaymentFixture({address,txid,now:Date.now,network:'main'});
 const settlement=createLightWalletSettlement({capture:native.capture,accountId:0,address,network:'main'});
 const f=await setup({network:'main',settlement,isolatedBuyer:true});try{
  await f.process();const quote=(await f.client.get(f.job.id)).payment;
  assert.equal(quote.invoice.network,'main');assert.equal(quote.network,'main');
  native.setInvoice(quote.invoice);const job=await f.fund();await f.process(job);
  const received=await f.client.get(job.id);
  assert.equal(received.result.payload.mode,'mainnet-paid');assert.equal(received.result.payload.payment.network,'main');
  assert.equal(received.result.payload.executionAuthorized,false);assert.equal(received.result.payload.tradeSubmitted,false);
  f.restart();await f.process(job);assert.equal(f.calls(),1);
  await assert.rejects(createPaidResearchClient({config:{...f.config,network:'test'},stateDirectory:f.stateDirectory}),/capability/);
 }finally{await f.close();}
});
