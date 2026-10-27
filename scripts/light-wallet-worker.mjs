import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {syncWalletCycle,walletCommand} from '../src/light-wallet-worker.mjs';
import {captureNativeEvidence} from '../src/light-wallet-capture.mjs';
import {verifyLightWalletSnapshot} from '../src/light-wallet-receipt.mjs';
process.umask(0o077);
const root='/var/data/veildesk-light-wallet',binary='/opt/veildesk-wallet/zingo-cli',native='/opt/veildesk-wallet/veildesk-evidence';
const password=process.env.VEILDESK_CHECKPOINT_PASSWORD;
if(typeof password!=='string'||password.length<32)throw Error('Wallet recovery password is required');
await mkdir(root,{recursive:true,mode:0o700});
// The container entrypoint holds an OS flock across this owner's lifetime.
async function status(value){const path=join(root,'status.worker.tmp');await writeFile(path,JSON.stringify(value),{mode:0o600});await rename(path,join(root,'status.json'))}
let stopping=false;process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
while(!stopping){
 try{
  const scan=await syncWalletCycle({root,binary,password});
  const addresses=await walletCommand(binary,join(root,'wallet'),'addresses');
  const address=addresses[0].encoded_address,accountId=addresses[0].account;
  const snapshot=await captureNativeEvidence({root,binary:native,query:{address,accountId,txid:'0'.repeat(64)},scan});
  verifyLightWalletSnapshot(snapshot,{address,accountId,now:Date.now()});
  if(snapshot.evidence.transaction!==null)throw Error('Unexpected preflight transaction');
  const ready={...scan,nativeRecipientVerified:true};await status(ready);
  console.log(JSON.stringify({event:'wallet_sync',...ready}));
 }catch{const failed={event:'wallet_sync_failed',syncReady:false,settlementVerified:false,paidFulfillmentEnabled:false,checkedAt:new Date().toISOString()};
  await status(failed);console.error(JSON.stringify(failed));}
 for(let seconds=0;seconds<120&&!stopping;seconds++)await new Promise(resolve=>setTimeout(resolve,1000));
}
