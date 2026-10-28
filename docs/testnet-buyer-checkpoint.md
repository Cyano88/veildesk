# Cloud buyer acceptance checkpoint (2026-10-28)

A separate testnet buyer wallet exists at `/var/data/veildesk-test-buyer` on the cloud wallet service. The recipient wallet remains at its original path. No full node or wallet binary was downloaded to the operator PC.

The buyer synchronized to height 4549075 and passed offline encrypted recovery verification. Its encrypted initial recovery file is 1254 bytes, SHA-256 `003efc10401e56e5ed426a86046c58ecdf10ec119ca73ce6b32e9f2903cc1cc4`. The operator copy and private recipient file are in ignored `private/test-buyer-20261028/`. The checkpoint uses the existing recovery password, whose DPAPI-protected operator copy remains in `private/render-live-20261027/`. Preserve both directories. No seed or plaintext wallet was downloaded.

## Repeatable initialization and recovery check

Run the script inside the cloud wallet image from its source checkout, under an exclusive buyer lock:

```sh
flock -n /var/data/veildesk-test-buyer.lock node scripts/testnet-buyer-bootstrap.mjs
```

This reopens existing state and validates its identity; it does not reset the wallet. It accepts no arbitrary path, send command, mainnet option or address. It prints only readiness and encrypted-backup metadata. It must not run concurrently with another buyer wallet command. The cloud recipient worker has its own separate wallet directory and lock.

## Actual funding attempts

- Valar reported ready at height 4549074. A single 0.125 TAZ request was accepted as queued, then failed with `the wallet cannot pay this address`; broadcastOk was zero. No automatic resubmission was made. Private claim records are preserved in the buyer operator directory. The rejection does not establish its underlying wallet compatibility cause.
- Jino's readiness endpoint reported `ready:false`, `node status unknown`. No payout request was submitted there.
- testnet.zecfaucet.com failed DNS resolution, including an unrestricted retry. No payout request was submitted there.

These are observations at this checkpoint, not permanent faucet availability claims. Buyer funding is not verified. No service invoice has been paid and no transaction has been sent by the buyer.

## Resume

Reconcile the existing claim before any retry. Once a compatible faucet funds the buyer, sync and verify the received note and spendable balance. Then obtain a signed invoice for an authenticated buyer service request, pay its exact address/amount/memo with a bounded testnet-only send path, and verify the real recipient note through the deployed private bridge. Complete encrypted PolyDesk report delivery and restart/replay acceptance before enabling paid service capability. Trade execution remains separately authorized.

## Funding compatibility follow-up and video (2026-10-28)

The wallet parser confirmed that the buyer's original address is already a testnet Orchard-only UA. A separate transparent-address inventory found an existing unused testnet receiving address. The wallet refused to create another one under its no-gap rule; no bypass or address reset was used.

After rechecking that the original claim had failed, one claim was submitted to the existing transparent address. It also failed with `the wallet cannot pay this address`, with zero successful broadcasts. Thus a simple Orchard-only address replacement does not resolve the problem. The precise faucet-side cause remains unknown. Jino still reported `node status unknown`. No funds were received or sent by the buyer as evidence of a completed purchase.

A fresh live Render bridge check passed at 2026-10-28 02:16:39 UTC: authenticated bridge, tracked recipient, unknown transaction awaiting_payment, settlementVerified=false and tradeSubmitted=false. The run was video-recorded alongside independent local coordination and the actual PolyDesk engine's synthetic-receipt integration test. Video and source/output integrity manifests are in the operator's ignored `output/playwright/` directory; see `docs/demo-recording-2026-10-28.md` for scope.
