# Judge and integrator guide

## Start here

- Working public walkthrough: https://veildesk-relay.onrender.com/
- Two-minute video: https://veildesk-relay.onrender.com/demo.mp4
- Sanitized recorded acceptance: https://veildesk-relay.onrender.com/evidence/mainnet-pilot.json
- Source: https://github.com/Cyano88/veildesk

The public page requires no wallet or account. Sign/encrypt a request, inspect its ciphertext, and run the three tamper/context rejection checks. The browser uses the production encryption/signature modules with temporary local identities. Both endpoints run in the same tab: this interaction does not invoke paid PolyDesk research or send a payment. The real cloud/mainnet run is presented separately as recorded evidence.

## Claim-to-evidence map

| Claim | Implementation / record | What it does not prove |
| --- | --- | --- |
| Authenticated private request | `src/authenticated.mjs`, `src/envelope.mjs`, interactive browser checks | Network anonymity or endpoint security |
| Invoice/payment bound to service request | `src/mandate-client.mjs`, `src/paid-provider.mjs`, mainnet pilot record | Permission to trade |
| Exact native recipient-note verification | `src/light-wallet-receipt.mjs`, `src/settlement.mjs`, `docs/native-wallet-receipts.md` | Trustless public verification independent of wallet/indexer |
| Durable note reservation and idempotent delivery | Provider payment ledger and paid-lifecycle tests | General distributed exactly-once execution |
| Real research, encrypted delivery | `src/artifact.mjs`, PolyDesk-hosted research integration, 11,784-byte recorded report | Independent provider-compute attestation |
| Completed mainnet purchase | `docs/mainnet-research-pilot-2026-10-28.md`, `web/evidence/mainnet-pilot.json` | Production availability or a new payment by each viewer |
| Broader agent access and OKX AI | Roadmap only | A completed marketplace listing or unrestricted onboarding |

## Read the recording correctly

The video combines procedural animation, synthetic neural narration, and recordings of actual Node.js process output streamed to a local browser console viewer. They are real process recordings, not native PowerShell window captures. The read-only recheck retrieves the original completed job from the deployed relay. The buyer authenticates/decrypts the invoice, signed receipt and report chunks, compares the report digest with the original, and retrieves an identical result again. It does not send funds or perform a fresh independent chain scan. Four confirmations refers to the original accepted receipt.

The test segment is a real selected test run with controlled fixtures: 12 passed, 1 optional check skipped. The recorded release-suite total was 85 passed with 2 optional checks skipped. Test fixtures are explicitly separate from the mainnet payment.

The original purchase took approximately 23 minutes after broadcast because of wallet freshness checks. The film is an edited explanation, not a two-minute settlement claim. Addresses, transaction identifiers, invoice memo, buyer credentials and private research remain outside the public evidence.

## Reproduce public checks

With Node 24.14.x, run `npm start` and visit http://127.0.0.1:5180. Run `npm test` for automated checks. `npm run demo` and `npm run acceptance` exercise local rehearsal paths and do not transmit mainnet transactions. Some optional integration checks require explicitly configured external components and otherwise skip.

The private mainnet buyer is not a public demo account. Replaying its paid-result fetch requires the owner's enrolled keys and persistent buyer state; they are not published. A new buyer requires operator enrollment and a separate spending authorization. The existing MCP adapter is preview-only. See `docs/agent-mcp.md` and `ops/mainnet-service/README.md`.

## Privacy boundary

VeilDesk hides application payloads from the relay and uses shielded ZEC for the demonstrated payment. It does not conceal authorized requests from their service provider, endpoint IP addresses, timing or traffic volume. Wallet/indexer chain observation is trusted. The public acceptance JSON is an operator report, not a public cryptographic receipt proof. No independent security certification is claimed.
