import test from 'node:test';
import assert from 'node:assert/strict';
import {walletWorkCycle} from '../src/wallet-work-cycle.mjs';
test('queued receipt scan supersedes due maintenance without overlapping wallet work',async()=>{
 const events=[];let due=true;
 await walletWorkCycle({tick:async()=>{events.push('receipt-start');await Promise.resolve();due=false;events.push('receipt-end')},scanDue:()=>due,scan:async()=>events.push('maintenance')});
 assert.deepEqual(events,['receipt-start','receipt-end']);
});
test('idle and startup cycles retain maintenance, but shutdown never starts more work',async()=>{
 const events=[];
 await walletWorkCycle({scanDue:()=>true,scan:async()=>events.push('startup')});
 await walletWorkCycle({tick:async()=>events.push('poll'),scanDue:()=>true,scan:async()=>events.push('maintenance')});
 let stopped=false;
 await walletWorkCycle({tick:async()=>{stopped=true},scanDue:()=>true,scan:()=>assert.fail(),shouldStop:()=>stopped});
 assert.deepEqual(events,['startup','poll','maintenance']);
});
test('failed receipt processing does not fall through into another wallet operation',async()=>{
 await assert.rejects(walletWorkCycle({tick:async()=>{throw Error('unavailable')},scanDue:()=>true,scan:()=>assert.fail()}),/unavailable/);
});
