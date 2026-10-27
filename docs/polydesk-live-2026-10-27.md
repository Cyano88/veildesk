# PolyDesk production integration: 2026-10-27

PolyDesk now exposes the VeilDesk SDK through authenticated HTTP endpoints:

- POST https://polydesk.trade/api/veildesk/previews
- GET https://polydesk.trade/api/veildesk/previews/:id
- Guide: https://polydesk.trade/docs/veildesk

This uses the SDK, not the read-only skill or MCP discovery tool. The SDK's
seven-module client import graph is vendored at VeilDesk runtime commit
cff6dee5cff84f8381a074f87195cf8b7ca40565. PolyDesk authenticates Privy tokens,
reserves job ownership before transport, and restricts reads to the owner.
PolyDesk sees the plaintext mandate over HTTPS before encrypting it for the
provider. This is not browser-to-provider encryption.

## Deployment

PolyDesk commit: e8c2c6e6ea899cf68589c2d8c55003e8b32d6c3c.
Render service: srv-d97i10eq1p3s73erav5g.
Render deploy: dep-dbg5lg2jnfac739m56o0, live at 08:05:32 UTC.
Dedicated relay principal: polydesk-app, separate from the earlier acceptance
client. Private keys are stored in a Render secret file, never the public repo.
Owner records and encrypted outbox use /var/sibyl/veildesk on PolyDesk's existing
disk. No additional paid service or disk was created.

The release was prepared from current origin/main in the separate worktree
C:/Users/USER/Desktop/polydesk-veildesk-release. The original PolyDesk checkout and
its unrelated uncommitted changes were preserved; it was not reset or rebased.

## Verified evidence

- Production build and server typecheck passed.
- Eight focused tests passed; the opt-in live case is skipped in the default suite.
- The live case passed separately using the dedicated client, real SDK, relay and
  provider, including signed encrypted result verification and replay.
- Ownership tests cover other-user reads, conflicting IDs, API recreation,
  concurrent claims and uncertain transport. Errors do not echo private input.
- At 08:14:14 UTC, production discovery reported previewApi.enabled true;
  missing and invalid tokens received HTTP 401 with Cache-Control: no-store;
  /docs/veildesk returned HTTP 200.

The live SDK/HTTP test injects user identities at the authentication boundary.
It does not prove successful production sign-in with a real Privy user's token.
That final user acceptance check is still required. No browser submission UI,
shielded payment, trade or OKX.AI listing was added or demonstrated.

## Private operator continuity

The local protected bundle private/render-live-20261027 contains the dedicated
polydesk-app-client.json and the active relay.json/provider.json with both clients
enrolled. The before-polydesk files preserve the initial configuration. Do not
replace the active configurations with those initial files during future deploys.
