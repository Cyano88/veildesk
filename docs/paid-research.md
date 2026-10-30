# Service-bound shielded payment gate

The explicit `polydesk.research.testnet-paid.v1` capability now reuses the Zallet receipt verifier and durable payment ledger for research purchases. This is implemented and fixture-tested, not evidence of an actual shielded payment. No production provider enrollment or worker configuration enables it yet.

## Request and authorization

Create a buyer with `createPaidResearchClient` from `src/mandate-client.mjs`. Configure its enrolled identity, pinned provider keys, this exact capability, a durable state directory and an explicit `maxPaymentZat`. Submit `{id, expiresAt, request}` where request is the strict service request used by the rehearsal: exact market/outcome/side, accepted disclosure version, and executionAuthorized false. The expiry must be within one hour.

The SDK persists the encrypted request and its hash before submission. An authenticated invoice must carry the matching requestHash, provider/capability, testnet network and terms within the buyer's amount cap and request expiry. Changing request contents under an existing ID fails. `submitPaymentHint(id, txid)` reports an already-sent transaction; it cannot authorize or send funds. Purchase approval and wallet spending remain separate host responsibilities.

The provider selects research mode only when `createPaidProvider` receives an explicit research implementation. Existing validation-only providers reject research capabilities. A host can supply the PolyDesk adapter backed by `runPolymarketTaskResearch`; current tests inject synthetic research instead. The production worker is intentionally unchanged until wallet readiness and upstream disclosure/retention are verified.

## Fulfillment ordering

1. Authenticate the buyer and bind the exact request, route, endpoint keys, recipient account/address, network and price into the payment ledger.
2. Verify testnet wallet readiness and recipient ownership before issuing an invoice.
3. Authenticate the transaction hint against both invoiceHash and requestHash. Verify the recipient's actual shielded note, memo, value, ownership, confirmations and canonical block evidence through the existing Zallet verifier.
4. Atomically reserve the note and mark work preparing before calling research. The ledger prevents reuse for another request. Concurrent, crashed or uncertain work requires reconciliation rather than automatic repeat execution.
5. Encrypt and persist the complete report bundle before uploading chunks. The signed result binds the payment receipt/requestHash to the artifact digest. Partial uploads remain unavailable to buyers.
6. Reverify settlement and expiry after artifact uploads, immediately before completion. Reorg/expiry review prevents release and remains sticky across restart. Identical retries reuse saved ciphertext.
7. The buyer checks the signed result against its saved request hash, invoice and submitted transaction hint, verifies the provider's receipt fields, then authenticates/reassembles the full report. Its receipt check is verification of a pinned provider attestation, not an independent wallet or consensus proof.

All results keep executionAuthorized, orderAuthorized and orderSubmitted false. Paying for research grants no trade authority or x402 PREPARE entitlement. ZEC receipts are not fabricated as USDC/USDT receipts.

## Verified scope and remaining gates

Automated tests use an independent buyer, real HTTP relay and SQLite state, the PolyDesk adapter, synthetic research and synthetic wallet RPC evidence. They cover no-payment gating, exact request hashes, invoice caps, changed requests/hints, wrong/insufficient evidence, duplicate notes, ciphertext upload recovery, payment-ledger backup/restore, client/provider restart, concurrent workers, expiry, upstream failure and a reorg during upload.

The report limit remains 64 KiB. Upstream errors or oversized reports after payment leave a reconciliation reservation; refunds and operator recovery are not automated. Use one authoritative payment ledger for capabilities sharing a recipient; separate databases cannot enforce cross-database note uniqueness. Once a report has been delivered, a later chain reorg cannot retract it.

Still required before a live paid launch: cloud-hosted compatible wallet readiness, a real shielded testnet transaction and retained acceptance evidence, verified downstream privacy/retention terms, provider worker deployment/enrollment, and refund/reconciliation procedures. No mainnet payment, real research purchase, trade, listing or deployment was performed for this change.
# Latency and buyer progress (29 October 2026)

The native paid path omits the redundant recipient preflight once a payment hint
exists. Receipt verification still performs two fresh native captures before
research and another pair before delivery. Unpaid invoices retain the readiness
check; legacy Zallet retains its separate recipient check. This removes one wallet
scan per funded native processing attempt, not chain confirmation time.

The wallet worker emits `wallet_stage_timing` with only stage, duration and success.
Use these measurements to separate indexer/info, wallet sync and offline command
delays. No receipt, address, transaction, report or recovery secret is logged.
Repeated backup restore remains enabled until measurements and a separately
validated recovery policy justify changing it. No reduced mainnet latency is claimed
until the updated deployed flow is measured.

An enrolled buyer can observe an existing purchase without submitting or paying:

```sh
node scripts/research-status.mjs /private/buyer-config.json /private/buyer-state EXISTING_JOB_ID
```

The watcher reads for at most one minute and prints sanitized state changes.
`fulfilled` requires authenticated receipt and decrypted report validation by the
paid SDK. `pending` means the observation window ended; it is not a failed payment.
Exit 0 means verified fulfillment, 2 means pending or manual review, and 1 means
status could not be verified. Keep the same job and durable state when observing
again. Never resend payment because the watch timed out.

For OKX integration, this is an internal progress source, not a task-acceptance or
delivery adapter. Only the authoritative accepted-task workflow can send progress
or deliver a result. Marketplace payment does not authorize an extra ZEC payment;
the shielded path requires a separately agreed service and explicit authorization.
Do not attach this purchase flow to the existing trading or monitoring services.
Use a short acknowledgement and subsequent progress updates, with delivery only
after verified fulfillment. Approval and a genuine subscription signal remain
separate from this implementation.

