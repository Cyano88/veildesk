import {createHash} from 'node:crypto';import {join} from 'node:path';
import {openPrivateJob,sealPrivateResult} from './client.mjs';import {oncePerMandate,validateMandate} from './mandate.mjs';
export async function processClaim(job,{rpc,recipient,signer,peers,stateDirectory}){
 const peer=peers[job.client];if(!peer)throw Error('Client is not enrolled with this provider');
 // Mutable status/late fields must not change the durable identity of claimed work.
 const binding={id:job.id,client:job.client,provider:job.provider,capability:job.capability,expiresAt:job.expiresAt,envelope:job.envelope,requesterSigningKey:peer.signingKey,requesterEncryptionKey:peer.encryptionKey,providerSigningKey:signer.publicKey,providerEncryptionKey:recipient.publicKey};
 const envelope=await oncePerMandate(join(stateDirectory,createHash('sha256').update(job.client).digest('hex')),binding,async()=>{
  let payload;
  try{
   if(job.capability!=='prediction.mandate.validate.v1')throw Error('Unsupported capability');
   const mandate=validateMandate(await openPrivateJob(job,{recipient,expectedSigner:peer.signingKey}));
   if(mandate.id!==job.id)throw Error('Mandate and job IDs differ');
   payload={status:'validated',mandate,marketVerified:false,paymentVerified:false,tradeSubmitted:false};
  }catch{payload={status:'rejected',reason:'Invalid, expired, unsupported or unauthenticated mandate',tradeSubmitted:false}}
  return sealPrivateResult(job,payload,{signer,recipientPublicKey:peer.encryptionKey});
 });
 return rpc('/v1/provider/deliver',{method:'POST',body:{client:job.client,id:job.id,envelope}});
}
