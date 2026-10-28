import {identity} from '/envelope.mjs';
import {signingIdentity,sealSigned,openSigned} from '/authenticated.mjs';
const $=id=>document.getElementById(id);let session;const buttons=['tamper','wrong-signer','wrong-request'];
function disable(value){for(const id of buttons)$(id).disabled=value;}
$('seal').addEventListener('click',async()=>{
 $('error').textContent='';session=undefined;disable(true);$('checks').replaceChildren();$('cipher').textContent='';$('decrypted').textContent='';
 const brief=$('brief').value.trim();if(!brief){$('error').textContent='Add a request first.';$('status').textContent='No request signed';return;}
 $('seal').disabled=true;$('status').textContent='Creating fresh endpoint keys…';
 try{const recipient=await identity(),signer=await signingIdentity(),id=crypto.randomUUID();
 const envelope=await sealSigned({brief,service:'demo.request.v1',executionAuthorized:false},{signer,recipientPublicKey:recipient.publicKey,id,direction:'request'});
 const verified=await openSigned(envelope,{recipient,expectedSigner:signer.publicKey,id,direction:'request'});
 if(verified.brief!==brief||verified.executionAuthorized!==false)throw Error('Unexpected result');
 session={recipient,signer,id,envelope};$('decrypted').textContent=verified.brief;$('cipher').textContent=JSON.stringify(envelope,null,2);
 $('binding').textContent='Request '+id+' · 4,096-byte padded plaintext · Trading not authorized';$('status').textContent='Signature verified. Request decrypted.';disable(false);
 }catch{$('status').textContent='Request was not sealed';$('error').textContent='Could not complete the check. Use a shorter request and a browser supporting Web Crypto.';}
 finally{$('seal').disabled=false;}
});
async function challenge(kind){if(!session)return;const current=session;disable(true);$('seal').disabled=true;
 try{let {envelope,id,recipient,signer}=current;envelope=structuredClone(envelope);let expectedSigner=signer.publicKey;
 const labels={'tamper':'Modified message','wrong-signer':'Sender impersonation','wrong-request':'Wrong request ID'};
 if(kind==='tamper'){const raw=Uint8Array.from(atob(envelope.ciphertext),c=>c.charCodeAt(0));raw[0]^=1;envelope.ciphertext=btoa(String.fromCharCode(...raw));}
 if(kind==='wrong-signer')expectedSigner=(await signingIdentity()).publicKey;if(kind==='wrong-request')id=crypto.randomUUID();
 let rejected=false;try{await openSigned(envelope,{recipient,expectedSigner,id,direction:'request'});}catch{rejected=true;}
 const row=document.createElement('li');row.textContent=(rejected?'Blocked':'Not blocked')+' — '+labels[kind]+(rejected?'. Verification caught the change.':'. Verification unexpectedly accepted the change.');row.className=rejected?'pass':'fail';$('checks').append(row);
 }catch{$('error').textContent='Challenge could not run; no successful check is claimed.';}finally{disable(false);$('seal').disabled=false;}
}
for(const id of buttons)$(id).addEventListener('click',()=>challenge(id));
