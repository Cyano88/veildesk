import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID,createHash} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {relayClient,preparePrivateJob,openPrivateResult} from '../src/client.mjs';import {loadEndpointIdentity} from '../src/endpoint-identity.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'veildesk-worker-load-')),privateDir=join(dir,'private'),hash=x=>createHash('sha256').update(x).digest('hex');
const read=async p=>JSON.parse(await readFile(p,'utf8'));let relay,worker;const report={schema:'veildesk.worker-acceptance.v1',startedAt:new Date().toISOString(),runtime:process.version,platform:process.platform,passed:false,scope:'Actual separate relay and production worker processes, unpaid synthetic mandates, 105 preclaimed jobs including one uncertain reservation plus 15 queued jobs; local loopback only. Rate quota raised to isolate scheduling.'};
async function stop(p){if(!p||p.exitCode!==null)return;const done=once(p,'exit');p.kill();await done}
async function batch(items,fn){for(let i=0;i<items.length;i+=10)await Promise.all(items.slice(i,i+10).map(fn))}
try{
 const provision=spawn(process.execPath,['scripts/provision-relay.mjs',privateDir],{cwd:root,stdio:'ignore'});assert.equal((await once(provision,'exit'))[0],0);
 const config=await read(join(privateDir,'relay.json'));config.maxRequestsPerMinute=100000;await writeFile(join(privateDir,'relay.json'),JSON.stringify(config));
 relay=spawn(process.execPath,['scripts/relay-server.mjs'],{cwd:root,env:{...process.env,VEILDESK_RELAY_CONFIG:join(privateDir,'relay.json'),PORT:'0'},stdio:['ignore','pipe','pipe']});relay.stderr.resume();
 const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Relay startup timeout')),10000);relay.stdout.on('data',b=>{out+=b;if(out.includes('\n')){clearTimeout(timer);resolve('http://127.0.0.1:'+JSON.parse(out.split('\n')[0]).port)}})});
 const c=await read(join(privateDir,'client.json')),p=await read(join(privateDir,'provider.json'));c.url=p.url=url;await writeFile(join(privateDir,'provider.json'),JSON.stringify(p));
 const ck=await loadEndpointIdentity(c.identity),pk=await loadEndpointIdentity(p.identity),client=relayClient(c),provider=relayClient(p),bodies=[];
 for(let n=0;n<120;n++){const id=randomUUID(),expiresAt=Date.now()+600000;bodies.push(await preparePrivateJob({id,expiresAt,provider:c.provider,capability:'prediction.mandate.validate.v1',signer:ck.signer,payload:{schema:'veildesk.mandate.v1',id,mode:'dry_run',market:'worker-backlog-fixture',side:'YES',maxSpendUsd:'1.00',limitPrice:'0.5',expiresAt,approval:'preview_only'}}))}
 await batch(bodies,b=>client('/v1/jobs',{method:'POST',body:b}));const claimed=[];for(let n=0;n<105;n++)claimed.push((await provider('/v1/provider/claim',{method:'POST',body:{}})).job);
 const job=claimed.sort((a,b)=>a.id.localeCompare(b.id))[0];
 const binding={id:job.id,client:job.client,provider:job.provider,capability:job.capability,expiresAt:job.expiresAt,envelope:job.envelope,requesterSigningKey:ck.signer.publicKey,requesterEncryptionKey:ck.recipient.publicKey,providerSigningKey:pk.signer.publicKey,providerEncryptionKey:pk.recipient.publicKey};
 const reservationDir=join(p.stateDirectory,hash(job.client));await mkdir(reservationDir,{recursive:true});await writeFile(join(reservationDir,hash(job.id)+'.reserved'),hash(JSON.stringify(binding)),{mode:0o600});
 const started=performance.now();worker=spawn(process.execPath,['scripts/provider-worker.mjs'],{cwd:root,env:{...process.env,VEILDESK_PROVIDER_CONFIG:join(privateDir,'provider.json')},stdio:['ignore','ignore','pipe']});worker.stderr.resume();let results=[];
 for(let attempt=0;attempt<60;attempt++){results=[];await batch(bodies,async b=>results.push(await client('/v1/jobs/'+b.id)));if(results.filter(r=>r.state==='completed').length===119)break;if(worker.exitCode!==null)throw Error('Worker exited early');await delay(1000)}
 report.durationMs=performance.now()-started;assert.equal(results.filter(r=>r.state==='completed').length,119);assert.equal(results.find(r=>r.id===job.id).state,'processing');
 for(const r of results.filter(r=>r.state==='completed')){const result=await openPrivateResult(r,{recipient:ck.recipient,expectedSigner:pk.signer.publicKey});assert.equal(result.payload.status,'validated');assert.equal(result.payload.mandate.id,r.id);assert.equal(result.executionAuthorized,false)}
 report.completed=119;report.uncertainPreserved=1;report.preclaimed=105;report.initiallyQueued=15;report.claimBatch=5;report.pendingLimit=20;report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1}
finally{
 await stop(worker);await stop(relay);report.finishedAt=new Date().toISOString();report.sourceHashes={};for(const path of ['src/relay.mjs','src/provider.mjs','src/provider-scheduler.mjs','scripts/provider-worker.mjs','scripts/worker-acceptance.mjs'])report.sourceHashes[path]=hash(await readFile(join(root,path)));
 await mkdir(join(root,'output'),{recursive:true});const file=join(root,'output','worker-acceptance-'+report.startedAt.replace(/[:.]/g,'-')+'.json');await writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log('Evidence: '+file);await rm(dir,{recursive:true,force:true});
}
