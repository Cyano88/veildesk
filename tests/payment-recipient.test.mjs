import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPaymentRecipient} from '../src/payment-recipient.mjs';
const account='00000000-0000-4000-8000-000000000002',address='fixture-unified-address';
test('recipient check requires exact account and unified address without deriving or exporting keys',async()=>{
 const calls=[];const walletRpc=async(...args)=>{calls.push(args);return {account_uuid:account,addresses:[{ua:address}]}};
 assert.deepEqual(await verifyPaymentRecipient({walletRpc,account,address}),{recipientTracked:true,settlementVerified:false,executionAuthorized:false});
 assert.deepEqual(calls,[['z_getaccount',[account]]]);
 for(const response of [null,{}, {account_uuid:'other',addresses:[{ua:address}]},{account_uuid:account,addresses:[]},{account_uuid:account,addresses:[{ua:'other'}]},{account_uuid:account,addresses:[{sapling:address}]},{account_uuid:account,addresses:null}])await assert.rejects(verifyPaymentRecipient({walletRpc:async()=>response,account,address}),/not a unified/);
 await assert.rejects(verifyPaymentRecipient({walletRpc:async()=>{throw Error('offline')},account,address}),/offline/);
});
