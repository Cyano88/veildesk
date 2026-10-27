# Native light-wallet receipt adapter

Implemented on 2026-10-28 (Africa/Lagos). This adapter is distinct from Zallet RPC. It does not fabricate Zallet accounts or transaction responses from CLI summaries.

## Components and trust boundary

- `ops/light-wallet/native/veildesk-evidence.rs`: read-only executable compiled inside the pinned zingolib workspace. Reads one bounded, stopped-wallet snapshot and a scoped account/address/txid query. Verifies testnet, exact tracked unified address, decrypted Orchard/Ironwood recipient, external account scope, memo, value and note output identity. Full transaction data supplies version, pool, privacy flags and transparent/legacy-bundle rejection. Confirmed notes must have contiguous retained wallet blocks reaching the wallet tip. No send, key export, network listener or network request is implemented.
- `src/light-wallet-capture.mjs`: invoked by the wallet owner under its exclusive lock after a fresh complete scan. It bounds the subprocess, removes recovery secrets from its environment, and requires the wallet file hashes before/after capture and the native export digest to agree. It never logs the scoped evidence.
- `src/light-wallet-receipt.mjs`: binds native evidence to the exact invoice, requires at least three confirmations and a stable second snapshot, and preserves missing/ambiguous/late/reorg outcomes. Every result leaves execution authorization false.
- `src/settlement.mjs`: separate Zallet and native backend factories. The paid provider binds its configured recipient and backend identity to the invoice ledger. The existing Zallet backend remains the default and retains existing ledger binding compatibility. The light-wallet account is a numeric account ID; the provider's UUID remains its durable ledger account identifier.

The capture callback is trusted host code, never buyer-supplied JSON. Production capture must stay inside the single wallet owner's serialized execution. The indexer and recipient wallet remain trusted for chain observation; this is not independent full-node consensus verification or a publicly verifiable zero-knowledge payment proof. Old transaction blocks outside the retained window fail closed and require reconciliation. Sapling and mixed-pool transactions are not supported by this native pilot.

## Verified evidence

- Rust build and native note ownership tests: https://github.com/Cyano88/veildesk/actions/runs/40600640309 . Tests bind native decrypted recipient, account, external scope, value, memo, txid and output index, for Orchard/Ironwood types.
- Live unfunded wallet probe: https://github.com/Cyano88/veildesk/actions/runs/40601514733 . Native recipient accepted at height 4549008, wrong account rejected, unknown transaction stayed awaiting_payment. No paid receipt was fabricated.
- Exporter release: wallet-evidence-bfb0a21-v1. Executable SHA-256 `4fbeab26d309c3dfe10acdfc5c7f5bb0912e2672b6679f4981e3a4f1b422e0e1`.
- Render deploy `dep-dbgj4mp42hec73f7nh2g`, commit `1914f896aab5029cfb1c7233e361f1b105a14541`, is live on wallet service `srv-dbgiegcs728c73e6oit0`. At 2026-10-27 23:24:20 UTC it reported height 4549015, consensus branch 77190ad9, syncReady=true, offlineRecoveryVerified=true and nativeRecipientVerified=true. settlementVerified and paidFulfillmentEnabled remained false.
- Full VeilDesk working-tree suite: 72 passed, two optional checks skipped. Additional focused recipient-configuration regression passed after the full run.
- Independent buyer-process test through the actual PolyDesk research engine and native backend passed with controlled market/model and synthetic native chain evidence. A wrong memo could not invoke research; encrypted report delivery and restart replay invoked the engine/model once. This is integration evidence, not live settlement.

## Still pending

Connect the provider to the single cloud wallet owner through authenticated private capture requests; do not expose raw wallet RPC or run a second writer on its files. The current background worker performs only native receiving-account preflight and does not serve remote receipt queries. Then provision/fund a separate testnet buyer, bind a shielded purchase to an authenticated invoice, verify its actual recipient note and confirmations, and deliver the encrypted PolyDesk report. Paid service capability remains disabled until that acceptance completes. Mainnet payments and trade execution remain separately unauthorized.
