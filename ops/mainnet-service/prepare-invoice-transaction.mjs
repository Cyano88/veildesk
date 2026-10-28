import {spawn,execFileSync} from 'node:child_process';
import {readFile,open,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function checkBudget(invoice,fee,price,now=Date.now()){
 if(invoice?.network!=='main'||invoice.amountZat!=='20000'||invoice.amount!=='0.0002'||!/^u1[a-z0-9]+$/.test(invoice.address)||!/^VD1:[a-f0-9]{48}$/.test(invoice.memo)||invoice.memo!=='VD1:'+invoice.nonce||!Number.isSafeInteger(invoice.expiresAt)||invoice.expiresAt-now<600000)throw Error('Invoice outside pilot scope or too close to expiry');
 if(!Number.isSafeInteger(fee)||fee<=0||fee>50000||typeof price!=='string'||!/^\d{1,8}(\.\d{1,8})?$/.test(price))throw Error('Invalid fee or price');
 const [whole,fraction='']=price.split('.'),scaled=BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'));
 if(scaled<=0n||BigInt(20000+fee)*scaled>100000000n*100000000n)throw Error('Service payment and fee exceed one USD');
 return {amountZat:20000,feeZat:fee,totalZat:20000+fee,quotedZecUsd:price,maxUsd:'1.00'};
}
async function quote(){const r=await fetch('https://api.coinbase.com/v2/prices/ZEC-USD/spot',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Price unavailable');const data=await r.json();if(data.data?.base!=='ZEC'||data.data.currency!=='USD')throw Error('Wrong price pair');return data.data.amount;}
async function durable(path,data){const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify(data));await file.sync();}finally{await file.close();}const parent=await open('/var/data/veildesk-mainnet-buyer','r');try{await parent.sync();}finally{await parent.close();}}
export async function prepare(){
 process.umask(0o077);
 const root='/var/data/veildesk-mainnet-buyer',binary='/opt/veildesk-wallet/zingo-cli';
 const auth=JSON.parse(await readFile(root+'/service-authorization.json','utf8')),invoice=auth.invoice;
 const hash=createHash('sha256').update(JSON.stringify(invoice)).digest('hex');
 if(auth.invoiceHash!==hash||!/^[a-f0-9]{64}$/.test(auth.requestHash))throw Error('Invoice binding mismatch');
 const ready=JSON.parse(await readFile(root+'/ready-to-propose.json','utf8'));
 if(ready.network!=='main'||ready.onlyIronwoodFunds!==true||Date.now()-Date.parse(ready.checkedAt)>900000)throw Error('Fresh shielded buyer scan required');
 const firstPrice=await quote();checkBudget(invoice,10000,firstPrice);
 // Fail closed on every rerun after signing starts. Never replace an uncertain attempt.
 try{await readFile(root+'/service-attempt.json');throw Error('Existing attempt requires reconciliation');}catch(e){if(e.code!=='ENOENT')throw e;}
 const safeEnv=Object.fromEntries(['PATH','HOME','LANG','LD_LIBRARY_PATH','ZINGO_NYM_PROXY'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 const child=spawn(binary,['--chain','mainnet','--data-dir',root+'/wallet','--offline'],{env:safeEnv,stdio:['pipe','pipe','pipe']});
 let output='',errors='',state='fee',busy=false,budget,txid,failure;
 const deadline=setTimeout(()=>{failure=Error('Signing deadline; reconcile before retry');child.kill('SIGTERM');},180000);
 const result=new Promise((resolve,reject)=>{
  child.on('error',reject);child.stdin.on('error',()=>{});
  child.stderr.on('data',chunk=>{errors+=chunk.toString();if(errors.length>100000){failure=Error('Unexpected wallet output');child.kill('SIGTERM');}});
  child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>100000){failure=Error('Unexpected wallet output');child.kill('SIGTERM');return;}
   if(busy)return;
   if(state==='fee'){
    const match=output.match(/\{\s*"fee"\s*:\s*(\d+)\s*\}/);if(!match)return;busy=true;
    (async()=>{budget=checkBudget(invoice,Number(match[1]),await quote());if(budget.totalZat>ready.confirmedIronwoodZat)throw Error('Insufficient shielded balance');
     await durable(root+'/service-attempt.json',{invoiceHash:hash,requestHash:auth.requestHash,budget,createdAt:new Date().toISOString(),state:'signing_started',automaticRetry:false});
     output='';state='calculated';busy=false;child.stdin.write('calculate\n');
    })().catch(e=>{failure=e;child.stdin.end('quit\n');});
   }else if(state==='calculated'){
    const match=output.match(/\{\s*"txids"\s*:\s*\[\s*"([a-f0-9]{64})"\s*\]\s*\}/);if(!match)return;
    txid=match[1];state='saving';child.stdin.end('save shutdown\nquit\n');
   }
  });
  child.on('close',async code=>{clearTimeout(deadline);await writeFile(root+'/preparation-cli.json',JSON.stringify({output,errors,code,state}),{mode:0o600});if(failure||code!==0||!txid||/^Error:/m.test(errors))reject(failure??Error('Wallet signing failed; inspect private state'));else resolve(txid);});
 });
 child.stdin.write('send '+invoice.address+' 20000 "'+invoice.memo+'"\n');
 await result;
 const own=JSON.parse(await readFile(root+'/recipient.json','utf8'));
 const evidence=JSON.parse(execFileSync('/opt/veildesk-wallet/veildesk-evidence',[root+'/wallet/zingo-wallet.dat'],{input:JSON.stringify({network:'main',accountId:0,address:own.address,txid}),encoding:'utf8',env:safeEnv,timeout:10000,stdio:['pipe','pipe','pipe']}));
 const tx=evidence.transaction;
 if(evidence.network!=='main'||tx?.txid!==txid||tx.shieldedOnly!==true||tx.pool!=='ironwood'||tx.version!==6||tx.versionGroupId!=='d884b698')throw Error('Signed transaction failed native shielded-only inspection');
 const approved={invoiceHash:hash,requestHash:auth.requestHash,txid,budget,invoiceExpiresAt:invoice.expiresAt,preparedAt:new Date().toISOString(),shieldedOnly:true,pool:tx.pool,broadcast:false};
 await durable(root+'/service-prepared.json',approved);
 console.log(JSON.stringify({network:'main',transactionPrepared:true,nativeShieldedOnly:true,budget,broadcast:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await prepare().catch(async e=>{await writeFile('/var/data/veildesk-mainnet-buyer/preparation-error.txt',String(e.stack),{mode:0o600});console.error('Payment preparation stopped; private state preserved. No broadcast command exists in this script.');process.exitCode=1;});
