import {walletRpc} from '../src/wallet-rpc.mjs';
import {testnetReadiness} from '../src/zallet-receipt.mjs';
// Read-only acceptance gate. Never creates keys, requests faucet funds, or sends.
const env=process.env;
try{
 const nodeRpc=walletRpc({url:env.VEILDESK_NODE_RPC_URL,cookieFile:env.VEILDESK_NODE_COOKIE_FILE});
 const wallet=walletRpc({url:env.VEILDESK_WALLET_RPC_URL,cookieFile:env.VEILDESK_WALLET_COOKIE_FILE});
 const chain=await nodeRpc('getblockchaininfo'),status=await wallet('getwalletstatus');
 console.log(JSON.stringify({chain:chain.chain,nodeHeight:chain.blocks,estimatedHeight:chain.estimatedheight,verificationProgress:chain.verificationprogress,wallet:status},null,2));
 await testnetReadiness(nodeRpc,wallet);
 console.log(JSON.stringify({ready:true,scope:'sync_only',paymentTestCompleted:false,executionAuthorized:false}));
}catch(error){console.error(JSON.stringify({ready:false,reason:error.message,paymentTestCompleted:false,executionAuthorized:false}));process.exitCode=1}
