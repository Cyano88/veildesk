import {createHash} from 'node:crypto';
import {mkdir,open,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openSigned} from './authenticated.mjs';
import {validateMandate,oncePerMandate} from './mandate.mjs';
import {invoice,validateInvoice} from './zcash.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const empty=value=>Array.isArray(value)&&value.length===0;

// The provider supplies the account/address; never take these from an untrusted request.
// Keep this ledger private. It contains invoice metadata, but no plaintext mandate.
export async function issueAuthenticatedInvoice({directory,envelope,recipient,expectedSigner,address,account,amount,now=Date.now()}){
 const mandate=validateMandate(await openSigned(envelope,{recipient,expectedSigner,id:envelope.id,direction:'request'}),now);
 if(mandate.id!==envelope.id||!uuid(account))throw Error('Invalid payment binding');
 const binding=await oncePerMandate(join(directory,'invoices'),mandate,async()=>({
  schema:'veildesk.testnet-binding.v1',mandateHash:hash(mandate),signerHash:hash(expectedSigner),
  account,issuedAt:now,invoice:invoice({address,amount,network:'test',now})
 }));
 if(binding.signerHash!==hash(expectedSigner)||binding.account!==account||binding.invoice.address!==address||binding.invoice.amount!==amount)throw Error('Invoice binding conflict');
 return binding;
}

export async function testnetReadiness(nodeRpc,walletRpc){
 const chain=await nodeRpc('getblockchaininfo',[]),wallet=await walletRpc('getwalletstatus',[]);
 if(chain.chain!=='test'||!Number.isSafeInteger(chain.blocks)||chain.blocks<1||!Number.isSafeInteger(chain.estimatedheight)||chain.blocks<chain.estimatedheight||!Number.isFinite(chain.verificationprogress)||chain.verificationprogress<0.9999||chain.initial_block_download===true||!hex(chain.bestblockhash)||wallet.locked!==false||wallet.node_tip?.height!==chain.blocks||wallet.node_tip?.blockhash!==chain.bestblockhash||wallet.wallet_tip?.height!==chain.blocks||wallet.wallet_tip?.blockhash!==chain.bestblockhash||wallet.fully_synced_height!==chain.blocks||wallet.sync_work_remaining!=null)throw Error('Testnet node or wallet is not fully synced');
 return chain;
}

// Candidate txid is only a lookup hint. Acceptance requires recipient wallet evidence.
// Conservative v4/v5 Sapling-only/Orchard-only or v6 Ironwood-only policy.
export async function verifyZalletReceipt({nodeRpc,walletRpc,invoice:i,account,txid,minimumConfirmations=3,now=Date.now()}){
 validateInvoice(i);
 if(i.network!=='test'||!uuid(account)||!hex(txid)||!Number.isSafeInteger(minimumConfirmations)||minimumConfirmations<3)throw Error('Invalid testnet verification policy');
 const chain=await testnetReadiness(nodeRpc,walletRpc);
 const view=await walletRpc('z_viewtransaction',[txid]);
 if(view?.txid!==txid||!Array.isArray(view.outputs))throw Error('Invalid wallet transaction evidence');
 const memo=Buffer.from(i.memo).toString('hex');
 const notes=view.outputs.filter(n=>['sapling','orchard','ironwood'].includes(n.pool)&&n.account_uuid===account&&n.address===i.address&&n.outgoing===false&&n.walletInternal===false&&Number.isSafeInteger(n.valueZat)&&String(n.valueZat)===i.amountZat&&typeof n.memo==='string'&&new RegExp('^'+memo+'(?:00)*$','i').test(n.memo)&&n.memo.length<=1024);
 if(notes.length!==1)return {state:notes.length?'ambiguous_payment_review':now>=i.expiresAt?'expired_unpaid':'awaiting_payment',executionAuthorized:false};
 const note=notes[0],index=note.pool==='sapling'?note.output:note.action;
 if(!Number.isSafeInteger(index)||index<0||index>65535)throw Error('Invalid note index');
 const tx=await nodeRpc('getrawtransaction',[txid,1]);
 if(view.status!=='mined'||!Number.isSafeInteger(view.confirmations)||view.confirmations<minimumConfirmations||!hex(view.blockhash)||tx?.txid!==txid||!hex(tx.blockhash)||view.blockhash!==tx.blockhash||!Number.isSafeInteger(tx.confirmations)||tx.confirmations<minimumConfirmations||tx.in_active_chain===false)throw Error('Settlement is not confirmed in the active chain');
 if(![4,5,6].includes(tx.version)||!empty(tx.vin)||!empty(tx.vout)||!empty(tx.vjoinsplit)||(note.pool!=='ironwood'&&(tx.version===6||tx.ironwood!=null)))throw Error('Unsupported or transparent transaction');
 if(note.pool==='ironwood'){
  if(tx.version!==6||tx.versiongroupid!=='d884b698'||view.version!==6||!empty(tx.vShieldedSpend)||!empty(tx.vShieldedOutput)||(tx.orchard!=null&&!empty(tx.orchard.actions))||!Array.isArray(tx.ironwood?.actions)||index>=tx.ironwood.actions.length||tx.ironwood.flags?.enableSpends!==true||tx.ironwood.flags?.enableOutputs!==true)throw Error('Not an Ironwood-only payment');
 }else if(note.pool==='orchard'){
  if(tx.version!==5||!empty(tx.vShieldedSpend)||!empty(tx.vShieldedOutput)||!Array.isArray(tx.orchard?.actions)||index>=tx.orchard.actions.length||tx.orchard.flags?.enableSpends!==true||tx.orchard.flags?.enableOutputs!==true)throw Error('Not an Orchard-only payment');
 }else if(!Array.isArray(tx.vShieldedSpend)||!tx.vShieldedSpend.length||!Array.isArray(tx.vShieldedOutput)||index>=tx.vShieldedOutput.length||(tx.orchard!=null&&!empty(tx.orchard.actions)))throw Error('Not a Sapling-only payment');
 const height=chain.blocks-tx.confirmations+1;
 if(!Number.isSafeInteger(height)||height<1||tx.height!==height||view.confirmations!==tx.confirmations||await nodeRpc('getblockhash',[height])!==tx.blockhash)throw Error('Block is no longer canonical');
 // Do not accept a mix of pre/post reorg or moving-tip snapshots; retry read-only.
 const after=await testnetReadiness(nodeRpc,walletRpc);
 if(after.bestblockhash!==chain.bestblockhash||after.blocks!==chain.blocks)throw Error('Chain changed during verification; retry');
 return {state:now>=i.expiresAt?'late_payment_review':'confirmed',noteId:`${txid}:${note.pool}:${index}`,blockhash:tx.blockhash,height,confirmations:tx.confirmations,executionAuthorized:false};
}

