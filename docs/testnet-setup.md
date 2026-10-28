> Historical checkpoint. For the completed mainnet pilot and current scope, see [the current README](../README.md) and [28 October pilot record](mainnet-research-pilot-2026-10-28.md). Earlier statements that settlement was pending describe the state at that time.

# Current testnet setup

Use Zallet with a compatible Zebra build. Do not install zcashd: its official end-of-life notice says it cannot follow NU6.3. The prototype src/zcash.mjs is a legacy fixture-tested adapter, not a verified Zallet adapter. Its z_listreceivedbyaddress method is absent from Zallet's documented current interface.

Verified release candidates on 2026-10-26: Zallet v0.1.0-beta.3 and Zebra v7.0.0. Verify their compatibility before running a wallet: Zallet's default backend requires a Zebra indexer build and compatible shared state format. Downloading both latest versions does not establish compatibility.

Local environment: Ubuntu-24.04 under WSL2. Keep wallet data and encryption identities in a dedicated Linux filesystem directory with owner-only permissions, not the source checkout or browser. Bind RPC to loopback only. Use testnet exclusively. Do not display or paste seeds, RPC cookies or private keys into chat.

The read-only preflight command is `node scripts/wallet-preflight.mjs`. Configure VEILDESK_WALLET_RPC_URL as a literal loopback HTTP URL and optionally VEILDESK_WALLET_COOKIE_FILE as a local cookie path. The preflight only discovers methods; it does not authorize payments or certify sync/network readiness.

Required acceptance: verify testnet chain and sync, create isolated test accounts, obtain faucet funds, make a shielded payment between accounts, validate the recipient's actual note and transaction evidence, persist its binding to the authenticated mandate, then test duplicate/reorg/late payment behavior before any execution adapter is enabled.

Sources:
- https://z.cash/support/zcashd-deprecation/
- https://zcash.github.io/zallet/guide/setup.html
- https://zcash.github.io/zallet/zcashd/rpc_status.html
- https://github.com/zcash/zallet/releases/tag/v0.1.0-beta.3
- https://github.com/ZcashFoundation/zebra/releases/tag/v7.0.0

## Installed and verified locally

- Zallet v0.1.0-beta.3: archive SHA-256 verified against GitHub release digest `1df2398df016ae6e9a1cba3f8ef0cc86ca0d7b48a0934b34df6f68114ebe9306`.
- Zebra v7.0.0: archive SHA-256 verified against its release checksum file.
- Release Zallet includes a zaino backend; the installed test environment uses that backend over authenticated local Zebra RPC. This avoids assuming shared database-format compatibility with the default zebra backend.
- Linux data root: `/home/shy/.local/share/veildesk-testnet`.
- Zebra RPC: `127.0.0.1:18232`; wallet RPC: `127.0.0.1:28232`.
- Both services started and synchronization observed. Wallet encryption initialized, but no mnemonic/account/faucet funding/payment created yet.
- Live OpenRPC discovery succeeded for getwalletstatus, z_viewtransaction, z_listtransactions, z_getnewaccount, z_getaddressforaccount, z_sendmany and z_getoperationstatus. z_listreceivedbyaddress is absent.
- Startup helper: `wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/USER/Desktop/veildesk/ops/start-testnet-wsl.py`.
- Existing services are left running to sync. Closing WSL or shutting down the computer can interrupt them; they are not installed as production/autostart services.

Windows readiness check (does not send payments):

```powershell
cd C:\Users\USER\Desktop\veildesk
$env:VEILDESK_WALLET_RPC_URL='http://127.0.0.1:28232'
$env:VEILDESK_WALLET_COOKIE_FILE='\\wsl.localhost\Ubuntu-24.04\home\shy\.local\share\veildesk-testnet\wallet\.cookie'
node scripts/wallet-preflight.mjs
```

Next: complete chain sync, inspect actual receipt schemas, create backed-up testnet accounts and obtain test funds. Production settlement remains disabled/unimplemented; the legacy fixture adapter must not be wired to customer payments.

## 2026-10-26 continuation: receipt verifier and sync gate

