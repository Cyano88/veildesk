import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {identity} from '../src/envelope.mjs';
import {signingIdentity} from '../src/authenticated.mjs';
import {preparePrivateJob, openPrivateResult, relayClient} from '../src/client.mjs';
import {createRelay} from '../src/relay.mjs';
import {createResearchRehearsalProvider, getResearchRehearsalResult, validateResearchRequest, RESEARCH_REHEARSAL, RESEARCH_DISCLOSURE} from '../src/service-rehearsal.mjs';

const request = () => ({schema: 'veildesk.service-request.v1', service: 'polydesk.market-research.v1',
  input: {marketId: 'private-fixture-market', outcome: 'YES', side: 'BUY'},
  disclosure: RESEARCH_DISCLOSURE, executionAuthorized: false});
const report = () => ({schema: 'polydesk-a2a-market-research-v1', researchStatus: 'AVAILABLE', opinion: 'fixture-only-private-result 🛡️'.repeat(300),
  orderAuthorized: false, orderSubmitted: false});

test('service request rejects execution, hidden fields and missing disclosure', () => {
  for (const value of [{...request(), executionAuthorized: true}, {...request(), disclosure: ''},
    {...request(), paymentVerified: true}, {...request(), input: {...request().input, action: 'PREPARE'}},
    {...request(), input: {...request().input, callbackUrl: 'https://example.com'}}])
    assert.throws(() => validateResearchRequest(value));
  assert.throws(() => createResearchRehearsalProvider({research: async () => report()}), /disabled/);
});

test('independent buyer requests PolyDesk: HTTP, pinned identities, encrypted report, replay and tenant isolation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'veildesk-service-'));
  let relay;
  try {
    const buyer = await identity(), buyerSigner = await signingIdentity();
    const provider = await identity(), providerSigner = await signingIdentity(), attacker = await signingIdentity();
    const descriptor = {id: 'polydesk', encryptionKey: provider.publicKey, signingKey: providerSigner.publicKey, capabilities: [RESEARCH_REHEARSAL]};
    const config = {database: join(directory, 'relay.db'), providers: [descriptor], principals:
      [['test-agent', 'client', 'b'], ['other-agent', 'client', 'o'], ['polydesk', 'provider', 'p']].map(([id, role, token]) =>
        ({id, role, tokenHash: createHash('sha256').update(token.repeat(40)).digest('hex')}))};
    relay = createRelay(config); relay.server.listen(0, '127.0.0.1'); await once(relay.server, 'listening');
    let url = `http://127.0.0.1:${relay.server.address().port}`;
    const rpc = token => relayClient({url, token: token.repeat(40), allowLoopback: true});
    let calls = 0;
    let research = async input => { calls++; assert.deepEqual(input, request().input); return report(); };
    if (process.env.VEILDESK_POLYDESK_ADAPTER) {
      const {createVeilDeskResearchService} = await import(pathToFileURL(process.env.VEILDESK_POLYDESK_ADAPTER).href);
      const fixture = research;
      research = createVeilDeskResearchService({runResearch: async input => ({ok: true, data: await fixture(input)})});
    }
    const options = {enabled: true, recipient: provider, signer: providerSigner,
      peers: {'test-agent': {signingKey: buyerSigner.publicKey, encryptionKey: buyer.publicKey}},
      stateDirectory: join(directory, 'provider'), research};
    const job = await preparePrivateJob({id: randomUUID(), provider: descriptor, capability: RESEARCH_REHEARSAL,
      expiresAt: Date.now() + 60000, payload: request(), signer: buyerSigner});
    await rpc('b')('/v1/jobs', {method: 'POST', body: job});
    const {job: claimed} = await rpc('p')('/v1/provider/claim', {method: 'POST', body: {}});
    assert.equal(claimed.client, 'test-agent'); assert.equal(claimed.provider, 'polydesk');
    const processJob = createResearchRehearsalProvider(options);
    await assert.rejects(processJob({...claimed, client: 'other-agent'}, rpc('p')), /not enrolled/);
    const forged = await preparePrivateJob({id: job.id, provider: descriptor, capability: RESEARCH_REHEARSAL,
      expiresAt: job.expiresAt, payload: request(), signer: attacker});
    await assert.rejects(processJob({...claimed, envelope: forged.envelope}, rpc('p')), /authentication/);
    assert.equal(calls, 0);
    await assert.rejects(processJob(claimed, async (path, options) => {
      const result = await rpc('p')(path, options);
      if (path === '/v1/provider/artifact' && options.body.index === 1) throw Error('lost upload response');
      return result;
    }), /lost upload response/);
    assert.equal(calls, 1);
    await assert.rejects(rpc('b')(`/v1/jobs/${job.id}/artifacts/0`), error => error.status === 404);
    await createResearchRehearsalProvider(options)(claimed, rpc('p'));
    const delivered = await rpc('b')('/v1/jobs/' + job.id);
    const opened = await openPrivateResult(delivered, {recipient: buyer, expectedSigner: providerSigner.publicKey});
    assert.equal(opened.payload.mode, 'rehearsal'); assert.equal(opened.payload.paymentVerified, false);
    const identityOptions = {recipient: buyer, expectedSigner: providerSigner.publicKey};
    assert.deepEqual((await getResearchRehearsalResult(rpc('b'), job, identityOptions)).report, report());
    await assert.rejects(rpc('o')(`/v1/jobs/${job.id}/artifacts/0`), error => error.status === 404);
    const chunk = await rpc('b')(`/v1/jobs/${job.id}/artifacts/0`);
    await assert.rejects(rpc('p')('/v1/provider/artifact', {method: 'POST', body: {
      client: 'test-agent', id: job.id, index: 0, envelope: delivered.envelope}}), error => error.status === 409);
    await assert.rejects(rpc('p')('/v1/provider/deliver', {method: 'POST', body: {
      client: 'test-agent', id: job.id, envelope: delivered.envelope, artifactCount: 1}}), error => error.status === 409);
    await assert.rejects(rpc('o')('/v1/jobs/' + job.id), error => error.status === 404);
    await assert.rejects(openPrivateResult(delivered, {recipient: await identity(), expectedSigner: providerSigner.publicKey}));
    await createResearchRehearsalProvider(options)(claimed, rpc('p')); // simulated provider restart
    assert.equal(calls, 1);
    assert.deepEqual((await rpc('b')('/v1/jobs/' + job.id)).envelope, delivered.envelope);
    await relay.close(); relay = null;
    const database = await readFile(config.database);
    assert.equal(database.includes(Buffer.from(request().input.marketId)), false);
    assert.equal(database.includes(Buffer.from(report().opinion)), false);
    relay = createRelay({...config, maxArtifactChunks: 1}); relay.server.listen(0, '127.0.0.1'); await once(relay.server, 'listening');
    url = `http://127.0.0.1:${relay.server.address().port}`;
    assert.deepEqual((await getResearchRehearsalResult(rpc('b'), job, identityOptions)).report, report());
    assert.deepEqual(await rpc('b')(`/v1/jobs/${job.id}/artifacts/0`), chunk);
    // Quota exhaustion preserves existing ciphertext and permits identical retries.
    await rpc('p')('/v1/provider/artifact', {method: 'POST', body: {client: 'test-agent', id: job.id, index: 0, envelope: chunk.envelope}});
    const next = await preparePrivateJob({id: randomUUID(), provider: descriptor, capability: RESEARCH_REHEARSAL,
      expiresAt: Date.now() + 60000, payload: request(), signer: buyerSigner});
    await rpc('b')('/v1/jobs', {method: 'POST', body: next});
    await rpc('p')('/v1/provider/claim', {method: 'POST', body: {}});
    const quotaBody = {client: 'test-agent', id: next.id, index: 0, envelope: {...chunk.envelope, id: next.id}};
    await assert.rejects(rpc('p')('/v1/provider/artifact', {method: 'POST', body: quotaBody}), error => error.status === 503);
    await assert.rejects(rpc('b')('/v1/provider/artifact', {method: 'POST', body: quotaBody}), error => error.status === 403);
    await assert.rejects(rpc('p')('/v1/provider/artifact', {method: 'POST', body: {...quotaBody, index: 64}}), error => error.status === 400);
  } finally { if (relay) await relay.close(); await rm(directory, {recursive: true, force: true}); }
});

