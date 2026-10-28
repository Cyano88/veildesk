import {syncWalletCycle} from '/app/src/light-wallet-worker.mjs';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
process.umask(0o077);
const root='/var/data/veildesk-mainnet-buyer',binary='/opt/veildesk-wallet/zingo-cli';
try{const status=await syncWalletCycle({root,binary,password:readFileSync(0,'utf8').trim(),network:'main'});
 const balance=execFileSync(binary,['--chain','mainnet','--data-dir',root+'/wallet','--offline','balance'],{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
 const values=Object.fromEntries([...balance.matchAll(/^\s*([a-z_]+_balance): ([0-9_]+)\s*$/gm)].map(m=>[m[1],Number(m[2].replaceAll('_',''))]));
 if(Object.keys(values).length!==12||values.total_transparent_balance!==0||values.total_sapling_balance!==0||values.total_orchard_balance!==0||values.confirmed_ironwood_balance<30000)throw Error('Unexpected funding pools');
 const proof={network:'main',buyerSynced:true,height:status.height,confirmedIronwoodZat:values.confirmed_ironwood_balance,onlyIronwoodFunds:true,checkedAt:new Date().toISOString(),paymentSent:false};
 await writeFile(root+'/ready-to-propose.json',JSON.stringify(proof),{mode:0o600});console.log(JSON.stringify(proof));
}catch(e){console.log(JSON.stringify({buyerSynced:false,paymentSent:false,code:/^[a-z_]+$/.test(e.message)?e.message:"readiness_failed"}));process.exitCode=1;}

