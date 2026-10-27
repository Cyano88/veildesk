import {walletRpc,inspectWallet} from '../src/wallet-rpc.mjs';
try{
 if(!process.env.VEILDESK_WALLET_RPC_URL)throw Error('Set VEILDESK_WALLET_RPC_URL to the local testnet Zallet RPC URL');
 const report=await inspectWallet(walletRpc({url:process.env.VEILDESK_WALLET_RPC_URL,cookieFile:process.env.VEILDESK_WALLET_COOKIE_FILE}));
 console.log(JSON.stringify(report,null,2));
}catch(error){console.error(JSON.stringify({ready:false,reason:error.message}));process.exitCode=1}
