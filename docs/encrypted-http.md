# Encrypted HTTP integration

VeilDesk already transports encrypted payloads over HTTPS. The PolyDesk preview
API is a different interface: it accepts plaintext over HTTPS and encrypts it
server-side. External agents can use the relay wire protocol directly, encrypting
before transmission. This guide and the standalone example make that existing
protocol explicit; they do not add another job queue or payment mechanism.

This branch is an integration candidate, not a new production deployment or public
paid-access launch. No new live purchase is claimed. Trade execution is not exposed.

## Contract and access

- Machine-readable OpenAPI 3.1 contract: [`web/openapi.json`](../web/openapi.json).
- Dependency-free Node reference: [`examples/encrypted-http-agent.mjs`](../examples/encrypted-http-agent.mjs).
- Acceptance: [`tests/encrypted-http.test.mjs`](../tests/encrypted-http.test.mjs).
- Existing paid lifecycle and trust boundaries: [pilot record](mainnet-research-pilot-2026-10-28.md).

An operator must enroll the buyer's token and signing/encryption public keys with
the provider and grant its capability. Buyer's private keys stay with the buyer.
Provider signing and encryption keys must be pinned through a trusted enrollment
channel. Never trust keys solely because `/v1/providers` returned them. Compare the
returned descriptor with both pins and the expected provider ID/capability.
There is no open signup or anonymous paid service. The relay token is not Privy.

Use HTTPS in deployment. Loopback HTTP is only for explicitly enabled local tests.
The reference rejects redirects, URL credentials, foreign paths, and provider-only
routes. Do not log bearer tokens, decrypted contents, invoice memos, or key files.
HTTP providers and request metadata remain visible to the relay; this is not network
anonymity. The provider sees the request and owns downstream research disclosure.

## Wire flow

| Step | HTTP request | Meaning |
| --- | --- | --- |
| Discover | `GET /v1/providers` | Enrollment-filtered descriptors; check trusted pins |
| Submit | `POST /v1/jobs` | 201 new; 200 identical retry; structural envelope acceptance only |
| Retrieve | `GET /v1/jobs/{id}` | Routing/state and encrypted invoice/review/result |
| Reference payment | `POST /v1/jobs/{id}/payment` | Encrypted reference to existing authorized tx; never sends funds |
| Retrieve report | `GET /v1/jobs/{id}/artifacts/{index}` | Encrypted chunks, owner-only after completion |

Send `Authorization: Bearer <enrollment token>` and `Content-Type: application/json`.
Requests have a 16 KiB limit. Wrong/missing tokens return 401; wrong role or denied
capability 403; other buyers' jobs/chunks 404. Conflicting retries return 409.
429 means a rate/pending-job limit; respect Retry-After when present. 408/503 or a
lost response can leave delivery uncertain: retry the exact persisted wire body.

```json
{
  "id": "<lowercase UUID>",
  "provider": "<pinned provider ID>",
  "capability": "polydesk.research.testnet-paid.v1",
  "expiresAt": 0,
  "envelope": {
    "version": 1,
    "id": "<same UUID>",
    "direction": "request",
    "ephemeralPublicKey": "<canonical base64>",
    "salt": "<canonical base64>",
    "iv": "<canonical base64>",
    "ciphertext": "<canonical base64>"
  }
}
```

Replace expiry with future Unix milliseconds within one hour. Mainnet capability
is `polydesk.research.mainnet-paid.v1` and requires explicit mainnet enrollment.
Neither a label nor a capability name authorizes a payment.

The encrypted application payload is:

```json
{
  "schema": "veildesk.job.v1",
  "route": {"provider": "<same provider>", "capability": "<same capability>", "expiresAt": 0},
  "payload": {
    "schema": "veildesk.service-request.v1",
    "service": "polydesk.market-research.v1",
    "input": {"marketId": "<market identifier>", "outcome": "YES", "side": "BUY"},
    "disclosure": "polydesk-provider-disclosure-v2",
    "executionAuthorized": false
  }
}
```

BUY/SELL is the research perspective. It is not an order. The provider checks the
signed route against the outer route. Tampering may be structurally accepted by
the opaque relay but is rejected at the provider before research runs. A queued
job is not proof of a valid signature, accepted purchase or verified payment.

## Cryptographic interoperability

No custom crypto primitives: P-256 ECDH, HKDF-SHA256, AES-256-GCM, P-256 ECDSA-SHA256.

1. Serialize the signed body as UTF-8 JSON with `domain: veildesk.signed.v1`, `id`,
   `direction`, `recipientPublicKey`, `payload`. Sign those exact bytes. ECDSA
   signatures are 64-byte IEEE-P1363 r||s, not ASN.1 DER. Send the exact body string
   alongside its canonical-base64 signature inside the encrypted content.
