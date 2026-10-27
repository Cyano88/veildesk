# VeilDesk relay API and operator runbook

Scope: `docs/product-scope.md`. This is a local single-host integration build. It is
not a deployed marketplace service. Node 24.14.x is the tested runtime; Node's
SQLite API remains experimental. No wallet or settlement endpoint is exposed.

## What an integrating app gets

An enrolled app sends an encrypted signed `prediction.mandate.validate.v1` request
to an enrolled provider. The provider validates the bounded preview-only mandate
and returns an encrypted signed `validated` or `rejected` result. Validation does
not check market existence, assess a prediction, settle payment or place a trade.

The relay authenticates bearer tokens and checks envelope structure, ownership,
expiry and idempotency. It cannot decrypt or authenticate the inner signature.
The provider and requesting app independently verify pinned keys and context.
Discovery keys are informational: do not replace pinned keys from discovery.

## Local provisioning and start

Choose a NEW private directory outside the repository whose parent exists. On
Linux, files are created owner-only. On Windows, mode bits do not enforce ACLs;
use a directory accessible only to the operator and verify its Windows ACL.

```powershell
node scripts/provision-relay.mjs C:\private\veildesk-pilot
$env:VEILDESK_RELAY_CONFIG='C:\private\veildesk-pilot\relay.json'
npm run relay
```

In a second terminal:

```powershell
$env:VEILDESK_PROVIDER_CONFIG='C:\private\veildesk-pilot\provider.json'
npm run provider
```

The provisioner creates an initial `polydesk` client and `veildesk-validation`
provider with separate encryption/signing keys. It is an operator-controlled
bootstrap, not remote identity verification. `relay.json` contains token hashes
and public keys; `client.json` and `provider.json` contain secret bearer tokens
and private endpoint keys. Distribute each only to its designated operator. Do
not mount either endpoint identity into the relay process/container.

The relay binds `127.0.0.1:5181`. `PORT` overrides the port. Non-loopback binding
requires `VEILDESK_BEHIND_TLS_PROXY=true`; this flag does NOT provide TLS. Expose
only an actual TLS reverse proxy and keep the underlying port private. SDK remote
URLs must use HTTPS; plaintext is allowed only for explicitly enabled loopback.

## HTTP contract

Except `/healthz`, every request requires `Authorization: Bearer <token>`.
Requests with bodies use JSON. The body limit is 16 KiB. Envelopes have exactly
`version,id,direction,ephemeralPublicKey,salt,iv,ciphertext`; binary fields use
canonical padded base64, with decoded lengths 65,32,12,4112 respectively.
Request IDs are lowercase UUIDs. The SDK also binds provider, capability and expiry
inside the authenticated ciphertext.

| Method / path | Caller | Contract |
|---|---|---|
| GET /healthz | Local supervisor | Database liveness only; not worker, payment or marketplace readiness |
| GET /v1/providers | Enrolled principal | Configured provider IDs, capabilities and public keys; not proof of availability |
| POST /v1/jobs | Client | `{id,provider,capability,expiresAt,envelope}`; expiry is UTC milliseconds, within one hour. 201 new, 200 identical retry, 409 conflicting ID |
| GET /v1/jobs/:id | Owning client | State and routing metadata; completed jobs include encrypted response. Other tenants receive 404 |
| POST /v1/provider/claim | Provider | Body `{}`. Atomically returns `{job}` or `{job:null}`; a job includes client ID and encrypted request |
| GET /v1/provider/pending | Provider | Up to 100 claimed jobs needing completion; recovery view, not authorization to repeat uncertain work |
| POST /v1/provider/deliver | Owning provider | `{client,id,envelope}`; immutable encrypted response. Identical retry succeeds; differing response returns 409 |

Errors: 400 invalid input; 401 invalid/revoked credential; 403 wrong role; 404
not found/not owned; 409 conflicting ID/delivery or unclaimed job; 413 too large;
429 pending/request quota; 503 storage capacity. Unexpected errors return generic
500 without echoing payloads or credentials. State transitions:

```text
queued -> processing -> completed
queued -> expired
```

Claimed work is never silently requeued. An expired claimed job may deliver an
explicit rejection or previously persisted result, with `late:true`; that never
confers execution authority. `executionAuthorized` is always false.

## App and provider integration

