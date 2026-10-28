import {walletNetwork,nativeBackendId} from './zcash-network.mjs';
import {testnetReadiness,verifyZalletReceipt} from './zallet-receipt.mjs';
import {verifyPaymentRecipient} from './payment-recipient.mjs';
import {verifyLightWalletReceipt,verifyLightWalletSnapshot} from './light-wallet-receipt.mjs';
const supported=new Set(['c2d6d0b4','c8e71055','4dec4df0','5437f330','77190ad9']);
export function createZalletSettlement({nodeRpc,walletRpc,account,address}){
 if(typeof nodeRpc!=='function'||typeof walletRpc!=='function')throw Error('Missing Zallet RPC');
 return {id:'zallet-testnet-v1',address,
  async preflight(){const chain=await testnetReadiness(nodeRpc,walletRpc);if(!supported.has(chain.consensus?.chaintip))throw Error('Active testnet upgrade is unsupported by the payment verifier');},
  recipient:()=>verifyPaymentRecipient({walletRpc,account,address}),
  verify:({invoice,txid,now})=>verifyZalletReceipt({nodeRpc,walletRpc,invoice,account,txid,now})};
}
export function createLightWalletSettlement({capture,accountId,address,now=Date.now,network='test'}){
 walletNetwork(network);
 if(typeof capture!=='function'||!Number.isSafeInteger(accountId)||accountId<0||accountId>0x7fffffff||typeof address!=='string'||!address)throw Error('Invalid native settlement configuration');
 const checkedCapture=async query=>{
  const snapshot=await capture(query);
  verifyLightWalletSnapshot(snapshot,{address,accountId,now:now(),network});
  const branches=network==='test'?supported:new Set(['37a5165b']);
  if(!branches.has(snapshot.scan.consensusBranchId))throw Error('Active network upgrade is unsupported by the payment verifier');
  return snapshot;
 };
 const preflight=async()=>{await checkedCapture({accountId,address,txid:'0'.repeat(64)});return {recipientTracked:true,settlementVerified:false,executionAuthorized:false};
 };
 return {id:nativeBackendId(network,accountId),address,preflight,recipient:preflight,
  verify:({invoice,txid,now:verifiedAt})=>verifyLightWalletReceipt({capture:checkedCapture,invoice,accountId,txid,network,now:verifiedAt===undefined?now:()=>Math.max(verifiedAt,now())})};
}
