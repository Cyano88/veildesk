import test from 'node:test';import assert from 'node:assert/strict';import {providerScheduler} from '../src/provider-scheduler.mjs';
test('scheduler advances past unresolved pages, bounds claims and preserves stop/rate-limit behavior',async()=>{
 const calls=[],processed=[];let stop=false,claims=0;
 const tick=providerScheduler({claimBatch:2,pendingLimit:2,shouldStop:()=>stop,onJobError:()=>{},rpc:async path=>{calls.push(path);if(path.includes('pending'))return path.includes('after=')?{jobs:[{id:'later'}],nextCursor:null}:{jobs:[{id:'blocked'}],nextCursor:'cursor'};return {job:{id:'new'+(++claims)}}},processJob:async job=>{processed.push(job.id);if(job.id==='blocked')throw Error('Pending reconciliation')}});
 await tick();await tick();assert.deepEqual(processed,['blocked','new1','new2','later','new3','new4']);assert.ok(calls.includes('/v1/provider/pending?limit=2&after=cursor'));
 const rate=providerScheduler({rpc:async()=>({jobs:[{id:'limited'}],nextCursor:'x'}),processJob:async()=>{throw Object.assign(Error('rate'),{status:429})}});await assert.rejects(rate(),e=>e.status===429);
 stop=true;await tick();assert.equal(claims,4);
 assert.throws(()=>providerScheduler({claimBatch:21}),/batch limits/);
});
