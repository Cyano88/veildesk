# VeilDesk by PolyDesk: v1 scope and release gate

> Historical scope checkpoint. The [28 October mainnet pilot](mainnet-research-pilot-2026-10-28.md) supersedes the pending-payment statements and establishes PolyDesk as the research provider, with an independent agent as buyer. For current listing preparation and remaining launch gates, see [marketplace readiness](okx-marketplace-readiness.md). Historical local passes below are not live marketplace acceptance.

Status: working scope for review, 2026-10-27. NOT approved for marketplace listing.
This document supersedes the earlier "Private Prediction Research" listing draft.

## Product purpose

VeilDesk is private mandate coordination infrastructure for prediction-market apps
and their service providers. An app submits an authenticated, encrypted, bounded
request to a selected provider, retrieves an authenticated encrypted response, and
can bind a verified payment receipt to that same request. The app and provider
retain their own keys. The relay stores ciphertext and routing metadata.

First concrete capability: `prediction.mandate.validate.v1`. The enrolled provider
authenticates and decrypts a preview mandate, validates its schema, expiry and
limits, and returns an encrypted signed validation result. This validates the
request contract; it does not verify a market, generate research or authorize a
trade. PolyDesk is the first intended client; a second independent client must
pass the same integration contract before describing it as reusable infrastructure.

The Zcash payment lane is part of the intended product acceptance, not a capability
proved by the relay. A standalone payment verifier does not establish payment-gated
delivery. Product-level shielded-settlement claims require all payment gates below.

## Included in v1

- Operator-enrolled client/provider identities with independently pinned signing
  and encryption keys; no self-asserted keys accepted as identity proof.
- Versioned HTTP job lifecycle and JavaScript SDK for submission, claim, status,
  delivery and authenticated result verification.
- Encrypted request/response bodies; tenant isolation and fixed envelope size.
- Durable idempotency, immutable delivery, bounded expiry, explicit uncertain-work
  reconciliation, restart recovery and a documented backup/restore procedure.
- Provider capability discovery and an adapter contract usable outside PolyDesk.
- A real testnet shielded payment bound to an authenticated mandate, with receipt
  verification and an explicit payment/delivery policy. Execution remains separate.
- Deployment packaging, health/readiness, request limits, secret provisioning,
  operational documentation and repeatable acceptance evidence.
- OKX.AI listing only after the exact listed service is reachable and passes its
  documented request/response contract through the marketplace integration.

## Excluded from v1

Automatic trading; custody of customer trading keys; prediction accuracy promises;
research generation without an explicitly integrated research provider; anonymous
networking; hiding public market trades; permissionless provider enrollment;
distributed/multi-region failover; mainnet/customer-fund settlement.

Do not broaden `preview_only` into trade consent. A payment proves neither trading
authority nor the quality of a provider's output.

## Acceptance matrix

| Gate | Required evidence | Current evidence / gap |
|---|---|---|
| Product contract | Inputs, outputs, capability, error states, trust boundary and excluded actions documented | Scope, relay API and integrated testnet-paid lifecycle documented; live paid acceptance remains open |
| Real service lifecycle | Separate client/relay/provider processes; submit, claim, deliver, decrypt/verify | PASSED locally: separate relay/provider processes and actual client CLIs; deployed acceptance pending |
| Interoperability | PolyDesk and an independently configured second client use the same protocol | PASSED locally: actual PolyDesk adapter plus independently enrolled second client through same protocol |
| Confidentiality/authentication | Wrong key, signature tampering, route substitution and replay rejection; no plaintext payload in relay DB/logs | Signature/route/wrong-key checks and plaintext absence tests pass; independent security review pending |
| Tenant authorization | Other tenants/providers cannot fetch, claim or deliver someone else's job | PASSED locally: tenant isolation, wrong-role rejection, cross-provider claim/delivery rejection and revocation on restart |
| Durability/concurrency | Process kill/restart, concurrent claims, lost responses, duplicate submit/delivery, uncertain work, backup restoration | PASSED locally: 20 concurrent claims, retries, lost claim/delivery responses, restart, uncertainty reservation and relay DB restore; encrypted local restore and fresh-container recovery passed; independent-host recovery pending |
| Resource controls | Body limits, rate limits, storage/queue quotas and graceful shutdown under load | Body/request quotas and bounded 300-job concurrent workload passed; all 364 records survived restart. Long soak, production-worker throughput, edge limits and retention operations pending |
| Payment | Real shielded testnet tx, exact recipient/amount/memo, confirmations, active-chain evidence and persisted mandate binding | NOT PASSED: wallet sync and real payment outstanding; NU7/v6 compatibility fixture-tested |
| Payment failure behavior | Wrong/late/duplicate payments and reorg handling; never unlock an expired/broadened mandate | Integrated payment/review/delivery policy fixture-tested; live acceptance pending |
| Operations | Container build, TLS endpoint, mounted persistence, non-root runtime, restore test, secret rotation/revocation, health/readiness | PASSED local Docker build/runtime, non-root/read-only/capability restrictions and persistent-volume recreation; fresh-container encrypted service restore passed; deployed TLS and independent-host recovery pending |
| Marketplace | Accurate listing draft, final pricing/identity, public HTTPS contract, live marketplace call and returned deliverable | NOT PASSED; no listing or activation performed |

