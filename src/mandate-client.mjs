import {walletNetwork,paidMandateCapability,paidResearchCapability} from './zcash-network.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {relayClient,preparePrivateJob,openPrivateResult} from './client.mjs';
import {sealSigned} from './authenticated.mjs';
import {loadEndpointIdentity} from './endpoint-identity.mjs';
import {validateMandate,oncePerMandate} from './mandate.mjs';
import {validateInvoice} from './zcash.mjs';
import {PAID_RESEARCH,validateResearchPurchase} from './service-rehearsal.mjs';
import {openArtifact} from './artifact.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const FREE='prediction.mandate.validate.v1',PAID='prediction.mandate.validate.testnet-paid.v1';
export async function createMandateClient({config,stateDirectory}){
 const network=config.network??'test';walletNetwork(network);const paidCapability=paidMandateCapability(network),researchCapability=paidResearchCapability(network);
 const capability=config.capability??FREE,research=capability===researchCapability,paid=capability===paidCapability||research;
 const hashField=research?'requestHash':'mandateHash',validate=research?validateResearchPurchase:validateMandate;
 if(!stateDirectory||![FREE,paidCapability,researchCapability].includes(capability)||!config.provider?.capabilities?.includes(capability))throw Error('Missing client state or provider capability');
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
  if(!paid||p?.status!=='payment_required'||p.network!==network||p[hashField]!==mandateHash||p.tradeSubmitted!==false)throw Error('Invalid payment challenge');
  validateInvoice(p.invoice);
  if(p.invoice.network!==network||p.invoice.expiresAt>job.expiresAt||digest(p.invoice)!==p.invoiceHash||BigInt(p.invoice.amountZat)>BigInt(config.maxPaymentZat))throw Error('Invoice terms exceed configured authorization');
  return p;
 }
 return {
  async submit(mandate){
   validate(mandate);
   if(research)mandate={id:mandate.id,expiresAt:mandate.expiresAt,request:mandate.request};
   const request=await oncePerMandate(directory,mandate,()=>preparePrivateJob({id:mandate.id,provider:config.provider,capability,expiresAt:mandate.expiresAt,payload:research?mandate.request:mandate,signer}));
   if(request.capability!==capability)throw Error('Job capability conflict');
   return rpc('/v1/jobs',{method:'POST',body:request});
  },
  async submitPaymentHint(id,txid){
   if(!paid||typeof txid!=='string'||!/^[a-f0-9]{64}$/.test(txid))throw Error('Invalid testnet transaction reference');
   const {job,mandateHash}=await context(id),quote=await challenge(job,mandateHash);
   if(!quote||job.state!=='processing')throw Error('No pending authenticated invoice');
   // May report an already-sent late payment for review; this never sends funds.
   const terms={id,txid,invoiceHash:quote.invoiceHash,[hashField]:mandateHash};
   const proof=await oncePerMandate(join(directory,'payment-hints'),terms,async()=>({...terms,envelope:await sealSigned({schema:'veildesk.payment-hint.v1',provider:job.provider,capability,...terms},{signer,recipientPublicKey:config.provider.encryptionKey,id,direction:'request'})}));
   return rpc('/v1/jobs/'+id+'/payment',{method:'POST',body:{envelope:proof.envelope}});
  },
  async get(id){
   const {request,mandateHash,job}=await context(id),quote=await challenge(job,mandateHash);
   let paymentReview;
   if(job.paymentReviewEnvelope){
    const review=await openPrivateResult({...job,envelope:job.paymentReviewEnvelope},{recipient,expectedSigner:config.provider.signingKey});
    if(!paid||review.payload?.status!=='payment_review'||review.payload[hashField]!==mandateHash||review.payload.paymentVerified!==false||review.payload.tradeSubmitted!==false)throw Error('Invalid payment review response');
    paymentReview=review.payload;
   }
   if(job.state!=='completed')return {id,state:job.state,paymentHintSubmitted:!!job.paymentHint,late:Date.now()>=request.expiresAt,...(quote?{payment:quote}:{}),...(paymentReview?{paymentReview}:{}),executionAuthorized:false};
   if(paymentReview)throw Error('Payment under review cannot authorize completion');
   const result=await openPrivateResult(job,{recipient,expectedSigner:config.provider.signingKey});
   if(research){
    const p=result.payload,payment=p?.payment;
    const hint=JSON.parse(await readFile(join(directory,'payment-hints',hash(id)+'.json'),'utf8'));
    if(!quote||p?.schema!=='veildesk.service-result.v1'||p.status!=='fulfilled'||p.service!=='polydesk.market-research.v1'
      ||p.mode!==(network==='main'?'mainnet-paid':'testnet-paid')||p.paymentVerified!==true||p.tradeSubmitted!==false||p.executionAuthorized!==false
      ||payment?.network!==network||payment.requestHash!==mandateHash||payment.invoiceHash!==quote.invoiceHash
      ||payment.txid!==hint.txid||!Number.isSafeInteger(payment.confirmations)||payment.confirmations<3
      ||typeof payment.blockhash!=='string'||!/^[a-f0-9]{64}$/.test(payment.blockhash)
      ||typeof payment.noteId!=='string'||!payment.noteId.startsWith(payment.txid+':'))throw Error('Invalid research payment receipt');
    const report=await openArtifact(job,p.artifact,async index=>(await rpc(`/v1/jobs/${id}/artifacts/${index}`)).envelope,{recipient,expectedSigner:config.provider.signingKey});
    if(report?.schema!=='polydesk-a2a-market-research-v1'||report.orderAuthorized!==false||report.orderSubmitted!==false)throw Error('Invalid research report');
    return {id,state:job.state,result:{...result,payload:{...p,report}},late:Date.now()>=request.expiresAt,executionAuthorized:false};
   }
   if(!['validated','rejected'].includes(result.payload?.status)||result.payload.tradeSubmitted!==false)throw Error('Unsupported provider result');
   if(result.payload.status==='validated'){
    if(digest(result.payload.mandate)!==mandateHash||result.payload.paymentVerified!==paid||result.payload.marketVerified!==false)throw Error('Provider validation does not match the original mandate');
    if(paid){
     const hint=JSON.parse(await readFile(join(directory,'payment-hints',hash(id)+'.json'),'utf8')),p=result.payload.payment;
     if(!quote||p?.network!==network||p.txid!==hint.txid||p.invoiceHash!==quote.invoiceHash||p.mandateHash!==mandateHash||!Number.isSafeInteger(p.confirmations)||p.confirmations<3||typeof p.blockhash!=='string'||!/^[a-f0-9]{64}$/.test(p.blockhash)||typeof p.noteId!=='string'||!p.noteId.startsWith(p.txid+':'))throw Error('Invalid provider payment receipt');
    }
   }
   return {id,state:job.state,result,late:Date.now()>=request.expiresAt,executionAuthorized:false};
  }
 };
}

export async function createPaidResearchClient(options){
 if(options.config.capability!==paidResearchCapability(options.config.network??'test'))throw Error('Explicit paid research capability required');
 return createMandateClient(options);
}
