const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true});
const SIZE=4096;
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const context=(id,direction)=>{
 if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)||!['request','response'].includes(direction))throw Error('Invalid envelope context');
 return enc.encode(`veildesk/v1/${id}/${direction}`);
};
export async function identity(){
 const keys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
 return {privateKey:keys.privateKey,publicKey:b64(new Uint8Array(await crypto.subtle.exportKey('raw',keys.publicKey)))};
}
async function key(privateKey,publicKey,salt,aad){
 const peer=await crypto.subtle.importKey('raw',bytes(publicKey),{name:'ECDH',namedCurve:'P-256'},false,[]);
 const secret=await crypto.subtle.deriveBits({name:'ECDH',public:peer},privateKey,256);
 const material=await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:aad},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function seal(payload,recipientPublicKey,id,direction){
 const plain=enc.encode(JSON.stringify(payload));if(plain.length>SIZE-4)throw Error('Research payload is too large');
 const padded=crypto.getRandomValues(new Uint8Array(SIZE));new DataView(padded.buffer).setUint32(0,plain.length);padded.set(plain,4);
 const ephemeral=await identity(),salt=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12)),aad=context(id,direction);
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await key(ephemeral.privateKey,recipientPublicKey,salt,aad),padded);
 return {version:1,id,direction,ephemeralPublicKey:ephemeral.publicKey,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))};
}
export async function open(envelope,privateKey,id,direction){
 if(envelope.version!==1||envelope.id!==id||envelope.direction!==direction)throw Error('Envelope context mismatch');
 const cipher=bytes(envelope.ciphertext),iv=bytes(envelope.iv),salt=bytes(envelope.salt);
 if(cipher.length!==SIZE+16||iv.length!==12||salt.length!==32)throw Error('Invalid envelope size');
 const aad=context(id,direction),k=await key(privateKey,envelope.ephemeralPublicKey,salt,aad);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},k,cipher);
 const length=new DataView(plain).getUint32(0);if(length>SIZE-4)throw Error('Invalid payload size');
 return JSON.parse(dec.decode(new Uint8Array(plain,4,length)));
}
