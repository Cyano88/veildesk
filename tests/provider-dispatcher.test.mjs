import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderDispatcher} from '../src/provider-dispatcher.mjs';
import {PAID_RESEARCH} from '../src/service-rehearsal.mjs';

test('provider routing cannot silently downgrade research into a validation response',async()=>{
  let transportCalls=0;
  const dispatcher=await createProviderDispatcher({config:{},keys:{},rpc:async()=>{transportCalls++;}});
  try{
    await assert.rejects(dispatcher.process({capability:PAID_RESEARCH}),/research disabled/);
    await assert.rejects(dispatcher.process({capability:'prediction.mandate.validate.testnet-paid.v1'}),/validation disabled/);
    await assert.rejects(dispatcher.process({capability:'unknown-service'}),/Unsupported/);
    assert.equal(transportCalls,0);
  }finally{dispatcher.close();}
});
test('research worker requires explicit payment configuration and injected implementation',async()=>{
  for(const options of [
    {config:{researchService:{enabled:true}}},
    {config:{researchService:{enabled:true},testnetPayment:{enabled:true}}},
    {config:{researchService:{enabled:true}},research:async()=>({})},
  ])await assert.rejects(createProviderDispatcher({...options,keys:{},rpc:async()=>{}}),/explicit implementation/);
});
