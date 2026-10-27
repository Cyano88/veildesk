import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {preparePrivateJob,openPrivateJob,sealPrivateResult,openPrivateResult} from './client.mjs';
import {oncePerMandate} from './mandate.mjs';
import {validateInvoice} from './zcash.mjs';
export const WALLET_CAPABILITY='zcash.receipt.check.testnet.v1';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function validateQuery(query,{accountId,address}){
 const fields=query?.operation==='preflight'?['schema','operation','accountId','address']:['schema','operation','accountId','address','invoice','txid'];
 if(!query||Object.keys(query).length!==fields.length||Object.keys(query).some(k=>!fields.includes(k))||query.schema!=='veildesk.wallet-query.v1'
  ||!['preflight','verify'].includes(query.operation)||query.accountId!==accountId||query.address!==address)throw Error('Invalid scoped wallet request');
 if(query.operation==='verify'){validateInvoice(query.invoice);if(query.invoice.network!=='test'||query.invoice.address!==address||!hex(query.txid))throw Error('Invalid scoped wallet payment')}
 return query;
}
export function createWalletBridgeProcessor({providerId,accountId,address,backend,recipient,signer,peers,stateDirectory,now=Date.now}){
 if(backend.address!==address||backend.id!==`zingolib-testnet-v1:${accountId}`)throw Error('Wallet backend identity mismatch');
 return async(job,{rpc})=>{
  const peer=peers[job.client];
  if(!peer||job.provider!==providerId||job.capability!==WALLET_CAPABILITY)throw Error('Unenrolled wallet request');
  const query=validateQuery(await openPrivateJob(job,{recipient,expectedSigner:peer.signingKey}),{accountId,address});
  const binding={id:job.id,client:job.client,provider:job.provider,capability:job.capability,expiresAt:job.expiresAt,envelope:job.envelope,
   requesterSigningKey:peer.signingKey,requesterEncryptionKey:peer.encryptionKey,walletSigningKey:signer.publicKey,walletEncryptionKey:recipient.publicKey};
  const envelope=await oncePerMandate(join(stateDirectory,hash(job.client)),binding,async()=>{
   let result,status='ok';
   try{result=query.operation==='preflight'?await backend.preflight():await backend.verify({invoice:query.invoice,txid:query.txid,now:now()})}
   catch{status='unavailable';result={executionAuthorized:false}}
   const observedAt=now();if(observedAt>=job.expiresAt)throw Error('Wallet request expired during check');
   return sealPrivateResult(job,{schema:'veildesk.wallet-result.v1',operation:query.operation,queryHash:hash(query),status,result,
    observedAt,expiresAt:Math.min(job.expiresAt,observedAt+30000),executionAuthorized:false},{signer,recipientPublicKey:peer.encryptionKey});
  });
  return rpc('/v1/provider/deliver',{method:'POST',body:{client:job.client,id:job.id,envelope}});
 };
}
export function createRemoteWalletSettlement({rpc,provider,recipient,signer,accountId,address,now=Date.now,pollMs=1000,timeoutMs=600000}){
 if(typeof rpc!=='function'||!provider?.capabilities?.includes(WALLET_CAPABILITY)||!Number.isSafeInteger(accountId)||accountId<0||accountId>0x7fffffff
  ||typeof address!=='string'||!address||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>600000||!Number.isSafeInteger(pollMs)||pollMs<1)throw Error('Invalid remote wallet configuration');
 async function request(operation,payment={}){
  const query=validateQuery({schema:'veildesk.wallet-query.v1',operation,accountId,address,...payment},{accountId,address});
  const started=now(),expiresAt=started+timeoutMs;
  const job=await preparePrivateJob({id:randomUUID(),provider,capability:WALLET_CAPABILITY,expiresAt,payload:query,signer});
  await rpc('/v1/jobs',{method:'POST',body:job});
  while(now()<expiresAt){
   const row=await rpc('/v1/jobs/'+job.id);
   if(row.state==='completed'){
    const opened=await openPrivateResult({...job,envelope:row.envelope},{recipient,expectedSigner:provider.signingKey}),payload=opened.payload,time=now();
    if(payload?.schema!=='veildesk.wallet-result.v1'||payload.operation!==operation||payload.queryHash!==hash(query)||payload.executionAuthorized!==false
     ||!Number.isSafeInteger(payload.observedAt)||payload.observedAt<started||payload.observedAt>time||time-payload.observedAt>30000
     ||!Number.isSafeInteger(payload.expiresAt)||payload.expiresAt>Math.min(expiresAt,payload.observedAt+30000)||time>=payload.expiresAt)throw Error('Invalid or stale authenticated wallet response');
    if(payload.status!=='ok')throw Error('Wallet verification unavailable');
    const result=payload.result;if(result?.executionAuthorized!==false)throw Error('Wallet response cannot grant execution');
    if(operation==='preflight'){if(result.recipientTracked!==true||result.settlementVerified!==false)throw Error('Invalid wallet preflight');return result}
    const states=['awaiting_payment','expired_unpaid','ambiguous_payment_review','confirmed','late_payment_review'];
    if(!states.includes(result.state))throw Error('Invalid wallet receipt state');
    if(['confirmed','late_payment_review'].includes(result.state)){
     const parts=typeof result.noteId==='string'?result.noteId.split(':'):[];
     if(parts.length!==3||parts[0]!==query.txid||!['orchard','ironwood'].includes(parts[1])||!/^\d+$/.test(parts[2])||Number(parts[2])>65535
      ||!hex(result.blockhash)||!Number.isSafeInteger(result.height)||result.height<1||!Number.isSafeInteger(result.confirmations)||result.confirmations<3||result.confirmations>200)throw Error('Invalid authenticated wallet receipt');
     if(time>=query.invoice.expiresAt)return {...result,state:'late_payment_review'};
    }
    return result;
   }
   if(row.state==='expired')throw Error('Wallet request expired');
   await pause(pollMs);
  }
  throw Error('Wallet request timed out');
 }
 const preflight=()=>request('preflight');
 return {id:`zingolib-testnet-v1:${accountId}`,address,preflight,recipient:preflight,
  verify:({invoice,txid})=>request('verify',{invoice,txid})};
}
