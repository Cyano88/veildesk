// Synthetic native-schema evidence for host integration tests, never runtime RPC translation.
export function nativePaymentFixture({address,txid,now,network='test'}){
 const hash=height=>height.toString(16).padStart(64,'0');let paidInvoice,branch=network==='main'?'37a5165b':'77190ad9';let captures=0;
 return {setInvoice:i=>paidInvoice=i,setBranch:value=>branch=value,captures:()=>captures,
  async capture(query){captures++;const time=now();return {capturedAt:time,
   scan:{network,syncReady:true,height:100,consensusBranchId:branch,checkedAt:new Date(time).toISOString()},
   evidence:{schema:'veildesk.light-wallet-evidence.v1',network,walletDigest:hash(1),recipient:{tracked:true,accountId:0,address},tip:{height:100,hash:hash(100)},
    transaction:query.txid!==txid?null:{txid,version:6,versionGroupId:'d884b698',pool:'ironwood',shieldedOnly:true,actionCount:1,mined:true,height:98,blockhash:hash(98),
     chain:[98,99,100].map(height=>({height,hash:hash(height),previousHash:hash(height-1)})),
     notes:paidInvoice?[{accountId:0,address,scope:'external',outputIndex:0,amountZat:paidInvoice.amountZat,memo:paidInvoice.memo}]:[]}}};}
 };
}
