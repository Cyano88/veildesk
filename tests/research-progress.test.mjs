import test from 'node:test';
import assert from 'node:assert/strict';
import {researchProgress,watchResearch} from '../src/research-progress.mjs';
const waiting={state:'processing',executionAuthorized:false};
const done={state:'completed',executionAuthorized:false,result:{payload:{status:'fulfilled',paymentVerified:true,executionAuthorized:false,tradeSubmitted:false,report:{schema:'polydesk-a2a-market-research-v1',orderAuthorized:false,orderSubmitted:false}}}};
test('progress exposes no invoice, transaction, identity or report contents and never grants execution',()=>{
 const row={...waiting,payment:{invoice:{address:'secret',memo:'secret'}},paymentHintSubmitted:true};
 assert.deepEqual(researchProgress(row),{stage:'verifying_payment',terminal:false,executionAuthorized:false});
 assert.equal(researchProgress({...row,paymentReview:{reason:'private'}}).stage,'payment_review');
 assert.equal(researchProgress({...row,late:true}).stage,'expired_review');
 assert.throws(()=>researchProgress({...done,result:undefined}),/delivery/);
 assert.equal(researchProgress(done).stage,'fulfilled');
});
test('watch reads the same purchase, emits transitions and cannot submit or pay',async()=>{
 const rows=[waiting,{...waiting,payment:{}},done],events=[];
 const client={get:async id=>{assert.equal(id,'existing');return rows.shift()},submit:()=>assert.fail('no submit')};
 assert.equal((await watchResearch({client,id:'existing',pollMs:100,onProgress:p=>events.push(p.stage)})).stage,'fulfilled');
 assert.deepEqual(events,['awaiting_invoice','awaiting_payment','fulfilled']);
});
test('timeout and transport errors never claim failure or fulfillment, and omit raw secrets',async()=>{
 assert.equal((await watchResearch({client:{get:()=>new Promise(()=>{})},id:'existing',timeoutMs:10})).stage,'pending');
 await assert.rejects(watchResearch({client:{get:async()=>{throw Error('secret-token')}},id:'existing'}),error=>!error.message.includes('secret-token')&&error.message.includes('existing request'));
});
