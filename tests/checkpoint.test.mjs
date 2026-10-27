import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createCheckpoint,restoreCheckpoint} from '../src/checkpoint.mjs';
const password='fixture-only-long-checkpoint-password';
test('encrypted checkpoint authenticates secrets, relocates state and refuses unsafe backups',async()=>{
 const base=await mkdtemp(join(tmpdir(),'veildesk-checkpoint-'));
 try{
  const directory=join(base,'source'),file=join(base,'checkpoint.enc');await mkdir(directory);
  await writeFile(join(directory,'provider.json'),JSON.stringify({stateDirectory:join(directory,'provider-state'),identity:{fixture:'secret-identity-marker'},url:'http://127.0.0.1:5181'}));
  const args={directory,file,password,servicesStopped:true};
  await assert.rejects(createCheckpoint({...args,servicesStopped:false}),/Stop relay/);
  await assert.rejects(createCheckpoint({...args,file:join(directory,'bad.enc')}),/outside/);
  await writeFile(join(directory,'payments.db-wal'),'pending');await assert.rejects(createCheckpoint(args),/WAL/);await rm(join(directory,'payments.db-wal'));
  await createCheckpoint(args);assert.equal((await readFile(file,'utf8')).includes('secret-identity-marker'),false);
  await assert.rejects(createCheckpoint(args),{code:'EEXIST'});
  await assert.rejects(restoreCheckpoint({file,directory:join(base,'wrong-password'),password:password+'wrong'}),/authentication/);
  const target=join(base,'restored');assert.equal((await restoreCheckpoint({file,directory:target,password})).automaticResume,false);
  const config=JSON.parse(await readFile(join(target,'provider.json'),'utf8'));assert.equal(config.stateDirectory,join(target,'provider-state'));assert.equal(config.identity.fixture,'secret-identity-marker');
  await assert.rejects(restoreCheckpoint({file,directory:target,password}),{code:'EEXIST'});
  const envelope=JSON.parse(await readFile(file,'utf8'));envelope.tag='0'.repeat(32);await writeFile(file,JSON.stringify(envelope));await assert.rejects(restoreCheckpoint({file,directory:join(base,'tampered'),password}),/authentication/);
  await writeFile(join(directory,'provider.json'),JSON.stringify({stateDirectory:join(base,'outside')}));await assert.rejects(createCheckpoint({...args,file:join(base,'outside.enc')}),/outside checkpoint/);
 }finally{await rm(base,{recursive:true,force:true})}
});
