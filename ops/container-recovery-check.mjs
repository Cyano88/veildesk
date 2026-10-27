// Runs inside a disposable non-root container; fixture keys never leave encrypted backup.
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {readFile,writeFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {createMandateClient} from '/app/src/mandate-client.mjs';
const mode=process.argv[2],root=mode==='create'?'/tmp/original':'/tmp/restored';
const read=async p=>JSON.parse(await readFile(p,'utf8'));const save=(p,v)=>writeFile(p,JSON.stringify(v),{mode:0o600});
async function run(args){const p=spawn(process.execPath,args,{cwd:'/app',stdio:['ignore','pipe','pipe']});let err='';p.stdout.resume();p.stderr.on('data',b=>err+=b);const [code]=await once(p,'exit');assert.equal(code,0,err)}
function start(script,env){const p=spawn(process.execPath,[script],{cwd:'/app',env:{...process.env,...env},stdio:['ignore','pipe','pipe']});p.stdout.resume();p.stderr.resume();return p}
async function stop(p){if(!p||p.exitCode!==null)return;const done=once(p,'exit');p.kill('SIGTERM');await done}
async function ready(p){for(let i=0;i<100;i++){if(p.exitCode!==null)throw Error('Relay exited');try{if((await fetch('http://127.0.0.1:5181/healthz')).ok)return}catch{}await delay(50)}throw Error('Relay not ready')}
async function completed(client,id){for(let i=0;i<100;i++){const r=await client.get(id);if(r.state==='completed')return r;await delay(100)}throw Error('Delivery timeout')}
let relay,worker;const checks=[];
try{
 assert.equal(process.getuid(),1000);
 if(mode==='create')await run(['scripts/provision-relay.mjs',root]);
 else {assert.equal(mode,'restore');await run(['scripts/checkpoint.mjs','restore','/transfer/checkpoint.enc',root])}
 const config=await read(root+'/client.json');
 relay=start('scripts/relay-server.mjs',{VEILDESK_RELAY_CONFIG:root+'/relay.json'});await ready(relay);
 const client=await createMandateClient({config,stateDirectory:root+'/client-state'});
 if(mode==='create'){
  const mandate=id=>({schema:'veildesk.mandate.v1',id,mode:'dry_run',market:'container-recovery-fixture',side:'YES',maxSpendUsd:'1.00',limitPrice:'0.5',expiresAt:Date.now()+600000,approval:'preview_only'});
  const first=mandate(randomUUID()),pending=mandate(randomUUID());await client.submit(first);
  worker=start('scripts/provider-worker.mjs',{VEILDESK_PROVIDER_CONFIG:root+'/provider.json'});
  const result=await completed(client,first.id);assert.equal(result.executionAuthorized,false);await stop(worker);worker=null;
  await client.submit(pending);assert.equal((await client.get(pending.id)).state,'queued');await stop(relay);relay=null;
  await run(['scripts/checkpoint.mjs','backup',root,'/transfer/checkpoint.enc','--services-stopped']);
  await save('/transfer/expected.json',{first,pending,result});checks.push('packaged_provisioning','separate_relay_worker','authenticated_completed_result','queued_job_checkpoint','encrypted_checkpoint_cli');
 }else{
  const expected=await read('/transfer/expected.json');
  assert.deepEqual((await client.get(expected.first.id)),expected.result);
  assert.equal((await client.submit(expected.first)).state,'completed');assert.equal((await client.get(expected.pending.id)).state,'queued');
  worker=start('scripts/provider-worker.mjs',{VEILDESK_PROVIDER_CONFIG:root+'/provider.json'});
  const result=await completed(client,expected.pending.id);assert.equal(result.result.payload.status,'validated');assert.equal(result.executionAuthorized,false);
  checks.push('fresh_container_restore','original_result_verified','idempotent_completed_retry','queued_job_recovered','restored_provider_identity');
 }
 console.log(JSON.stringify({mode,passed:true,runtime:process.version,checks}));
}finally{await stop(worker);await stop(relay)}
