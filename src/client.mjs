import {sealSigned,openSigned} from './authenticated.mjs';
export function relayClient({url,token,allowLoopback=false}){
 const endpoint=new URL(url);if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/'||(endpoint.protocol!=='https:'&&!(allowLoopback&&endpoint.protocol==='http:'&&['127.0.0.1','[::1]'].includes(endpoint.hostname))))throw Error('Use HTTPS or explicitly enabled loopback');
 return async(path,{method='GET',body}={})=>{
  if(!path.startsWith('/v1/'))throw Error('Invalid API path');
  const res=await fetch(new URL(path,endpoint),{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  const data=await res.json();if(!res.ok)throw Object.assign(Error(data.error||'Relay request failed'),{status:res.status});return data;
 };
}
export async function preparePrivateJob({id,provider,capability,expiresAt,payload,signer}){
 const route={provider:provider.id,capability,expiresAt};
 const envelope=await sealSigned({schema:'veildesk.job.v1',route,payload},{signer,recipientPublicKey:provider.encryptionKey,id,direction:'request'});
 return {id,...route,envelope};
}
export async function submitPrivateJob(rpc,options){
 return rpc('/v1/jobs',{method:'POST',body:await preparePrivateJob(options)});
}
export async function openPrivateJob(job,{recipient,expectedSigner}){
 const request=await openSigned(job.envelope,{recipient,expectedSigner,id:job.id,direction:'request'});
 if(request?.schema!=='veildesk.job.v1'||request.route?.provider!==job.provider||request.route?.capability!==job.capability||request.route?.expiresAt!==job.expiresAt||Date.now()>=job.expiresAt)throw Error('Invalid, rerouted or expired job');return request.payload;
}
export async function openPrivateResult(job,{recipient,expectedSigner}){
 const result=await openSigned(job.envelope,{recipient,expectedSigner,id:job.id,direction:'response'});
 if(result?.schema!=='veildesk.result.v1'||result.id!==job.id||result.provider!==job.provider||result.capability!==job.capability||result.executionAuthorized!==false)throw Error('Invalid result context');return result;
}
export async function sealPrivateResult(job,payload,{signer,recipientPublicKey}){
 return sealSigned({schema:'veildesk.result.v1',id:job.id,provider:job.provider,capability:job.capability,executionAuthorized:false,payload},{signer,recipientPublicKey,id:job.id,direction:'response'});
}
