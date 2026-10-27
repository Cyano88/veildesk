import {fork} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {identity} from '../src/envelope.mjs';
import {signingIdentity,sealSigned,openSigned} from '../src/authenticated.mjs';
const recipient=await identity(),signer=await signingIdentity();
const directory=await mkdtemp(join(tmpdir(),'veildesk-demo-'));
const child=fork(new URL('./provider-demo.mjs',import.meta.url),[],{env:{...process.env,VEILDESK_DEMO_STATE:directory},stdio:['ignore','ignore','inherit','ipc']});
function exchange(message){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{cleanup();reject(Error('Provider timed out'))},10000);
 const receive=value=>{cleanup();value.type==='error'?reject(Error(value.message)):resolve(value)};
 const failure=()=>{cleanup();reject(Error('Provider disconnected'))};
 function cleanup(){clearTimeout(timer);child.off('message',receive);child.off('exit',failure)}
 child.once('message',receive);child.once('exit',failure);child.send(message);
})}
try{
 // Keys are bootstrapped through an owned local child process, not an untrusted directory.
 const peer=await exchange({type:'init',peer:{encryptionKey:recipient.publicKey,signingKey:signer.publicKey}});
 const id=crypto.randomUUID();
 const mandate={schema:'veildesk.mandate.v1',id,mode:'dry_run',market:'demonstration-market-not-a-live-market',side:'YES',maxSpendUsd:'10.00',limitPrice:'0.50',expiresAt:Date.now()+300000,approval:'preview_only'};
 const envelope=await sealSigned(mandate,{signer,recipientPublicKey:peer.encryptionKey,id,direction:'request'});
 const first=await exchange({type:'request',envelope});
 const receipt=await openSigned(first.envelope,{recipient,expectedSigner:peer.signingKey,id,direction:'response'});
 const second=await exchange({type:'request',envelope});
 if(JSON.stringify(first.envelope)!==JSON.stringify(second.envelope))throw Error('Replay did not return existing encrypted receipt');
 console.log(JSON.stringify({demo:'VeilDesk by PolyDesk',independentProcesses:true,senderAuthenticated:true,receiptAuthenticated:true,replayReturnedExistingReceipt:true,status:receipt.status,tradeSubmitted:receipt.tradeSubmitted,paymentVerified:receipt.paymentVerified,marketVerified:receipt.marketVerified},null,2));
}finally{child.kill()}
