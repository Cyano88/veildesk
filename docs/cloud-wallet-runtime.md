# Persistent cloud testnet wallet

This is an unfunded recipient-wallet runtime, not a payment verifier. Paid service fulfillment remains disabled. PolyDesk still owns research, Tavily and 0G; the wallet runtime has none of those credentials.

Render service: `srv-dbgiegcs728c73e6oit0` (`veildesk-light-wallet`), Oregon starter background worker, one instance, 1 GB persistent disk at `/var/data`. There is no public port or wallet RPC. Its Docker image pins the wallet kit SHA-256 and source revision. The OS `flock` prevents concurrent worker ownership; wallet operations are serialized and expose only fixed info, sync, height and address commands. There is no spend command in the wrapper.

Source: zingolabs/zingolib `bfb0a2156819ea7f75a9b09b1724abfd06c8925e`; release kit SHA-256 `f8d65345681dbc4d99d210992bf545424879ec6e437e887fcb0713fe340ad5ac`. Both zingo-cli and nym-proxy are included. This does not establish anonymity for every indexer request; the indexer can observe wallet/network activity metadata.

The first fresh-wallet info command sets `--nosync --waitsync` to persist finite-sync settings. Every cycle checks the testnet network, immutable receiving identity, encrypted recovery and full block/output scan completion. Readiness is invalidated before fresh checks and on errors. Status always declares `settlementVerified: false` and `paidFulfillmentEnabled: false`.

An initial AES-256-GCM encrypted checkpoint is created while the wallet process is stopped. Each cycle restores that checkpoint to an isolated temporary directory and opens it offline to compare the receiving identity. The temporary restored copy is deleted, while the active wallet and encrypted checkpoint remain. This proves the initial wallet identity can be recovered; later invoices/receipts will require their own durable backup strategy.

## Evidence

- Cloud worker integration: https://github.com/Cyano88/veildesk/actions/runs/40595593837 — two sync/recovery/reopen cycles passed at testnet heights 4548897 and 4548898.
- First Render deployment `dep-dbgiegks728c73e6ojh0` went live, then returned sync-ready at height 4548906 with offline recovery verified at 2026-10-27 22:37:37 UTC.
- Explicit Render restart at 22:38:44 UTC retained the same receiving identity and returned sync-ready at height 4548909 at 22:39:36 UTC.
- The initial encrypted recovery copy was downloaded privately (1258 bytes) and its SHA-256 matched the cloud file. No seed or plaintext wallet was downloaded. A separate Windows-DPAPI-protected recovery password copy is in the ignored operator directory, and Render holds its runtime secret.
- Focused local tests cover wrong network, stale tip, incomplete scanning, forbidden commands, restart identity, missing wallet state, changed identity, wrong recovery password and encrypted checkpoint authentication.

Operator files are under the ignored `private/render-live-20261027` directory. Preserve them. Do not log wallet command output, seed material, receiving addresses or the recovery password. The SSH connection keeps strict host-key checking; disabling automatic host-key updates was necessary because Render's additional host-key proof failed.

## Remaining acceptance

The native light-wallet receipt adapter is implemented and its recipient preflight is deployed; see docs/native-wallet-receipts.md. Connect authenticated provider capture requests to the single wallet owner before live paid acceptance. CLI summary notes do not prove exact invoice recipient or canonical block binding and must not be passed off as Zallet evidence. Then verify one real shielded testnet payment bound to an authenticated service request, exercise replay/reorg/late-payment handling, and complete encrypted PolyDesk report delivery. Mainnet payment acceptance and trade execution are not enabled.
