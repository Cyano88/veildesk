import {readFile} from 'node:fs/promises';
import {loadEndpointIdentity} from '../src/endpoint-identity.mjs';
import {relayClient} from '../src/client.mjs';
import {createRemoteWalletSettlement} from '../src/wallet-bridge.mjs';
import {invoice} from '../src/zcash.mjs';
process.umask(0o077);
let config;
if(process.env.VEILDESK_WALLET_CLIENT_CONFIG)config=JSON.parse(await readFile(process.env.VEILDESK_WALLET_CLIENT_CONFIG,'utf8'));
else{
 const base=JSON.parse(process.env.VEILDESK_CONFIG_JSON??await readFile('/etc/secrets/veildesk.json','utf8'));
 config={...JSON.parse(process.env.VEILDESK_WALLET_CLIENT_JSON),identity:base.identity};
}
const keys=await loadEndpointIdentity(config.identity);
const backend=createRemoteWalletSettlement({...config,...keys,rpc:relayClient(config)});
const preflight=await backend.preflight();
let unknownPaymentState;
if(process.argv.includes('--unknown-payment'))unknownPaymentState=(await backend.verify({invoice:invoice({address:config.address,amount:'0.001',network:'test'}),txid:'0'.repeat(64)})).state;
if(unknownPaymentState!==undefined&&unknownPaymentState!=='awaiting_payment')throw Error('Unknown payment did not fail closed');
console.log(JSON.stringify({bridgeAuthenticated:true,recipientTracked:preflight.recipientTracked,unknownPaymentState,settlementVerified:false,tradeSubmitted:false}));
