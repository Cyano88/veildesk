import {validateMandate} from './mandate.mjs';
const VERSION='2025-06-18';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const uuid='^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$';
const mandateSchema={type:'object',additionalProperties:false,required:['schema','id','mode','market','side','maxSpendUsd','limitPrice','expiresAt','approval'],properties:{schema:{const:'veildesk.mandate.v1'},id:{type:'string',pattern:uuid},mode:{const:'dry_run'},market:{type:'string',pattern:'^[a-z0-9-]{1,160}$'},side:{enum:['YES','NO']},maxSpendUsd:{type:'string',pattern:'^\\d{1,6}\\.\\d{2}$'},limitPrice:{type:'string',pattern:'^0\\.\\d{1,4}$'},expiresAt:{type:'integer',description:'Future Unix milliseconds within one hour; preserve unchanged on retries.'},approval:{const:'preview_only'}}};
export const mcpTools=[
 {name:'veildesk_capabilities',description:'Describe private preview validation and enrollment requirements. Does not contact the relay.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:'veildesk_submit_preview',description:'Send an authenticated encrypted preview mandate to the configured cloud provider. The provider sees the mandate. Obtain authorization to disclose it before calling. Reuse the exact UUID and fields on retry. No funds or trades are sent.',inputSchema:{type:'object',properties:{mandate:mandateSchema},required:['mandate'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
 {name:'veildesk_get_preview',description:'Retrieve and verify a previously submitted preview using the same enrolled identity and persistent outbox. Decrypted results are returned to this agent and may enter its conversation history.',inputSchema:{type:'object',properties:{id:{type:'string',pattern:uuid}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}},
];
export function createMcpSession({getClient,configured=false}){
 let initialized=false,ready=false;
 const content=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
 return async message=>{
  const id=message?.id,hasId=Object.hasOwn(message??{},'id');
  const fail=(code,text,data)=>({jsonrpc:'2.0',id:typeof id==='string'||Number.isSafeInteger(id)?id:null,error:{code,message:text,...(data?{data}:{})}});
  if(!object(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string'||(hasId&&!(typeof id==='string'||Number.isSafeInteger(id))))return fail(-32600,'Invalid request');
  if(!hasId){if(message.method==='notifications/initialized'&&initialized)ready=true;return undefined}
  const reply=result=>({jsonrpc:'2.0',id,result});
  if(message.method==='server/discover')return fail(-32022,'Use the supported initialize protocol',{supported:[VERSION]});
  if(message.method==='initialize'){
   const p=message.params;
   if(initialized||!object(p)||typeof p.protocolVersion!=='string'||!object(p.capabilities)||!object(p.clientInfo)||typeof p.clientInfo.name!=='string'||typeof p.clientInfo.version!=='string')return fail(-32602,'Invalid initialization');
   initialized=true;
   return reply({protocolVersion:VERSION,capabilities:{tools:{}},serverInfo:{name:'veildesk',version:'0.2.0'},instructions:'Private preview validation only. Never interpret validation as market verification, payment or trading authorization. Tool results may contain private mandate data; restrict host logs and conversation sharing.'});
  }
  if(message.method==='ping')return reply({});
  if(!ready)return fail(-32002,'Initialize and send notifications/initialized first');
  if(message.method==='tools/list'){
   if(message.params?.cursor)return fail(-32602,'Pagination is not supported');
   return reply({tools:mcpTools});
  }
  if(message.method!=='tools/call')return fail(-32601,'Method not found');
  const p=message.params,args=p?.arguments??{};
  if(!object(p)||!mcpTools.some(tool=>tool.name===p.name)||!object(args))return fail(-32602,'Unknown tool or invalid arguments');
  if(p.name==='veildesk_capabilities'){
   if(!exact(args,[]))return fail(-32602,'Unexpected arguments');
   return reply(content({schema:'veildesk.mcp-capabilities.v1',configured,authentication:'enrolled_endpoint_keys',privyRequired:false,transport:'stdio-to-https-relay',capability:'prediction.mandate.validate.v1',paymentSettlement:false,tradeExecution:false,providerSeesMandate:true,hostSeesResult:true}));
  }
  if(p.name==='veildesk_submit_preview'){
   try{if(!exact(args,['mandate']))throw Error();validateMandate(args.mandate)}catch{return fail(-32602,'Invalid or expired preview mandate')}
  }else if(!exact(args,['id'])||typeof args.id!=='string'||!new RegExp(uuid).test(args.id))return fail(-32602,'Invalid job ID');
  try{
   const client=await getClient();
   if(p.name==='veildesk_submit_preview'){
    const job=await client.submit(args.mandate);
    return reply(content({id:job.id,state:job.state,executionAuthorized:false}));
   }
   return reply(content(await client.get(args.id)));
  }catch(error){
   const code=error.code==='ENOENT'?'unknown_local_request':error.status===401?'enrollment_rejected':error.status===429?'rate_limited':error.message==='Mandate ID reused with different contents'?'mandate_conflict':'preview_unavailable';
   return reply({...content({code,executionAuthorized:false,message:'Keep the original request and persistent outbox. Check configuration, retry the identical request, or reconcile uncertain work. No private error details are exposed.'}),isError:true});
  }
 };
}

// Bounded newline framing; serial handling bounds in-flight transport work.
export async function serveMcp(input,output,session,{maxBytes=16384}={}){
 let buffered=Buffer.alloc(0),dropping=false;
 const send=async value=>{if(value!==undefined&&!output.write(JSON.stringify(value)+'\n'))await new Promise(resolve=>output.once('drain',resolve))};
 const oversized=()=>send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Message exceeds size limit'}});
 for await(const chunk of input){
  const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
  let start=0;
  while(start<bytes.length){
   const newline=bytes.indexOf(10,start),end=newline<0?bytes.length:newline,part=bytes.subarray(start,end);
   if(!dropping){
    if(buffered.length+part.length>maxBytes){buffered=Buffer.alloc(0);dropping=true;await oversized()}
    else buffered=Buffer.concat([buffered,part]);
   }
   if(newline<0)break;
   if(!dropping&&buffered.length){
    let message;
    try{message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffered))}catch{await send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}})}
    if(message!==undefined)await send(await session(message));
   }
   buffered=Buffer.alloc(0);dropping=false;start=newline+1;
  }
 }
 if(buffered.length)await send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Incomplete JSON message'}});
}
