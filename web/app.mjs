import {identity} from '/envelope.mjs';
import {signingIdentity,sealSigned,openSigned} from '/authenticated.mjs';
const $=id=>document.getElementById(id);
let recipient,signer;
$('seal').addEventListener('click',async()=>{
 $('error').textContent='';
 const brief=$('brief').value.trim();
 if(!brief){$('error').textContent='Add a research brief first.';return}
 $('seal').disabled=true;
 try{
  recipient??=await identity();
  signer??=await signingIdentity();
  const id=crypto.randomUUID();
  const envelope=await sealSigned({brief},{signer,recipientPublicKey:recipient.publicKey,id,direction:'request'});
  const verified=await openSigned(envelope,{recipient,expectedSigner:signer.publicKey,id,direction:'request'});
  $('cipher').textContent=JSON.stringify(envelope,null,2);
  $('decrypted').textContent=verified.brief;
  $('result').hidden=false;
  $('research').textContent='Sealed · 4 KB payload';
  $('status').textContent='Brief sealed successfully';
 }catch{
  $('error').textContent='Could not seal this brief. Shorten it and try again.';
 }finally{$('seal').disabled=false}
});