test('oversized, unsafe and failed research never delivers; uncertain work is not rerun', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'veildesk-service-failure-'));
  try {
    const buyer = await identity(), signer = await signingIdentity(), provider = await identity();
    for (const outcome of ['large', 'unsafe', 'error']) {
      let calls = 0, deliveries = 0;
      const job = {...await preparePrivateJob({id: randomUUID(), provider: {id: 'polydesk', encryptionKey: provider.publicKey},
        capability: RESEARCH_REHEARSAL, expiresAt: Date.now() + 60000, payload: request(), signer}), client: 'test-agent'};
      const process = createResearchRehearsalProvider({enabled: true, recipient: provider, signer: await signingIdentity(),
        peers: {'test-agent': {signingKey: signer.publicKey, encryptionKey: buyer.publicKey}}, stateDirectory: directory,
        research: async () => {calls++; if (outcome === 'error') throw Error('upstream failure');
          return {...report(), ...(outcome === 'large' ? {opinion: 'x'.repeat(65536)} : {orderAuthorized: true})};}});
      const deliver = async () => {deliveries++;};
      await assert.rejects(process(job, deliver));
      await assert.rejects(process(job, deliver), /reconciliation/);
      assert.equal(calls, 1); assert.equal(deliveries, 0);
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});

// A changed downstream disclosure requires a fresh signed buyer request.
test('old private-compute disclosure is not silently accepted under provider disclosure', () => {
  assert.throws(()=>validateResearchRequest({...request(),disclosure:'polydesk-0g-private-router-v1'}), /disclosure/);
});
