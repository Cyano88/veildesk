// Inject the host's reviewed @solana/web3.js dependency. No network or wallet key access.
// Deliberately narrow: legacy messages with one/two classic SPL TransferChecked instructions.
export function createSolanaSponsorshipInspector({Transaction,PublicKey}){
 const tokenProgram=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
 return async wire=>{
  const tx=Transaction.from(wire);
  if(!tx.recentBlockhash||!tx.feePayer||tx.instructions.length<1||tx.instructions.length>2||tx.signatures.length!==2)throw Error('Unsupported sponsorship transaction');
  const feePayer=tx.feePayer.toBase58(),transfers=[];let customer,sourceAccount,mint,decimals;
  for(const i of tx.instructions){
   if(!i.programId.equals(tokenProgram)||i.keys.length!==4||i.data.length!==10||i.data[0]!==12)throw Error('Only SPL TransferChecked is supported');
   const [source,asset,destination,authority]=i.keys;
   if(!source.isWritable||source.isSigner||asset.isWritable||asset.isSigner||!destination.isWritable||destination.isSigner||!authority.isSigner)throw Error('Unexpected instruction privileges');
   const fields={customer:authority.pubkey.toBase58(),sourceAccount:source.pubkey.toBase58(),mint:asset.pubkey.toBase58(),decimals:i.data[9]};
   if(fields.customer===feePayer)throw Error('Sponsor cannot be token authority');
   if(customer&&(customer!==fields.customer||sourceAccount!==fields.sourceAccount||mint!==fields.mint||decimals!==fields.decimals))throw Error('Mixed token sources or authorities');
   ({customer,sourceAccount,mint,decimals}=fields);
   transfers.push({recipientAccount:destination.pubkey.toBase58(),amountUnits:i.data.readBigUInt64LE(1).toString()});
  }
  const sponsorSignature=tx.signatures.find(s=>s.publicKey.toBase58()===feePayer),customerSignature=tx.signatures.find(s=>s.publicKey.toBase58()===customer);
  if(!sponsorSignature||sponsorSignature.signature||!customerSignature?.signature||!tx.verifySignatures(false))throw Error('Valid independent customer signature required');
  return {message:Buffer.from(tx.serializeMessage()),feePayer,customer,customerSigned:true,sourceAccount,mint,decimals,transfers};
 };
}
