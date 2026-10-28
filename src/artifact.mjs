import {createHash} from 'node:crypto';
import {sealSigned, openSigned} from './authenticated.mjs';
export const ARTIFACT_CHUNK_BYTES = 1024;
export const ARTIFACT_MAX_CHUNKS = 64;
const hash = value => createHash('sha256').update(value).digest('hex');

export async function sealArtifact(job, value, {signer, recipientPublicKey}) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > ARTIFACT_CHUNK_BYTES * ARTIFACT_MAX_CHUNKS) throw Error('Report exceeds artifact limit');
  const manifest = {schema: 'veildesk.artifact.v1', digest: hash(bytes), bytes: bytes.length,
    count: Math.ceil(bytes.length / ARTIFACT_CHUNK_BYTES)};
  const chunks = [];
  for (let index = 0; index < manifest.count; index++) {
    chunks.push(await sealSigned({schema: 'veildesk.artifact-chunk.v1', provider: job.provider,
      capability: job.capability, digest: manifest.digest, count: manifest.count, index,
      data: bytes.subarray(index * ARTIFACT_CHUNK_BYTES, (index + 1) * ARTIFACT_CHUNK_BYTES).toString('base64')},
    {signer, recipientPublicKey, id: job.id, direction: 'response'}));
  }
  return {manifest, chunks};
}

export async function openArtifact(job, manifest, fetchChunk, {recipient, expectedSigner}) {
  if (manifest?.schema !== 'veildesk.artifact.v1' || !/^[a-f0-9]{64}$/.test(manifest.digest)
    || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1
    || manifest.bytes > ARTIFACT_CHUNK_BYTES * ARTIFACT_MAX_CHUNKS
    || manifest.count !== Math.ceil(manifest.bytes / ARTIFACT_CHUNK_BYTES)) throw Error('Invalid artifact manifest');
  const parts = [];
  for (let index = 0; index < manifest.count; index++) {
    const chunk = await openSigned(await fetchChunk(index), {recipient, expectedSigner, id: job.id, direction: 'response'});
    if (chunk?.schema !== 'veildesk.artifact-chunk.v1' || chunk.provider !== job.provider
      || chunk.capability !== job.capability || chunk.digest !== manifest.digest
      || chunk.count !== manifest.count || chunk.index !== index || typeof chunk.data !== 'string'
      || chunk.data.length > 1368) throw Error('Artifact context mismatch');
    const bytes = Buffer.from(chunk.data, 'base64');
    const expected = Math.min(ARTIFACT_CHUNK_BYTES, manifest.bytes - index * ARTIFACT_CHUNK_BYTES);
    if (bytes.length !== expected || bytes.toString('base64') !== chunk.data) throw Error('Invalid artifact chunk');
    parts.push(bytes);
  }
  const bytes = Buffer.concat(parts);
  if (hash(bytes) !== manifest.digest) throw Error('Artifact digest mismatch');
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}
