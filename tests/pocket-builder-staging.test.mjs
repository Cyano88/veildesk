// Offline integration fixture. Never imports Pocket's module or its secret loaders.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {signingIdentity} from '../src/authenticated.mjs';
import {createSigningGate,signAuthorization} from '../src/signing-gate.mjs';
import {createSolanaSponsorshipInspector} from '../src/solana-sponsorship-inspector.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');

test('Pocket actual builder staging: unsigned preparation, customer approval, gated mock sponsorship',{
 skip:!process.env.VEILDESK_POCKET_SOURCE_ROOT||!process.env.VEILDESK_SOLANA_DEPENDENCY_ROOT,
},async t=>{
 const require=createRequire(pathToFileURL(join(resolve(process.env.VEILDESK_SOLANA_DEPENDENCY_ROOT),'package.json')));
 const ts=require('typescript'),web3=require('@solana/web3.js'),spl=require('@solana/spl-token');
 const {Keypair,PublicKey,Transaction}=web3;
 const source=await readFile(join(process.env.VEILDESK_POCKET_SOURCE_ROOT,'api/relay-solana.ts'),'utf8');
 t.diagnostic(`Pocket source SHA256: ${hash(source)}`);
 const ast=ts.createSourceFile('relay-solana.ts',source,ts.ScriptTarget.Latest,true);
 const names=['parseSolanaAddress','parseUsdcAmount','formatUsdc','ensureATA','buildSolanaTx','buildSolanaTransaction'];
 let selected=names.map(name=>{
  const matches=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  assert.equal(matches.length,1,`source must contain exactly one ${name}`);
  return matches[0].getText(ast).replace(/^export /,'');
 }).join('\n');
 // The single deliberate staging seam: defer sponsorship until customer approval.
 assert.equal((selected.match(/tx\.partialSign\(relayer\)/g)||[]).length,1);
 selected=selected.replace('tx.partialSign(relayer)','stagingUnsigned(tx)');
 assert.doesNotMatch(selected,/\.partialSign\(|\.sign\(|sendRawTransaction|process\.|require\(/);
 const sponsor=Keypair.generate().publicKey,customer=Keypair.generate(),merchant=Keypair.generate().publicKey,treasury=Keypair.generate().publicKey;
 const mint=new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
 const blockhash=Keypair.generate().publicKey.toBase58();
 let rpcCalls=0,prepared=0,signCalls=0,lostResponse=false;
 const fail=()=>{throw Error('Unexpected fixture dependency');};
 const context=vm.createContext({Buffer,PublicKey,Transaction,USDC_MINT:mint,USDC_DECIMALS:6,PLATFORM_FEE_BPS:25,
  loadRelayer:()=>({publicKey:sponsor}),getRpc:()=> 'offline://fixture',
  Connection:class {constructor(){rpcCalls++;} async getLatestBlockhash(){return {blockhash,lastValidBlockHeight:123};} async getFeeForMessage(){return {value:5000};}},
  baseStablecoin:asset=>{assert.equal(asset,'USDC');return asset;},
  getAssociatedTokenAddress:spl.getAssociatedTokenAddress,createTransferCheckedInstruction:spl.createTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction:fail,readTokenAccountAmount:async()=>100000000n,
  getSolanaTreasury:()=>treasury,readNativeUsdcRate:async()=>100000000n,fetch:fail,
  solanaReimbursementUnits:()=>522n,checkSolanaRelayerBalance:async()=>{},
  verifyPaymentFeeQuote:()=>({exemption:'none',networkFeeUnits:'522'}),createPaymentFeeQuote:fail,
  stagingUnsigned:tx=>{assert.ok(tx.signatures.every(s=>s.signature===null));prepared++;},
 });
 const js=ts.transpileModule(selected,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 vm.runInContext(js+'\nthis.prepare=buildSolanaTx;',context,{timeout:1000});
 async function prepare(from=customer.publicKey,mode='send'){
  const result={status:200};const res={status(code){result.status=code;return this;},json(body){result.body=body;return this;}};
  await context.prepare({body:{from:from.toBase58(),to:merchant.toBase58(),amount:'20.7',mode,asset:'USDC',feeQuoteToken:'fixture-only'}},res);
  return result;
 }
 assert.equal((await prepare(sponsor)).status,403);assert.equal(rpcCalls,0);assert.equal(prepared,0);
 assert.equal((await prepare(customer.publicKey,'withdraw')).status,403);assert.equal(rpcCalls,0);
 const result=await prepare();assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(prepared,1);assert.equal(signCalls,0);
 const tx=Transaction.from(Buffer.from(result.body.tx,'base64'));
 assert.ok(tx.signatures.every(s=>s.signature===null));assert.equal(tx.instructions.length,2);
 const sourceAccount=await spl.getAssociatedTokenAddress(mint,customer.publicKey),destination=await spl.getAssociatedTokenAddress(mint,merchant),feeAccount=await spl.getAssociatedTokenAddress(mint,treasury);
 const agent=await signingIdentity(),dir=await mkdtemp(join(tmpdir(),'veildesk-pocket-stage-'));let gate;
 const options={database:join(dir,'ledger.db'),network:'solana:devnet',sponsor:sponsor.toBase58(),agents:{buyer:{
  customer:customer.publicKey.toBase58(),sourceAccount:sourceAccount.toBase58(),mint:mint.toBase58(),decimals:6,
  maxTotalUnits:'21000000',maxFeeLamports:'5000',recipients:[destination.toBase58(),feeAccount.toBase58()],signingKey:agent.publicKey,
 }},inspectTransaction:createSolanaSponsorshipInspector(web3),
 quoteFee:async message=>({network:'solana:devnet',messageHash:hash(message),lamports:'5000',checkedAt:Date.now(),blockhashValid:true}),
 signMessage:async message=>{signCalls++;assert.deepEqual(message,tx.serializeMessage());if(lostResponse)throw Error('Mock signer response lost');return Buffer.alloc(64,7);}};
 const authorization={schema:'veildesk.sponsor-transfer.v1',id:randomUUID(),agent:'buyer',network:options.network,sponsor:options.sponsor,
  customer:customer.publicKey.toBase58(),sourceAccount:sourceAccount.toBase58(),mint:mint.toBase58(),decimals:6,
  transfers:[{recipientAccount:destination.toBase58(),amountUnits:'20700000'},{recipientAccount:feeAccount.toBase58(),amountUnits:'522'}],
  messageHash:hash(tx.serializeMessage()),maxFeeLamports:'5000',expiresAt:Date.now()+60000};
 const wire=x=>x.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
 try{
  gate=createSigningGate(options);const signed=await signAuthorization(authorization,agent);
  await assert.rejects(gate.authorizeAndSign({signed,transaction:wire(tx)}),/customer signature/);
  tx.partialSign(customer);
  const altered=Transaction.from(Buffer.from(wire(tx),'base64'));altered.instructions[0].keys[2].pubkey=Keypair.generate().publicKey;altered.partialSign(customer);
  await assert.rejects(gate.authorizeAndSign({signed,transaction:wire(altered)}),/match/);
  const extra=Transaction.from(Buffer.from(wire(tx),'base64'));extra.add(spl.createTransferCheckedInstruction(sourceAccount,mint,destination,customer.publicKey,1n,6));extra.partialSign(customer);
  await assert.rejects(gate.authorizeAndSign({signed,transaction:wire(extra)}),/Unsupported/);assert.equal(signCalls,0);
  const input={signed,transaction:wire(tx)},approved=await gate.authorizeAndSign(input);assert.equal(signCalls,1);assert.equal(approved.broadcast,false);
  gate.close();gate=createSigningGate(options);assert.equal((await gate.authorizeAndSign(input)).signature,approved.signature);assert.equal(signCalls,1);
  lostResponse=true;const uncertain={signed:await signAuthorization({...authorization,id:randomUUID()},agent),transaction:wire(tx)};
  await assert.rejects(gate.authorizeAndSign(uncertain),/response lost/);assert.equal(signCalls,2);
  gate.close();gate=createSigningGate(options);await assert.rejects(gate.authorizeAndSign(uncertain),/reconciliation/);assert.equal(signCalls,2);
  t.diagnostic('PASS: sponsor sender and public withdrawal blocked; customer signature required; recipient mutation and extra transfer rejected; retry cached; lost response reserved across restart. No RPC or broadcast.');
 }finally{gate?.close();await rm(dir,{recursive:true,force:true});}
});
