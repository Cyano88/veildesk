# Encrypted HTTP candidate acceptance — 28 October 2026

## Scope

An SDK-independent buyer uses real loopback HTTP and independently implemented
standard Web Crypto primitives to interoperate with the existing VeilDesk relay,
paid provider, and PolyDesk research service. This is not a new mainnet purchase.
Production remains at the previously deployed release; this candidate is on
`feature/encrypted-http-contract` and is not merged into main.

## Results

- Full regression suite: **88 passed, 0 failed, 2 optional checks skipped** (90 total).
- SDK-independent wire tests: **2 passed** with synthetic report/chain fixtures.
- Same wire tests with PolyDesk adapter and real research engine: **2 passed**;
  external market/news/model inputs and native wallet observations are fixtures.
- The PolyDesk path asserts one engine invocation and one fixture model invocation,
  zero external HTTP requests, research-only output, and no order submission.
- No payment broadcast, production enrollment change, deployment or marketplace
  operation was performed for this candidate.

The engine fixture uses some historical `zeroScout` field names for compatibility;
this does not call ZeroScout or change PolyDesk's current 0G/retrieval configuration.

## Reproduce

Node 24.14.x and an existing PolyDesk checkout with its dependencies installed:

```powershell
node --test tests/*.test.mjs
$env:POLYDESK_ROOT='C:/Users/USER/Desktop/polydesk-veildesk-release'
node scripts/test-encrypted-http-polydesk.mjs
```

The runner sets the adapter/engine fixture paths and uses PolyDesk's existing tsx
loader. The test denies all non-loopback requests. No credentials or funded wallet
are needed. Local run output is stored under `output/encrypted-http-*-tests.txt`.

## Checked boundaries

| Boundary | Evidence |
| --- | --- |
| Identity | Trusted provider pins required; unexpected signer/key rejected |
| Enrollment | Other buyer cannot discover or submit the private capability |
| HTTP | Missing/wrong tokens, extra plaintext fields and oversized requests rejected |
| Encryption | Independent buyer seals request; production provider authenticates/decrypts |
| Tampering | Altered ciphertext, forged sender and changed request ID rejected before work |
| Payment | No research until synthetic recipient evidence matches the authenticated invoice |
| Invoice | Amount ceiling and changed request hash rejected |
| Receipt | Wrong transaction reference rejected; original request and invoice hashes retained |
| Result | Signed result and all encrypted chunks verified; wrong key and altered chunk rejected |
| Ownership | Cross-buyer result/chunk retrieval and premature chunk access denied |
| Replay | Exact stored request survives relay/provider restart; identical response, one research run |
| Storage | Relay database lacks the fixture plaintext request/report |
| Authorization | Report carries no execution or order authority; reference has no wallet actions |

## Remaining release work

Review the standalone reference (especially durable state/key integration in any
consumer), then run an operator-enrolled staging exercise before promotion. The
example deliberately leaves wallet spending and durable key storage to the caller;
it is not a second managed SDK. Browser CORS and public enrollment are not added.

The contract covers buyer endpoints; provider worker control remains private. The
new `/openapi.json` static route is part of this candidate only until deployed.
The HTTP job endpoints themselves predate this candidate and remain enrolled-only.
