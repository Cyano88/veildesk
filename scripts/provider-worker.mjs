import {readFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {setTimeout} from 'node:timers/promises';
import {relayClient} from '../src/client.mjs';import {loadEndpointIdentity} from '../src/endpoint-identity.mjs';import {processClaim} from '../src/provider.mjs';
import {createPaidProvider,PAID_CAPABILITY} from '../src/paid-provider.mjs';import {walletRpc} from '../src/wallet-rpc.mjs';
process.umask(0o077);
const file=process.env.VEILDESK_PROVIDER_CONFIG;if(!file)throw Error('Set VEILDESK_PROVIDER_CONFIG');
const config=JSON.parse(await readFile(file,'utf8')),keys=await loadEndpointIdentity(config.identity),rpc=relayClient(config);
let paid;
if(config.testnetPayment?.enabled===true){
 await mkdir(config.stateDirectory,{recursive:true,mode:0o700});
 const p=config.testnetPayment;
 paid=createPaidProvider({...p,...keys,peers:config.peers,database:join(config.stateDirectory,'testnet-payments.db'),nodeRpc:walletRpc(p.node),walletRpc:walletRpc(p.wallet)});
}
let stop=false;for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>stop=true);
const {providerScheduler}=await import('../src/provider-scheduler.mjs');
const tick=providerScheduler({rpc,shouldStop:()=>stop,claimBatch:config.claimBatch??5,pendingLimit:config.pendingLimit??20,
 onJobError:()=>console.error('Provider job requires reconciliation; no automatic re-execution.'),
 processJob:async job=>{if(job.capability===PAID_CAPABILITY){if(!paid)throw Error('Paid service disabled');await paid.process(job,{rpc})}else await processClaim(job,{...config,...keys,rpc})}
});
while(!stop){
 let pause=2000;
 try{await tick()}catch(error){if(error.status===429)pause=60000;console.error('Relay unavailable or rate-limited; retrying transport. No credentials or payload logged.')}
 // Short sleeps make graceful stop responsive even during rate-limit backoff.
 for(let waited=0;waited<pause&&!stop;waited+=200)await setTimeout(200);
}
paid?.close();
