// Standalone wire-protocol reference. No VeilDesk SDK imports and no wallet operations.
// Keep prepared request bytes in durable private storage before POST; retry unchanged.
import {webcrypto, createHash} from 'node:crypto';
const {subtle}=webcrypto, utf8=new TextEncoder(), decode=new TextDecoder('utf-8',{fatal:true});
const b64=value=>Buffer.from(value).toString('base64');
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
function binary(value,length){if(typeof value!=='string')throw Error('Invalid binary encoding');const b=Buffer.from(value,'base64');if(b.toString('base64')!==value||(length!==undefined&&b.length!==length))throw Error('Invalid binary encoding');return b;}
function aad(id,direction){if(!uuid(id)||!['request','response'].includes(direction))throw Error('Invalid message context');return utf8.encode(`veildesk/v1/${id}/${direction}`);}
export async function createIdentity(){
 const encryption=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
 const signing=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 return {encryption:{privateKey:encryption.privateKey,publicKey:b64(await subtle.exportKey('raw',encryption.publicKey))},signing:{privateKey:signing.privateKey,publicKey:b64(await subtle.exportKey('raw',signing.publicKey))}};
}
async function derive(privateKey,publicKey,salt,info){
 const peer=await subtle.importKey('raw',binary(publicKey,65),{name:'ECDH',namedCurve:'P-256'},false,[]);
 const secret=await subtle.deriveBits({name:'ECDH',public:peer},privateKey,256);
 const material=await subtle.importKey('raw',secret,'HKDF',false,['deriveKey']);
 return subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptMessage(payload,{signer,recipientPublicKey,id,direction='request'}){
 const info=aad(id,direction),body=JSON.stringify({domain:'veildesk.signed.v1',id,direction,recipientPublicKey,payload});
 const signature=b64(await subtle.sign({name:'ECDSA',hash:'SHA-256'},signer.privateKey,utf8.encode(body)));
 const plain=utf8.encode(JSON.stringify({body,signature}));if(plain.length>4092)throw Error('Payload exceeds padded envelope');
 const padded=webcrypto.getRandomValues(new Uint8Array(4096));new DataView(padded.buffer).setUint32(0,plain.length);padded.set(plain,4);
 const ephemeral=await subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
 const salt=webcrypto.getRandomValues(new Uint8Array(32)),iv=webcrypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await subtle.encrypt({name:'AES-GCM',iv,additionalData:info},await derive(ephemeral.privateKey,recipientPublicKey,salt,info),padded);
 return {version:1,id,direction,ephemeralPublicKey:b64(await subtle.exportKey('raw',ephemeral.publicKey)),salt:b64(salt),iv:b64(iv),ciphertext:b64(ciphertext)};
}
export async function decryptMessage(envelope,{recipient,expectedSigner,id,direction='response'}){
 const fields=['version','id','direction','ephemeralPublicKey','salt','iv','ciphertext'];
 if(!envelope||Object.keys(envelope).length!==fields.length||!fields.every(f=>Object.hasOwn(envelope,f))||envelope.version!==1||envelope.id!==id||envelope.direction!==direction)throw Error('Envelope context mismatch');
 const info=aad(id,direction),salt=binary(envelope.salt,32),iv=binary(envelope.iv,12),ciphertext=binary(envelope.ciphertext,4112);
 const plain=await subtle.decrypt({name:'AES-GCM',iv,additionalData:info},await derive(recipient.privateKey,envelope.ephemeralPublicKey,salt,info),ciphertext);
 const length=new DataView(plain).getUint32(0);if(length>4092)throw Error('Invalid padding length');
 const signed=JSON.parse(decode.decode(new Uint8Array(plain,4,length)));if(typeof signed.body!=='string')throw Error('Missing signed body');
 const key=await subtle.importKey('raw',binary(expectedSigner,65),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 if(!await subtle.verify({name:'ECDSA',hash:'SHA-256'},key,binary(signed.signature,64),utf8.encode(signed.body)))throw Error('Sender authentication failed');
 const body=JSON.parse(signed.body);if(body.domain!=='veildesk.signed.v1'||body.id!==id||body.direction!==direction||body.recipientPublicKey!==recipient.publicKey)throw Error('Signed context mismatch');return body.payload;
}
export function createHttpTransport({url,token,allowLoopback=false}){
 const base=new URL(url);if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||(base.protocol!=='https:'&&!(allowLoopback&&base.protocol==='http:'&&['127.0.0.1','[::1]'].includes(base.hostname))))throw Error('HTTPS required');
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw Error('Invalid enrollment token');
 return async(path,{method='GET',body}={})=>{
  if(!/^\/v1\/(providers|jobs(?:\/[a-f0-9-]+(?:\/payment|\/artifacts\/[0-9]+)?)?)$/.test(path))throw Error('Unsupported buyer route');
  const response=await fetch(new URL(path,base),{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  // Bounded reads: do not accept an unbounded error or report body from an intermediary.
  let size=0,parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>1048576)throw Error('HTTP response too large');parts.push(chunk);}
  if(!response.ok)throw Object.assign(Error('HTTP request rejected'),{status:response.status});
  return JSON.parse(decode.decode(Buffer.concat(parts)));
 };
}
export function pinProvider(discovery,pin,capability){
 const provider=discovery?.schema==='veildesk.providers.v1'&&discovery.providers?.find(p=>p.id===pin.id);
 if(!provider||provider.encryptionKey!==pin.encryptionKey||provider.signingKey!==pin.signingKey||!provider.capabilities.includes(capability))throw Error('Provider pin or enrollment mismatch');return provider;
}
export async function prepareResearchRequest({id,expiresAt,provider,capability,request,signer}){
 if(!uuid(id)||!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+3600000)throw Error('Invalid request expiry');
 const route={provider:provider.id,capability,expiresAt};
 return {id,...route,envelope:await encryptMessage({schema:'veildesk.job.v1',route,payload:request},{signer,recipientPublicKey:provider.encryptionKey,id})};
}
export async function verifyResult(job,envelope,{recipient,expectedSigner}){
 const result=await decryptMessage(envelope,{recipient,expectedSigner,id:job.id});
 if(result?.schema!=='veildesk.result.v1'||result.id!==job.id||result.provider!==job.provider||result.capability!==job.capability||result.executionAuthorized!==false)throw Error('Result context mismatch');return result;
}
export async function readResearchReport(job,result,rpc,identity){
 const manifest=result?.payload?.artifact;
 if(manifest?.schema!=='veildesk.artifact.v1'||!/^[a-f0-9]{64}$/.test(manifest.digest)||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<1||manifest.bytes>65536||manifest.count!==Math.ceil(manifest.bytes/1024))throw Error('Invalid artifact manifest');
 const parts=[];for(let index=0;index<manifest.count;index++){
  const {envelope}=await rpc(`/v1/jobs/${job.id}/artifacts/${index}`);
  const chunk=await decryptMessage(envelope,{...identity,id:job.id});
  if(chunk?.schema!=='veildesk.artifact-chunk.v1'||chunk.provider!==job.provider||chunk.capability!==job.capability||chunk.digest!==manifest.digest||chunk.count!==manifest.count||chunk.index!==index)throw Error('Artifact context mismatch');
  parts.push(binary(chunk.data,Math.min(1024,manifest.bytes-index*1024)));
 }
 const bytes=Buffer.concat(parts);if(hash(bytes)!==manifest.digest)throw Error('Artifact digest mismatch');const report=JSON.parse(decode.decode(bytes));
 if(report?.schema!=='polydesk-a2a-market-research-v1'||report.orderAuthorized!==false||report.orderSubmitted!==false)throw Error('Invalid research report');return report;
}
// Transport and signature verification do not establish payment settlement.
// For paid research, additionally validate invoice/receipt bindings as documented.
// This reference intentionally contains no spend, signing-wallet or trade operation.

export const purchaseHash=purchase=>hash(JSON.stringify({id:purchase.id,expiresAt:purchase.expiresAt,request:purchase.request}));
export async function verifyResearchInvoice(job,envelope,identity,{purchase,network,maxPaymentZat}){
 if(!['main','test'].includes(network)||job.capability!==`polydesk.research.${network==='main'?'mainnet':'testnet'}-paid.v1`||typeof maxPaymentZat!=='string'||!/^\d{1,16}$/.test(maxPaymentZat)||BigInt(maxPaymentZat)<=0n)throw Error('Explicit payment policy required');
 if(purchase.id!==job.id||purchase.expiresAt!==job.expiresAt)throw Error('Purchase context mismatch');
 const p=(await verifyResult(job,envelope,identity)).payload,i=p?.invoice;
 if(p?.status!=='payment_required'||p.network!==network||p.requestHash!==purchaseHash(purchase)||p.tradeSubmitted!==false||!i||i.version!==1||i.network!==network||typeof i.address!=='string'||!i.address||i.address.length>512||!Number.isSafeInteger(i.expiresAt)||i.expiresAt<=0||i.expiresAt>job.expiresAt||typeof i.nonce!=='string'||!/^[a-f0-9]{48}$/.test(i.nonce)||i.memo!==`VD1:${i.nonce}`||typeof i.amount!=='string'||!/^\d{1,8}(\.\d{1,8})?$/.test(i.amount))throw Error('Invoice binding failed');
 const [whole,fraction='']=i.amount.split('.'),amount=BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'));
 if(amount<=0n||amount>2100000000000000n||i.amountZat!==String(amount)||amount>BigInt(maxPaymentZat)||p.invoiceHash!==hash(JSON.stringify(i)))throw Error('Invoice policy failed');
 return p; // Before a NEW payment, separately check expiry and obtain explicit wallet approval.
}
export function verifyResearchReceipt(result,{quote,network,txid}){
 const p=result?.payload,payment=p?.payment;
 if(!['main','test'].includes(network)||typeof quote?.requestHash!=='string'||typeof quote?.invoiceHash!=='string'||result?.executionAuthorized!==false||p?.schema!=='veildesk.service-result.v1'||p.service!=='polydesk.market-research.v1'||p.status!=='fulfilled'||p.mode!==`${network==='main'?'mainnet':'testnet'}-paid`||p.paymentVerified!==true||p.tradeSubmitted!==false||p.executionAuthorized!==false||payment?.network!==network||payment.requestHash!==quote.requestHash||payment.invoiceHash!==quote.invoiceHash||!/^([a-f0-9]{64})$/.test(txid)||payment.txid!==txid||!Number.isSafeInteger(payment.confirmations)||payment.confirmations<3||!/^([a-f0-9]{64})$/.test(payment.blockhash??'')||typeof payment.noteId!=='string'||!payment.noteId.startsWith(txid+':'))throw Error('Payment receipt binding failed');
 return payment;
}
