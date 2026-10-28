import {execFileSync} from 'node:child_process';import {readFile,open,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {checkBudget} from './prepare-invoice-transaction.mjs';
process.umask(0o077);
const root='/var/data/veildesk-mainnet-buyer';
async function durable(name,value){const f=await open(root+'/'+name,'wx',0o600);try{await f.writeFile(JSON.stringify(value));await f.sync();}finally{await f.close();}const parent=await open(root,'r');try{await parent.sync();}finally{await parent.close();}}
try{
 const auth=JSON.parse(await readFile(root+'/service-authorization.json','utf8')),prepared=JSON.parse(await readFile(root+'/service-prepared.json','utf8'));
 if(prepared.invoiceHash!==auth.invoiceHash||auth.invoiceHash!==createHash('sha256').update(JSON.stringify(auth.invoice)).digest('hex')||prepared.requestHash!==auth.requestHash||!/^[a-f0-9]{64}$/.test(prepared.txid)||prepared.broadcast!==false||prepared.shieldedOnly!==true)throw Error('Prepared transaction binding mismatch');
 const r=await fetch('https://api.coinbase.com/v2/prices/ZEC-USD/spot',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Price unavailable');const data=await r.json();if(data.data?.base!=='ZEC'||data.data.currency!=='USD')throw Error('Price pair mismatch');
 const budget=checkBudget(auth.invoice,prepared.budget.feeZat,data.data.amount);
 const safeEnv=Object.fromEntries(['PATH','HOME','LANG','LD_LIBRARY_PATH','ZINGO_NYM_PROXY'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 const own=JSON.parse(await readFile(root+'/recipient.json','utf8'));
 const e=JSON.parse(execFileSync('/opt/veildesk-wallet/veildesk-evidence',[root+'/wallet/zingo-wallet.dat'],{input:JSON.stringify({network:'main',accountId:0,address:own.address,txid:prepared.txid}),encoding:'utf8',env:safeEnv,timeout:10000,stdio:['pipe','pipe','pipe']}));
 if(e.network!=='main'||e.transaction?.txid!==prepared.txid||e.transaction.shieldedOnly!==true||e.transaction.pool!=='ironwood'||e.transaction.version!==6)throw Error('Native transaction verification failed');
 // Reservation is fsynced BEFORE the only broadcasting command. Any timeout is uncertain.
 await durable('service-broadcast-attempt.json',{...prepared,budget,attemptedAt:new Date().toISOString(),automaticRetry:false});
 const raw=execFileSync('/opt/veildesk-wallet/zingo-cli',['--chain','mainnet','--data-dir',root+'/wallet','--server','https://zec.rocks:443','--nosync','transmit',prepared.txid],{encoding:'utf8',env:safeEnv,timeout:540000,maxBuffer:100000,stdio:['ignore','pipe','pipe']});
 const result=JSON.parse(raw);if(result.txids?.length!==1||result.txids[0]!==prepared.txid)throw Error('Unexpected broadcast result');
 const evidence={...prepared,budget,broadcast:true,broadcastAt:new Date().toISOString()};await durable('service-broadcast.json',evidence);
 console.log(JSON.stringify({network:'main',servicePaymentSent:true,nativeShieldedOnly:true,budget,settlementVerified:false,tradeSubmitted:false}));
}catch(e){await writeFile(root+'/broadcast-error.txt',String(e.stack),{mode:0o600});console.error('Broadcast did not produce a verified completion record. Inspect private attempt and wallet state; never automatically resend.');process.exitCode=1;}
