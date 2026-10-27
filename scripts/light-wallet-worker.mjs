import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {syncWalletCycle,walletCommand} from '../src/light-wallet-worker.mjs';
import {captureNativeEvidence} from '../src/light-wallet-capture.mjs';
import {verifyLightWalletSnapshot} from '../src/light-wallet-receipt.mjs';
import {createLightWalletSettlement} from '../src/settlement.mjs';
import {createWalletBridgeProcessor} from '../src/wallet-bridge.mjs';
import {loadEndpointIdentity} from '../src/endpoint-identity.mjs';
import {relayClient} from '../src/client.mjs';
import {providerScheduler} from '../src/provider-scheduler.mjs';
process.umask(0o077);
const root='/var/data/veildesk-light-wallet',binary='/opt/veildesk-wallet/zingo-cli',native='/opt/veildesk-wallet/veildesk-evidence';
const password=process.env.VEILDESK_CHECKPOINT_PASSWORD;
const rawBridge=process.env.VEILDESK_WALLET_BRIDGE_JSON;delete process.env.VEILDESK_WALLET_BRIDGE_JSON;
const config=rawBridge?JSON.parse(rawBridge):null;
if(typeof password!=='string'||password.length<32)throw Error('Wallet recovery password is required');
if(config&&(config.accountId!==0||config.id!=='veildesk-wallet'))throw Error('Invalid wallet bridge configuration');
await mkdir(root,{recursive:true,mode:0o700});
// All sync, capture and bridge work runs serially under the container's OS flock.
async function save(name,value){const path=join(root,name+'.tmp');await writeFile(path,JSON.stringify(value),{mode:0o600});await rename(path,join(root,name+'.json'))}
let stopping=false,tick,nextScan=0;process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
async function capture(query){
 const scan=await syncWalletCycle({root,binary,password});
 const snapshot=await captureNativeEvidence({root,binary:native,query,scan});
 verifyLightWalletSnapshot(snapshot,{address:query.address,accountId:query.accountId,now:Date.now()});
 const ready={...scan,nativeRecipientVerified:true};await save('status',ready);nextScan=Date.now()+120000;
 return snapshot;
}
while(!stopping){
 try{
  if(Date.now()>=nextScan){
   const scan=await syncWalletCycle({root,binary,password});
   const addresses=await walletCommand(binary,join(root,'wallet'),'addresses');
   const address=addresses[0].encoded_address,accountId=addresses[0].account;
   const snapshot=await captureNativeEvidence({root,binary:native,query:{address,accountId,txid:'0'.repeat(64)},scan});
   verifyLightWalletSnapshot(snapshot,{address,accountId,now:Date.now()});
   if(snapshot.evidence.transaction!==null)throw Error('Unexpected preflight transaction');
   await save('recipient',{network:'test',accountId,address});
   const ready={...scan,nativeRecipientVerified:true};await save('status',ready);console.log(JSON.stringify({event:'wallet_sync',...ready}));
   nextScan=Date.now()+120000;
   if(config&&!tick){
    const keys=await loadEndpointIdentity(config.identity),rpc=relayClient(config);
    const backend=createLightWalletSettlement({capture,accountId,address});
    const process=createWalletBridgeProcessor({providerId:config.id,accountId,address,backend,...keys,peers:config.peers,stateDirectory:join(root,'bridge')});
    tick=providerScheduler({rpc,processJob:job=>process(job,{rpc}),shouldStop:()=>stopping,claimBatch:1,pendingLimit:5,
     onJobError:()=>console.error('Authenticated wallet request requires reconciliation; no payload logged.')});
    console.log(JSON.stringify({event:'wallet_bridge_ready',publicWalletRpc:false,spendingEnabled:false}));
   }
  }
  if(tick)await tick();
 }catch{const failed={event:'wallet_sync_or_transport_failed',syncReady:false,settlementVerified:false,paidFulfillmentEnabled:false,checkedAt:new Date().toISOString()};await save('status',failed);console.error(JSON.stringify(failed));}
 for(let seconds=0;seconds<2&&!stopping;seconds++)await new Promise(resolve=>setTimeout(resolve,1000));
}
