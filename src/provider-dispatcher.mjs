import {configuredPayment,paidMandateCapability,paidResearchCapability} from './zcash-network.mjs';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createPaidProvider,PAID_CAPABILITY} from './paid-provider.mjs';
import {PAID_RESEARCH} from './service-rehearsal.mjs';
import {processClaim} from './provider.mjs';
import {walletRpc} from './wallet-rpc.mjs';

// Trusted host injection only. Requests cannot choose modules, callbacks or RPC destinations.
export async function createProviderDispatcher({config,keys,rpc,research,settlement,createRpc=walletRpc}) {
  const researchEnabled=config.researchService?.enabled===true;
  if(researchEnabled&&typeof research!=='function')throw Error('Research requires an explicit implementation');
  const payment=configuredPayment(config);
  if(researchEnabled&&(typeof research!=='function'||!payment))
    throw Error('Research requires an explicit implementation and testnet payment configuration');
  let validation,service;
  try {
    if(payment){
      await mkdir(config.stateDirectory,{recursive:true,mode:0o700});

      const options={...payment,...keys,peers:config.peers,database:join(config.stateDirectory,payment.network==='main'?'mainnet-payments.db':'testnet-payments.db'),
        ...(settlement?{settlement}:{nodeRpc:createRpc(payment.node),walletRpc:createRpc(payment.wallet)})};
      // One authoritative ledger prevents note reuse across both paid capabilities.
      validation=createPaidProvider(options);
      if(researchEnabled)service=createPaidProvider({...options,research});
    }
  }catch(error){validation?.close();service?.close();throw error;}
  return {
    async process(job){
      if([PAID_RESEARCH,paidResearchCapability('main')].includes(job.capability)){if(!service)throw Error('Paid research disabled');return service.process(job,{rpc});}
      if([PAID_CAPABILITY,paidMandateCapability('main')].includes(job.capability)){if(!validation)throw Error('Paid validation disabled');return validation.process(job,{rpc});}
      if(job.capability!=='prediction.mandate.validate.v1')throw Error('Unsupported provider capability');
      return processClaim(job,{...config,...keys,rpc});
    },
    close(){service?.close();validation?.close();},
  };
}