A pass means a saved, reproducible result for the exact build. An implementation
file, mock, schema capture, screenshot, or marketing statement is not sufficient
proof of an untested gate. Fixture and live evidence must be labeled separately.

## Evidence standard

For each acceptance run save: UTC timestamp, code/package SHA-256, runtime versions,
command, exit status, assertion results, and sanitized output. Integration evidence
must identify the participating components and whether they were local, deployed,
fixture-backed or connected to testnet. Payment evidence must include the actual
txid and confirmation/block checks without publishing keys or private mandates.

Collect a short product walkthrough only after the underlying run succeeds. It
should show a real consumer request, its encrypted journey, authenticated result,
failure handling and the verified payment boundary. A compelling submission is
supported by these results; winning or event eligibility is not guaranteed.

## Listing gate

Do not create, update, submit for review, or activate a VeilDesk listing while its
advertised capability lacks the relevant acceptance evidence. The initial service
wording must describe what the provider actually returns, not future research or
trading behavior. If payment is not verified, do not silently substitute a free
relay demo for the intended shielded-payment product. Any narrower listing scope
must be explicitly agreed with the owner first.

Next work: settle the service/payment lifecycle contract, finish SDK + provider
acceptance and the PolyDesk adapter, exercise the failure matrix, then validate a
deployment and the real payment lane. Prepare the listing from that evidence last.


## Acceptance checkpoint: 2026-10-27

21 VeilDesk tests passed, including the actual PolyDesk CLI and an independently
enrolled second app against separate relay/provider processes. Five existing
PolyDesk discovery/MCP tests also passed. Source-hashed evidence is in
`output/acceptance-2026-10-27T00-39-44-718Z.json`. The source hash identifies that
exact run; later documentation/packaging changes do not retroactively alter it.

Local Docker acceptance passed six checks recorded in
`output/container-acceptance.json`, including container recreation with the same
persistent volume. This test verifies the relay container; it does not claim a
containerized provider, deployed TLS, live payment or marketplace verification.

Listing remains blocked by the unpaid validation/paid-settlement lifecycle gap,
real shielded payment, deployed operation and marketplace acceptance. These local
passes do not authorize publishing the old research-service description.

## v0.2 testnet payment lane

The separately configured testnet-paid capability adds authenticated invoice
challenges, encrypted transaction references, note reservations, fresh finality
checks before delivery and signed persistent review notices. Default provisioning
remains unpaid. See `docs/payment-lifecycle.md` for the exact protocol and remaining
acceptance. This closes the local orchestration gap only: real settlement is still
unverified, and NU7/v6 compatibility is now an explicit pre-invoice blocker.

## Payment-gate acceptance checkpoint (2026-10-27)

The paid pilot now has an integrated signed invoice / encrypted transaction hint /
recipient-note verification / signed review / delivery lifecycle. Eight additional
HTTP tests cover this lane using synthetic wallet responses, including concurrent
requests and delivery-response loss both before and after relay completion.
Real payment evidence is still absent. The active remote testnet reports NU7,
which is intentionally refused by invoice admission until its receipt formats
are supported and verified. Local sync completion is not sufficient by itself.

## NU7 compatibility continuation (2026-10-27)

The earlier NU7 format blocker is superseded by implemented v6 Ironwood-only
verification, with pinned source evidence and a public transaction-shape fixture.
See docs/nu7-receipt-evidence.md. Authenticated HTTP lifecycle and negative receipt
tests use synthetic recipient evidence. Real settlement remains unproven; listing
stays closed pending live payment, operational recovery and deployed acceptance.

## Payment recovery checkpoint (2026-10-27)

Added payment-ledger SQLite backup/restore with integrity/schema/checksum checks
and new-directory-only output. HTTP recovery tests preserve encrypted results,
note reservations, reorg review and uncertain-work blocking after restore.
Client outbox restore preserves payment-hint binding. This is partial local
recovery evidence; coordinated whole-machine restore, protected key backups,
real settlement and deployed recovery remain open gates. See relay-api.md.


