// An explicitly unpaid, opt-in transport rehearsal. Never a paid-service gate.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {openPrivateJob, openPrivateResult, sealPrivateResult} from './client.mjs';
import {sealArtifact, openArtifact} from './artifact.mjs';
import {oncePerMandate} from './mandate.mjs';

export const RESEARCH_REHEARSAL = 'polydesk.research.rehearsal.v1';
export const PAID_RESEARCH = 'polydesk.research.testnet-paid.v1';
export const RESEARCH_DISCLOSURE = 'polydesk-provider-disclosure-v2';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function validateResearchRequest(request) {
  if (!exact(request, ['schema', 'service', 'input', 'disclosure', 'executionAuthorized'])
    || request.schema !== 'veildesk.service-request.v1'
    || request.service !== 'polydesk.market-research.v1'
    || request.disclosure !== RESEARCH_DISCLOSURE || request.executionAuthorized !== false)
    throw Error('Invalid service request or missing disclosure acceptance');
  const input = request.input;
  if (!exact(input, ['marketId', 'outcome', 'side'])
    || typeof input.marketId !== 'string' || !input.marketId.trim() || input.marketId.length > 320
    || typeof input.outcome !== 'string' || !input.outcome.trim() || input.outcome.length > 100
    || !['BUY', 'SELL'].includes(input.side)) throw Error('Invalid research input');
  return request;
}

export function validateResearchPurchase(value, now = Date.now()) {
  if (!exact(value, ['id', 'expiresAt', 'request']) || typeof value.id !== 'string'
    || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.id)
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + 3600000)
    throw Error('Invalid or expired research purchase');
  validateResearchRequest(value.request);
  return value;
}

export function createResearchRehearsalProvider({enabled = false, recipient, signer, peers, stateDirectory, research}) {
  if (enabled !== true || typeof research !== 'function') throw Error('Research rehearsal is disabled');
  return async function process(job, rpc) {
    if (job.capability !== RESEARCH_REHEARSAL) throw Error('Unsupported rehearsal capability');
    const peer = peers[job.client];
    if (!peer) throw Error('Buyer is not enrolled');
    const request = validateResearchRequest(await openPrivateJob(job, {recipient, expectedSigner: peer.signingKey}));
    const binding = {id: job.id, client: job.client, provider: job.provider, capability: job.capability,
      expiresAt: job.expiresAt, envelope: job.envelope, buyerSigningKey: peer.signingKey,
      buyerEncryptionKey: peer.encryptionKey, providerSigningKey: signer.publicKey, providerEncryptionKey: recipient.publicKey};
    const directory = join(stateDirectory, createHash('sha256').update(job.client).digest('hex'));
    // Reserve before invoking even a fixture: uncertain work requires reconciliation.
    const bundle = await oncePerMandate(directory, binding, async () => {
      const report = await research(structuredClone(request.input));
      if (!report || report.schema !== 'polydesk-a2a-market-research-v1'
        || report.orderAuthorized !== false || report.orderSubmitted !== false)
        throw Error('Invalid research result or execution authority');
      const {manifest, chunks} = await sealArtifact(job, report, {signer, recipientPublicKey: peer.encryptionKey});
      const envelope = await sealPrivateResult(job, {schema: 'veildesk.service-result.v1', service: request.service,
        mode: 'rehearsal', paymentVerified: false, executionAuthorized: false, artifact: manifest},
      {signer, recipientPublicKey: peer.encryptionKey});
      return {envelope, chunks};
    });
    // Old rehearsal reservations contain a single inline envelope; preserve their retries.
    const chunks = bundle.chunks ?? [];
    for (let index = 0; index < chunks.length; index++)
      await rpc('/v1/provider/artifact', {method: 'POST', body: {client: job.client, id: job.id, index, envelope: chunks[index]}});
    return rpc('/v1/provider/deliver', {method: 'POST', body: {client: job.client, id: job.id,
      envelope: bundle.envelope ?? bundle, ...(chunks.length ? {artifactCount: chunks.length} : {})}});
  };
}

// Call with the submitted job context, not provider/capability fields taken on trust from a relay.
export async function getResearchRehearsalResult(rpc, job, identity) {
  if (job.capability !== RESEARCH_REHEARSAL) throw Error('Unsupported rehearsal capability');
  const delivered = await rpc('/v1/jobs/' + job.id);
  if (delivered.state !== 'completed' || delivered.id !== job.id || delivered.provider !== job.provider
    || delivered.capability !== job.capability) throw Error('Research result unavailable or rerouted');
  const result = await openPrivateResult({...job, envelope: delivered.envelope}, identity);
  const payload = result.payload;
  if (payload?.schema !== 'veildesk.service-result.v1' || payload.service !== 'polydesk.market-research.v1'
    || payload.mode !== 'rehearsal' || payload.paymentVerified !== false || payload.executionAuthorized !== false)
    throw Error('Invalid research result');
  const report = payload.artifact ? await openArtifact(job, payload.artifact,
    async index => (await rpc(`/v1/jobs/${job.id}/artifacts/${index}`)).envelope, identity) : payload.report;
  if (report?.schema !== 'polydesk-a2a-market-research-v1' || report.orderAuthorized !== false || report.orderSubmitted !== false)
    throw Error('Invalid research report');
  return {...payload, report};
}
