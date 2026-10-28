# VeilDesk by PolyDesk

**Private, authenticated agent-service requests with shielded Zcash settlement and encrypted delivery.**

An agent should be able to buy a useful service without publishing its request or payment relationship. VeilDesk provides signed encrypted coordination, invoices bound to the authorized request, payment-note reservation, and authenticated encrypted results. **PolyDesk is the first working service provider**: an independent buyer agent purchased real prediction-market research using shielded ZEC on mainnet.

**[Try the public walkthrough](https://veildesk-relay.onrender.com/) · [Watch the two-minute demo](https://veildesk-relay.onrender.com/demo.mp4) · [Read the judge guide](docs/judge-guide.md) · [Inspect the evidence summary](https://veildesk-relay.onrender.com/evidence/mainnet-pilot.json)**

## What is real

The controlled mainnet purchase completed on **28 October 2026 at 09:15:01 UTC**:

| Check | Recorded result |
| --- | --- |
| Buyer | Independent, operator-enrolled agent |
| Service | Real PolyDesk market research |
| Shielded payment | 0.0002 ZEC service amount + 0.0001 ZEC network fee |
| Request binding | Authenticated invoice and signed payment hint bound to the request |
| Settlement | Native recipient-note verification; receipt records four confirmations |
| Delivery | 11,784-byte research report, authenticated and decrypted by the buyer |
| Replay | Repeated retrieval returned the identical authenticated result |
| Trading | Neither authorized nor submitted |

See the [mainnet pilot record](docs/mainnet-research-pilot-2026-10-28.md), [native receipt boundary](docs/native-wallet-receipts.md), and [sanitized acceptance summary](web/evidence/mainnet-pilot.json). The public summary is an **operator acceptance report**, not an independently verifiable public chain proof. It omits addresses, transaction IDs, invoice memos, credentials, and the research contents. The video includes a recorded read-only recheck of the existing purchase; it does not make another payment.

Wallet freshness checks delayed delivery to approximately **23 minutes after broadcast**. They were not bypassed. This is one successful pilot, not a production availability, throughput, or independent-security certification.

## Try it without funds

Open the [public walkthrough](https://veildesk-relay.onrender.com/). Enter a request, sign and encrypt it, then try changing its ciphertext, sender key, or request ID. These checks execute the real VeilDesk encryption/signature modules using temporary browser keys.

**The interactive sandbox runs both endpoints in your browser.** It sends no brief to PolyDesk, generates no research, and transfers no money. It is separate from the recorded cloud/mainnet pilot. No wallet, login, or production credentials are required. Refresh discards the demo keys.

To run it locally with **Node 24.14.x**:

```sh
npm start
# Open http://127.0.0.1:5180
npm test
```

The relay/SDK has no npm runtime dependencies. Wallet operators use the separate [cloud wallet runtime](docs/cloud-wallet-runtime.md); client applications do not need a local blockchain node.

## How a paid service request works

1. **Authorize:** an enrolled buyer signs the service request, deadline, and explicit execution limits.
2. **Encrypt:** the request is encrypted to the pinned provider key. The relay transports ciphertext; the authorized provider decrypts its own request.
3. **Invoice:** the provider issues an authenticated invoice bound to the request. The buyer validates its terms and separately authorizes the payment.
4. **Settle:** a shielded ZEC payment is checked against the exact recipient note, amount, memo, chain evidence and confirmation requirement. Durable note reservation protects against payment reuse.
5. **Deliver:** the provider returns a signed encrypted receipt and report chunks. The buyer authenticates, decrypts and checks the report digest. Retries retrieve the same completed result.

**Paying for research never authorizes a trade.** Execution requires separate authorization and no trade was submitted in the pilot.

## Who uses it

- **Buyer-agent developers:** request services with explicit limits and verifiable, encrypted responses.
- **Service providers:** expose paid capabilities while binding each payment to its authorized job.
- **Prediction-market applications:** use PolyDesk research as a service without automatically exposing the request or authorizing execution.

PolyDesk owns research, retrieval and inference configuration. VeilDesk owns the coordination and payment-verification boundary. VeilDesk does not independently attest the provider's computation.

### Integration status

| Surface | Current scope |
| --- | --- |
| HTTPS relay + SDK | Cloud deployed; operator-managed enrollment and pinned endpoint keys |
| Paid PolyDesk research | Working mainnet pilot restricted to its enrolled buyer |
| MCP adapter | Preview mandates only; no paid-research tools or automatic ZEC sending |
| Additional service providers | Planned enrollment and service-adapter work |
| OKX AI marketplace | Not listed; external ZEC payment compatibility still requires validation |

Start with the [integrator quickstart](docs/integrator-quickstart.md), [relay API](docs/relay-api.md), and [MCP preview adapter](docs/agent-mcp.md). The paid SDK entry point is `createPaidResearchClient` in `src/mandate-client.mjs`; the bounded operator payment tools are in `ops/mainnet-service/`. The public browser demo does not grant access to the private paid capability.

## Signing policy candidate (not deployed)

A separate [authorization-gate candidate](docs/signing-authorization-gate.md) checks a signed agent approval and the actual Solana transaction message before invoking a mock sponsor signer. It demonstrates sponsor/customer separation, exact transfer limits and durable one-time authorization. It is not connected to live wallets and does not extend research or preview approvals into trading authority.

## Privacy and trust boundaries

- Requests and responses use authenticated envelopes with P-256 ECDH/ECDSA, HKDF-SHA256 and AES-256-GCM. Payloads are padded to 4,096 bytes and bound to request ID, direction and recipient.
- The authorized provider sees its decrypted request. The buyer sees the decrypted result. Endpoint compromise can expose keys and plaintext.
- The relay can observe routing metadata, timing and traffic volume. This is **not network anonymity**, and it does not make public-market trades anonymous.
- The wallet and configured indexer are trusted for chain observations. A signed provider receipt is not a public zero-knowledge proof.
- There has been no independent security audit. Broader enrollment, wallet latency, failure recovery and marketplace compatibility remain rollout work.

## Tests and evidence

The recorded mainnet release passed **85 tests**, with **two optional checks skipped**. The selected test rerun shown in the video passed **12**, with **one optional integration check skipped**. These are distinct runs. Automated payment tests use controlled fixtures; they are not substitutes for the separately recorded real payment.

```sh
npm test
npm run demo
npm run acceptance
```

`npm run demo` and `npm run acceptance` are local rehearsals, not new mainnet payments. The [judge guide](docs/judge-guide.md) maps each claim to its source and describes reproducibility without exposing private keys or sending funds.

Earlier audit and testnet documents are dated historical checkpoints. The [28 October mainnet record](docs/mainnet-research-pilot-2026-10-28.md) supersedes their statements that real settlement was still pending.
