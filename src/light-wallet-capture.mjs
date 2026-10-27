import {spawn} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// Invoke only inside the wallet owner's exclusive lock, after syncWalletCycle.
// This exporter has no network or spend operation. It receives no recovery secret.
export async function captureNativeEvidence({root,binary,query,scan,now=Date.now}){
 if(!query||Object.keys(query).sort().join(',')!=='accountId,address,txid'||!Number.isSafeInteger(query.accountId)
  ||query.accountId<0||query.accountId>0x7fffffff||typeof query.address!=='string'||!query.address||query.address.length>512||!hex(query.txid))throw Error('Invalid native evidence query');
 const scannedAt=Date.parse(scan?.checkedAt);
 if(scan?.syncReady!==true||scan.network!=='test'||!Number.isSafeInteger(scan.height)||!Number.isFinite(scannedAt)
  ||scannedAt>now()||now()-scannedAt>5000)throw Error('Fresh wallet scan required before native capture');
 const path=join(root,'wallet','zingo-wallet.dat');
 if((await stat(path)).size>64*1024*1024)throw Error('Wallet snapshot exceeds capture limit');
 const before=digest(await readFile(path));
 const evidence=await new Promise((accept,reject)=>{
  const child=spawn(binary,[path],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH},windowsHide:true});
  let stdout='',size=0,failure;
  const timer=setTimeout(()=>{failure='Native evidence timed out';child.kill('SIGKILL')},10000);
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(query));
  child.stdout.on('data',data=>{size+=data.length;if(size>1024*1024){failure='Native evidence exceeds limit';child.kill('SIGKILL')}else stdout+=data.toString()});
  child.stderr.on('data',data=>{size+=data.length;if(size>1024*1024){failure='Native evidence exceeds limit';child.kill('SIGKILL')}});
  child.once('error',()=>{clearTimeout(timer);reject(Error('Native evidence executable unavailable'))});
  child.once('close',code=>{clearTimeout(timer);if(failure||code!==0)return reject(Error(failure??'Native evidence refused query'));
   try{accept(JSON.parse(stdout))}catch{reject(Error('Native evidence returned invalid JSON'))}});
 });
 const capturedAt=now(),after=digest(await readFile(path));
 if(before!==after||evidence?.walletDigest!==before||evidence.network!=='test'||evidence.tip?.height!==scan.height
  ||capturedAt-scannedAt>5000)throw Error('Wallet changed or scan became stale during evidence capture');
 return {evidence,scan:structuredClone(scan),capturedAt};
}
