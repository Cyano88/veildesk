// Accept only the authenticated paid client's get() result. This view is for
// progress, never proof of marketplace acceptance or permission to spend.
export function researchProgress(row){
 if(!row||row.executionAuthorized!==false)throw Error('Invalid research progress');
 if(row.state==='completed'){
  const p=row.result?.payload;
  if(p?.status!=='fulfilled'||p.paymentVerified!==true||p.executionAuthorized!==false||p.tradeSubmitted!==false
   ||p.report?.schema!=='polydesk-a2a-market-research-v1'||p.report.orderAuthorized!==false||p.report.orderSubmitted!==false)
   throw Error('Verified research delivery required');
  return {stage:'fulfilled',terminal:true,executionAuthorized:false};
 }
 const stage=row.paymentReview?'payment_review':row.late||row.state==='expired'?'expired_review':
  row.paymentHintSubmitted?'verifying_payment':row.payment?'awaiting_payment':'awaiting_invoice';
 return {stage,terminal:stage==='payment_review'||stage==='expired_review',executionAuthorized:false};
}

// Polling reads an existing purchase only. It never submits, pays or sends an
// OKX message. A timeout or read failure is uncertain, not a failed payment.
export async function watchResearch({client,id,onProgress=()=>{},pollMs=2000,timeoutMs=60000}){
 if(typeof client?.get!=='function'||typeof id!=='string'||!id||!Number.isSafeInteger(pollMs)||pollMs<100
  ||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000)throw Error('Invalid progress configuration');
 const started=performance.now();let previous,timer;
 const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs)});
 try{
  while(true){
   let row;try{row=await Promise.race([client.get(id),deadline])}catch{throw Error('Research status unavailable; reconcile the existing request before any retry')}
   if(row===null)return {stage:'pending',terminal:false,executionAuthorized:false};
   const progress=researchProgress(row);
   if(progress.stage!==previous){await onProgress({...progress,elapsedMs:Math.round(performance.now()-started)});previous=progress.stage}
   if(progress.terminal)return progress;
   if(await Promise.race([new Promise(resolve=>setTimeout(()=>resolve(true),pollMs)),deadline])===null)
    return {stage:'pending',terminal:false,executionAuthorized:false};
  }
 }finally{clearTimeout(timer)}
}
