import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {identity} from '../src/envelope.mjs';
import {signingIdentity,sealSigned} from '../src/authenticated.mjs';
import {invoice} from '../src/zcash.mjs';
import {issueAuthenticatedInvoice,verifyAuthenticatedPayment,verifyZalletReceipt,testnetReadiness} from '../src/zallet-receipt.mjs';
const account='00000000-0000-4000-8000-000000000002',txid='a'.repeat(64),blockhash='b'.repeat(64),now=1800000000000;
function evidence(i){
 const chain={chain:'test',blocks:100,estimatedheight:100,verificationprogress:1,bestblockhash:blockhash};
 const status={locked:false,node_tip:{height:100,blockhash},wallet_tip:{height:100,blockhash},fully_synced_height:100};
 const note={pool:'orchard',action:0,account_uuid:account,address:i.address,outgoing:false,walletInternal:false,valueZat:Number(i.amountZat),memo:Buffer.from(i.memo).toString('hex').padEnd(1024,'0')};
 const view={txid,status:'mined',confirmations:3,blockhash,outputs:[note]};
 const raw={txid,version:5,height:98,confirmations:3,blockhash,vin:[],vout:[],vjoinsplit:[],vShieldedSpend:[],vShieldedOutput:[],orchard:{actions:[{}],flags:{enableSpends:true,enableOutputs:true}}};
 const nodeRpc=async(method)=>({getblockchaininfo:chain,getrawtransaction:raw,getblockhash:blockhash})[method];
 const walletRpc=async(method)=>({getwalletstatus:status,z_viewtransaction:view})[method];
 return {chain,status,note,view,raw,nodeRpc,walletRpc,invoice:i,account,txid,now};
}
test('Zallet-schema fixtures verify a shielded note and keep execution disabled',async()=>{
 const e=evidence(invoice({address:'test-fixture-address',amount:'0.01',network:'test',now}));
 const r=await verifyZalletReceipt(e);assert.equal(r.state,'confirmed');assert.equal(r.noteId,txid+':orchard:0');assert.equal(r.executionAuthorized,false);
 assert.equal((await verifyZalletReceipt({...e,now:now+900000})).state,'late_payment_review');
 e.note.pool='sapling';e.note.output=0;e.raw.vShieldedSpend=[{}];e.raw.vShieldedOutput=[{}];e.raw.orchard.actions=[];
 assert.equal((await verifyZalletReceipt(e)).state,'confirmed');
});
test('wrong note ownership, memo, value, change and ambiguous receipts never settle',async()=>{
 for(const change of [{account_uuid:'other'},{address:'other'},{outgoing:true},{walletInternal:true},{valueZat:1000001},{valueZat:'1000000'},{memo:'ff'}]){
  const e=evidence(invoice({address:'fixture',amount:'0.01',network:'test',now}));Object.assign(e.note,change);
  assert.equal((await verifyZalletReceipt(e)).state,'awaiting_payment');
 }
 const e=evidence(invoice({address:'fixture',amount:'0.01',network:'test',now}));e.view.outputs.push({...e.note,action:1});
 assert.equal((await verifyZalletReceipt(e)).state,'ambiguous_payment_review');
});
test('sync, missing confirmations, transparent, cross-pool and reorg evidence fail closed',async()=>{
 const mutations=[e=>e.status.locked=true,e=>delete e.status.fully_synced_height,e=>e.chain.estimatedheight++,e=>e.chain.chain='main',e=>e.view.confirmations='3',e=>delete e.raw.confirmations,e=>e.raw.vin.push({}),e=>e.raw.vShieldedOutput.push({}),e=>e.raw.ironwood={},e=>e.raw.version=6,e=>e.raw.blockhash='c'.repeat(64),e=>e.note.action=-1,e=>e.nodeRpc=async m=>m==='getblockhash'?'c'.repeat(64):m==='getblockchaininfo'?e.chain:e.raw];
 for(const mutate of mutations){const e=evidence(invoice({address:'fixture',amount:'0.01',network:'test',now}));mutate(e);await assert.rejects(verifyZalletReceipt(e));}
});
test('authenticated mandate binding persists, replays reverify, and late payments remain review-only',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'veildesk-receipt-'));
 try{
  const recipient=await identity(),signer=await signingIdentity();
  const mandate={schema:'veildesk.mandate.v1',id:'00000000-0000-4000-8000-000000000001',mode:'dry_run',market:'synthetic-market',side:'YES',maxSpendUsd:'1.00',limitPrice:'0.5',expiresAt:now+600000,approval:'preview_only'};
  const envelope=await sealSigned(mandate,{signer,recipientPublicKey:recipient.publicKey,id:mandate.id,direction:'request'});
  const args={directory,envelope,recipient,expectedSigner:signer.publicKey,address:'fixture',account,amount:'0.01',now};
  const binding=await issueAuthenticatedInvoice(args);assert.deepEqual(await issueAuthenticatedInvoice(args),binding);
  const e=evidence(binding.invoice),request={...args,...e};
  assert.equal((await verifyAuthenticatedPayment(request)).replayed,false);
  assert.equal((await verifyAuthenticatedPayment(request)).replayed,true);
  assert.equal((await verifyAuthenticatedPayment({...request,now:now+600000})).state,'mandate_expired_review');
  e.note.action=1;e.raw.orchard.actions.push({});
  assert.equal((await verifyAuthenticatedPayment(request)).state,'duplicate_payment_review');
  e.note.action=0;
  assert.equal((await verifyAuthenticatedPayment({...request,now:now+900000})).state,'late_payment_review');
  e.status.locked=true;await assert.rejects(verifyAuthenticatedPayment(request),/synced/);e.status.locked=false;
  e.raw.blockhash='c'.repeat(64);e.view.blockhash=e.raw.blockhash;
  request.nodeRpc=async m=>m==='getblockhash'?e.raw.blockhash:m==='getblockchaininfo'?e.chain:e.raw;
  assert.equal((await verifyAuthenticatedPayment(request)).state,'reorg_review');
  await assert.rejects(issueAuthenticatedInvoice({...args,amount:'0.02'}),/conflict/);
  const impostor=await signingIdentity();await assert.rejects(verifyAuthenticatedPayment({...request,expectedSigner:impostor.publicKey}));
  const changed=await sealSigned({...mandate,side:'NO'},{signer,recipientPublicKey:recipient.publicKey,id:mandate.id,direction:'request'});
  await assert.rejects(verifyAuthenticatedPayment({...request,envelope:changed}),/mismatch/);
 }finally{await rm(directory,{recursive:true,force:true})}
});

