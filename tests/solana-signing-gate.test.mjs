import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {createHash,randomUUID} from 'node:crypto';
import {signingIdentity} from '../src/authenticated.mjs';import {createSigningGate,signAuthorization} from '../src/signing-gate.mjs';import {createSolanaSponsorshipInspector} from '../src/solana-sponsorship-inspector.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');

test('real Solana wire bytes: sponsor-owner exploit rejected; customer-approved sponsorship allowed (mock signer, no RPC)',{skip:!process.env.VEILDESK_SOLANA_DEPENDENCY_ROOT},async()=>{
 const require=createRequire(pathToFileURL(join(resolve(process.env.VEILDESK_SOLANA_DEPENDENCY_ROOT),'package.json')));
 const web3=require('@solana/web3.js'),{Keypair,PublicKey,Transaction,TransactionInstruction,SystemProgram}=web3;
 const dir=await mkdtemp(join(tmpdir(),'veildesk-solana-gate-'));let gate;
 try{
  const sponsor=Keypair.generate(),customer=Keypair.generate(),agent=await signingIdentity();const address=()=>Keypair.generate().publicKey;
  const source=address(),mint=address(),merchant=address(),treasury=address(),attacker=address(),blockhash=address().toBase58();
  const tokenProgram=new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const instruction=(authority,destination,amount,sourceAccount=source)=>{
   const data=Buffer.alloc(10);data[0]=12;data.writeBigUInt64LE(BigInt(amount),1);data[9]=6;
   return new TransactionInstruction({programId:tokenProgram,keys:[{pubkey:sourceAccount,isWritable:true,isSigner:false},{pubkey:mint,isWritable:false,isSigner:false},{pubkey:destination,isWritable:true,isSigner:false},{pubkey:authority,isWritable:false,isSigner:true}],data});
  };
  const transaction=(owner=customer,extra)=>{const tx=new Transaction({feePayer:sponsor.publicKey,recentBlockhash:blockhash});tx.add(instruction(owner.publicKey,merchant,'20700000'),instruction(owner.publicKey,treasury,'522'));if(extra)tx.add(extra);if(owner!==sponsor)tx.partialSign(owner);return tx;};
  const good=transaction(),unsafe=transaction(sponsor);
  // Regression precondition: sponsor as token authority needs no independent customer signature.
  assert.equal(unsafe.compileMessage().header.numRequiredSignatures,1);
  assert.equal(good.compileMessage().header.numRequiredSignatures,2);
  let calls=0;const policy={customer:customer.publicKey.toBase58(),sourceAccount:source.toBase58(),mint:mint.toBase58(),decimals:6,maxTotalUnits:'21000000',maxFeeLamports:'5000',recipients:[merchant.toBase58(),treasury.toBase58()],signingKey:agent.publicKey};
  const options={database:join(dir,'gate.db'),network:'solana:devnet',sponsor:sponsor.publicKey.toBase58(),agents:{buyer:policy},inspectTransaction:createSolanaSponsorshipInspector(web3),
   quoteFee:async message=>({network:'solana:devnet',messageHash:hash(message),lamports:'5000',checkedAt:Date.now(),blockhashValid:true}),
   signMessage:async message=>{calls++;assert.deepEqual(message,good.serializeMessage());return Buffer.alloc(64,9);}};
  gate=createSigningGate(options);
  const mandate=tx=>({schema:'veildesk.sponsor-transfer.v1',id:randomUUID(),agent:'buyer',network:'solana:devnet',sponsor:sponsor.publicKey.toBase58(),customer:policy.customer,sourceAccount:policy.sourceAccount,mint:policy.mint,decimals:6,
   transfers:[{recipientAccount:merchant.toBase58(),amountUnits:'20700000'},{recipientAccount:treasury.toBase58(),amountUnits:'522'}],messageHash:hash(tx.serializeMessage()),maxFeeLamports:'5000',expiresAt:Date.now()+60000});
  const input=async(tx,a=mandate(tx))=>({signed:await signAuthorization(a,agent),transaction:tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')});
  const exploit=await input(unsafe,{...mandate(unsafe),customer:sponsor.publicKey.toBase58()});await assert.rejects(gate.authorizeAndSign(exploit),/Sponsor/);assert.equal(calls,0);
  // Merely lying about the customer in the signed JSON does not bypass inspection.
  await assert.rejects(gate.authorizeAndSign(await input(unsafe)),/Unsupported|Sponsor/);assert.equal(calls,0);
  const noCustomer=new Transaction({feePayer:sponsor.publicKey,recentBlockhash:blockhash}).add(instruction(customer.publicKey,merchant,'20700000'),instruction(customer.publicKey,treasury,'522'));
  await assert.rejects(gate.authorizeAndSign(await input(noCustomer)),/customer signature/);
  const altered=transaction();altered.instructions[0]=instruction(customer.publicKey,attacker,'20700000');altered.partialSign(customer);await assert.rejects(gate.authorizeAndSign(await input(altered)),/match/);
  const extra=transaction(customer,SystemProgram.transfer({fromPubkey:customer.publicKey,toPubkey:attacker,lamports:1}));await assert.rejects(gate.authorizeAndSign(await input(extra)),/Unsupported|Only SPL/);
  const unknown=new Transaction({feePayer:sponsor.publicKey,recentBlockhash:blockhash}).add(SystemProgram.transfer({fromPubkey:customer.publicKey,toPubkey:attacker,lamports:1}));unknown.partialSign(customer);await assert.rejects(gate.authorizeAndSign(await input(unknown)),/Only SPL/);
  const v0=new web3.VersionedTransaction(new web3.TransactionMessage({payerKey:sponsor.publicKey,recentBlockhash:blockhash,instructions:good.instructions}).compileToV0Message());v0.sign([customer]);
  const v0Authorization={...mandate(good),messageHash:hash(v0.message.serialize())};
  await assert.rejects(gate.authorizeAndSign({signed:await signAuthorization(v0Authorization,agent),transaction:Buffer.from(v0.serialize()).toString('base64')}));
  assert.equal(calls,0);
  const validInput=await input(good),signed=await gate.authorizeAndSign(validInput);assert.equal(calls,1);assert.equal(signed.broadcast,false);
  gate.close();gate=createSigningGate(options);assert.equal((await gate.authorizeAndSign(validInput)).signature,signed.signature);assert.equal(calls,1);
 }finally{gate?.close();await rm(dir,{recursive:true,force:true});}
});