Import `createMandateClient` from `src/mandate-client.mjs`, providing private client
configuration and a persistent state directory. `submit(mandate)` persists the exact
ciphertext before sending. After a timeout retry the same mandate; do not create a
new ID. `get(id)` verifies provider identity, route, signature and the original
mandate digest before returning decrypted data to the authorized app.

The lower-level `preparePrivateJob` plus `relayClient` supports other adapters.
Persist the returned request before posting. `submitPrivateJob` is a convenience
for one attempt and generates fresh ciphertext; do NOT repeatedly use it for the
same job ID. Providers use `openPrivateJob` with their own independent client key
registry and `sealPrivateResult`; configure advertised capabilities only when an
actual handler exists. The bundled provider implements validation only.

PolyDesk's opt-in adapter is `api/veildesk-client.ts` in its separate checkout.
It is not wired into any public HTTP route or live trading path. The reference CLI
is `node --import tsx scripts/veildesk-client.ts submit <private-json-file>` then
`get <job-id>`. See PolyDesk's `docs/VEILDESK_INTEGRATION.md` for configuration.

## Persistence, recovery and quotas

SQLite uses WAL and FULL synchronous mode. Put it on one persistent LOCAL disk;
network-mounted SQLite and multi-region deployment are unsupported. Client outbox
and provider reservation/result directories must also persist across restarts.
The provider stores ciphertext and digest reservations, not decrypted mandates.
A completed encrypted result is saved before delivery, so a lost HTTP response
can retry the same ciphertext. A reservation without a result requires operator
reconciliation; do not delete it to force a rerun. Client outbox reservations can
have the same uncertain state after a crash and likewise require reconciliation.

Defaults: 1,000 queued/processing jobs per client, 100,000 total stored jobs,
600 authenticated requests per principal per minute. Configure `maxPending`,
`maxRecords`, `maxRequestsPerMinute` in relay.json. Exceeding total capacity blocks
new work without deleting replay history. Quotas are admission limits, not a
retention policy or proof of sustained-load capacity. Request-rate counters reset
on restart; enforce unauthenticated/IP rate limits and payload/time limits at the
TLS proxy. Pending provider recovery is limited to 100 rows per poll; a large
unresolved backlog requires operator intervention before further scale-up.

Token rotation/revocation: replace/remove the principal's token hash in relay.json,
then restart the relay. Existing connections are drained for up to five seconds.
Keep encryption/signing key versions available for outstanding jobs; changing
pinned identity keys changes the client namespace and requires a deliberate
migration. Automatic key rotation/enrollment is not implemented.

## Backup and restore

`node scripts/backup-relay.mjs <database> <new-backup-directory>` creates a consistent
SQLite snapshot using SQLite's backup API, verifies integrity and records SHA-256.
This backup contains only the relay database. Separately back up endpoint identity
files and client/provider state, encrypted and access-controlled. For a consistent
whole-service recovery checkpoint, stop the provider and relay before capturing
all files. Never copy a live SQLite main file without its WAL and call that a backup.

Restore into a NEW location with services stopped, verify the manifest checksum,
point relay.json at the restored database, preserve the service URL and pinned
keys, and restore matching endpoint state. Start the relay, then the provider.
Inspect pending reservations; never turn uncertain jobs into automatic execution.
The acceptance test exercises database restore with unchanged endpoint state; a
full machine-loss restore and encrypted-backup procedure remain deployment gates.

## Container packaging and release evidence

The Dockerfile runs as the `node` user and copies source only. Local build/runtime validation passed on 2026-10-27; deployment validation is still required. Mount relay.json read-only and a persistent `/data`
volume; configure its database as `/data/relay.db`. A typical command after build:

```sh
docker run --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  -p 127.0.0.1:5181:5181 -v veildesk-data:/data \
  -v /private/relay.json:/run/relay.json:ro \
  -e VEILDESK_RELAY_CONFIG=/run/relay.json -e VEILDESK_BIND=0.0.0.0 \
  -e VEILDESK_BEHIND_TLS_PROXY=true veildesk:0.1.0
```

Put TLS in front before remote access. Run endpoint workers separately with only
their own identities. Local relay container runtime and volume persistence passed; deployed TLS and live marketplace calls remain unverified. `npm run acceptance` saves timestamped, source-hashed results under
`output/`, including actual PolyDesk and independent-client process tests. It needs
the PolyDesk checkout (default sibling, or set `POLYDESK_ROOT`) and its installed
`tsx`. Payment tests in this suite are explicitly fixtures, not settlement evidence.

