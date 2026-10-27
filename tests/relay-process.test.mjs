import {createCheckpoint,restoreCheckpoint} from '../src/checkpoint.mjs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,readFile,writeFile,rm,copyFile,readdir,mkdir,symlink} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
import {relayClient} from '../src/client.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),polydesk=process.env.POLYDESK_ROOT||resolve(root,'../polydesk');
const read=async p=>JSON.parse(await readFile(p,'utf8'));const save=(p,v)=>writeFile(p,JSON.stringify(v),{mode:0o600});
async function run(args,{cwd=root,env={}}={}){
 const child=spawn(process.execPath,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
 const timer=setTimeout(()=>child.kill(),20000);try{const [code]=await once(child,'exit');assert.equal(code,0,stderr);return stdout.trim()}finally{clearTimeout(timer)}
}
async function stop(child){if(!child||child.exitCode!==null)return;const exited=once(child,'exit');child.kill();await exited}
async function server(config,port='0'){
 const child=spawn(process.execPath,['scripts/relay-server.mjs'],{cwd:root,env:{...process.env,VEILDESK_RELAY_CONFIG:config,PORT:port},stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stderr.on('data',x=>err+=x);
 return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('Relay startup timed out'))},15000);child.once('exit',()=>{clearTimeout(timeout);reject(Error('Relay exited before ready: '+err))});child.stdout.on('data',x=>{out+=x;if(out.includes('\n')){clearTimeout(timeout);const ready=JSON.parse(out.split('\n')[0]);resolve({child,url:`http://127.0.0.1:${ready.port}`})}})});
}
async function waitResult(get){for(let i=0;i<50;i++){const r=await get();if(r.state==='completed')return r;await delay(100)}throw Error('Provider delivery timed out')}

