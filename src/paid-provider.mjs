import {createZalletSettlement} from './settlement.mjs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {openSigned} from './authenticated.mjs';
import {sealPrivateResult} from './client.mjs';
import {invoice,zats} from './zcash.mjs';
import {validateMandate} from './mandate.mjs';

export const PAID_CAPABILITY='prediction.mandate.validate.testnet-paid.v1';
export const paymentHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Testnet pilot only. The trusted endpoint verifies wallet evidence; the opaque relay cannot.
// No spend RPC or automatic refund. Public availability remains disabled until live acceptance.
export function createPaidProvider({database,network,account,address,amount,nodeRpc,walletRpc,recipient,signer,peers,now=Date.now,settlement}){
 if(network!=='test'||typeof account!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(account)||typeof address!=='string'||!address||(!settlement&&(typeof nodeRpc!=='function'||typeof walletRpc!=='function')))throw Error('Invalid testnet payment configuration');zats(amount);
 const paymentBackend=settlement??createZalletSettlement({nodeRpc,walletRpc,account,address});
 if(paymentBackend.address!==address||!/^(?:zallet-testnet-v1|zingolib-testnet-v1:[0-9]+)$/.test(paymentBackend.id)||['preflight','recipient','verify'].some(name=>typeof paymentBackend[name]!=='function'))throw Error('Invalid trusted settlement backend');
 const db=new DatabaseSync(database);db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS paid_jobs(owner TEXT PRIMARY KEY,binding TEXT NOT NULL,issued INTEGER NOT NULL,invoice TEXT NOT NULL,challenge TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'awaiting',note TEXT,blockhash TEXT,result TEXT,review TEXT);
 CREATE TABLE IF NOT EXISTS paid_notes(note TEXT PRIMARY KEY,owner TEXT NOT NULL);`);
 if(!db.prepare('PRAGMA table_info(paid_jobs)').all().some(c=>c.name==='review_result'))db.exec('ALTER TABLE paid_jobs ADD COLUMN review_result TEXT');
 const review=(owner,reason)=>{db.prepare("UPDATE paid_jobs SET state='review',review=? WHERE owner=?").run(reason,owner);return {state:'payment_review',reason,executionAuthorized:false}};
 return {
  close:()=>db.close(),
  async process(job,{rpc}){
   const peer=peers[job.client];if(!peer||job.capability!==PAID_CAPABILITY)throw Error('Unsupported or unenrolled paid job');
   const owner=paymentHash([job.client,job.id]);let row=db.prepare('SELECT * FROM paid_jobs WHERE owner=?').get(owner);
   const request=await openSigned(job.envelope,{recipient,expectedSigner:peer.signingKey,id:job.id,direction:'request'});
   if(request?.schema!=='veildesk.job.v1'||request.route?.provider!==job.provider||request.route?.capability!==job.capability||request.route?.expiresAt!==job.expiresAt)throw Error('Paid job context mismatch');
   const mandate=validateMandate(request.payload,row?.issued??now());if(mandate.id!==job.id||mandate.expiresAt!==job.expiresAt)throw Error('Paid mandate context mismatch');
   const binding=paymentHash({owner,request,signer:peer.signingKey,recipient:peer.encryptionKey,providerSigner:signer.publicKey,providerRecipient:recipient.publicKey,account,address,amount,network,...(paymentBackend.id==='zallet-testnet-v1'?{}:{settlement:paymentBackend.id})});
   async function publishReview(reason){
    review(owner,reason);
    let stored=db.prepare('SELECT review_result FROM paid_jobs WHERE owner=?').get(owner)?.review_result;
    if(!stored){
     const envelope=await sealPrivateResult(job,{status:'payment_review',reason,mandateHash:paymentHash(mandate),paymentVerified:false,tradeSubmitted:false},{signer,recipientPublicKey:peer.encryptionKey});
     db.prepare('UPDATE paid_jobs SET review_result=? WHERE owner=? AND review_result IS NULL').run(JSON.stringify(envelope),owner);
     stored=db.prepare('SELECT review_result FROM paid_jobs WHERE owner=?').get(owner).review_result;
    }
    await rpc('/v1/provider/payment-review',{method:'POST',body:{client:job.client,id:job.id,envelope:JSON.parse(stored)}});
    return {state:'payment_review',reason,executionAuthorized:false};
   }
   if(row&&row.binding!==binding)throw Error('Paid job binding conflict');
   if(!row){
    // Never solicit payment from a wallet which cannot currently verify receipts.
    await paymentBackend.preflight();
    await paymentBackend.recipient();
    const issued=now();validateMandate(mandate,issued);
    const i=invoice({address,amount,network:'test',now:issued});i.expiresAt=Math.min(i.expiresAt,mandate.expiresAt);
    const challenge=await sealPrivateResult(job,{status:'payment_required',network:'test',invoice:i,invoiceHash:paymentHash(i),mandateHash:paymentHash(mandate),tradeSubmitted:false},{signer,recipientPublicKey:peer.encryptionKey});
    db.prepare('INSERT OR IGNORE INTO paid_jobs(owner,binding,issued,invoice,challenge) VALUES(?,?,?,?,?)').run(owner,binding,issued,JSON.stringify(i),JSON.stringify(challenge));
    row=db.prepare('SELECT * FROM paid_jobs WHERE owner=?').get(owner);if(row.binding!==binding)throw Error('Paid job binding conflict');
   }
   if(row.state==='review')return publishReview(row.review);
   if(row.state==='preparing')throw Error('Paid result pending reconciliation; do not execute again');
   if(now()>=mandate.expiresAt)return publishReview('mandate_expired_review');
   await paymentBackend.recipient();
   await rpc('/v1/provider/invoice',{method:'POST',body:{client:job.client,id:job.id,envelope:JSON.parse(row.challenge)}});
   if(!job.paymentHint)return {state:'awaiting_payment',executionAuthorized:false};
   const i=JSON.parse(row.invoice),hint=await openSigned(job.paymentHint,{recipient,expectedSigner:peer.signingKey,id:job.id,direction:'request'});
   if(hint?.schema!=='veildesk.payment-hint.v1'||hint.provider!==job.provider||hint.capability!==job.capability||hint.invoiceHash!==paymentHash(i)||hint.mandateHash!==paymentHash(mandate)||typeof hint.txid!=='string'||!/^[a-f0-9]{64}$/.test(hint.txid))throw Error('Payment hint authentication or binding failed');
   const receipt=await paymentBackend.verify({invoice:i,txid:hint.txid,now:now()});
   if(receipt.state==='awaiting_payment')return {state:'awaiting_payment',executionAuthorized:false};
   if(receipt.state!=='confirmed')return publishReview(receipt.state);
   if(now()>=Math.min(i.expiresAt,mandate.expiresAt))return publishReview('late_payment_review');
   if(row.note&&row.note!==receipt.noteId)return publishReview('duplicate_payment_review');
   if(row.blockhash&&row.blockhash!==receipt.blockhash)return publishReview('reorg_review');
   if(!row.result){
    db.exec('BEGIN IMMEDIATE');let reserved=false;
    try{
     const existing=db.prepare('SELECT owner FROM paid_notes WHERE note=?').get(receipt.noteId);
     if(existing&&existing.owner!==owner){db.exec('ROLLBACK');return publishReview('note_already_bound_review')}
     db.prepare('INSERT OR IGNORE INTO paid_notes(note,owner) VALUES(?,?)').run(receipt.noteId,owner);
     reserved=db.prepare("UPDATE paid_jobs SET state='preparing',note=?,blockhash=? WHERE owner=? AND state='awaiting'").run(receipt.noteId,receipt.blockhash,owner).changes===1;
     db.exec('COMMIT');
    }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}
    if(!reserved)throw Error('Concurrent or uncertain paid result; reconcile before retry');
    const result=await sealPrivateResult(job,{status:'validated',mandate,marketVerified:false,paymentVerified:true,tradeSubmitted:false,payment:{network:'test',txid:hint.txid,noteId:receipt.noteId,blockhash:receipt.blockhash,confirmations:receipt.confirmations,invoiceHash:paymentHash(i),mandateHash:paymentHash(mandate)}},{signer,recipientPublicKey:peer.encryptionKey});
    db.prepare("UPDATE paid_jobs SET result=?,state='ready' WHERE owner=? AND state='preparing'").run(JSON.stringify(result),owner);
    row=db.prepare('SELECT * FROM paid_jobs WHERE owner=?').get(owner);
   }
   // Even a saved result must pass a fresh chain check immediately before delivery.
   const final=await paymentBackend.verify({invoice:i,txid:hint.txid,now:now()});
   if(final.state!=='confirmed'||final.noteId!==row.note||final.blockhash!==row.blockhash||now()>=Math.min(i.expiresAt,mandate.expiresAt))return publishReview('finality_or_expiry_review');
   return rpc('/v1/provider/deliver',{method:'POST',body:{client:job.client,id:job.id,envelope:JSON.parse(row.result)}});
  }
 };
}