Live checks during this continuation observed Zebra advancing from 9,200 to
15,200 blocks; Zallet advanced from 7,113 to 12,310. At the latter check Zebra
estimated 3,608,185 blocks (verification progress 0.0042126). Both RPC services
responded on testnet, but Zallet reported `locked: true`. This is a sync/reorg
lock, not evidence that a passphrase unlock is required. Neither a funded account
nor a shielded payment was created during this continuation. Services remain running.

`src/zallet-receipt.mjs` is the new **testnet-only, schema-fixture-tested** adapter.
It uses `z_viewtransaction` rather than the legacy address-receipt RPC. The full
public OpenRPC catalog captured from the installed beta.3 wallet is saved in
`docs/zallet-openrpc.json`; it contains method descriptions and schemas, not wallet
keys or account data. Zebra fields were checked against the v7.0.0 source:
https://github.com/ZcashFoundation/zebra/blob/v7.0.0/zebra-rpc/src/methods/types/transaction.rs

The local API sequence is:

1. `issueAuthenticatedInvoice`: decrypt and verify a signed request against the
   pinned requester key, validate the preview-only mandate, then persist an invoice
   with mandate/signer hashes and the operator-configured recipient account UUID.
   Keep its directory outside the checkout, in the owner-only Linux data root.
2. Obtain and fund isolated test accounts only after sync and secure backup setup.
   Use an external shielded receiving address belonging to the recipient account;
   internal/change addresses are deliberately rejected. Send the exact invoice
   amount and hex-encoded memo with FullPrivacy and wait for operation completion.
3. Pass the resulting txid as a lookup hint to `verifyAuthenticatedPayment`, with
   the original signed envelope, pinned key and provider identity. The verifier
   reloads the persisted invoice, reauthenticates the request and checks recipient
   wallet evidence plus Zebra's canonical block. It never trusts a caller's receipt.
4. Repeat verification to test replay. Replays recheck the chain; no cached success
   bypasses readiness. A re-mined note under a different block enters `reorg_review`;
   a second matching note enters `duplicate_payment_review`. Expired invoices or
   mandates enter review states. No result authorizes execution.

Run fixture tests: `node --test tests/*.test.mjs`.
Run the read-only live gate using the wallet environment variables above plus:

```powershell
$env:VEILDESK_NODE_RPC_URL='http://127.0.0.1:18232'
$env:VEILDESK_NODE_COOKIE_FILE='\\wsl.localhost\Ubuntu-24.04\home\shy\.local\share\veildesk-testnet\node-rpc\.cookie'
node scripts/testnet-readiness.mjs
```

The gate currently exits 1 because sync is incomplete. A successful gate would
only establish sync, not funding or payment acceptance. Receipt verification
requires at least three confirmations and a stable tip across the read sequence.
Retry if the tip moves. The candidate-txid workflow does not scan for payments;
`awaiting_payment`/`expired_unpaid` means no matching note in that candidate, not
proof that the wallet has received no other transaction.

Remaining acceptance: actual address representation (particularly unified address
round trips), a real funded shielded transfer, asynchronous send completion, and
live duplicate/reorg/late behavior. Only v4/v5 Sapling-only and Orchard-only
transactions are supported; version 6, Ironwood and mixed-pool transactions fail
closed. Re-evaluate this policy against the active testnet upgrade at acceptance.
Address ownership must be established during account provisioning; issuing an
invoice alone does not validate ownership. Ledger files are single-host metadata
with exclusive reservations and fsync, not a distributed or crash-recoverable store.
Do not enable production settlement, trade execution, or an OKX listing from these
fixture results.


## Sync checkpoint 2026-10-26T07:44:09.673028+00:00

Read-only live check: Zebra block 1156000 of estimated 3665049; Zallet wallet tip 471832, locked=True. The readiness gate still fails on incomplete sync. Both services were observed processing blocks. No funding or payment was attempted. Available WSL disk space was 941 GiB; available memory about 9.5 GiB. Resume with the readiness command above before account setup or faucet funding.

## Fast-backend investigation (2026-10-27)

Tatum's documented HTTPS testnet endpoints answered unauthenticated
`getblockchaininfo` probes at height 4,545,682 with NU7 active:
https://docs.tatum.io/reference/rpc-zcash

