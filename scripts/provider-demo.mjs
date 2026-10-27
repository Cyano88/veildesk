import {identity} from '../src/envelope.mjs';
import {signingIdentity,openSigned,sealSigned} from '../src/authenticated.mjs';
import {validateMandate,oncePerMandate} from '../src/mandate.mjs';
const recipient=await identity(),signer=await signingIdentity();
let peer;
process.on('message',async message=>{
 try{
  if(message.type==='init'&&!peer){peer=message.peer;process.send({type:'ready',encryptionKey:recipient.publicKey,signingKey:signer.publicKey});return}
  if(!peer||message.type!=='request')throw Error('Invalid demo message');
  const m=await openSigned(message.envelope,{recipient,expectedSigner:peer.signingKey,id:message.envelope.id,direction:'request'});
  validateMandate(m);
  if(m.id!==message.envelope.id)throw Error('Mandate ID mismatch');
  const envelope=await oncePerMandate(process.env.VEILDESK_DEMO_STATE,m,async()=>sealSigned({schema:'veildesk.receipt.v1',mandateId:m.id,status:'dry_run_completed',tradeSubmitted:false,paymentVerified:false,marketVerified:false,preview:{market:m.market,side:m.side,maxSpendUsd:m.maxSpendUsd,limitPrice:m.limitPrice},publicBoundary:'A real Polymarket fill and position would be publicly observable.'},{signer,recipientPublicKey:peer.encryptionKey,id:m.id,direction:'response'}));
  process.send({type:'receipt',envelope});
 }catch{process.send({type:'error',message:'Request rejected or pending reconciliation'})}
});
