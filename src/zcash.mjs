// LEGACY FIXTURE ADAPTER: zcashd has reached EOL; not compatible with live Zallet receipt RPC. See docs/testnet-setup.md.
// A local wallet adapter. No spending key or wallet RPC is exposed to the browser.
import {randomBytes} from 'node:crypto';
export function zats(value){
 if(typeof value!=='string'||!/^\d{1,8}(\.\d{1,8})?$/.test(value))throw Error('Invalid ZEC amount');
 const [whole,fraction='']=value.split('.');const n=BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'));
 if(n<=0n||n>21000000n*100000000n)throw Error('Amount outside supported range');return n;
}
export function validateInvoice(i){
 if(!i||i.version!==1||!['main','test'].includes(i.network)||typeof i.address!=='string'||!i.address||i.address.length>512||!Number.isSafeInteger(i.expiresAt)||i.expiresAt<=0||typeof i.nonce!=='string'||!/^[a-f0-9]{48}$/.test(i.nonce)||i.memo!==`VD1:${i.nonce}`||zats(i.amount).toString()!==i.amountZat)throw Error('Invalid invoice');
 return i;
}
export function invoice({address,amount,network,now=Date.now()}){
 if(!['main','test'].includes(network)||typeof address!=='string'||!address||address.length>512)throw Error('Invalid invoice');
 const amountZat=zats(amount).toString(),nonce=randomBytes(24).toString('hex');
 return {version:1,address,amount,amountZat,network,nonce,memo:`VD1:${nonce}`,expiresAt:now+900000};
}
export function paymentUri(i){
 validateInvoice(i);
 return `zcash:${encodeURIComponent(i.address)}?amount=${i.amount}&memo=${Buffer.from(i.memo).toString('base64url')}`;
}
export async function verifyInvoice(rpc,i,{minimumConfirmations=3,now=Date.now()}={}){
 if(!Number.isInteger(minimumConfirmations)||minimumConfirmations<1)throw Error('Invalid confirmation policy');
 validateInvoice(i);
 const late=now>=i.expiresAt;
 const chain=await rpc('getblockchaininfo',[]);if(chain.chain!==i.network||chain.initial_block_download!==false)throw Error('Wallet network is wrong or still syncing');
 const notes=await rpc('z_listreceivedbyaddress',[i.address,minimumConfirmations]);
 const note=notes.find(n=>['sapling','orchard'].includes(n.pool)&&n.change===false&&Number.isSafeInteger(n.amountZat)&&String(n.amountZat)===i.amountZat&&Number.isInteger(n.confirmations)&&n.confirmations>=minimumConfirmations&&Number.isSafeInteger(n.outindex)&&/^[0-9a-f]{64}$/.test(n.txid)&&typeof n.memo==='string'&&/^(?:[0-9a-fA-F]{2})+$/.test(n.memo)&&Buffer.from(n.memo,'hex').toString('utf8').replace(/\0+$/,'')===i.memo);
 if(!note)return {state:late?'expired_unpaid':'awaiting_payment'};
 // Recipient evidence proves receipt, not payer anonymity. Check the public transaction too.
 const tx=await rpc('getrawtransaction',[note.txid,1]);
 if(!tx||tx.txid!==note.txid||!Number.isInteger(tx.confirmations)||tx.confirmations<minimumConfirmations||typeof tx.blockhash!=='string'||!/^[0-9a-f]{64}$/.test(tx.blockhash)||tx.in_active_chain===false)throw Error('Settlement is not confirmed');
 if(!Array.isArray(tx.vin)||tx.vin.length||!Array.isArray(tx.vout)||tx.vout.length||!Array.isArray(tx.vjoinsplit)||tx.vjoinsplit.length)throw Error('Transparent or legacy payment rejected');
 const sapling=Array.isArray(tx.vShieldedSpend)&&tx.vShieldedSpend.length>0;
 const orchard=Array.isArray(tx.orchard?.actions)&&tx.orchard.actions.length>0;
 if(sapling===orchard||note.pool==='sapling'&&!sapling||note.pool==='orchard'&&!orchard)throw Error('Cross-pool or unknown payment rejected');
 if(orchard&&(!Array.isArray(tx.vShieldedSpend)||tx.vShieldedSpend.length||!Array.isArray(tx.vShieldedOutput)||tx.vShieldedOutput.length))throw Error('Cross-pool payment rejected');
 return {state:late?'late_payment_review':'confirmed',noteId:`${note.txid}:${note.pool}:${note.outindex}`,confirmations:note.confirmations};
}
export async function sendPrivate(rpc,{from,invoice:i,approved=false}){
 if(approved!==true)throw Error('Explicit payment approval required');
 validateInvoice(i);
 if(Date.now()>=i.expiresAt)throw Error('Invoice expired');
 const chain=await rpc('getblockchaininfo',[]);if(chain.chain!==i.network||chain.initial_block_download!==false)throw Error('Wallet network is wrong or still syncing');
 zats(i.amount);
 // The wallet must reject transparent funding and cross-pool value leakage.
 return rpc('z_sendmany',[from,[{address:i.address,amount:Number(i.amount),memo:Buffer.from(i.memo).toString('hex')}],3,null,'FullPrivacy']);
}
