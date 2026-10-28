import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {identity} from '../src/envelope.mjs';
import {signingIdentity, sealSigned, openSigned} from '../src/authenticated.mjs';
import {sealArtifact, openArtifact} from '../src/artifact.mjs';

test('artifact authentication rejects swapped, missing, substituted, corrupted and rerouted chunks', async () => {
  const recipient = await identity(), signer = await signingIdentity();
  const job = {id: randomUUID(), provider: 'polydesk', capability: 'polydesk.research.rehearsal.v1'};
  const options = {recipient, expectedSigner: signer.publicKey};
  const sealing = {signer, recipientPublicKey: recipient.publicKey};
  const value = {text: 'unicode 🛡️ data'.repeat(300)};
  const {manifest, chunks} = await sealArtifact(job, value, sealing);
  assert.deepEqual(await openArtifact(job, manifest, i => chunks[i], options), value);
  await assert.rejects(openArtifact(job, manifest, i => chunks[(i + 1) % chunks.length], options), /context/);
  await assert.rejects(openArtifact(job, manifest, () => undefined, options));
  await assert.rejects(openArtifact({...job, id: randomUUID()}, manifest, i => chunks[i], options));
  await assert.rejects(openArtifact({...job, provider: 'other'}, manifest, i => chunks[i], options), /context/);
  const other = await sealArtifact(job, {text: 'other'.repeat(1000)}, sealing);
  await assert.rejects(openArtifact(job, manifest, i => other.chunks[i], options), /context/);
  const bad = structuredClone(chunks[0]);
  // Flip deterministically even if the first character already happened to be A.
  bad.ciphertext = (chunks[0].ciphertext[0] === 'A' ? 'B' : 'A') + chunks[0].ciphertext.slice(1);
  await assert.rejects(openArtifact(job, manifest, i => i ? chunks[i] : bad, options));
  // A signed but internally inconsistent artifact still fails the complete-content digest.
  const plain = await openSigned(chunks[0], {...options, id: job.id, direction: 'response'});
  plain.data = Buffer.alloc(1024, 65).toString('base64');
  const inconsistent = await sealSigned(plain, {...sealing, id: job.id, direction: 'response'});
  await assert.rejects(openArtifact(job, manifest, i => i ? chunks[i] : inconsistent, options), /digest/);
  await assert.rejects(openArtifact(job, {...manifest, bytes: 65537}, i => chunks[i], options), /manifest/);
  await assert.rejects(sealArtifact(job, 'x'.repeat(65536), sealing), /limit/);
});