test('v6 Ironwood accepts recipient evidence and rejects malformed or mixed-pool payments',async()=>{
 const make=()=>{const e=evidence(invoice({address:'fixture',amount:'0.01',network:'test',now}));e.note.pool='ironwood';e.view.version=6;e.raw.version=6;e.raw.versiongroupid='d884b698';e.raw.ironwood=e.raw.orchard;delete e.raw.orchard;return e};
 assert.equal((await verifyZalletReceipt(make())).noteId,txid+':ironwood:0');
 const mutations=[e=>e.raw.version=7,e=>e.raw.versiongroupid='ffffffff',e=>delete e.view.version,e=>e.view.version=5,e=>e.raw.ironwood.flags.enableSpends=false,e=>e.raw.ironwood.flags.enableOutputs=false,e=>delete e.raw.ironwood.actions,e=>e.note.action=1,e=>e.raw.orchard={actions:[{}]},e=>e.raw.vShieldedSpend.push({}),e=>e.raw.vShieldedOutput.push({}),e=>e.raw.vin.push({coinbase:'00'}),e=>e.raw.vout.push({}),e=>e.raw.vjoinsplit.push({}),e=>e.raw.confirmations=2,e=>e.raw.height--];
 for(const mutate of mutations){const e=make();mutate(e);await assert.rejects(verifyZalletReceipt(e));}
 for(const patch of [{account_uuid:'other'},{address:'other'},{memo:'ff'},{valueZat:1},{outgoing:true},{walletInternal:true}]){const e=make();Object.assign(e.note,patch);assert.equal((await verifyZalletReceipt(e)).state,'awaiting_payment');}
 const duplicate=make();duplicate.view.outputs.push({...duplicate.note,action:1});assert.equal((await verifyZalletReceipt(duplicate)).state,'ambiguous_payment_review');
});

test('observed public NU7 shape is compatible; recipient ownership remains synthetic',async()=>{
 const {readFile}=await import('node:fs/promises');const fixture=JSON.parse(await readFile(new URL('./fixtures/nu7-public-shape.json',import.meta.url),'utf8'));
 assert.equal(fixture.recipientEvidence,false);
 const e=evidence(invoice({address:'fixture',amount:'0.01',network:'test',now}));
 Object.assign(e.raw,fixture.transaction);e.txid=e.raw.txid;e.view.txid=e.txid;e.view.version=6;e.note.pool='ironwood';
 assert.equal((await verifyZalletReceipt(e)).state,'confirmed');
 e.view.outputs=[];assert.equal((await verifyZalletReceipt(e)).state,'awaiting_payment');
});
