import {readFile} from 'node:fs/promises';
import {walletRpc} from '../src/wallet-rpc.mjs';
import {paymentPreflight} from '../src/payment-recipient.mjs';
// Uses the provider's existing private config; emits no keys or addresses.
try{
 const config=JSON.parse(await readFile(process.env.VEILDESK_PROVIDER_CONFIG,'utf8'));
 const p=config.testnetPayment;
 if(p?.network!=='test')throw Error('Testnet payment configuration required');
 const report=await paymentPreflight({account:p.account,address:p.address,nodeRpc:walletRpc(p.node),walletRpc:walletRpc(p.wallet)});
 console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({ready:false,reason:error.message,settlementVerified:false,executionAuthorized:false}));process.exitCode=1}
