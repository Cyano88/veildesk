import {seal,open} from './envelope.mjs';
const encoder=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));

export async function signingIdentity(){
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 return {privateKey:pair.privateKey,publicKey:b64(await crypto.subtle.exportKey('raw',pair.publicKey))};
}
export async function sealSigned(payload,{signer,recipientPublicKey,id,direction}){
 const body=JSON.stringify({domain:'veildesk.signed.v1',id,direction,recipientPublicKey,payload});
 const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signer.privateKey,encoder.encode(body)));
 return seal({body,signature},recipientPublicKey,id,direction);
}
export async function openSigned(envelope,{recipient,expectedSigner,id,direction}){
 const signed=await open(envelope,recipient.privateKey,id,direction);
 if(typeof signed?.body!=='string'||typeof signed.signature!=='string')throw Error('Unsigned message');
 const key=await crypto.subtle.importKey('raw',bytes(expectedSigner),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes(signed.signature),encoder.encode(signed.body)))throw Error('Sender authentication failed');
 const body=JSON.parse(signed.body);
 if(body.domain!=='veildesk.signed.v1'||body.id!==id||body.direction!==direction||body.recipientPublicKey!==recipient.publicKey)throw Error('Signed context mismatch');
 return body.payload;
}
