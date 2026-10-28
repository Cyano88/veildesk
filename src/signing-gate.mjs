// Candidate only: host-local authorization gate. No HTTP route, key loading or broadcast.
import {DatabaseSync} from 'node:sqlite';
import {createHash,webcrypto} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const units=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;
const deny=message=>{throw Error(message);};
export const signingAuthorizationBody=authorization=>JSON.stringify({domain:'veildesk.signing-authorization.v1',authorization});
export async function signAuthorization(authorization,signer){
 const body=signingAuthorizationBody(authorization);
 return {body,signature:Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signer.privateKey,Buffer.from(body))).toString('base64')};
}
export function createSigningGate({database,network,sponsor,agents,inspectTransaction,quoteFee,signMessage,now=Date.now}){
 if(typeof database!=='string'||!database||database===':memory:')deny('A durable database path is required');
 if(!['solana:mainnet-beta','solana:devnet'].includes(network)||typeof sponsor!=='string'||!sponsor||typeof inspectTransaction!=='function'||typeof quoteFee!=='function'||typeof signMessage!=='function')deny('Missing trusted signer configuration');
 // Enrollment and limits come from host configuration, never request JSON.
 const enrolled=structuredClone(agents);if(!enrolled||!Object.keys(enrolled).length)deny('Missing enrolled agents');
 for(const p of Object.values(enrolled))if(!p||typeof p.customer!=='string'||p.customer===sponsor||typeof p.sourceAccount!=='string'||typeof p.mint!=='string'||!Number.isInteger(p.decimals)||p.decimals<0||p.decimals>18||!units(p.maxTotalUnits)||BigInt(p.maxTotalUnits)<=0n||!units(p.maxFeeLamports)||!Array.isArray(p.recipients)||!p.recipients.length||p.recipients.some(r=>typeof r!=='string'||r===p.sourceAccount)||typeof p.signingKey!=='string')deny('Invalid agent policy or sponsor/customer separation');
 const db=new DatabaseSync(database);db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS signing_authorizations(id TEXT PRIMARY KEY,binding TEXT NOT NULL,state TEXT NOT NULL,signature TEXT)");
 return {
  async authorizeAndSign({signed,transaction}){
   if(!exact(signed,['body','signature'])||typeof signed.body!=='string'||Buffer.byteLength(signed.body)>8192||typeof signed.signature!=='string'||signed.signature.length!==88)deny('Invalid signed authorization');
   const body=signed.body,signatureText=signed.signature;
   let parsed;try{parsed=JSON.parse(body)}catch{deny('Invalid signed authorization');}
   if(!exact(parsed,['domain','authorization'])||parsed.domain!=='veildesk.signing-authorization.v1')deny('Invalid authorization domain');
   const a=parsed.authorization;
   if(!exact(a,['schema','id','agent','network','sponsor','customer','sourceAccount','mint','decimals','transfers','messageHash','maxFeeLamports','expiresAt'])||a.schema!=='veildesk.sponsor-transfer.v1'||typeof a.id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(a.id)||typeof a.agent!=='string'||!Object.hasOwn(enrolled,a.agent))deny('Unknown or invalid authorization');
   const p=enrolled[a.agent],signature=Buffer.from(signatureText,'base64');if(signature.length!==64||signature.toString('base64')!==signatureText)deny('Invalid signature encoding');
   const key=await webcrypto.subtle.importKey('raw',Buffer.from(p.signingKey,'base64'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
   if(!await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,Buffer.from(body)))deny('Agent signature invalid');
   if(a.sponsor!==sponsor||a.customer===sponsor||a.customer!==p.customer)deny('Sponsor cannot authorize customer spending');
   if(a.network!==network||a.sourceAccount!==p.sourceAccount||a.mint!==p.mint||a.decimals!==p.decimals)deny('Asset or customer policy mismatch');
   if(!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=now()||a.expiresAt>now()+300000||typeof a.messageHash!=='string'||!/^[a-f0-9]{64}$/.test(a.messageHash)||!units(a.maxFeeLamports)||BigInt(a.maxFeeLamports)>BigInt(p.maxFeeLamports))deny('Authorization expiry or fee policy invalid');
   if(!Array.isArray(a.transfers)||a.transfers.length<1||a.transfers.length>2||a.transfers.some(t=>!exact(t,['recipientAccount','amountUnits'])||!p.recipients.includes(t.recipientAccount)||!units(t.amountUnits)||BigInt(t.amountUnits)<=0n)||new Set(a.transfers.map(t=>t.recipientAccount)).size!==a.transfers.length)deny('Transfer not allowed');
   if(a.transfers.reduce((sum,t)=>sum+BigInt(t.amountUnits),0n)>BigInt(p.maxTotalUnits))deny('Transfer total exceeds policy');
   if(typeof transaction!=='string'||transaction.length>1644)deny('Invalid transaction encoding');
   const wire=Buffer.from(transaction,'base64');if(!wire.length||wire.length>1232||wire.toString('base64')!==transaction)deny('Invalid transaction encoding');
   // Trusted adapter parses actual wire bytes; request-supplied instruction summaries are never accepted.
   const inspected=await inspectTransaction(Buffer.from(wire));
   const message=Buffer.from(inspected.message);
   if(hash(message)!==a.messageHash||inspected.feePayer!==sponsor||inspected.customer!==a.customer||inspected.customerSigned!==true||inspected.sourceAccount!==a.sourceAccount||inspected.mint!==a.mint||inspected.decimals!==a.decimals||JSON.stringify(inspected.transfers)!==JSON.stringify(a.transfers))deny('Transaction does not match authorization');
   const id=hash(JSON.stringify([network,sponsor,a.agent,a.id]));
   const binding=hash(JSON.stringify({authorization:a,policy:p,network,sponsor,messageHash:hash(message)}));
   const prior=db.prepare('SELECT * FROM signing_authorizations WHERE id=?').get(id);
   const replay=row=>{if(row.binding!==binding)deny('Authorization ID conflict');if(row.state!=='signed')deny('Signing requires reconciliation; never retry automatically');return {signature:row.signature,messageHash:a.messageHash,replayed:true,broadcast:false};};
   if(prior)return replay(prior);
   // Trusted chain-specific fee/blockhash observation must refer to these exact bytes.
   const quote=await quoteFee(Buffer.from(message));
   if(!quote||quote.network!==network||quote.messageHash!==a.messageHash||quote.blockhashValid!==true||!Number.isSafeInteger(quote.checkedAt)||quote.checkedAt>now()||now()-quote.checkedAt>5000||!units(quote.lamports)||BigInt(quote.lamports)>BigInt(a.maxFeeLamports))deny('Fee quote or blockhash invalid');
   if(now()>=a.expiresAt)deny('Authorization expired before signing');
   const reserved=db.prepare("INSERT OR IGNORE INTO signing_authorizations(id,binding,state) VALUES(?,?,'reserved')").run(id,binding);
   if(!reserved.changes)return replay(db.prepare('SELECT * FROM signing_authorizations WHERE id=?').get(id));
   // Reservation is durable before invoking the only signing callback. Uncertain outcomes stay reserved.
   const result=await signMessage(Buffer.from(message));
   if(!(result instanceof Uint8Array)||result.length!==64)deny('Signer returned invalid result; reconciliation required');
   const encoded=Buffer.from(result).toString('base64');
   db.prepare("UPDATE signing_authorizations SET state='signed',signature=? WHERE id=? AND state='reserved'").run(encoded,id);
   return {signature:encoded,messageHash:a.messageHash,replayed:false,broadcast:false};
  },
  close(){db.close();}
 };
}
