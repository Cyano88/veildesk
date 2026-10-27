# VeilDesk by PolyDesk: hackathon demo

## Submission description

VeilDesk is a developer preview for private coordination between prediction-market agents. It encrypts and signs a bounded, preview-only mandate for an intended provider, authenticates the reply, and persists replay reservations. Its testnet Zcash receipt verifier binds an invoice to the authenticated mandate and checks recipient-note evidence against a node's canonical chain. PolyDesk exposes discovery and envelope structure validation; it does not accept settlement or trade execution.

The working demo uses two local processes with pinned keys bootstrapped through an owned IPC channel. Payment verification is tested with synthetic RPC responses using the installed Zallet schema. A real shielded testnet payment has NOT been completed. This is an integration prototype, not deployed private trading or an anonymity guarantee.

## Reproduce in two minutes

Requires Node 22+; no dependencies for standalone VeilDesk.

```powershell
cd C:\Users\USER\Desktop\veildesk
node scripts/hackathon-demo.mjs
```

The runner fails if the coordination demo or any test fails, and writes timestamped results to `output/hackathon-evidence.json`. To explore the separate browser encryption preview, run `npm start` and open `http://127.0.0.1:5180`. The browser preview is a local encryption demonstration, not the two-process or payment flow.

## Recording script

0:00-0:20: "VeilDesk by PolyDesk protects an agent's mandate in transit and binds payment evidence to that authenticated request. This preview does not execute trades."

0:20-0:50: Run the command above. Point out `independentProcesses`, sender and receipt authentication, and replay returning the existing receipt. Explain that requester and provider are separate local processes, not discovered remote identities.

0:50-1:20: Show the receipt test results: exact recipient, amount and memo checks; transparent/mixed-pool rejection; sync and active-chain checks; duplicate/replay handling; expired mandate and late-payment review. Say explicitly: "These payment cases use fixtures; they are not blockchain transaction receipts."

1:20-1:40: Show `src/zallet-receipt.mjs` and the PolyDesk discovery response's unavailable capabilities. Every receipt keeps execution authorization false. A payment does not broaden a preview mandate into trading authority.

1:40-2:00: "Next acceptance is a real shielded testnet payment. Local Zebra and Zallet are syncing; a remote backend probe reached testnet but failed on rate limits and timeouts. Providers still see decrypted mandates, network metadata remains visible, and any eventual public market trade remains public."

## Evidence and limitations

- `scripts/demo.mjs`: working two-process authenticated request/reply and replay demonstration.
- `tests/zallet-receipt.test.mjs`: synthetic recipient-note and mandate-binding cases.
- `docs/zallet-openrpc.json`: public RPC schema captured from the installed wallet, not transaction evidence.
- `docs/testnet-setup.md`: wallet setup and acceptance blockers.
- `docs/audit-2026-10-25.md`: security boundaries and unfinished work.
- PolyDesk integration lives separately in `../polydesk/api/veildesk.ts` and `../polydesk/scripts/veildesk.test.ts`.

Do not claim mainnet settlement, a completed shielded testnet payment, verified remote enrollment, automatic trading, production deployment, an OKX listing, or independent audit certification. Confirm event eligibility, deadline and submission requirements with the organizer; this package does not establish them.

