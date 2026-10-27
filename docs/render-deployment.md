# Render deployment

Live target: Render Oregon. This replaces the earlier laptop-runtime assumption.
Local commands/tests are preparation and acceptance tooling, not live dependencies.

The validated render.yaml declares veildesk-relay (web) and veildesk-provider
(background worker), each Starter with a separate 1 GB disk mounted at /var/data.
Both use Node 24.14.1, one instance and manual deploys. Render terminates public
TLS. The provider uses the relay HTTPS URL; the relay cannot decrypt mandates.

scripts/render-start.mjs requires a real /var/data mount before creating state.
It reads its role-specific secret JSON from VEILDESK_CONFIG_JSON or the secret
file /etc/secrets/veildesk.json. It rewrites durable paths and writes a private
runtime config under /tmp. It never generates replacement endpoint identities at
startup. Relay: /var/data/relay.db. Provider: /var/data/provider-state.

Provision a fresh deployment identity bundle once with provision-relay.mjs in a
protected directory outside source control. Upload only relay.json to the relay,
only provider.json to the worker, and give client.json to the enrolled application.
Never put the client private key on the relay. Back up identities separately and
keep the provider state disk across deploys. Set VEILDESK_RELAY_URL on the provider
to the actual deployed HTTPS endpoint before startup. Client outboxes belong to
the integrating application's persistent storage, including PolyDesk on Render.

Initial live capability: prediction.mandate.validate.v1. This is authenticated
private preview validation, not market research or trading. Paid ZEC settlement,
marketplace billing and listing remain disabled until their acceptance gates pass.
The live service must not connect to WSL, a developer laptop or a loopback proxy
running on a developer machine. A future paid provider requires a compatible
cloud-hosted wallet/backend and protected transport; generic hosted RPC alone
cannot decrypt incoming shielded notes.

Deployment acceptance: public HTTPS health; unauthenticated API rejected; enrolled
client submits, provider processes and client verifies original mandate digest;
foreign tenant denied; exact retry returns identical result; redeploy/restart
preserves relay DB and provider state. Observe deployment logs without printing
keys, bearer tokens or plaintext mandates. Verify persistent mounts and complete
these checks before advertising the service as live or listing it on OKX.AI.

Render persistent disks are single-instance; deployments have brief downtime.
Backups must be coordinated across the two separate services and client state.
Do not claim multi-region failover or zero-downtime deployment.
