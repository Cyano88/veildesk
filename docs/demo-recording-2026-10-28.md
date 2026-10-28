# Recorded demo evidence - 2026-10-28

The operator recorded real browser interactions and command results using the Playwright skill. No result was staged in the browser. The local evidence console is an operator tool, not the deployed customer UI.

Recorded checks:

- Independent local buyer/provider authenticated encryption and replay: passed.
- Actual PolyDesk research engine with synthetic receipt evidence and controlled market/model inputs: passed. Wrong memo blocks research; encrypted report delivery and one model call across restart replay are asserted.
- Live Render provider-to-wallet bridge: passed at 02:16:39 UTC. Tracked recipient and authenticated response verified; unknown payment remained awaiting_payment. No payment or trade was accepted.

Operator artifacts under `output/playwright/`:

- `veildesk-demo-2min.mp4`: captioned, silent two-minute demo edit.
- `veildesk-demo-2min.webm`: same edit without burned captions.
- `veildesk-demo.srt`: editable captions/narration outline.
- `veildesk-evidence-live.webm`: uncut 3m25s evidence-console recording.
- `veildesk-live-integration.webm`: live PolyDesk documentation recording.
- `verified-results.png`, `evidence/`, `evidence-manifest.json`, `README-evidence.md`: results, timestamped command output and integrity/provenance records.

The edit contains 15 seconds of documentation, 65 seconds from the check recording's beginning and its last 40 seconds. The wait is visibly shortened using the on-screen UTC clock and explained in captions. Raw footage is preserved. SHA-256 manifests provide integrity checks, not independent attestations.

No seed, bearer token, wallet recovery secret or private recipient address is included in the selected recording. No new compiler, wallet binary or video dependency was downloaded to the PC. Existing Playwright and FFmpeg installations were used.

This is evidence of implemented components. It is not proof of a real funded shielded purchase. Paid capability stays disabled until an actual buyer payment and encrypted research delivery complete. Intended providers see decrypted requests; network metadata and public trades are not made private. Do not present the fixture-backed engine test as live settlement.
