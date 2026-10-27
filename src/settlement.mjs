import {testnetReadiness,verifyZalletReceipt} from './zallet-receipt.mjs';
import {verifyPaymentRecipient} from './payment-recipient.mjs';
import {verifyLightWalletReceipt,verifyLightWalletSnapshot} from './light-wallet-receipt.mjs';
const supported=new Set(['c2d6d0b4','c8e71055','4dec4df0','5437f330','77190ad9']);
export function createZalletSettlement({nodeRpc,walletRpc,account,address}){
 if(typeof nodeRpc!=='function'||typeof walletRpc!=='function')throw Error('Missing Zallet RPC');
 return {id:'zallet-testnet-v1',
  async preflight(){const chain=await testnetReadiness(nodeRpc,walletRpc);if(!supported.has(chain.consensus?.chaintip))throw Error('Active testnet upgrade is unsupported by the payment verifier');},
  recipient:()=>verifyPaymentRecipient({walletRpc,account,address}),
  verify:({invoice,txid,now})=>verifyZalletReceipt({nodeRpc,walletRpc,invoice,account,txid,now})};
}
export function createLightWalletSettlement({capture,accountId,address,now=Date.now}){
 if(typeof capture!=='function'||!Number.isSafeInteger(accountId)||accountId<0||accountId>0x7fffffff||typeof address!=='string'||!address)throw Error('Invalid native settlement configuration');
 const preflight=async()=>{
  const snapshot=await capture({accountId,address,txid:'0'.repeat(64)});
  verifyLightWalletSnapshot(snapshot,{address,accountId,now:now()});
  if(!supported.has(snapshot.scan.consensusBranchId))throw Error('Active testnet upgrade is unsupported by the payment verifier');
  return {recipientTracked:true,settlementVerified:false,executionAuthorized:false};
 };
 return {id:`zingolib-testnet-v1:${accountId}`,preflight,recipient:preflight,
  verify:({invoice,txid,now:verifiedAt})=>verifyLightWalletReceipt({capture,invoice,accountId,txid,now:verifiedAt===undefined?now:()=>Math.max(verifiedAt,now())})};
}
