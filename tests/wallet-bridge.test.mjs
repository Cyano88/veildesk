import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {once} from 'node:events';import {createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {identity} from '../src/envelope.mjs';import {signingIdentity} from '../src/authenticated.mjs';
import {relayClient,sealPrivateResult,preparePrivateJob} from '../src/client.mjs';
import {createRelay} from '../src/relay.mjs';import {invoice} from '../src/zcash.mjs';
import {WALLET_CAPABILITY,createRemoteWalletSettlement,createWalletBridgeProcessor} from '../src/wallet-bridge.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'wallet-bridge-'));
 const wallet={recipient:await identity(),signer:await signingIdentity()},provider={recipient:await identity(),signer:await signingIdentity()};
 const descriptor={id:'wallet',encryptionKey:wallet.recipient.publicKey,signingKey:wallet.signer.publicKey,capabilities:[WALLET_CAPABILITY],allowedClients:['provider-client']};
 const address='private-testnet-receiver-fixture',txid='a'.repeat(64);let checks=0;
 const backend={id:'zingolib-testnet-v1:0',address,preflight:async()=>{checks++;return {recipientTracked:true,settlementVerified:false,executionAuthorized:false}},
 verify:async({invoice:i,txid:t})=>{checks++;assert.equal(t,txid);assert.equal(i.address,address);return {state:'confirmed',noteId:t+':ironwood:0',blockhash:'b'.repeat(64),height:100,confirmations:3,executionAuthorized:false}}};
 const relay=createRelay({database:join(directory,'relay.db'),principals:[{id:'provider-client',role:'client',tokenHash:hash('c'.repeat(40))},{id:'wallet',role:'provider',tokenHash:hash('w'.repeat(40))},{id:'outsider',role:'client',tokenHash:hash('s'.repeat(40))}],providers:[descriptor]});
 relay.server.listen(0,'127.0.0.1');await once(relay.server,'listening');const url='http://127.0.0.1:'+relay.server.address().port;
 const rpc=relayClient({url,allowLoopback:true,token:'c'.repeat(40)}),walletRpc=relayClient({url,allowLoopback:true,token:'w'.repeat(40)});
 const process=createWalletBridgeProcessor({providerId:'wallet',accountId:0,address,backend,...wallet,peers:{'provider-client':{signingKey:provider.signer.publicKey,encryptionKey:provider.recipient.publicKey}},stateDirectory:join(directory,'wallet')});
 let stop=false,lastJob;
 const pump=(async()=>{while(!stop){const {job}=await walletRpc('/v1/provider/claim',{method:'POST',body:{}});if(job){lastJob=job;await process(job,{rpc:walletRpc})}await pause(5)}})();
 const remote=createRemoteWalletSettlement({rpc,provider:descriptor,...provider,accountId:0,address,pollMs:5,timeoutMs:5000});
 return {outsider:relayClient({url,allowLoopback:true,token:'s'.repeat(40)}),directory,wallet,provider,descriptor,address,txid,backend,remote,rpc,walletRpc,process,checks:()=>checks,lastJob:()=>lastJob,
 close:async()=>{stop=true;await pump;await relay.close();await rm(directory,{recursive:true,force:true})}};
}
test('encrypted cloud-wallet bridge binds receipts, restricts peers and replays without repeating wallet work',async()=>{
 const f=await fixture();try{
  assert.equal((await f.remote.preflight()).recipientTracked,true);
  const i=invoice({address:f.address,amount:'0.001',network:'test'});
  const result=await f.remote.verify({invoice:i,txid:f.txid});assert.equal(result.state,'confirmed');assert.equal(result.executionAuthorized,false);
  assert.deepEqual((await f.outsider('/v1/providers')).providers,[]);
  const forbidden=await preparePrivateJob({id:crypto.randomUUID(),provider:f.descriptor,capability:WALLET_CAPABILITY,expiresAt:Date.now()+5000,payload:{},signer:f.provider.signer});
  await assert.rejects(f.outsider('/v1/jobs',{method:'POST',body:forbidden}),error=>error.status===403);
  assert.equal(f.checks(),2);await f.process(f.lastJob(),{rpc:f.walletRpc});assert.equal(f.checks(),2);
  await assert.rejects(f.process({...f.lastJob(),client:'stranger'},{rpc:f.walletRpc}),/Unenrolled/);
  const bytes=await readFile(join(f.directory,'relay.db-wal'));assert.equal(bytes.includes(Buffer.from(f.address)),false);assert.equal(bytes.includes(Buffer.from(i.memo)),false);
 }finally{await f.close()}
});
test('bridge rejects wrong scope before wallet access and rejects stale signed responses',async()=>{
 const f=await fixture();try{
  const bad=await preparePrivateJob({id:crypto.randomUUID(),provider:f.descriptor,capability:WALLET_CAPABILITY,expiresAt:Date.now()+5000,
   payload:{schema:'veildesk.wallet-query.v1',operation:'preflight',accountId:1,address:f.address},signer:f.provider.signer});
  await assert.rejects(f.process({...bad,client:'provider-client'},{rpc:f.walletRpc}),/scoped/);assert.equal(f.checks(),0);
  let job;
  const rpc=async(path,options)=>{if(options?.method==='POST'){job=options.body;return {state:'queued'}}
   const envelope=await sealPrivateResult(job,{schema:'veildesk.wallet-result.v1',operation:'preflight',queryHash:hash(JSON.stringify({schema:'veildesk.wallet-query.v1',operation:'preflight',accountId:0,address:f.address})),status:'ok',result:{recipientTracked:true,settlementVerified:false,executionAuthorized:false},observedAt:Date.now()-60000,expiresAt:Date.now()+10000,executionAuthorized:false},{signer:f.wallet.signer,recipientPublicKey:f.provider.recipient.publicKey});return {state:'completed',envelope}};
  const remote=createRemoteWalletSettlement({rpc,provider:f.descriptor,...f.provider,accountId:0,address:f.address,pollMs:5,timeoutMs:5000});
  await assert.rejects(remote.preflight(),/stale authenticated/);
 }finally{await f.close()}
});
