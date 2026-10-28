# Signing authorization gate — restricted candidate

This extension addresses a concrete failure class: a fee sponsor must never become
the token owner/customer authorizing signer merely because it sponsors fees.
Encryption alone cannot enforce that rule. Enforcement must happen before signing.

The original `hashpaylink-exchange-push-release/api/relay-solana.ts` was inspected
read-only. Its builder rejects the relayer as sender and its signed-transaction
validator rejects the relayer as the customer signer. This work does not alter
Pocket, revive legacy checkout flows, or attribute the historical 20.7 USDC transfer.
The incident's endpoint/actor attribution and key exposure remain unproven.

## Implemented here

- `src/signing-gate.mjs`: verifies an enrolled agent's signed, bounded authorization,
  compares decoded transaction details and exact message hash, checks a trusted fee/
  blockhash observation, durably reserves the authorization, and only then invokes
  a host-supplied signer. There is no direct/public signing endpoint.
- `src/solana-sponsorship-inspector.mjs`: parses serialized Solana transaction bytes
  with the host's `@solana/web3.js`. Accepts only legacy messages containing one or
  two classic SPL Token TransferChecked instructions, one asset/source/customer,
  exact transfer order/amounts and an independent valid customer transaction signature.
- SQLite records only hashed identifiers/bindings and signature result, not requests
  or private keys. Identical retries return the existing signature. Changed approvals
  under the same ID conflict. Unknown signing outcomes require reconciliation.

This is separate from the encrypted HTTP candidate. No deployed code, wallet,
customer, provider enrollment or marketplace listing is changed.

## Explicitly allowed flow

1. The host enrolls an agent's P-256 signing key and binds it to one customer wallet,
   one source token account, mint/decimals, recipient token accounts, a total token
   ceiling and sponsor network-fee ceiling. This configuration is trusted operator
   input, never supplied by the request. Source ownership/mint enrollment must be
   verified by the host before enabling a real signer.
2. The customer approves the final transaction message with their Solana signature.
3. The agent signs a separate `veildesk.sponsor-transfer.v1` authorization containing
   the exact message hash, transfer amounts and recipient token accounts, network,
   sponsor/customer, expiry and fee ceiling. A research payment or preview mandate
   cannot substitute for this approval.
4. The gate authenticates the agent, checks its policy, decodes the actual wire
   bytes and verifies the independent customer signature. The sponsor cannot be the
   customer or token authority. A request-side summary is never used as the decoder.
5. The host supplies a fresh observation for those exact message bytes: configured
   network, valid blockhash, fee in integer lamports, message hash and observation
   time. The gate checks freshness (5 seconds), fee ceiling and expiry again.
6. An atomic durable reservation is written before the signing callback. Only the
   inspected message bytes are passed to it, using a private copy. No broadcast is
   performed. A failed/lost callback response leaves the reservation locked for review.

Transaction message bytes do not encode a Solana cluster. The host must bind the
fee/blockhash observer and any later submission to the configured cluster. The
five-minute authorization lifetime gates signing invocation; it is not an on-chain
expiry guarantee. Exact cached signature replay never invokes the signer again.

## Authorization shape

```json
{
  "schema": "veildesk.sponsor-transfer.v1",
  "id": "<lowercase UUID>",
  "agent": "<enrolled agent ID>",
  "network": "solana:devnet",
  "sponsor": "<fee-payer public key>",
  "customer": "<different customer public key>",
  "sourceAccount": "<enrolled customer token account>",
  "mint": "<enrolled mint>",
  "decimals": 6,
  "transfers": [
    {"recipientAccount": "<merchant token account>", "amountUnits": "20700000"},
    {"recipientAccount": "<approved treasury token account>", "amountUnits": "522"}
  ],
  "messageHash": "<SHA-256 of actual serialized transaction message>",
  "maxFeeLamports": "5000",
  "expiresAt": 0
}
```

Replace expiry with a future Unix millisecond timestamp no more than five minutes
away. Amounts are integer base units, not floating-point currency values. Every
extra field is rejected. `signAuthorization` signs the exact UTF-8 JSON body with
P-256 ECDSA/SHA-256 under the `veildesk.signing-authorization.v1` domain. The Solana
customer signature is separate and verifies the transaction's actual message.

## Narrow support and non-goals

Versioned transactions/lookup tables, Token-2022, token-account creation, delegates,
multisig, SOL transfers, swaps, compute-budget instructions, extra instructions and
arbitrary program calls are unsupported and rejected. Existing destination token
accounts are required. This is deliberately not a drop-in replacement for every
Pocket transaction builder; first-time-recipient account creation needs its own
reviewed policy before support. No policy means no signing.

The gate is a host-local library, not a key vault or sandbox. A service that keeps
another route to the raw signer can bypass it. A production integration must make
this gate the only path to the signing key, verify source/recipient account state,
use trustworthy cluster observations, and secure backup/recovery and enrollment.
It does not protect a leaked private key or a compromised host/decoder/signer.
Ceilings are per authorization, not aggregate daily budgets. No production security
certification or automatic wallet-theft prevention is claimed.

## Acceptance evidence

Tests create ephemeral fake wallet identities and real serialized Solana messages;
the sponsor callback returns a mock signature. No production keys, network/RPC
calls, wallet broadcasts, funds or new downloads are involved.

The vulnerable-pattern fixture has a token transfer of 20,700,000 units and a
522-unit treasury transfer with the sponsor as authority. Its compiled message
requires only one signer, reproducing the dangerous role overlap. The gate rejects
it before the sponsor callback. This reproduces the failure mechanism, not the
historical transaction or attacker identity.

The legitimate fixture requires two distinct signers: customer + sponsor. It passes
with a genuine ephemeral customer signature, exact allowed transfers and fixture
fee observation; the mock sponsor is called once. Restart/replay returns the same
result without another signing call.

Also tested: wrong agent signature, sponsor/customer confusion, wrong asset/source/
network/recipient, excessive token or fee amount, expiry during observation, extra
instructions, unsupported programs/versioned messages, missing customer signature,
modified wire contents, concurrent attempts, and ambiguous signer failure across
restart. Mutating a caller-owned authorization or callback byte buffer cannot
change what the gate verifies/signs.

```powershell
node --test tests/signing-gate.test.mjs
$env:VEILDESK_SOLANA_DEPENDENCY_ROOT='C:/Users/USER/Desktop/polydesk-veildesk-release'
node --test tests/signing-gate.test.mjs tests/solana-signing-gate.test.mjs
```

The second command uses the already installed `@solana/web3.js` 1.98.4 from that
checkout; it does not add a runtime dependency to VeilDesk. Without that explicitly
configured dependency root, the real-wire integration test is visibly skipped.

Next release gate: review this policy and adapter, integrate with a staging-only
signer using verified account/cluster observations, prove all signing paths are
gated, then separately authorize any production wallet integration.

### Recorded test result (28 October 2026)

Full suite with the real Solana decoder enabled: **92 passed, 2 optional checks
skipped, 0 failed** (94 total). After adding the explicit rejection of in-memory
signing ledgers, the six targeted gate/real-wire checks were rerun: **6 passed,
0 skipped, 0 failed**. Outputs: `output/signing-gate-full-tests.txt` and
`output/signing-gate-targeted-tests.txt`. These are local fixture results, not a
production signer audit or proof of the historical transaction's origin.
