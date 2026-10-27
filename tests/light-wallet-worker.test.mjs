import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyScan,walletCommand,syncWalletCycle} from '../src/light-wallet-worker.mjs';
const info={chain_name:'test',latest_block_height:100};
const progress={sync_start_height:90,total_blocks:11,total_blocks_scanned:11,total_outputs:20,total_outputs_scanned:20,percentage_total_blocks_scanned:100,percentage_total_outputs_scanned:100};
test('light wallet readiness rejects wrong chain, unscanned outputs and stale height',()=>{
 assert.equal(verifyScan(info,progress,{height:100}).syncReady,true);
 for(const [i,p,h] of [[{...info,chain_name:'main'},progress,100],[info,{...progress,total_outputs_scanned:19},100],[info,{...progress,percentage_total_blocks_scanned:99},100],[info,{...progress,sync_start_height:0},100],[info,progress,99]])assert.throws(()=>verifyScan(i,p,{height:h}));
 assert.equal(verifyScan(info,progress,{height:100}).settlementVerified,false);
 assert.throws(()=>walletCommand('unused','unused','send'),/forbidden/);
});
test('persistent identity and encrypted offline recovery survive restart and reject changed identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'veildesk-wallet-test-'));
 const password='test-password-with-at-least-32-characters';let changed=false;
 const addresses=[{encoded_address:'test-recipient',account_id:0}];
 const command=async(_binary,directory,op)=>{
  if(op==='info'){await writeFile(join(directory,'zingo-wallet.dat'),'fixture-wallet-secret');return info}
  if(op==='addresses'){assert.equal(await readFile(join(directory,'zingo-wallet.dat'),'utf8'),'fixture-wallet-secret');return changed?[{encoded_address:'wrong-recipient'}]:addresses}
  if(op==='sync')return progress;if(op==='height')return {height:100};throw Error('unexpected command');
 };
 try{
  const options={root,password,binary:'fixture',command};
  assert.equal((await syncWalletCycle(options)).offlineRecoveryVerified,true);
  assert.equal((await syncWalletCycle(options)).syncReady,true);
  const backup=await readFile(join(root,'recovery.initial.json'),'utf8');
  assert.equal(backup.includes('fixture-wallet-secret'),false);
  changed=true;await assert.rejects(syncWalletCycle(options),/identity_changed/);
  changed=false;await rm(join(root,'wallet'),{recursive:true});
  await assert.rejects(syncWalletCycle(options),/state_missing/);
 }finally{await rm(root,{recursive:true,force:true})}
});