2. Encode `{body, signature}` as UTF-8. Maximum 4092 bytes. Start a 4096-byte random
   padded buffer with a four-byte unsigned big-endian payload length; put JSON at
   byte 4. Do not treat ciphertext/padding as a compressed or variable-size payload.
3. Generate a fresh ephemeral P-256 ECDH key for each newly prepared message. Public
   keys are 65-byte SEC1 uncompressed (0x04 prefix). Derive a 256-bit shared secret
   with the recipient's pinned encryption key.
4. HKDF-SHA256: random 32-byte salt; info is UTF-8 `veildesk/v1/{id}/{direction}`.
   AES-GCM uses the same bytes as additional authenticated data, a random 12-byte
   IV and a 128-bit tag. Ciphertext including tag is exactly 4112 bytes.
5. All binary fields use standard canonical padded base64, not base64url.
6. On receipt, check sizes/context, decrypt, verify the signature against the pinned
   signing key, and check signed domain/ID/direction/recipient key. Then validate
   service-specific fields. Never treat successful decryption alone as authentication.

JSON key order matters for hashed purchase/invoice bytes. The research purchase
hash is SHA-256 over UTF-8 `JSON.stringify({id, expiresAt, request})`, retaining the
request's exact serialized key order. Invoice hash covers the exact invoice object
serialization. Persist original contexts; do not reconstruct them from relay replies.

## Buyer implementation

The reference exports transport, encryption, pinned discovery, result, invoice,
receipt and artifact verification functions. It imports only Node built-ins, not
VeilDesk's SDK. It is a reviewable protocol example, not a managed wallet or durable
client product. `createIdentity()` creates temporary test keys; production identities
must be durable and backed up. Import your enrolled private keys through your key
store, keeping the same `{privateKey: CryptoKey, publicKey: base64}` shape.

```js
import {createHttpTransport, pinProvider, prepareResearchRequest}
  from './examples/encrypted-http-agent.mjs';

const rpc = createHttpTransport({url: relayUrl, token: enrollmentToken});
const provider = pinProvider(await rpc('/v1/providers'), trustedPin, capability);
const wire = await prepareResearchRequest({id, expiresAt, provider, capability,
  request, signer: buyerSigningIdentity});
// REQUIRED: atomically persist wire plus original purchase context to private
// durable storage before this POST. On uncertain response, retry stored wire.
const accepted = await rpc('/v1/jobs', {method: 'POST', body: wire});
```

`accepted` means queued, not paid. On GET, compare ID/provider/capability/expiry to
stored context before processing any envelopes. `verifyResult` checks signatures
and result context. It does not alone validate payment settlement.

For paid research:

- Authenticate `invoiceEnvelope` with `verifyResearchInvoice` using the stored
  purchase, explicit network and maximum service amount in zatoshis. That cap is
  not a fee budget. Separately approve network fee, recipient, amount and memo in
  the wallet and reject expired invoices before a new payment. Invoice verification
  permits reading historical invoices; it never grants spending authority.
- Submit an encrypted/signed `veildesk.payment-hint.v1` payload with provider,
  capability, invoiceHash, requestHash, txid (and optionally matching id as used by
  the SDK). Persist this prepared envelope before POST. It is only a reference.
- If paymentReviewEnvelope exists, authenticate it and stop automated completion.
  Never treat `processing` or HTTP 200 as a paid result.
- Require `completed`, verify the result with stored job context, then call
  `verifyResearchReceipt` with the authenticated quote, explicit network and your
  stored transaction reference. Provider receipt assertions still rely on trusted
  wallet/indexer observations, not public zero-knowledge proofs.
- Only then call `readResearchReport`: authenticate each chunk's provider,
  capability, ID, digest, count and index; check decoded lengths, assembled SHA-256,
  research schema and false execution fields. Maximum 64 × 1024-byte chunks.
- Preserve state across retries/restarts. Never regenerate ciphertext under an
  already-used job ID, silently change provider keys, or automatically retry an
  uncertain wallet broadcast. Use a newly approved request for changed terms.

## Evidence and release gate

Local real HTTP tests exercise a buyer implementation independent of the SDK,
provider payment gating, encrypted chunks, durable relay/provider restart, identical
replay, wrong identity, tampering, changed request ID, missing/wrong authorization,
private enrollment, premature artifacts, conflicting retries, and invoice amount/
request and receipt transaction binding. Synthetic native wallet evidence is
explicitly labeled; no wallet sends, live inference or live chain calls occur.

With PolyDesk's adapter and offline engine fixture configured, the same test invokes
the real research engine with synthetic external inputs. It asserts one model call,
no execution, and zero external requests. See `docs/encrypted-http-acceptance.md`
for the recorded invocation and result. Do not call this a second mainnet payment.

This candidate remains separate from the deployed hackathon release. Review the
wire reference and contract, retain the existing SDK for managed durable operations,
and complete an enrolled staging acceptance before promoting any new integration.
