import {captureNativeEvidence} from '../src/light-wallet-capture.mjs';
import {verifyLightWalletSnapshot} from '../src/light-wallet-receipt.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {syncWalletCycle,walletCommand} from '../src/light-wallet-worker.mjs';
process.umask(0o077);
// Operator-only setup. Run under /var/data/veildesk-mainnet-buyer.lock.
// The independent checkpoint password arrives via stdin, never command arguments.
const root='/var/data/veildesk-mainnet-buyer',binary='/opt/veildesk-wallet/zingo-cli';
const password=readFileSync(0,'utf8').trim();
if(password.length<32||password.length>256)throw Error('Mainnet recovery password required');
try{
 const status=await syncWalletCycle({root,binary,password,network:'main'});
 const entries=await walletCommand(binary,root+'/wallet','addresses',{network:'main'});
 const address=entries[0]?.encoded_address;
 if(entries[0]?.account!==0||!address?.startsWith('u1'))throw Error('Unexpected mainnet recipient');
 const snapshot=await captureNativeEvidence({root,binary:'/opt/veildesk-wallet/veildesk-evidence',query:{accountId:0,address,txid:'0'.repeat(64)},scan:status,network:'main'});
 verifyLightWalletSnapshot(snapshot,{accountId:0,address,network:'main',now:Date.now()});
 if(snapshot.evidence.transaction!==null)throw Error('Unexpected transaction');
 await writeFile(root+'/recipient.json',JSON.stringify({network:'main',accountId:0,address}),{mode:0o600});
 const recovery=await readFile(root+'/recovery.initial.json');
 console.log(JSON.stringify({role:'buyer',network:'main',nativeRecipientVerified:true,syncReady:status.syncReady,height:status.height,consensusBranchId:status.consensusBranchId,offlineRecoveryVerified:status.offlineRecoveryVerified,recoverySha256:createHash('sha256').update(recovery).digest('hex'),recoveryBytes:recovery.length,settlementVerified:false,paidFulfillmentEnabled:false,spendingEnabled:false}));
}catch(e){console.error(JSON.stringify({mainnetSetupFailed:true,code:/^[a-z_]+$/.test(e.message)?e.message:'wallet_setup_failed',statePreserved:true}));process.exitCode=1}
