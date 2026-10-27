// Bounded, sequential processing keeps existing durable reservation semantics.
export function providerScheduler({rpc,processJob,shouldStop=()=>false,onJobError=()=>{},claimBatch=5,pendingLimit=20}){
 for(const n of [claimBatch,pendingLimit])if(!Number.isSafeInteger(n)||n<1||n>20)throw Error('Worker batch limits must be integers from 1 to 20');
 let cursor=null;
 async function process(job){try{await processJob(job)}catch(error){if(error.status===429)throw error;onJobError(error)}}
 return async()=>{
  const page=await rpc('/v1/provider/pending?limit='+pendingLimit+(cursor?'&after='+encodeURIComponent(cursor):''));
  if(!Array.isArray(page.jobs))throw Error('Invalid pending page');
  for(const job of page.jobs){if(shouldStop())return;await process(job)}
  cursor=page.nextCursor??null;
  for(let n=0;n<claimBatch&&!shouldStop();n++){
   const {job}=await rpc('/v1/provider/claim',{method:'POST',body:{}});if(!job)break;await process(job);
  }
 };
}
