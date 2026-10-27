import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {relayClient,preparePrivateJob,openPrivateResult} from './client.mjs';
import {sealSigned} from './authenticated.mjs';
import {loadEndpointIdentity} from './endpoint-identity.mjs';
import {validateMandate,oncePerMandate} from './mandate.mjs';
import {validateInvoice} from './zcash.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const FREE='prediction.mandate.validate.v1',PAID='prediction.mandate.validate.testnet-paid.v1';
export async function createMandateClient({config,stateDirectory}){
 const capability=config.capability??FREE,paid=capability===PAID;
 if(!stateDirectory||![FREE,PAID].includes(capability)||!config.provider?.capabilities?.includes(capability))throw Error('Missing client state or provider capability');
 if(paid&&(typeof config.maxPaymentZat!=='string'||!/^\d{1,16}$/.test(config.maxPaymentZat)||BigInt(config.maxPaymentZat)<=0n))throw Error('Set an explicit testnet invoice amount cap');
 const {recipient,signer}=await loadEndpointIdentity(config.identity),rpc=relayClient(config);
 const directory=join(stateDirectory,hash(JSON.stringify([config.url,config.provider.id,config.provider.encryptionKey,config.provider.signingKey,signer.publicKey,recipient.publicKey])));
 async function context(id){
  if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))throw Error('Invalid job ID');
  const request=JSON.parse(await readFile(join(directory,hash(id)+'.json'),'utf8')),mandateHash=await readFile(join(directory,hash(id)+'.reserved'),'utf8');
  const job=await rpc('/v1/jobs/'+id);
  if(job.id!==id||job.provider!==request.provider||job.capability!==request.capability||job.capability!==capability||job.expiresAt!==request.expiresAt)throw Error('Job context mismatch');
  return {request,mandateHash,job};
 }
 async function challenge(job,mandateHash){
  if(!job.invoiceEnvelope)return null;
  const result=await openPrivateResult({...job,envelope:job.invoiceEnvelope},{recipient,expectedSigner:config.provider.signingKey}),p=result.payload;
  if(!paid||p?.status!=='payment_required'||p.network!=='test'||p.mandateHash!==mandateHash||p.tradeSubmitted!==false)throw Error('Invalid payment challenge');
  validateInvoice(p.invoice);
  if(p.invoice.network!=='test'||p.invoice.expiresAt>job.expiresAt||digest(p.invoice)!==p.invoiceHash||BigInt(p.invoice.amountZat)>BigInt(config.maxPaymentZat))throw Error('Invoice terms exceed configured authorization');
  return p;
 }
 return {
  async submit(mandate){
   validateMandate(mandate);
   const request=await oncePerMandate(directory,mandate,()=>preparePrivateJob({id:mandate.id,provider:config.provider,capability,expiresAt:mandate.expiresAt,payload:mandate,signer}));
   if(request.capability!==capability)throw Error('Job capability conflict');
   return rpc('/v1/jobs',{method:'POST',body:request});
  },
  async submitPaymentHint(id,txid){
   if(!paid||typeof txid!=='string'||!/^[a-f0-9]{64}$/.test(txid))throw Error('Invalid testnet transaction reference');
   const {job,mandateHash}=await context(id),quote=await challenge(job,mandateHash);
   if(!quote||job.state!=='processing')throw Error('No pending authenticated invoice');
   // May report an already-sent late payment for review; this never sends funds.
   const terms={id,txid,invoiceHash:quote.invoiceHash,mandateHash};
   const proof=await oncePerMandate(join(directory,'payment-hints'),terms,async()=>({...terms,envelope:await sealSigned({schema:'veildesk.payment-hint.v1',provider:job.provider,capability,...terms},{signer,recipientPublicKey:config.provider.encryptionKey,id,direction:'request'})}));
   return rpc('/v1/jobs/'+id+'/payment',{method:'POST',body:{envelope:proof.envelope}});
  },
  async get(id){
   const {request,mandateHash,job}=await context(id),quote=await challenge(job,mandateHash);
   let paymentReview;
   if(job.paymentReviewEnvelope){
    const review=await openPrivateResult({...job,envelope:job.paymentReviewEnvelope},{recipient,expectedSigner:config.provider.signingKey});
    if(!paid||review.payload?.status!=='payment_review'||review.payload.mandateHash!==mandateHash||review.payload.paymentVerified!==false||review.payload.tradeSubmitted!==false)throw Error('Invalid payment review response');
    paymentReview=review.payload;
   }
   if(job.state!=='completed')return {id,state:job.state,late:Date.now()>=request.expiresAt,...(quote?{payment:quote}:{}),...(paymentReview?{paymentReview}:{}),executionAuthorized:false};
   if(paymentReview)throw Error('Payment under review cannot authorize completion');
   const result=await openPrivateResult(job,{recipient,expectedSigner:config.provider.signingKey});
   if(!['validated','rejected'].includes(result.payload?.status)||result.payload.tradeSubmitted!==false)throw Error('Unsupported provider result');
   if(result.payload.status==='validated'){
    if(digest(result.payload.mandate)!==mandateHash||result.payload.paymentVerified!==paid||result.payload.marketVerified!==false)throw Error('Provider validation does not match the original mandate');
    if(paid){
     const hint=JSON.parse(await readFile(join(directory,'payment-hints',hash(id)+'.json'),'utf8')),p=result.payload.payment;
     if(!quote||p?.network!=='test'||p.txid!==hint.txid||p.invoiceHash!==quote.invoiceHash||p.mandateHash!==mandateHash||!Number.isSafeInteger(p.confirmations)||p.confirmations<3||typeof p.blockhash!=='string'||!/^[a-f0-9]{64}$/.test(p.blockhash)||typeof p.noteId!=='string'||!p.noteId.startsWith(p.txid+':'))throw Error('Invalid provider payment receipt');
    }
   }
   return {id,state:job.state,result,late:Date.now()>=request.expiresAt,executionAuthorized:false};
  }
 };
}
