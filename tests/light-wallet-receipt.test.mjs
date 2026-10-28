import test from 'node:test';
import assert from 'node:assert/strict';
import {invoice} from '../src/zcash.mjs';
import {verifyLightWalletReceipt} from '../src/light-wallet-receipt.mjs';
const now=1800000000000,txid='a'.repeat(64),hash=n=>n.toString(16).padStart(64,'0');
function fixture(){
 const i=invoice({address:'test-only-recipient-fixture',amount:'0.01',network:'test',now});
 const chain=[98,99,100].map(height=>({height,hash:hash(height),previousHash:hash(height-1)}));
 const snapshot={capturedAt:now,scan:{checkedAt:new Date(now).toISOString(),syncReady:true,network:'test',height:100},
  evidence:{schema:'veildesk.light-wallet-evidence.v1',network:'test',walletDigest:hash(4),recipient:{tracked:true,accountId:0,address:i.address},
   tip:{height:100,hash:hash(100)},transaction:{txid,version:6,versionGroupId:'d884b698',shieldedOnly:true,pool:'ironwood',actionCount:2,
    mined:true,height:98,blockhash:hash(98),chain,notes:[{accountId:0,address:i.address,scope:'external',amountZat:i.amountZat,memo:i.memo,outputIndex:1}]}}};
 return {snapshot,options:{invoice:i,accountId:0,txid,now:()=>now,capture:async query=>{assert.deepEqual(query,{accountId:0,address:i.address,txid});return structuredClone(snapshot)}}};
}
test('native evidence verifier binds exact shielded receipt and never authorizes execution',async()=>{
 const {snapshot,options}=fixture();const r=await verifyLightWalletReceipt(options);
 assert.equal(r.state,'confirmed');assert.equal(r.noteId,txid+':ironwood:1');assert.equal(r.executionAuthorized,false);
 snapshot.evidence.transaction.pool='orchard';snapshot.evidence.transaction.version=5;snapshot.evidence.transaction.versionGroupId='26a7270a';
 assert.equal((await verifyLightWalletReceipt(options)).state,'confirmed');
});
test('wrong ownership, value, memo, change and ambiguity never settle',async()=>{
 for(const patch of [{accountId:1},{address:'other'},{scope:'internal'},{amountZat:'1'},{memo:'other'}]){
  const {snapshot,options}=fixture();Object.assign(snapshot.evidence.transaction.notes[0],patch);
  assert.equal((await verifyLightWalletReceipt(options)).state,'awaiting_payment');
 }
 const {snapshot,options}=fixture();snapshot.evidence.transaction.notes.push({...snapshot.evidence.transaction.notes[0],outputIndex:0});
 assert.equal((await verifyLightWalletReceipt(options)).state,'ambiguous_payment_review');
});
test('stale, partial, wrong-chain, malformed and insufficient confirmations fail closed',async()=>{
 const changes=[s=>s.capturedAt-=31000,s=>s.scan.syncReady=false,s=>s.scan.network='main',s=>s.evidence.recipient.tracked=false,
  s=>s.evidence.transaction.shieldedOnly=false,s=>s.evidence.transaction.version=7,s=>s.evidence.transaction.versionGroupId='wrong',
  s=>s.evidence.transaction.mined=false,s=>s.evidence.transaction.height=99,s=>s.evidence.transaction.chain[1].previousHash=hash(1),
  s=>s.evidence.tip.hash=hash(1),s=>s.evidence.transaction.notes[0].outputIndex=2];
 for(const change of changes){const {snapshot,options}=fixture();change(snapshot);await assert.rejects(verifyLightWalletReceipt(options))}
});
test('recheck rejects reorgs and missing notes; late and absent payments remain review-only',async()=>{
 for(const change of [s=>s.evidence.tip.hash=hash(999),s=>s.evidence.transaction=null]){
  const {snapshot,options}=fixture();let calls=0;options.capture=async()=>{const copy=structuredClone(snapshot);if(++calls===2)change(copy);return copy};
  await assert.rejects(verifyLightWalletReceipt(options));assert.equal(calls,2);
 }
 const {snapshot,options}=fixture();options.invoice.expiresAt=now-1;
 assert.equal((await verifyLightWalletReceipt(options)).state,'late_payment_review');
 snapshot.evidence.transaction=null;assert.equal((await verifyLightWalletReceipt(options)).state,'expired_unpaid');
});

test('mainnet receipts require explicit network and reject testnet substitution (synthetic evidence)',async()=>{
 const {snapshot,options}=fixture();options.invoice.network='main';options.network='main';snapshot.scan.network='main';snapshot.evidence.network='main';
 assert.equal((await verifyLightWalletReceipt(options)).state,'confirmed');
 await assert.rejects(verifyLightWalletReceipt({...options,network:'test'}),/policy/);
 snapshot.scan.network='test';await assert.rejects(verifyLightWalletReceipt(options),/Fresh complete/);
 snapshot.scan.network='main';snapshot.evidence.network='test';await assert.rejects(verifyLightWalletReceipt(options),/Fresh complete/);
 snapshot.evidence.network='main';options.invoice.network='test';await assert.rejects(verifyLightWalletReceipt(options),/policy/);
});

test('confirmation recheck accepts a chain extension but rejects a changed retained block',async()=>{
 for(const reorg of [false,true]){
  const {snapshot,options}=fixture();let calls=0;
  options.capture=async()=>{const copy=structuredClone(snapshot);if(++calls===2){
   const tx=copy.evidence.transaction;
   if(reorg){tx.chain[2].hash=hash(900);}
   tx.chain.push({height:101,hash:hash(101),previousHash:tx.chain[2].hash});
   copy.scan.height=101;copy.evidence.tip={height:101,hash:hash(101)};
  }return copy;};
  if(reorg)await assert.rejects(verifyLightWalletReceipt(options),/Chain or note changed/);
  else {const result=await verifyLightWalletReceipt(options);assert.equal(result.state,'confirmed');assert.equal(result.confirmations,4);}
 }
});
