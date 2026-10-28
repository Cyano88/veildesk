import {createRemoteWalletSettlement} from '../src/wallet-bridge.mjs';
import {readFile} from 'node:fs/promises';import {setTimeout} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {relayClient} from '../src/client.mjs';import {loadEndpointIdentity} from '../src/endpoint-identity.mjs';
import {createProviderDispatcher} from '../src/provider-dispatcher.mjs';
export async function runProviderWorker({research,settlement}={}){
process.umask(0o077);
const file=process.env.VEILDESK_PROVIDER_CONFIG;if(!file)throw Error('Set VEILDESK_PROVIDER_CONFIG');
const config=JSON.parse(await readFile(file,'utf8')),keys=await loadEndpointIdentity(config.identity),rpc=relayClient(config);
const bridgeRaw=process.env.VEILDESK_WALLET_CLIENT_JSON;delete process.env.VEILDESK_WALLET_CLIENT_JSON;
if(bridgeRaw&&settlement)throw Error('Conflicting trusted wallet backends');
const bridge=bridgeRaw?JSON.parse(bridgeRaw):null;
const configuredSettlement=settlement??(bridge?createRemoteWalletSettlement({...bridge,...keys,rpc:relayClient(bridge)}):undefined);
const dispatcher=await createProviderDispatcher({config,keys,rpc,research,settlement:configuredSettlement});
let stop=false;for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>stop=true);
const {providerScheduler}=await import('../src/provider-scheduler.mjs');
const tick=providerScheduler({rpc,shouldStop:()=>stop,claimBatch:config.claimBatch??5,pendingLimit:config.pendingLimit??20,
 onJobError:()=>console.error('Provider job requires reconciliation; no automatic re-execution.'),
 processJob:job=>dispatcher.process(job)
});
while(!stop){
 let pause=2000;
 try{await tick()}catch(error){if(error.status===429)pause=60000;console.error('Relay unavailable or rate-limited; retrying transport. No credentials or payload logged.')}
 // Short sleeps make graceful stop responsive even during rate-limit backoff.
 for(let waited=0;waited<pause&&!stop;waited+=200)await setTimeout(200);
}
dispatcher.close();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runProviderWorker();