This is a remote provider's chain view, not independent local validation. The
local Zebra estimate understated the actual remote tip, so previously reported
local sync percentages should not be treated as progress against a verified tip.
Public lightwalletd is not a drop-in full-node JSON-RPC backend for this Zallet
installation. The pinned release's Zaino backend does accept a validator RPC
connection, unlike the current default backend's co-located state requirement:
https://github.com/zcash/zallet/releases/tag/v0.1.0-beta.3
https://zcash.github.io/zallet/guide/installation/index.html

An isolated compatibility probe uses `/home/shy/.local/share/veildesk-testnet/remote-probe`,
wallet port 28242 and a read-only cookie-authenticated loopback proxy on 18242.
The proxy terminates upstream TLS with certificate verification and never forwards
local Authorization headers. Its allowlist excludes transaction submission.
The original wallet, Zebra, and their configuration are untouched. No accounts,
mnemonics, funding or payments were created in the probe wallet.

Initial Zallet startup connected to the remote validator but failed with HTTP 429.
A serialized, throttled read-only retry was started. Do not describe this probe as
payment-ready: public endpoint availability, quotas and required methods must all
be checked, as must v6/NU7 receipt support. The existing v4/v5 verifier deliberately
rejects newer transaction formats. Remote reads disclose timing and queried block/
transaction identifiers to the provider; no wallet secrets are sent upstream.

Demo fallback: `node scripts/hackathon-demo.mjs`; walkthrough in
`docs/hackathon-demo.md`. This produces reproducible local evidence without waiting
for chain sync and explicitly labels payment evidence as synthetic fixtures.

Probe outcome: throttling avoided the immediate startup failure but requests then
exceeded the backend's timeout during initialization. Both isolated probe processes
were stopped; original local Zebra/Zallet remain running. This public endpoint is
not validated as a usable Zallet backend. Resuming requires adequate provider quota
and bounded request latency, or another verified full-node endpoint. No send path
was enabled. The hackathon demo package is ready independently of this blocker.

## NU7 compatibility update (2026-10-27)

v6 Ironwood-only receipts are now supported; see nu7-receipt-evidence.md for
source and test evidence. Use an owned Orchard-only unified address with exact
wallet-view round-trip equality. Current readiness remains false: Zebra 1868800,
Zallet 603666, locked true. Original services remain running. No faucet/payment
was attempted; public transaction-shape evidence does not establish ownership.

## Root-cause diagnosis and verified fast path (2026-10-27)

The existing Zallet RPC reports zero accounts. Logs show its steady-state task
scanning old blocks individually around height 722060 while its Zaino view tracks
Zebra around 2492400. The process used about one CPU core; available memory was
9.4 GiB. Raising recover_batch_size is not established as a remedy for this
steady-state scan path.

A separate fresh empty beta.3 Zallet wallet using the SAME local Zebra RPC reached
wallet_tip=node_tip=2495799 in 4.6 seconds. It still reported locked:true because
this is not proof of global chain readiness. No mnemonic/account/funding was
created, and the probe was terminated after checking status. Original services
and data were left untouched. Private probe directory:
/home/shy/.local/share/veildesk-testnet/sync-probe-6eedf26c.

A read-only public Tatum query then reported testnet block 4546536, NU7 branch
77190ad9. This remote observation is not independent local validation. It shows
the full node remains materially behind; its estimatedheight is not the actual tip.

Practical path: preserve the original wallet, finish syncing Zebra (or validate an
already-synced compatible RPC backend with sufficient capacity), then initialize
a fresh test wallet against that tip and create new accounts with current chain
birthdays. Verify full readiness before funding. This skips needless pre-account
wallet history; it does not skip full-node consensus validation. Existing funded
wallets must not be reset or assigned invented birthdays. No existing accounts
were changed in this investigation.

Pinned source supporting initialization and new-account birthday behavior:
https://github.com/zcash/zallet/blob/v0.1.0-beta.3/zallet-core/src/components/sync.rs
https://github.com/zcash/zallet/blob/v0.1.0-beta.3/zallet-core/src/components/json_rpc/methods/get_new_account.rs
A free remote RPC was already tried and rejected as a production/backend option
because of 429 responses followed by initialization timeouts. A replacement must
pass the actual Zallet initialization and receipt-method checks before use.
