# VeilDesk by PolyDesk

Private coordination for prediction-market agents. New standalone developer preview; PolyDesk remains an optional integration.

## Run

The relay/SDK package requires Node 24.14.x. No runtime dependencies.

    npm start
    npm test
    npm run demo

Open http://127.0.0.1:5180. The demo seals a brief to an in-memory recipient and decrypts it locally. Both parties run in one browser; no research provider, payment or trade occurs. Refresh discards the keys. No telemetry or third-party resources are loaded.

## Implemented and tested

- P-256 ephemeral ECDH, HKDF-SHA256 and AES-256-GCM envelopes bound to request ID and direction.
- Fixed 4096-byte plaintext padding; recipient decryption, tamper rejection, wrong-recipient and context rejection tests.
- Local Zcash adapter with explicit spending approval and FullPrivacy policy; receipt checks against trusted wallet RPC fixtures.

## Required before launch or listing

1. Remote authenticated key enrollment and recovery. The two-process local demo now signs mandates and receipts and prevents duplicate work; its owned-child-process bootstrap is not remote identity verification.
2. Real synced Zcash wallet integration, shielded address validation, testnet receipt and send verification, durable invoice/note redemption, late-payment handling and reorg recovery. Late payments are now flagged for review; do not use with customer funds.
3. Actual research delivery with attributable public sources and explicit user-controlled disclosure to PolyDesk. No automatic trade execution.
4. Deployment supervision, health checks, successful task delivery and sustained uptime testing.
5. Confirm OKX marketplace rules for external ZEC payment. Published subscription documentation specifies USDT billing; do not describe that as a shielded ZEC payment.

## Privacy boundary

This is not an anonymity guarantee. Providers see decrypted briefs. Network endpoints can see IP addresses, timing and traffic volume. Browser compromise can expose plaintext and keys. Fixed payload padding does not hide timing. A public trade can reveal the eventual position. No independent cryptographic audit has been performed.

## References

https://thezecathon.com/

https://web3.okx.com/onchainos/dev-docs/okxai/a2a-subscription

https://zips.z.cash/zip-0321

https://zcash.github.io/rpc/z_sendmany.html

## Coordination demo

Run npm run demo for a signed, encrypted, preview-only mandate sent to a separate provider process, followed by an encrypted receipt and replay check. No real market is verified, no payment occurs, and no trade is submitted. See docs/audit-2026-10-25.md for the exact scope and outstanding production requirements.

## Testnet integration status

Zebra and Zallet are installed in isolated Ubuntu WSL and syncing. Live wallet capability discovery passes. The legacy payment adapter is not Zallet-compatible and is not connected to live funds. See docs/testnet-setup.md for exact versions, commands and outstanding acceptance tests.


## Hackathon walkthrough

Run `node scripts/hackathon-demo.mjs` for the authenticated coordination demo and
receipt/security tests, with timestamped evidence in `output/hackathon-evidence.json`.
See [the two-minute walkthrough](docs/hackathon-demo.md). Real shielded payment
acceptance remains pending; fixtures are not on-chain receipts.


## Infrastructure service

The opt-in relay and validation provider now support encrypted jobs over HTTP,
durable retries, tenant isolation, independent endpoint signatures, restart
recovery and a server-side PolyDesk adapter. Start with [product scope](docs/product-scope.md)
and [API/operator instructions](docs/relay-api.md). Run `npm run acceptance` for
source-hashed local evidence. Local Docker build/runtime checks passed; deployment,
shielded settlement and OKX listing remain gated. The browser preview above is a
separate surface and does not represent the service lifecycle.

## Optional testnet payment gate

Version 0.2 adds a separate paid pilot with signed invoice challenges, encrypted
transaction references and verified-receipt-gated delivery. Read
[the payment lifecycle](docs/payment-lifecycle.md) before enabling anything.
Defaults remain unpaid. The paid flow is fixture-tested; active testnet NU7 receipt
support and real settlement remain outstanding. No marketplace listing is enabled.
