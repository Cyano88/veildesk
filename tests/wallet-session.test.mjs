import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWalletSession} from '../src/wallet-session.mjs';
const info={chain_name:'main',latest_block_height:100,vendor:'braces { and } and quote "'};
const progress={sync_start_height:90,scan_ranges:[{start:90,end:100}]};
const encode=(...values)=>values.map(value=>JSON.stringify(value)).join('\n');
const valid=encode(info,progress)+'\nZingo CLI quit successfully.\n';
test('session output accepts nested JSON and escaped strings',()=>{
 assert.deepEqual(parseWalletSession(valid),{info,progress});
});
test('session output rejects command failures, missing results and extra output',()=>{
 for(const output of ['',encode(info),'Error: sync failed\n'+valid,
  encode(info,progress),valid+'unexpected',encode(info,progress,{height:100})+'\nZingo CLI quit successfully.',
  encode(progress,info)+'\nZingo CLI quit successfully.','{broken}\n'+valid]){
  assert.throws(()=>parseWalletSession(output),/wallet_session_invalid_output/);
 }
});
