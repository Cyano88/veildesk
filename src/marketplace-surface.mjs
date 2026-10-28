// Read-only release probe. Public resource availability is never listing approval.
export async function checkMarketplaceSurface({fetchImpl=fetch}={}){
 const origin='https://veildesk-relay.onrender.com';
 const checks=[];
 for(const [path,expectedStatus,type,validate] of [
  ['/',200,'text/html',text=>text.includes('VeilDesk')],
  ['/agent-integration.json',200,'application/json',text=>{const v=JSON.parse(text);return v.schema==='veildesk.agent-integration.v1'&&v.access?.enrollment==='operator-managed'&&v.access?.selfService===false&&v.marketplace?.readyForUnattendedPaidListing===false&&v.privacy?.tradeExecutionAuthorized===false;}],
  ['/agent-integration.md',200,'text/markdown',text=>text.includes('Do not send plaintext briefs')],
  ['/openapi.json',200,'application/json',text=>{const v=JSON.parse(text);return v.openapi==='3.1.0'&&v.paths?.['/v1/jobs']?.post&&v.security?.some(s=>Array.isArray(s.enrollmentBearer));}],
  ['/v1/providers',401,'application/json',()=>true],
 ]){
  try{
   const response=await fetchImpl(origin+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:type}});
   const status=response.status,contentType=response.headers.get('content-type')??'';
   if(status!==expectedStatus||!contentType.includes(type)){await response.body?.cancel();checks.push({path,ok:false,status,reason:'Unexpected status or content type'});continue;}
   // Bound even a chunked public response; never print response contents.
   const reader=response.body?.getReader();let size=0,parts=[];
   if(!reader)throw Error('No response body');
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>131072)throw Error('Response too large');parts.push(value);}}finally{await reader.cancel();}
   const valid=!!validate(Buffer.concat(parts).toString('utf8'));
   checks.push({path,ok:valid,status,...(!valid?{reason:'Public contract mismatch'}:{})});
  }catch{checks.push({path,ok:false,reason:'Request failed or response was invalid'});}
 }
 return {schema:'veildesk.marketplace-surface-check.v1',checkedAt:new Date().toISOString(),origin,checks,
  publicIntegrationSurfaceReady:checks.every(c=>c.ok),marketplaceReadiness:'not-established',
  limitation:'This probe does not test buyer enrollment, settlement, marketplace invocation, listing approval or activation.'};
}
