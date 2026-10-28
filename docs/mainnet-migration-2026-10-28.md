# Mainnet migration - 2026-10-28

The user requested switching settlement work to mainnet. This authorizes preparation and verification; no mainnet payment has been approved or sent. Paid fulfillment and trade execution remain disabled.

## Isolation and recovery

- A new recipient wallet lives at `/var/data/veildesk-mainnet-recipient`, with an independent recovery password and encrypted initial checkpoint. Testnet wallet and buyer directories are preserved. The cloud worker now selects mainnet explicitly; testnet background polling is paused by that selection.
- Fresh mainnet synchronization reached height 3533173 with observed branch `37a5165b`. Complete scanning and offline recovery both passed.
- The 1266-byte encrypted checkpoint was copied off-cloud and verified against SHA-256 `1c76483d7db00fab8a91024ea0087191aefb65369aed22a1afff364325144fbc`. It and a Windows-DPAPI-protected password copy are under ignored `private/mainnet-20261028/`. Preserve this directory. No seed or plaintext wallet was downloaded.
- Mainnet startup refuses to open saved testnet identity before running wallet commands. The mainnet bootstrap and worker share the same exclusive wallet lock. CLI child environments receive an allowlist of runtime variables, not bridge or recovery credentials.

## Verification and authorization

- `zcash-network.mjs` defines explicit network selection, distinct bridge/paid capability identifiers, and rejects simultaneous testnet/mainnet payment configuration.
- Native capture and receipt validation bind the selected network, exact recipient, amount, memo and retained confirmation chain. Mainnet does not fall back to the testnet Zallet adapter. Unknown consensus branches fail both preflight and receipt capture.
- Mainnet bridge enrollment has separate keys, bearer tokens, provider ID and capability. The relay permits only its enrolled provider client. No public wallet RPC is exposed.
- Mainnet payment ledgers use separate files. Buyer invoice caps remain mandatory. A verified payment never grants trading authority.
- The original working tree contains the research-aware integration; the release provider remains validation-oriented with paid fulfillment disabled. Do not describe the full research purchase as deployed or mainnet-settled until its actual acceptance run completes.

## Native build

Build and Rust tests: https://github.com/Cyano88/veildesk/actions/runs/40632302864 . Release `wallet-evidence-bfb0a21-v2`, binary SHA-256 `126a0f8f2932ea889370383d0d6693e503908b63a31e3f0fed96d2123213840d`. Source pin remains zingolib `bfb0a2156819ea7f75a9b09b1724abfd06c8925e`. All compilation and binary retrieval occurred in the cloud.

## Acceptance still required

Agree the maximum total ZEC budget including fees, prepare a separately authorized buyer payment against a fresh authenticated service invoice, and verify actual settlement and encrypted report delivery. No funding or spending should be inferred from mainnet wallet readiness. The earlier demo video remains historical component/testnet evidence, not proof of mainnet settlement.

## Deployed mainnet result

At 2026-10-28 04:46:07 UTC the deployed provider returned network=main, bridgeAuthenticated=true, recipientTracked=true, unknownPaymentState=awaiting_payment, settlementVerified=false and tradeSubmitted=false. Wallet deploy `dep-dbgnp5p42hec73djg4rg` is live at commit `dc89a84`; relay and provider deploys `dep-dbgnojgu01pc73alaj50` and `dep-dbgnojvb9u1s738qpa4g` are live with the mainnet integration. The wallet independently logged mainnet height 3533182 and nativeRecipientVerified=true after deployment.

The final original working-tree suite passed 81 tests with two optional checks skipped. The release suite passed 63 tests with one optional check skipped before the final branch-check hardening; all 18 affected wallet/payment tests passed after that change. Mainnet research acceptance is synthetic evidence, not a live purchase.

Sanitized result: `output/mainnet-cloud-bridge-check.json`. Mainnet recording: `output/playwright/veildesk-mainnet-check.webm`; a 45-second result excerpt is `veildesk-mainnet-check.mp4`, and `mainnet-verified.png` captures the final screen. The local read-only evidence viewer displays the actual saved cloud command output; its source is `output/mainnet-proof-viewer.mjs`. The excerpt shortens the waiting period; raw footage is retained. This evidence contains no wallet address, secret or recovery material.

Mainnet wallet and verification migration is complete. Before sending any real funds, the operator still needs the user's maximum ZEC budget including fees, funding source, a concrete authenticated invoice and payment approval. Paid fulfillment remains disabled.

## Buyer funding preparation - 2026-10-28

The user set a total budget of USD 1 including fees and confirmed they will fund from their own ZEC wallet. A separate mainnet buyer was created at `/var/data/veildesk-mainnet-buyer`, with its own lock and independent recovery password. Mainnet sync at height 3533228, native receiving-address ownership, and offline encrypted recovery all passed. The address differs from the service recipient.

The encrypted initial checkpoint is 1258 bytes, SHA-256 `75008028aa84d50951244f0cfdb0e2dc45932ca45863937e1ee6424fc1b706de`. Operator state, the verified encrypted copy, receiving address, budget note and Windows-DPAPI-protected password are under ignored `private/mainnet-buyer-20261028/`. Preserve these files. Source helper: `scripts/mainnet-buyer-bootstrap.mjs`; run only under `/var/data/veildesk-mainnet-buyer.lock` with the independent password on stdin.

The Coinbase spot response at 05:37:26 UTC quoted ZEC/USD 1315.04. Proposed buyer funding is 0.0004 ZEC (USD 0.526016 at that quote), provided the user's sending wallet shows a total including its fee of no more than USD 0.75. The remaining USD 0.25 is reserved for the later service-transfer fee. The planned service invoice is 0.0002 ZEC; the buyer invoice cap must be 20000 zatoshis. This is an operator budget note, not evidence of an executed transaction or an enabled service. Recheck price and actual fee before spending; do not exceed the user's total budget.

Funding this buyer is separate from paying a fresh authenticated PolyDesk invoice. No buyer funding or service payment has been verified at this checkpoint. Paid fulfillment remains disabled.
