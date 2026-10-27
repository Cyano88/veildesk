import {testnetReadiness} from './zallet-receipt.mjs';

// Read-only ownership check against the trusted local recipient wallet.
// This proves wallet tracking, not spend authority, backup health or settlement.
export async function verifyPaymentRecipient({walletRpc,account,address}){
 if(typeof account!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(account)||typeof address!=='string'||!address)throw Error('Invalid payment recipient configuration');
 const result=await walletRpc('z_getaccount',[account]);
 if(result?.account_uuid!==account||!Array.isArray(result.addresses)||!result.addresses.some(entry=>entry?.ua===address))throw Error('Payment recipient is not a unified address tracked by the configured wallet account');
 return {recipientTracked:true,settlementVerified:false,executionAuthorized:false};
}

export async function paymentPreflight({nodeRpc,walletRpc,account,address}){
 const chain=await testnetReadiness(nodeRpc,walletRpc);
 const recipient=await verifyPaymentRecipient({walletRpc,account,address});
 return {...recipient,network:chain.chain,nodeHeight:chain.blocks,syncReady:true};
}
