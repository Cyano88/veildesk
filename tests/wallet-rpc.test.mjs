import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';
import {walletRpc,inspectWallet} from '../src/wallet-rpc.mjs';
test('readiness rejects remote destinations and all fund-moving RPC methods',async()=>{
 for(const url of ['https://example.com','http://example.com','http://localhost:8232','http://user:secret@127.0.0.1:8232'])assert.throws(()=>walletRpc({url}));
 const rpc=walletRpc({url:'http://127.0.0.1:1'});
 for(const method of ['z_sendmany','z_exportkey','walletpassphrase','stop'])await assert.rejects(rpc(method),/not allowed/);
});
test('live HTTP schema discovery does not falsely declare payment readiness',async()=>{
 const server=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;const message=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{methods:[{name:'z_sendmany'},{name:'getwalletstatus'}]}}))}).listen(0,'127.0.0.1');await once(server,'listening');
 try{const report=await inspectWallet(walletRpc({url:`http://127.0.0.1:${server.address().port}`}));assert.equal(report.paymentAdapterReady,false);assert.equal(report.legacyReceiptMethod,false);assert.equal(report.methods.find(m=>m.name==='z_sendmany').available,true)}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});
