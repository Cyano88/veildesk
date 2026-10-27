import {validateInvoice} from './zcash.mjs';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// capture is a trusted host callback that performs a fresh completed wallet scan and
// invokes the native exporter under the same exclusive wallet lock. Never accept a
// buyer-supplied snapshot or substitute CLI note summaries. This trusts the configured
// light-wallet indexer; it is not independent full-node consensus verification.
function inspect(snapshot,{invoice,accountId,txid,minimumConfirmations,now}){
 const {evidence:e,scan,capturedAt}=snapshot??{};
 const scannedAt=Date.parse(scan?.checkedAt);
 if(!Number.isSafeInteger(capturedAt)||capturedAt>now||now-capturedAt>30000||!Number.isFinite(scannedAt)
  ||capturedAt<scannedAt||capturedAt-scannedAt>5000||scan?.syncReady!==true||scan.network!=='test'
  ||e?.schema!=='veildesk.light-wallet-evidence.v1'||e.network!=='test'||!hash(e.walletDigest)
  ||!Number.isSafeInteger(e.tip?.height)||e.tip.height<1||!hash(e.tip.hash)||scan.height!==e.tip.height)
  throw Error('Fresh complete light-wallet evidence required');
 if(e.recipient?.tracked!==true||e.recipient.accountId!==accountId||e.recipient.address!==invoice.address)
  throw Error('Light-wallet recipient binding mismatch');
 const tx=e.transaction;
 if(tx===null)return {state:now>=invoice.expiresAt?'expired_unpaid':'awaiting_payment',executionAuthorized:false};
 if(!tx||tx.txid!==txid||tx.shieldedOnly!==true||!Number.isSafeInteger(tx.actionCount)||tx.actionCount<1
  ||!((tx.pool==='orchard'&&tx.version===5&&tx.versionGroupId==='26a7270a')
    ||(tx.pool==='ironwood'&&tx.version===6&&tx.versionGroupId==='d884b698')))
  throw Error('Unsupported or non-shielded light-wallet transaction');
 if(tx.mined!==true||!Number.isSafeInteger(tx.height)||tx.height<1||!hash(tx.blockhash))throw Error('Settlement is not mined');
 const confirmations=e.tip.height-tx.height+1;
 if(confirmations<minimumConfirmations||confirmations>200||!Array.isArray(tx.chain)||tx.chain.length!==confirmations)
  throw Error('Settlement lacks retained confirmed chain evidence');
 for(let index=0;index<tx.chain.length;index++){
  const block=tx.chain[index];
  if(block?.height!==tx.height+index||!hash(block.hash)||!hash(block.previousHash)
   ||(index===0?block.hash!==tx.blockhash:block.previousHash!==tx.chain[index-1].hash))throw Error('Broken light-wallet block binding');
 }
 if(tx.chain.at(-1).hash!==e.tip.hash)throw Error('Receipt chain does not reach wallet tip');
 if(!Array.isArray(tx.notes))throw Error('Missing recipient note evidence');
 const notes=tx.notes.filter(note=>note?.accountId===accountId&&note.address===invoice.address&&note.scope==='external'
  &&note.amountZat===invoice.amountZat&&note.memo===invoice.memo);
 if(notes.length!==1)return {state:notes.length?'ambiguous_payment_review':now>=invoice.expiresAt?'expired_unpaid':'awaiting_payment',executionAuthorized:false};
 const index=notes[0].outputIndex;
 if(!Number.isSafeInteger(index)||index<0||index>=tx.actionCount)throw Error('Invalid recipient note index');
 return {state:now>=invoice.expiresAt?'late_payment_review':'confirmed',noteId:`${txid}:${tx.pool}:${index}`,
  blockhash:tx.blockhash,height:tx.height,confirmations,executionAuthorized:false};
}
export async function verifyLightWalletReceipt({capture,invoice,accountId,txid,minimumConfirmations=3,now=Date.now}){
 validateInvoice(invoice);
 if(invoice.network!=='test'||!Number.isSafeInteger(accountId)||accountId<0||accountId>0x7fffffff
  ||!hash(txid)||typeof capture!=='function'||typeof now!=='function'||!Number.isSafeInteger(minimumConfirmations)||minimumConfirmations<3)
  throw Error('Invalid light-wallet verification policy');
 const query={accountId,address:invoice.address,txid};
 const first=await capture(query),receipt=inspect(first,{invoice,accountId,txid,minimumConfirmations,now:now()});
 if(!receipt.noteId)return receipt;
 const second=await capture(query),rechecked=inspect(second,{invoice,accountId,txid,minimumConfirmations,now:now()});
 if(first.evidence.tip.height!==second.evidence.tip.height||first.evidence.tip.hash!==second.evidence.tip.hash
  ||receipt.noteId!==rechecked.noteId||receipt.blockhash!==rechecked.blockhash||receipt.height!==rechecked.height)
  throw Error('Chain or note changed during light-wallet verification; retry');
 return rechecked;
}
