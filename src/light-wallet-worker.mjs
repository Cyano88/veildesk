import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,access,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createCheckpoint,restoreCheckpoint} from './checkpoint.mjs';
import {walletNetwork} from './zcash-network.mjs';

export const TESTNET_INDEXER='https://testnet.zec.rocks:443';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exists=async path=>{try{await access(path);return true}catch(e){if(e.code==='ENOENT')return false;throw e}};
async function atomic(path,value){const temp=path+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path)}

// This is sync readiness, never settlement or spend authorization.
export function verifyScan(info,progress,saved,{network='test'}={}){
 walletNetwork(network);
 if(info?.chain_name!==network||!Number.isSafeInteger(info.latest_block_height)||info.latest_block_height<1
  ||!Number.isSafeInteger(saved?.height)||saved.height<info.latest_block_height
  ||!Number.isSafeInteger(progress?.sync_start_height)||progress.sync_start_height<1)throw Error('wallet_sync_incomplete');
 for(const unit of ['blocks','outputs']){
  const count=progress['total_'+unit],scanned=progress['total_'+unit+'_scanned'];
  if(!Number.isSafeInteger(count)||count<0||scanned!==count||progress['percentage_total_'+unit+'_scanned']!==100)throw Error('wallet_scan_incomplete');
 }
 const branch=info.consensus_branch_id;
 const consensusBranchId=Number.isSafeInteger(branch)&&branch>=0&&branch<=0xffffffff?branch.toString(16).padStart(8,'0'):
  typeof branch==='string'&&/^(?:0x)?[a-fA-F0-9]{8}$/.test(branch)?branch.replace(/^0x/,'').toLowerCase():undefined;
 return {network,height:saved.height,syncReady:true,settlementVerified:false,paidFulfillmentEnabled:false,consensusBranchId};
}

// Only fixed read/sync commands are reachable. Never forward arbitrary CLI arguments or raw output to logs.
export function walletCommand(binary,directory,operation,{timeout=540000,env=process.env,network='test'}={}){
 const config=walletNetwork(network);
 const commands={info:['--server',config.indexer,'--nosync','--waitsync','info'],
  sync:['--server',config.indexer,'--waitsync','sync','status'],height:['--offline','height'],addresses:['--offline','addresses']};
 if(!Object.hasOwn(commands,operation))throw Error('wallet_command_forbidden');
 const childEnv=Object.fromEntries(['PATH','HOME','USERPROFILE','SystemRoot','TEMP','TMP','LANG','LC_ALL','LD_LIBRARY_PATH','ZINGO_NYM_PROXY'].filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));
 return new Promise((accept,reject)=>{
  const child=spawn(binary,['--chain',config.chain,'--data-dir',directory,...commands[operation]],{env:childEnv,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  let output='',bytes=0,failure;const limit=4*1024*1024;
  function terminate(reason){failure??=reason;try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL')}catch{}}
  const timer=setTimeout(()=>terminate('wallet_command_timeout'),timeout);
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>limit)terminate('wallet_output_limit');else output+=chunk.toString()});
  child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>limit)terminate('wallet_output_limit')});
  child.once('error',()=>{clearTimeout(timer);reject(Error('wallet_command_start_failed'))});
  child.once('close',code=>{clearTimeout(timer);if(failure||code!==0)return reject(Error(failure??'wallet_command_failed'));
   try{accept(JSON.parse(output))}catch{reject(Error('wallet_command_invalid_json'))}});
 });
}

export async function syncWalletCycle({root,binary,password,command=walletCommand,network='test'}){
 walletNetwork(network);
 const execute=(binary,directory,operation)=>command(binary,directory,operation,{network});
 root=resolve(root);const directory=join(root,'wallet'),identityPath=join(root,'identity.json');
 await mkdir(root,{recursive:true,mode:0o700});
 const established=await exists(identityPath);
 if(established&&JSON.parse(await readFile(identityPath,'utf8')).network!==network)throw Error('wallet_network_identity_mismatch');
 await atomic(join(root,'status.json'),{network,syncReady:false,settlementVerified:false,paidFulfillmentEnabled:false,checkedAt:new Date().toISOString()});
 if(established&&(!await exists(directory)||(await readdir(directory)).length===0))throw Error('wallet_state_missing');
 await mkdir(directory,{recursive:true,mode:0o700});
 const info=await execute(binary,directory,'info');
 if(info?.chain_name!==network)throw Error('wallet_wrong_network');
 const addresses=await execute(binary,directory,'addresses');
 if(!Array.isArray(addresses)||addresses.length===0)throw Error('wallet_recipient_missing');
 const identity={schema:'veildesk.light-wallet-identity.v1',network,addressDigest:digest(addresses)};
 if(established){const prior=JSON.parse(await readFile(identityPath,'utf8'));if(prior.addressDigest!==identity.addressDigest||prior.network!==network)throw Error('wallet_identity_changed')}
 else await atomic(identityPath,identity);
 // Initial encrypted recovery is verified by opening a restored copy offline. It is never funded.
 const backup=join(root,'recovery.initial.json'),verified=join(root,'recovery.verified.json');
 {
  if(!await exists(backup))await createCheckpoint({directory,file:backup,password,servicesStopped:true});
  const restored=join(root,'recovery-check');
  // Only this disposable restore directory is removed, never the active wallet or encrypted backup.
  await rm(restored,{recursive:true,force:true});
  try{await restoreCheckpoint({file:backup,directory:restored,password});
   const recovered=await execute(binary,restored,'addresses');
   if(digest(recovered)!==identity.addressDigest)throw Error('wallet_recovery_mismatch');
   await atomic(verified,{schema:'veildesk.wallet-recovery-check.v1',addressDigest:identity.addressDigest,offlineRestoreVerified:true});
  }finally{await rm(restored,{recursive:true,force:true})}
 }
 const progress=await execute(binary,directory,'sync');
 const saved=await execute(binary,directory,'height');
 const status={...verifyScan(info,progress,saved,{network}),offlineRecoveryVerified:true,checkedAt:new Date().toISOString()};
 await atomic(join(root,'status.json'),status);return status;
}
