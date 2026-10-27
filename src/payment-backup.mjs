import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const digest=data=>createHash('sha256').update(data).digest('hex');
function inspect(file){
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Payment backup integrity check failed');
  for(const [table,columns] of Object.entries({paid_jobs:['owner','binding','issued','invoice','challenge','state','note','blockhash','result','review','review_result'],paid_notes:['note','owner']})){
   const present=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
   if(columns.some(c=>!present.has(c)))throw Error('Unsupported payment ledger schema');
  }
  return {jobs:db.prepare('SELECT count(*) AS n FROM paid_jobs').get().n,notes:db.prepare('SELECT count(*) AS n FROM paid_notes').get().n};
 }finally{db.close()}
}
// Snapshot is transactionally consistent, but not a coordinated whole-service checkpoint.
export async function backupPayments(source,target){
 const directory=resolve(target);await mkdir(directory,{mode:0o700});
 const file=join(directory,'payments.db'),db=new DatabaseSync(resolve(source),{readOnly:true});
 try{await backup(db,file)}finally{db.close()}
 await chmod(file,0o600);const counts=inspect(file);
 const manifest={schema:'veildesk.payment-backup.v1',createdAt:new Date().toISOString(),sha256:digest(await readFile(file)),...counts,scope:'provider_payment_database_only',keysIncluded:false,walletIncluded:false,coordinatedCheckpoint:false};
 await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
 return manifest;
}
export async function restorePayments(source,target){
 const directory=resolve(source),manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
 if(manifest.schema!=='veildesk.payment-backup.v1'||manifest.scope!=='provider_payment_database_only'||typeof manifest.sha256!=='string'||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw Error('Unsupported payment backup manifest');
 const bytes=await readFile(join(directory,'payments.db'));
 if(digest(bytes)!==manifest.sha256)throw Error('Payment backup checksum mismatch');
 // Use the checked bytes, not a second copy of a possibly changed source file.
 const destination=resolve(target);await mkdir(destination,{mode:0o700});
 const file=join(destination,'payments.db');await writeFile(file,bytes,{mode:0o600,flag:'wx'});
 const counts=inspect(file);
 if(counts.jobs!==manifest.jobs||counts.notes!==manifest.notes)throw Error('Payment backup record count mismatch');
 return {database:file,...counts,requiresReconciliation:true,automaticResume:false};
}

