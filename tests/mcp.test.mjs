import test from 'node:test';import assert from 'node:assert/strict';import {Readable,Writable} from 'node:stream';import {spawn} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';import {createMcpSession,serveMcp} from '../src/mcp.mjs';
const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'acceptance',version:'1'}}};
const initialized={jsonrpc:'2.0',method:'notifications/initialized'};
const call=(name,args={},id=2)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
const mandate=()=>({schema:'veildesk.mandate.v1',id:randomUUID(),mode:'dry_run',market:'mcp-acceptance-fixture',side:'YES',maxSpendUsd:'1.00',limitPrice:'0.5',expiresAt:Date.now()+600000,approval:'preview_only'});
async function ready(options){const session=createMcpSession(options);assert.equal((await session(init)).result.protocolVersion,'2025-06-18');await session(initialized);return session}
test('MCP initialization, discovery, malformed IDs and unsupported tools',async()=>{
 const session=createMcpSession({getClient:()=>assert.fail('no client for discovery')});
 assert.equal((await session(call('veildesk_capabilities'))).error.code,-32002);
 assert.equal((await session({...init,id:null})).error.code,-32600);
 assert.equal((await session({jsonrpc:'2.0',id:9,method:'server/discover'})).error.code,-32022);
 await session(init);await session(initialized);
 const caps=(await session(call('veildesk_capabilities'))).result.structuredContent;
 assert.equal(caps.privyRequired,false);assert.equal(caps.paymentSettlement,false);
 assert.equal((await session({jsonrpc:'2.0',id:3,method:'tools/list'})).result.tools.length,3);
 assert.equal((await session(call('send_payment'))).error.code,-32602);
 assert.equal((await session(call('veildesk_get_preview',{id:randomUUID(),config:'/secret'}))).error.code,-32602);
 assert.equal(await session({jsonrpc:'2.0',method:'tools/call',params:{name:'veildesk_submit_preview',arguments:{mandate:mandate()}}}),undefined);
});
test('MCP invalid or live mandates never reach transport; errors omit sensitive details',async()=>{
 let calls=0;const session=await ready({configured:true,getClient:async()=>{calls++;throw Error('secret-token-private-path')}});
 assert.equal((await session(call('veildesk_submit_preview',{mandate:{...mandate(),mode:'live'}}))).error.code,-32602);assert.equal(calls,0);
 const result=(await session(call('veildesk_submit_preview',{mandate:mandate()}))).result;
 assert.equal(result.isError,true);assert.equal(JSON.stringify(result).includes('secret-token'),false);assert.equal(result.structuredContent.executionAuthorized,false);
});
test('MCP submit hides raw relay envelope; verified get returns only to caller',async()=>{
 const m=mandate(),session=await ready({getClient:async()=>({submit:async received=>{assert.deepEqual(received,m);return{id:m.id,state:'queued',envelope:'not-returned'}},get:async id=>({id,state:'completed',executionAuthorized:false,result:{payload:{status:'validated',mandate:m}}})})});
 const submitted=(await session(call('veildesk_submit_preview',{mandate:m}))).result;
 assert.equal(submitted.structuredContent.state,'queued');assert.equal(JSON.stringify(submitted).includes('not-returned'),false);
 assert.deepEqual((await session(call('veildesk_get_preview',{id:m.id}))).result.structuredContent.result.payload.mandate,m);
});
test('stdio framing recovers after oversize and invalid JSON and handles split UTF-8',async()=>{
 let text='';const out=new Writable({write(chunk,_enc,done){text+=chunk.toString();done()}});
 const bytes=Buffer.from(JSON.stringify({...init,params:{...init.params,clientInfo:{name:'caf\u00e9',version:'1'}}})+'\n'+JSON.stringify(initialized)+'\n'+JSON.stringify(call('veildesk_capabilities'))+'\n');
 const cut=bytes.indexOf(Buffer.from('\u00e9'))+1;
 await serveMcp(Readable.from([Buffer.from('x'.repeat(17000)),Buffer.from('\n{bad}\n'),bytes.subarray(0,cut),bytes.subarray(cut)]),out,createMcpSession({getClient:()=>assert.fail('unexpected')}));
 const replies=text.trim().split('\n').map(line=>JSON.parse(line));assert.equal(replies[0].error.code,-32600);assert.equal(replies[1].error.code,-32700);assert.equal(replies[2].result.protocolVersion,'2025-06-18');assert.equal(replies[3].result.structuredContent.privyRequired,false);
});
function subprocess(config,state){
 const child=spawn(process.execPath,['scripts/mcp-server.mjs'],{cwd:resolve('.'),env:{...process.env,VEILDESK_CLIENT_CONFIG:config||'',VEILDESK_CLIENT_STATE:state||''},stdio:['pipe','pipe','pipe']});
 let sequence=0,buffer='',stderr='';const waiting=new Map();
 child.stderr.on('data',x=>stderr+=x);
 child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const value=JSON.parse(line);const item=waiting.get(value.id);if(item){clearTimeout(item.timer);waiting.delete(value.id);item.resolve(value)}}});
 child.on('exit',()=>{for(const item of waiting.values()){clearTimeout(item.timer);item.reject(Error('MCP child exited'))}waiting.clear()});
 return {send:message=>new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject,timer:setTimeout(()=>{waiting.delete(id);reject(Error('MCP response timeout'))},25000)});child.stdin.write(JSON.stringify({...message,id})+'\n')}),notify:()=>child.stdin.write(JSON.stringify(initialized)+'\n'),close:()=>new Promise(resolve=>{child.once('exit',()=>{assert.equal(stderr.includes('privateKey'),false);resolve()});child.stdin.end()})};
}
test('unconfigured executable discovers capabilities without a login or dependencies',async()=>{
 const process=subprocess();try{await process.send(init);process.notify();const result=await process.send(call('veildesk_capabilities'));assert.equal(result.result.structuredContent.configured,false);assert.equal((await process.send(call('veildesk_submit_preview',{mandate:mandate()}))).result.isError,true)}finally{await process.close()}
});
test('live MCP submit, signature verification and restart replay against Render',{skip:!process.env.VEILDESK_MCP_LIVE_CONFIG},async()=>{
 const state=await mkdtemp(join(tmpdir(),'veildesk-mcp-')),config=process.env.VEILDESK_MCP_LIVE_CONFIG,m=mandate();let child=subprocess(config,state);
 try{
  await child.send(init);child.notify();const submission=await child.send(call('veildesk_submit_preview',{mandate:m}));assert.equal(submission.result.isError,undefined);
  let completed;
  for(let i=0;i<20;i++){const result=await child.send(call('veildesk_get_preview',{id:m.id}));assert.equal(result.result.isError,undefined);completed=result.result.structuredContent;if(completed.state==='completed')break;await new Promise(r=>setTimeout(r,2000))}
  assert.equal(completed.state,'completed');assert.equal(completed.executionAuthorized,false);assert.equal(completed.result.payload.status,'validated');assert.deepEqual(completed.result.payload.mandate,m);
  await child.close();child=subprocess(config,state);await child.send(init);child.notify();assert.equal((await child.send(call('veildesk_submit_preview',{mandate:m}))).result.isError,undefined);
  const replay=(await child.send(call('veildesk_get_preview',{id:m.id}))).result.structuredContent;assert.deepEqual(replay.result,completed.result);
 }finally{await child.close();await rm(state,{recursive:true,force:true})}
});