export async function verifyAuthenticatedPayment({directory,envelope,recipient,expectedSigner,nodeRpc,walletRpc,txid,now=Date.now()}){
 const mandate=await openSigned(envelope,{recipient,expectedSigner,id:envelope.id,direction:'request'});
 if(!uuid(mandate?.id)||mandate.id!==envelope.id)throw Error('Invalid mandate ID');
 const binding=JSON.parse(await readFile(join(directory,'invoices',createHash('sha256').update(mandate.id).digest('hex')+'.json'),'utf8'));
 validateMandate(mandate,binding.issuedAt);
 if(binding.schema!=='veildesk.testnet-binding.v1'||binding.mandateHash!==hash(mandate)||binding.signerHash!==hash(expectedSigner))throw Error('Authenticated mandate binding mismatch');
 const receipt=await verifyZalletReceipt({nodeRpc,walletRpc,invoice:binding.invoice,account:binding.account,txid,now});
 if(!receipt.noteId)return receipt;
 if(receipt.state==='confirmed'&&now>=mandate.expiresAt)receipt.state='mandate_expired_review';
 const record={bindingHash:hash(binding),noteId:receipt.noteId,blockhash:receipt.blockhash};
 await mkdir(join(directory,'notes'),{recursive:true,mode:0o700});
 const path=join(directory,'notes',hash(receipt.noteId)+'.json');
 let handle;
 try{handle=await open(path,'wx',0o600)}catch(error){
  if(error.code!=='EEXIST')throw error;
  const prior=JSON.parse(await readFile(path,'utf8'));
  if(prior.bindingHash!==record.bindingHash)throw Error('Note already bound to another mandate');
  if(prior.blockhash!==record.blockhash)return {...receipt,state:'reorg_review',executionAuthorized:false};
  return recordMandateReceipt(directory,binding,receipt,true);
 }
 try{await handle.writeFile(JSON.stringify(record));await handle.sync()}finally{await handle.close()}
 return recordMandateReceipt(directory,binding,receipt,false);
}

async function recordMandateReceipt(directory,binding,receipt,replayed){
 await mkdir(join(directory,'settlements'),{recursive:true,mode:0o700});
 const path=join(directory,'settlements',hash(binding)+'.json');
 let handle;
 try{handle=await open(path,'wx',0o600)}catch(error){
  if(error.code!=='EEXIST')throw error;
  const prior=JSON.parse(await readFile(path,'utf8'));
  if(prior.noteId!==receipt.noteId)return {...receipt,state:'duplicate_payment_review',executionAuthorized:false};
  return {...receipt,mandateHash:binding.mandateHash,replayed};
 }
 try{await handle.writeFile(JSON.stringify({noteId:receipt.noteId}));await handle.sync()}finally{await handle.close()}
 return {...receipt,mandateHash:binding.mandateHash,replayed};
}