Testnet payment protocol additions are documented in `docs/payment-lifecycle.md`.
The default service remains unpaid; the paid pilot cannot issue an invoice against
an unsupported chain upgrade. New paid ledger/state files require protected backup.

## Payment-ledger recovery

Use `node scripts/payment-backup.mjs backup <payments.db> <new-directory>` to
capture a transactionally consistent SQLite payment-ledger snapshot, including
WAL contents. It verifies database integrity and schema, records row counts and a
SHA-256 checksum, and refuses an existing target directory.

Use `node scripts/payment-backup.mjs restore <backup-directory> <new-directory>`
to verify and restore into a fresh location. It never replaces an active database
or restarts services. A failed restore may leave a partial new directory; never
point a worker at it. Only use a restore that completed successfully.

Stop the provider and relay and quiesce clients before taking a coordinated
recovery checkpoint. Capture matching relay database, provider payment ledger,
provider reservation/result files, client outboxes and endpoint configurations.
Keep pinned identity keys and service URL consistent. The payment backup command
includes only the payment database: it does not back up wallet keys, endpoint
keys, client files or relay state, and it does not encrypt the output. Store these
sensitive records on protected storage with appropriate OS access controls.
Checksums detect corruption; they do not authenticate an attacker-modified backup.

Before starting a restored provider, reconcile the checkpoint with later relay
activity and the wallet's canonical chain. A stale checkpoint can omit reservations
created after it; checksums cannot detect rollback. Do not resume acceptance from
an old or mismatched checkpoint merely because its checksum passes. Preserve
uncertain/preparing reservations for manual reconciliation; never delete them to
force regeneration. A whole-machine-loss drill remains a deployment gate.

Local recovery tests restore the payment database into a new location after a
lost delivery response: identical ciphertext is retried, reorg evidence blocks
delivery, and interrupted result creation stays blocked. A client outbox copy
with the same identity preserves invoice/mandate binding and rejects a conflicting
payment hint. Wallet responses in these tests remain synthetic.

Encrypted offline directory checkpoints are now available via
`scripts/checkpoint.mjs`. See recovery-checkpoint.md for shutdown, path/size
restrictions, password handling, restore/reconciliation steps and test boundaries.
The process acceptance test restores endpoint keys and all captured service state
to a new directory, verifies completed-job replay and revoked access, and processes
queued work using the restored provider identity. This is local relocation;
independent-host and real wallet recovery remain open deployment gates.

## Worker scheduling and pending pagination

The worker now processes at most five newly claimed jobs per polling cycle and
reads pending jobs in pages of 20. Set claimBatch and pendingLimit in provider.json
(each integer 1..20) to lower or raise those bounds. Processing remains sequential;
existing durable reservation and payment-verification paths are unchanged.

GET /v1/provider/pending accepts limit (1..100, default 100) and after (the opaque
nextCursor returned by the previous response). Responses contain jobs and
nextCursor, null when traversal reaches the end. The cursor advances by stable
client/id ordering within the authenticated provider's processing jobs. It is a
scan position, not authorization or a snapshot. New arrivals behind the cursor
are revisited on the next sweep. Do not decode or construct cursors in clients.
Existing calls without query parameters remain supported.

A pending job that requires review does not prevent traversal to later pages or
bounded claiming of queued work. On HTTP 429 the worker stops that cycle and waits
60 seconds before retrying. Idle polling remains two seconds. Stop signals are
checked between jobs and during short backoff sleeps. Backlog traffic still
consumes configured per-principal quotas; batch tuning is not a bypass of limits.
No automatic deletion or regeneration of uncertain reservations was introduced.


## Streaming request limits and shutdown

The relay rejects declared bodies over 16 KiB immediately and rejects chunked
uploads as soon as received bytes exceed that limit. It no longer waits for an
oversized sender to finish. An authenticated request body must finish within
bodyTimeoutMs (default 10000; configurable integer 100..15000), otherwise the
relay returns 408. Early error responses close incomplete request connections.
Malformed/aborted bodies cannot create a job. Memory buffering stays capped.

Shutdown waits for valid in-flight requests, then force-closes remaining sockets
after five seconds. The regression test sends a valid partial upload alongside a
stalled upload, starts shutdown, finishes the valid upload, and verifies its
committed job and exact replay after reopening the database. It also checks early
413 for both declared-length and chunked oversized requests, 408 for a stalled
body, and successful requests after rejection. These local controls do not replace
TLS-proxy connection limits or establish resistance to distributed floods.