test('PolyDesk and independent client, real relay/provider processes, retries, worker restart and database restore',{timeout:90000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'veildesk-process-')),checkpoint=dir+'.enc',recovered=dir+'-recovered';let relay,worker;
 try{
  const a=join(dir,'a'),b=join(dir,'b');await run(['scripts/provision-relay.mjs',a]);await run(['scripts/provision-relay.mjs',b]);
  const configPath=join(a,'relay.json'),config=await read(configPath),provider=await read(join(a,'provider.json')),client=await read(join(a,'client.json')),external=await read(join(b,'client.json')),secondConfig=await read(join(b,'relay.json'));
  config.principals.push({...secondConfig.principals.find(p=>p.role==='client'),id:'independent-app'});external.provider=client.provider;
  provider.peers['independent-app']={encryptionKey:external.identity.encryption.publicKey,signingKey:external.identity.signing.publicKey};await save(configPath,config);
  relay=await server(configPath);
  const configure=async()=>{client.url=external.url=provider.url=relay.url;await save(join(a,'client.json'),client);await save(join(b,'client.json'),external);await save(join(a,'provider.json'),provider)};await configure();
  const clientEnv=folder=>({VEILDESK_CLIENT_CONFIG:join(folder,'client.json'),VEILDESK_CLIENT_STATE:join(folder,'client-state'),VEILDESK_SDK_ROOT:root});
  const poly=async(action,arg)=>JSON.parse(await run(['--import','tsx','scripts/veildesk-client.ts',action,arg],{cwd:polydesk,env:clientEnv(a)}));
  // External app resolves the SDK by its public package export, outside the checkout.
  await mkdir(join(b,'node_modules'));await symlink(root,join(b,'node_modules','veildesk'),process.platform==='win32'?'junction':'dir');
  await copyFile(join(root,'examples','prediction-market-client.mjs'),join(b,'integration.mjs'));
  const independent=async(action,arg)=>JSON.parse(await run([join(b,'integration.mjs'),action,arg],{env:clientEnv(b)}));
  const mandate=id=>({schema:'veildesk.mandate.v1',id,mode:'dry_run',market:'process-acceptance-private-marker',side:'YES',maxSpendUsd:'5.00',limitPrice:'0.5',expiresAt:Date.now()+600000,approval:'preview_only'});
  const id=randomUUID(),otherId=randomUUID(),file=join(dir,'mandate.json'),otherFile=join(dir,'other.json');await save(file,mandate(id));await save(otherFile,mandate(otherId));
  assert.equal((await poly('submit',file)).state,'queued');assert.equal((await poly('submit',file)).id,id);
  assert.equal((await independent('submit',otherFile)).state,'queued');
  const api=relayClient(client),otherApi=relayClient(external),providerApi=relayClient(provider);
  await assert.rejects(otherApi('/v1/jobs/'+id),e=>e.status===404);
  // Lost claim response: claim without processing, then let the real worker recover it.
  const lost=await providerApi('/v1/provider/claim',{method:'POST',body:{}});assert.equal(lost.job.id,id);
  const startWorker=()=>{const p=spawn(process.execPath,['scripts/provider-worker.mjs'],{cwd:root,env:{...process.env,VEILDESK_PROVIDER_CONFIG:join(a,'provider.json')},stdio:['ignore','ignore','pipe']});p.stderr.resume();return p};
  worker=startWorker();
  const first=await waitResult(()=>poly('get',id)),second=await waitResult(()=>independent('get',otherId));
  for(const value of [first,second]){assert.equal(value.result.payload.status,'validated');assert.equal(value.result.executionAuthorized,false);assert.equal(value.result.payload.tradeSubmitted,false)}
  const before=await api('/v1/jobs/'+id);await stop(worker);worker=null;
  // Provider restart and exact-client retry preserve the same encrypted result.
  worker=startWorker();assert.equal((await poly('submit',file)).state,'completed');assert.equal((await api('/v1/jobs/'+id)).envelope.ciphertext,before.envelope.ciphertext);await stop(worker);worker=null;
  const pendingId=randomUUID(),pendingFile=join(dir,'pending.json');await save(pendingFile,mandate(pendingId));assert.equal((await poly('submit',pendingFile)).state,'queued');
  await run(['scripts/backup-relay.mjs',config.database,join(dir,'backup')]);await stop(relay.child);relay=null;
  const restored=join(dir,'restored.db');await copyFile(join(dir,'backup','relay.db'),restored);config.database=restored;await save(configPath,config);
  // Restore to the same service URL with unchanged client state and pinned keys.
  relay=await server(configPath,new URL(client.url).port);await configure();
  assert.deepEqual((await poly('get',id)).result,first.result);assert.deepEqual((await independent('get',otherId)).result,second.result);
  await stop(relay.child);relay=null;
  config.principals=config.principals.filter(p=>p.id!=='independent-app');await save(configPath,config);
  relay=await server(configPath,new URL(client.url).port);
  await assert.rejects(relayClient(external)('/v1/jobs/'+otherId),e=>e.status===401);
  assert.equal((await poly('get',id)).state,'completed');await stop(relay.child);relay=null;
  const raw=await readFile(restored);assert.equal(raw.includes(Buffer.from('process-acceptance-private-marker')),false);assert.equal(raw.includes(Buffer.from(client.token)),false);
  // All writers are stopped; flush WAL left by platform-specific process termination.
  for(const database of [join(a,'relay.db'),restored]){const db=new DatabaseSync(database);db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.close()}
  // Dependencies are reinstalled on recovery; only private application state is backed up.
  await rm(join(b,'node_modules'),{recursive:true,force:true});
  await createCheckpoint({directory:dir,file:checkpoint,password:'fixture-only-checkpoint-passphrase',servicesStopped:true});
  await restoreCheckpoint({file:checkpoint,directory:recovered,password:'fixture-only-checkpoint-passphrase'});
  const recoveredConfig=join(recovered,'a','relay.json');
  relay=await server(recoveredConfig,new URL(client.url).port);
  const recoveredEnv=clientEnv(join(recovered,'a'));
  const result=JSON.parse(await run(['--import','tsx','scripts/veildesk-client.ts','get',id],{cwd:polydesk,env:recoveredEnv}));
  assert.deepEqual(result.result,first.result);
  const retry=JSON.parse(await run(['--import','tsx','scripts/veildesk-client.ts','submit',join(recovered,'mandate.json')],{cwd:polydesk,env:recoveredEnv}));assert.equal(retry.state,'completed');
  worker=spawn(process.execPath,['scripts/provider-worker.mjs'],{cwd:root,env:{...process.env,VEILDESK_PROVIDER_CONFIG:join(recovered,'a','provider.json')},stdio:['ignore','ignore','pipe']});worker.stderr.resume();
  const recoveredPending=await waitResult(async()=>JSON.parse(await run(['--import','tsx','scripts/veildesk-client.ts','get',pendingId],{cwd:polydesk,env:recoveredEnv})));assert.equal(recoveredPending.result.payload.status,'validated');assert.equal(recoveredPending.result.executionAuthorized,false);await stop(worker);worker=null;
  // Revocation survives relocation with unchanged pinned identities and service URL.
  const revoked=await read(join(recovered,'b','client.json'));await assert.rejects(relayClient(revoked)('/v1/jobs/'+otherId),e=>e.status===401);
  await stop(relay.child);relay=null;
 }finally{await stop(worker);await stop(relay?.child);await rm(dir,{recursive:true,force:true});await rm(recovered,{recursive:true,force:true});await rm(checkpoint,{force:true})}
});



