import {createHash} from 'node:crypto';
import {mkdir,open,readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';

export function validateMandate(m,now=Date.now()){
 const fields=['schema','id','mode','market','side','maxSpendUsd','limitPrice','expiresAt','approval'];
 if(!m||typeof m!=='object'||Object.keys(m).length!==fields.length||Object.keys(m).some(k=>!fields.includes(k))||m.schema!=='veildesk.mandate.v1'||m.mode!=='dry_run'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.id)||!['YES','NO'].includes(m.side)||typeof m.market!=='string'||!/^[a-z0-9-]{1,160}$/.test(m.market)||typeof m.maxSpendUsd!=='string'||!/^\d{1,6}\.\d{2}$/.test(m.maxSpendUsd)||Number(m.maxSpendUsd)<=0||typeof m.limitPrice!=='string'||!/^0\.\d{1,4}$/.test(m.limitPrice)||Number(m.limitPrice)<=0||!Number.isSafeInteger(m.expiresAt)||m.expiresAt<=now||m.expiresAt>now+3600000||m.approval!=='preview_only')throw Error('Invalid, expired or unauthorized mandate');
 return m;
}

// Reserve before invoking work. A crash leaves a reservation requiring reconciliation.
// No plaintext strategy or keys are persisted. Single-host local filesystem only.
export async function oncePerMandate(directory,mandate,work){
 const id=createHash('sha256').update(mandate.id).digest('hex');
 const digest=createHash('sha256').update(JSON.stringify(mandate)).digest('hex');
 await mkdir(directory,{recursive:true,mode:0o700});
 const reservation=join(directory,id+'.reserved'),result=join(directory,id+'.json');
 let handle;
 try{handle=await open(reservation,'wx',0o600)}catch(error){
  if(error.code!=='EEXIST')throw error;
  if(await readFile(reservation,'utf8')!==digest)throw Error('Mandate ID reused with different contents');
  try{return JSON.parse(await readFile(result,'utf8'))}catch(error){if(error.code==='ENOENT')throw Error('Pending reconciliation; do not execute again');throw error}
 }
 try{await handle.writeFile(digest);await handle.sync()}finally{await handle.close()}
 const encryptedResult=await work();
 const temp=await open(result+'.tmp','wx',0o600);
 try{await temp.writeFile(JSON.stringify(encryptedResult));await temp.sync()}finally{await temp.close()}
 await rename(result+'.tmp',result);
 return encryptedResult;
}
