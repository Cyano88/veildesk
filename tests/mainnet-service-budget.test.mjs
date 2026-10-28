import test from 'node:test';import assert from 'node:assert/strict';import {checkBudget} from '../ops/mainnet-service/prepare-invoice-transaction.mjs';
const now=Date.now(),invoice={network:'main',amount:'0.0002',amountZat:'20000',address:'u1fixture',nonce:'a'.repeat(48),memo:'VD1:'+'a'.repeat(48),expiresAt:now+2700000};
test('payment budget binds mainnet invoice, exact amount, fee, price and minimum remaining time',()=>{
 assert.equal(checkBudget(invoice,10000,'1300.00',now).totalZat,30000);
 for(const [i,fee,price] of [[{...invoice,network:'test'},10000,'1300'],[{...invoice,amountZat:'20001'},10000,'1300'],[{...invoice,memo:'wrong'},10000,'1300'],[{...invoice,expiresAt:now+599999},10000,'1300'],[invoice,50001,'1'],[invoice,0,'1'],[invoice,10000,'4000'],[invoice,10000,'NaN'],[invoice,10000,'0']])assert.throws(()=>checkBudget(i,fee,price,now));
 assert.equal(checkBudget(invoice,50000,'1428.57142857',now).totalZat,70000);
 assert.throws(()=>checkBudget(invoice,50000,'1428.57142858',now));
});
