import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {walletNetwork} from '../src/zcash-network.mjs';
import {syncWalletCycle,verifyScan} from '../src/light-wallet-worker.mjs';
const progress={sync_start_height:90,total_blocks:11,total_blocks_scanned:11,total_outputs:0,total_outputs_scanned:0,percentage_total_blocks_scanned:100,percentage_total_outputs_scanned:100};
test('explicit mainnet readiness rejects testnet observations and unknown networks',()=>{
 assert.equal(walletNetwork('main').chain,'mainnet');
 assert.throws(()=>walletNetwork('mainnet'),/Unsupported/);
 assert.throws(()=>verifyScan({chain_name:'test',latest_block_height:100},progress,{height:100},{network:'main'}));
 assert.equal(verifyScan({chain_name:'main',latest_block_height:100},progress,{height:100},{network:'main'}).network,'main');
});
test('mainnet recovery persists separately and rejects network reuse before any wallet command or status mutation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'veildesk-mainnet-'));let calls=0;
 const command=async(_bin,dir,op,{network})=>{calls++;assert.equal(network,'main');
  if(op==='info'){await writeFile(join(dir,'wallet.fixture'),'mainnet-fixture-secret');return {chain_name:'main',latest_block_height:100};}
  if(op==='addresses'){assert.equal(await readFile(join(dir,'wallet.fixture'),'utf8'),'mainnet-fixture-secret');return [{account:0,encoded_address:'mainnet-fixture-address'}];}
  if(op==='sync')return progress;if(op==='height')return {height:100};throw Error('Unexpected command');
 };
 try{
  const config={root,binary:'fixture',password:'mainnet-test-recovery-password-32chars',network:'main',command};
  const result=await syncWalletCycle(config);assert.equal(result.network,'main');assert.equal(result.offlineRecoveryVerified,true);assert.equal(result.paidFulfillmentEnabled,false);
  assert.equal((await syncWalletCycle(config)).syncReady,true);
  const oldCalls=calls,oldStatus=await readFile(join(root,'status.json'),'utf8');
  await assert.rejects(syncWalletCycle({...config,network:'test'}),/network_identity_mismatch/);
  assert.equal(calls,oldCalls);assert.equal(await readFile(join(root,'status.json'),'utf8'),oldStatus);
  assert.equal((await readFile(join(root,'recovery.initial.json'),'utf8')).includes('mainnet-fixture-secret'),false);
 }finally{await rm(root,{recursive:true,force:true})}
});
