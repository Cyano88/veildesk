# Testnet payment and delivery lifecycle (v0.2)

Status: implemented and tested over local HTTP with synthetic wallet RPC evidence.
Not verified against a real shielded payment; disabled in default provisioning.
The service is not listed or deployed publicly.

## Separate capabilities

- `prediction.mandate.validate.v1`: existing unpaid validation, reports
  `paymentVerified:false`.
- `prediction.mandate.validate.testnet-paid.v1`: explicitly configured testnet
  payment-required validation. It is never inferred from the unpaid capability.

The provider returns a validated preview contract, not market research or trading
execution. No code here sends funds. The transaction-reference command reports a
payment already sent by a separately authorized wallet workflow.

## Protocol

1. Client signs/encrypts the bounded preview mandate and persists its exact outbox
   request before submission. Routing and expiry are signed inside the envelope.
2. Provider authenticates the request and checks node/wallet readiness AND a supported
   consensus branch before creating any invoice. A sync-locked or unsupported wallet
   cannot solicit payment through this path.
3. Provider persists invoice terms, requester/provider key bindings and mandate hash,
   then publishes a signed encrypted `payment_required` challenge. The invoice
   expires no later than the mandate. Its random memo and invoice hash bind the
   expected receipt to this request.
4. Client verifies the provider signature, mandate hash, testnet, expiry, invoice
   hash and its configured `maxPaymentZat`. It obtains explicit authorization through
   a separate wallet flow before sending funds; this SDK provides no send function.
5. Client submits a signed encrypted hint containing txid, invoice hash and mandate
   hash. This is a lookup hint, never proof of payment. Exactly one candidate txid
   is accepted per job; retries reuse the same persisted ciphertext. An incorrect
   candidate requires operator reconciliation, not silently replacing the invoice.
6. Provider reads its actual recipient wallet and node: account/address, external
   incoming note, amount, memo, index, mined status, confirmations and canonical
   block must match. It atomically reserves the note for one job and persists its
   signed encrypted result before delivery.
7. Before every delivery attempt, including retries after a lost response, the
   provider rechecks the chain, note, block and deadlines. Cached success alone
   cannot authorize delivery. Execution authorization always remains false.

The relay is opaque. It authenticates caller roles and protects immutable invoice,
hint and review records; it cannot verify inner signatures or chain evidence.
Recipient-wallet verification is the enrolled provider's responsibility, and the
client accepts only its pinned provider's signed result bound to the original job.
A malicious trusted provider is outside this trust guarantee; the client does not
independently validate the blockchain through this API.

## Additive API endpoints

| Endpoint | Caller | Request / effect |
|---|---|---|
| POST /v1/provider/invoice | Owning provider | `{client,id,envelope}`; immutable signed encrypted invoice challenge for a claimed paid job |
| POST /v1/jobs/:id/payment | Owning client | `{envelope}`; immutable encrypted signed txid hint; no send/broadcast |
| POST /v1/provider/payment-review | Owning provider | `{client,id,envelope}`; immutable signed review state; blocks subsequent delivery |

`GET /v1/jobs/:id` may include `invoiceEnvelope` and `paymentReviewEnvelope`.
The SDK authenticates/decrypts them into `payment` and `paymentReview`. Provider
pending jobs also include the encrypted `paymentHint`. Relay state remains
`processing` during invoice/payment/review; a review is not successful fulfillment.
The migration adds nullable columns and preserves existing unpaid jobs/results.

## Failure policy

Missing receipt: remain awaiting payment. Invalid hint signatures or wallet/RPC
errors: no delivery. Unconfirmed or unsupported transaction: no delivery. Late,
ambiguous/duplicate notes, changed block hashes, or an already-bound note enter
persistent manual review. Signed review notices let clients see the reason. Review
is sticky across restarts and relay delivery is blocked. Do not erase review/note
records to force fulfillment. A result-creation crash after reservation requires
reconciliation rather than automatically repeating work.

There is no automatic refund or resolution endpoint. Operator review, refund
policy and abandoned-job retention remain deployment requirements. Once an
already-verified encrypted result has been delivered, a later reorg cannot retract
information from its recipient. The receipt is a verification snapshot, not a
promise of permanent finality. Expired/review jobs are not an automatic continuous
wallet-monitoring service for later transfers.

## Operator configuration (not enabled by the provisioner)

Enroll the paid capability on the provider only after payment acceptance passes.
In provider.json, an explicit `testnetPayment` object contains:
`enabled:true`, `network:"test"`, recipient `account` UUID, owned shielded `address`,
ZEC decimal-string `amount`, plus `node` and `wallet` objects with literal-loopback
HTTP `url` and local `cookieFile`. Cookies stay on the provider host. Do not expose
wallet RPC through the relay or send cookies upstream. The provider keeps its
SQLite payment/note ledger at `<stateDirectory>/testnet-payments.db`; include it
in protected whole-service backups with identities and existing replay ledgers.

In client.json set `capability` to the paid capability and require an explicit
positive zatoshi-string `maxPaymentZat`, alongside the pinned provider keys.
The existing SDK's `get(id)` returns the authenticated invoice/review or result;
`submitPaymentHint(id,txid)` only reports transaction evidence.

PolyDesk's opt-in adapter exposes the same method. Its CLI accepts:
`node --import tsx scripts/veildesk-client.ts payment <job-id> <txid>`.
This command does not pay, refund, authorize a trade or change marketplace billing.

## Current live blocker

NU7/v6 Ironwood-only receipt support is implemented and fixture-tested against
pinned Zebra/Zallet schemas and an observed public transaction shape. See
nu7-receipt-evidence.md. Local Zebra is at 1,868,800 and Zallet at 603,666,
with the wallet still sync-locked. Real recipient payment evidence is absent.

Required remaining evidence: actual owned addresses, current-protocol compatible
wallet evidence, a real shielded payment, live failure handling, deployment,
provider operational recovery and exact marketplace terms. Fixture passes do not
satisfy those gates or authorize listing.


## Recipient admission gate

Before creating or republishing an invoice, the provider calls the local wallet's
read-only z_getaccount(account UUID). The exact configured unified address must
appear in that account's addresses[].ua; absent, mismatched or unavailable wallet
evidence prevents publication. This establishes wallet tracking, not spending
capability, backup health, Orchard-only receiver composition or completed payment.
Actual receipt verification still requires the decrypted incoming note.

Run `node scripts/payment-preflight.mjs` with VEILDESK_PROVIDER_CONFIG pointing to
the private provider configuration. It checks sync and recipient tracking without
creating accounts, deriving addresses or sending. It emits no keys or addresses.
Provision an Orchard-only unified testnet address as described in
nu7-receipt-evidence.md and verify its exact incoming-note round trip before use.
