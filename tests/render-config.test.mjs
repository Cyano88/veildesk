import test from 'node:test';import assert from 'node:assert/strict';import {renderConfig} from '../src/render-config.mjs';
test('Render roles preserve enrollment and keys while placing state on separate disks',()=>{
 const source={database:'C:/private/relay.db',principals:[{id:'client',tokenHash:'fixture'}],providers:[{id:'provider'}]};
 const relay=renderConfig('relay',source);assert.equal(relay.database,'/var/data/relay.db');assert.deepEqual(relay.principals,source.principals);assert.equal(source.database,'C:/private/relay.db');
 const workerSource={url:'http://127.0.0.1:5181',allowLoopback:true,identity:{fixture:'private-key'},token:'fixture-token',peers:{client:{signingKey:'pinned'}},stateDirectory:'old'};
 const worker=renderConfig('provider',workerSource,{relayUrl:'https://veildesk.example'});assert.equal(worker.stateDirectory,'/var/data/provider-state');assert.equal(worker.url,'https://veildesk.example');assert.equal(worker.allowLoopback,false);assert.deepEqual(worker.identity,workerSource.identity);assert.deepEqual(worker.peers,workerSource.peers);
 for(const url of ['http://127.0.0.1:5181','http://remote.example','https://user:pass@example.com','https://example.com/path'])assert.throws(()=>renderConfig('provider',workerSource,{relayUrl:url}));
 assert.throws(()=>renderConfig('relay',source,{dataDirectory:'/tmp'}),/persistent disk/);
});
