import test from 'node:test';import assert from 'node:assert/strict';
import {identity,seal,open} from '../src/envelope.mjs';
import {invoice,verifyInvoice,sendPrivate,zats} from '../src/zcash.mjs';
test('only the intended recipient decrypts; identity and direction are bound',async()=>{
 const a=await identity(),b=await identity(),id=crypto.randomUUID(),payload={market:'Secret market',budget:'secret budget'};
 const sealed=await seal(payload,a.publicKey,id,'request');assert.ok(!JSON.stringify(sealed).includes('Secret market'));
 assert.deepEqual(await open(sealed,a.privateKey,id,'request'),payload);await assert.rejects(open(sealed,b.privateKey,id,'request'));
 await assert.rejects(open(sealed,a.privateKey,crypto.randomUUID(),'request'));await assert.rejects(open(sealed,a.privateKey,id,'response'));
 const mutated={...sealed,ciphertext:'A'+sealed.ciphertext.slice(1)};if(mutated.ciphertext!==sealed.ciphertext)await assert.rejects(open(mutated,a.privateKey,id,'request'));
 assert.equal((await seal({x:'x'.repeat(1000)},a.publicKey,id,'request')).ciphertext.length,sealed.ciphertext.length);
 await assert.rejects(seal({x:'x'.repeat(5000)},a.publicKey,id,'request'));
});
const i=()=>invoice({address:'test-fixture-address',amount:'0.01',network:'test'});
const txid='a'.repeat(64);
function rpc(i,change={}){return async(method)=>({getblockchaininfo:{chain:'test',initial_block_download:false},z_listreceivedbyaddress:[{pool:'orchard',change:false,amountZat:1000000,confirmations:3,outindex:0,txid,memo:Buffer.from(i.memo).toString('hex'),...change.note}],getrawtransaction:{txid,confirmations:3,blockhash:'b'.repeat(64),vin:[],vout:[],vjoinsplit:[],vShieldedSpend:[],vShieldedOutput:[],orchard:{actions:[{}]},...change.tx}}[method])}
test('receipt requires exact memo, amount, confirmed shielded note and private transaction',async()=>{
 const bill=i();assert.equal((await verifyInvoice(rpc(bill),bill)).state,'confirmed');
 for(const note of [{amountZat:999999},{confirmations:0},{memo:''},{pool:'transparent'},{change:true}])assert.equal((await verifyInvoice(rpc(bill,{note}),bill)).state,'awaiting_payment');
 for(const tx of [{vin:[{}]},{vout:[{}]},{vShieldedSpend:[{}]},{in_active_chain:false},{confirmations:0}])await assert.rejects(verifyInvoice(rpc(bill,{tx}),bill));
 assert.equal((await verifyInvoice(rpc(bill),bill,{now:bill.expiresAt})).state,'late_payment_review');
 assert.equal((await verifyInvoice(rpc(bill,{note:{amountZat:1}}),bill,{now:bill.expiresAt})).state,'expired_unpaid');
 for(const confirmations of [undefined,null,'3',NaN])await assert.rejects(verifyInvoice(rpc(bill,{tx:{confirmations}}),bill));
 await assert.rejects(verifyInvoice(rpc(bill),{...bill,network:'main'}));
});
test('send is explicitly authorized and always FullPrivacy',async()=>{
 const bill=i(),calls=[];const call=async(m,p)=>{calls.push([m,p]);return m==='getblockchaininfo'?{chain:'test',initial_block_download:false}:'operation'};
 await assert.rejects(sendPrivate(call,{from:'payer',invoice:bill}));assert.equal(calls.length,0);
 await assert.rejects(sendPrivate(call,{from:'payer',invoice:bill,approved:'yes'}));
 await assert.rejects(sendPrivate(call,{from:'payer',invoice:{...bill,amountZat:'1'},approved:true}));
 await assert.rejects(sendPrivate(call,{from:'payer',invoice:{...bill,expiresAt:undefined},approved:true}));assert.equal(calls.length,0);
 await sendPrivate(call,{from:'payer',invoice:bill,approved:true});assert.equal(calls.at(-1)[1].at(-1),'FullPrivacy');
 assert.equal(zats('0.00000001'),1n);assert.throws(()=>zats('1e-8'));assert.throws(()=>zats('-1'));
});
