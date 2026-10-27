# NU7 receipt compatibility evidence — 2026-10-27

Implemented scope: v6, version group `d884b698`, Ironwood-only incoming payments.
Zallet must report version 6, pool `ironwood`, an action index, the configured
account UUID and exact recipient address, external incoming ownership, exact
integer amount and invoice memo. Existing canonical-chain, stable-tip, confirmation,
expiry, authenticated mandate and durable note-reuse checks still apply.
Transparent, Sprout, mixed-pool, unknown-version and unsupported-branch evidence
fails closed. Legacy v4/v5 Sapling/Orchard receipt support remains available.
NU7 branch `77190ad9` is admitted; no other new branch was inferred or enabled.

## Pinned implementation sources

- [Zebra v7.0.0 RPC transaction types](https://github.com/ZcashFoundation/zebra/blob/v7.0.0/zebra-rpc/src/methods/types/transaction.rs): Ironwood uses the same RPC bundle structure as Orchard. RPC exposes enableSpends and enableOutputs, not the wire-level cross-address flag.
- [Zallet v0.1.0-beta.3 transaction view](https://github.com/zcash/zallet/blob/v0.1.0-beta.3/zallet-core/src/components/json_rpc/methods/view_transaction.rs): Ironwood uses `pool: ironwood` and `action`, with Ironwood-specific decryption. Incoming addresses use an Orchard-only unified encoding.

Downloaded source SHA256, respectively:
`b0d6338831d0dbd929a08f441b6d95fc6d24a1b9fa11e97f2e9f67a4985c0d8f`
and `05cfa23e39ef4b2dec9f7f7bf2234c979e0593d81148fc52c0c8f8e8e20c24a9`.

The operator must provision an owned Orchard-only unified testnet address and
verify its exact round trip in z_viewtransaction. Multi-receiver address
normalization is not implemented. Do not bypass ownership checks to compensate.

## Public chain schema evidence

Read-only Tatum testnet RPC returned block 4545850, hash
`00001df81aa044eec27045e3ca6b7bcf3fdfb21b06d2969a96cc15874166aab9`.
Transaction `9fa44df4980c1475a1ea70cc7f1982d3bf3381b722cdf0e1bc591d3c9ad1f1ef`
is v6 with two Ironwood actions and both spend/output flags true, with no
transparent or other shielded-pool components. A reduced structural fixture is
stored at tests/fixtures/nu7-public-shape.json; proof/ciphertext payloads are
omitted. This is a third-party node observation, not local chain validation or
proof of payment to VeilDesk. The compatibility test supplies synthetic recipient
wallet evidence and explicitly rejects acceptance when that evidence is absent.

## Remaining release gates

Real owned-wallet settlement is still unverified. Current local readiness check:
Zebra 1868800, wallet 603666, locked true. The local estimated height understates
the observed remote tip and must not be used as a reliable sync percentage.
Live payment, live failure recovery, deployed operation and marketplace acceptance
remain required. No payment, trade, deployment or listing was performed.
