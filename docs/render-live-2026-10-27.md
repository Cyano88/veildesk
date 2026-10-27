# Render deployment evidence: 2026-10-27

Public source: https://github.com/Cyano88/veildesk

Live relay: https://veildesk-relay.onrender.com

Runtime commit: `cff6dee5cff84f8381a074f87195cf8b7ca40565`.
Both services reported live from Render's authenticated API. Each uses Node
24.14.1, one Starter instance in Oregon, a separate 1 GB persistent disk at
`/var/data`, and manual deployment. Endpoint identities are supplied as private
Render secret files and excluded from Git. Neither service depends on a laptop
or WSL runtime.

| Resource | Identifier |
| --- | --- |
| Relay | `srv-dbg4ad59el5s73bs0v5g` |
| Relay deploy | `dep-dbg4add9el5s73bs10i0` |
| Provider | `srv-dbg4afh42hec73di4bs0` |
| Provider deploy | `dep-dbg4afp42hec73di4d3g` |

## Live acceptance

At 06:35:38 UTC an enrolled SDK client submitted a signed, encrypted synthetic
preview mandate over public HTTPS. The Render provider processed it, and the
client verified the response signature, decryption and original mandate contents.
The test required a completed, validated result with `executionAuthorized: false`,
`tradeSubmitted: false` and `paymentVerified: false`.

- Public `/healthz` returned HTTP 200 with status `ok`.
- Missing and invalid bearer tokens received HTTP 401.
- Exact resubmission returned the identical verified result.
- Both services were restarted. Render recorded `server_restarted` events at
  06:35:55 and 06:35:56 UTC. The relay briefly returned HTTP 502 during restart.
- At 06:36:35 UTC, the original result was retrieved and its hash matched the
  value recorded before restart. A fresh mandate completed and replay matched.

This verifies live transport, enrolled endpoint authentication, cloud processing,
result integrity and relay result persistence across a service restart. It is not
a sustained uptime test, independent security audit, or proof of provider ledger
recovery under every crash condition. Local acceptance previously passed 44 tests;
the live checks above are separate from that fixture coverage.

## Available scope

`prediction.mandate.validate.v1` provides private preview validation for enrolled
applications. The public repository includes the server-side SDK and integration
example. Enrollment remains operator managed. The provider can decrypt authorized
mandates; the relay handles encrypted payloads and routing metadata.

No real market was verified and no funds or trades were sent. Shielded ZEC
settlement, cloud wallet provisioning, marketplace billing and OKX.AI listing
remain pending. Public source availability does not imply marketplace approval.

This deployment covers the VeilDesk relay and provider. It does not establish
that the separately deployed PolyDesk application has been configured as a live
enrolled client. See [deployment operations](render-deployment.md) for integration
storage and identity requirements.
