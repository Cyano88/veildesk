import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {syncWalletCycle} from '../src/light-wallet-worker.mjs';
process.umask(0o077);
const root='/var/data/veildesk-light-wallet',binary='/opt/veildesk-wallet/zingo-cli';
const password=process.env.VEILDESK_CHECKPOINT_PASSWORD;
if(typeof password!=='string'||password.length<32)throw Error('Wallet recovery password is required');
await mkdir(root,{recursive:true,mode:0o700});
// The container entrypoint holds an OS flock across the worker lifetime.

let stopping=false;process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
while(!stopping){
 try{console.log(JSON.stringify({event:'wallet_sync',...await syncWalletCycle({root,binary,password})}))}
 catch{const status={event:'wallet_sync_failed',syncReady:false,settlementVerified:false,paidFulfillmentEnabled:false,checkedAt:new Date().toISOString()};
  await writeFile(join(root,'status.json'),JSON.stringify(status),{mode:0o600});console.error(JSON.stringify(status));}
 for(let seconds=0;seconds<120&&!stopping;seconds++)await new Promise(resolve=>setTimeout(resolve,1000));
}
