import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {syncWalletCycle,walletCommand} from '../src/light-wallet-worker.mjs';
process.umask(0o077);
const root='/var/data/veildesk-test-buyer';
const binary='/opt/veildesk-wallet/zingo-cli';
const password=process.env.VEILDESK_CHECKPOINT_PASSWORD;
if(!password||password.length<32)throw Error('Recovery configuration missing');
try{
 const status=await syncWalletCycle({root,binary,password});
 const addresses=await walletCommand(binary,root+'/wallet','addresses');
 if(addresses[0]?.account!==0||!addresses[0]?.encoded_address?.startsWith('utest'))throw Error('Buyer recipient invalid');
 const address=addresses[0].encoded_address;
 await writeFile(root+'/recipient.json',JSON.stringify({network:'test',accountId:0,address}),{mode:0o600});
 const recovery=await readFile(root+'/recovery.initial.json');
 console.log(JSON.stringify({buyerReady:true,network:'test',height:status.height,offlineRecoveryVerified:status.offlineRecoveryVerified,recoverySha256:createHash('sha256').update(recovery).digest('hex'),recoveryBytes:recovery.length,paymentSent:false}));
}catch{console.error('Buyer initialization failed; private state retained.');process.exitCode=1;}
