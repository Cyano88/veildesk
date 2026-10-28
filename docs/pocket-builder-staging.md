# Pocket builder staging evidence

This offline integration test exercises the actual transfer-construction functions from a local Pocket checkout. It does not deploy a Pocket route, use a wallet secret, contact an RPC, broadcast a transaction, or demonstrate production authentication.

Run from this VeilDesk worktree in PowerShell, using existing dependencies:

```powershell
$env:VEILDESK_POCKET_SOURCE_ROOT='C:/Users/USER/hashpaylink-exchange-push-release'
$env:VEILDESK_SOLANA_DEPENDENCY_ROOT='C:/Users/USER/Desktop/polydesk-veildesk-release'
node --test tests/pocket-builder-staging.test.mjs
```

Both environment variables are required; otherwise the integration test explicitly skips. It reads `api/relay-solana.ts`, extracts six named functions through the TypeScript AST, and prints the full source SHA-256. The original checkout is never changed or imported. Secret loaders, RPC, fee observations and token balances are substituted with offline fixtures; SPL instructions and customer signatures use the installed Solana libraries. Fee-quote authentication and Circle/Privy authentication are not tested here.

The only source alteration in the extracted functions replaces the single sponsor `partialSign` call with an unsigned-preparation assertion. This is a staging seam, not a production patch. Production currently signs before customer approval; the candidate flow deliberately prepares unsigned bytes, obtains the customer's signature, then invokes the VeilDesk gate with an independently signed mandate bound to the exact transaction message. The sponsor fixture has only a public key. The final signer returns mock bytes, so the result cannot be submitted as a valid transaction.

## Observed result, 28 October 2026

Source SHA-256: `f98dda0641cffdfce7d28d8e15c70e5c03b54f7b73a3450dc340a7e633844d8c` (working checkout, including its preexisting changes).

Full VeilDesk suite with both fixture environments enabled: 95 tests, 93 passed, 2 optional tests skipped, zero failures. Local transcript: `output/pocket-staging-full-tests.txt`.

- Existing Pocket sponsor-as-sender guard returned 403 before the fixture connection was constructed.
- Public `mode=withdraw` returned 403; the authenticated withdrawal path was not exposed.
- Preparation produced two unsigned SPL TransferChecked instructions: 20.7 USDC to the recipient and 0.000522 USDC to the treasury fixture.
- Missing customer signature, changed recipient even with a fresh customer signature, and an extra transfer all failed before the mock sponsor was called.
- Valid customer approval plus the agent mandate reached the mock signer once.
- Reopening the durable ledger and retrying returned the cached signature without another signer call.
- A simulated lost signer response remained reserved after reopening the ledger; retry required reconciliation and did not invoke the signer again.

These amounts model the reported failure pattern; this is not a replay of the historical transaction or evidence attributing it to an attacker or endpoint.

## Remaining production boundary

Only the selected transfer builder is exercised. Pocket's authenticated transfer adapter, native sends/swaps, CCTP/USDT bridge signing, and legacy sweep signing are not integrated with this gate. No staging HTTP server exposes those routes. Do not claim every Pocket signing path is protected.

Before production adoption, integrate the prepare/approve/sponsor sequence into the authenticated linked-wallet flow, enforce exclusive access to the signer, verify token ownership and destination accounts with trusted chain observations, and test actual wallet-client compatibility. The current inspector rejects account-creation instructions, so this candidate supports existing token accounts only. Mainnet RPC, fee freshness and signer operations remain untested by this fixture. The Zcash paid-research product remains separate from this candidate Solana security extension.
