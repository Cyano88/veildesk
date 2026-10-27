import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {backupPayments,restorePayments} from '../src/payment-backup.mjs';
test('payment backups reject corruption, wrong schemas and overwrite attempts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'veildesk-backup-'));
 try{
  const source=join(root,'source.db'),db=new DatabaseSync(source);
  db.exec('CREATE TABLE paid_jobs(owner TEXT PRIMARY KEY,binding TEXT,issued INTEGER,invoice TEXT,challenge TEXT,state TEXT,note TEXT,blockhash TEXT,result TEXT,review TEXT,review_result TEXT);CREATE TABLE paid_notes(note TEXT PRIMARY KEY,owner TEXT);');db.close();
  const snapshot=join(root,'snapshot');await backupPayments(source,snapshot);
  await assert.rejects(backupPayments(source,snapshot),{code:'EEXIST'});
  const target=join(root,'target');assert.equal((await restorePayments(snapshot,target)).automaticResume,false);
  await assert.rejects(restorePayments(snapshot,target),{code:'EEXIST'});
  const file=join(snapshot,'payments.db'),bytes=await readFile(file);await writeFile(file,Buffer.concat([bytes,Buffer.from('tamper')]));
  await assert.rejects(restorePayments(snapshot,join(root,'corrupt')),/checksum mismatch/);
  await writeFile(file,bytes);
  const manifest=JSON.parse(await readFile(join(snapshot,'manifest.json'),'utf8'));manifest.notes=1;await writeFile(join(snapshot,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(restorePayments(snapshot,join(root,'wrong-count')),/count mismatch/);
  const wrong=new DatabaseSync(join(root,'wrong.db'));wrong.exec('CREATE TABLE unrelated(id TEXT)');wrong.close();
  await assert.rejects(backupPayments(join(root,'wrong.db'),join(root,'wrong-backup')),/ledger schema/);
 }finally{await rm(root,{recursive:true,force:true})}
});
