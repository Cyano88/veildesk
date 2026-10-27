# Offline encrypted recovery checkpoint

This tool captures a dedicated private directory containing relay/provider/client
configuration, endpoint private identities, tokens, databases and client/provider
state. It is for small single-host installations (64 MiB source limit), on the
same OS/path convention. It is not a Zallet wallet backup or a production DR
certification. Keep wallet seeds and encryption identity backups in the wallet's
separate recovery process.

1. Stop the provider and relay, then stop all client writers. Verify all writers
   are stopped; the tool cannot prove this. A second file scan detects changes
   during capture but does not replace an offline checkpoint.
2. Put all state and endpoint configurations in the dedicated private root.
   Managed relay.json database and provider.json stateDirectory paths must remain
   inside it. Include every client's outbox and preserve identity versions. Files
   outside the root are not captured. Inventory these before backup; the tool
   cannot infer missing client directories or validate deployment completeness.
3. Cleanly checkpoint any SQLite WAL left after an abnormal shutdown, with all
   writers stopped. The tool refuses nonempty WAL files. Do not delete WAL files
   to get past this check. Use SQLite's checkpoint operation or a verified SQLite
   backup of the stopped database.
4. Supply a strong unique password through VEILDESK_CHECKPOINT_PASSWORD (never a
   command-line argument or committed file), then run:

   `node scripts/checkpoint.mjs backup <private-root> <new-file.enc> --services-stopped`

5. Preserve the password separately in protected recovery storage. The artifact
   uses scrypt-derived AES-256-GCM authenticated encryption with fresh random
   salt and nonce. No credentials are printed. Protect temporary plaintext files
   and Windows directory ACLs; POSIX mode bits are not a Windows ACL policy.
6. Restore with the same password:

   `node scripts/checkpoint.mjs restore <file.enc> <new-private-root>`

   Authentication and file checks happen before creating the destination. Existing
   destinations are refused. An I/O failure can leave a partial new directory;
   never use a failed restore. No service is started automatically.
7. The tool rewrites only database/stateDirectory in files named relay.json or
   provider.json. Service URLs, pinned keys, tokens and encrypted envelopes remain
   unchanged. Set the client CLI state path to its restored outbox. Reconfigure
   external wallet RPC/cookie paths separately and run payment preflight before
   enabling paid work. Arbitrary application paths are not automatically migrated.
8. Reconcile the checkpoint time with later activity before resuming. Authenticated
   encryption detects modification, not rollback to a valid older checkpoint.
   Check relay/provider/client consistency and reconcile uncertain reservations.
   Start relay, then provider only after that review. Never operate both old and
   restored writers against the same service identity.

## Acceptance evidence

The process test stops the service, checkpoints SQLite, encrypts the entire local
fixture installation, and restores into a new directory. Real relay/provider
processes then use the restored keys and state. PolyDesk reads the same completed
result, an exact retry stays completed, queued work completes with execution
unauthorized, and revoked-client access stays rejected. Separate payment tests
exercise restored note reservations, reorg checks and uncertain-result blocking
with synthetic wallet responses. Password errors, tampering, nonempty WAL,
external managed paths and overwrite attempts are rejected.

These are local same-host relocation tests. Independent-host recovery, backup
retention/access controls, password-loss recovery and real wallet settlement
remain deployment acceptance gates.

## Packaged Linux container recovery (2026-10-27)

`ops/container-recovery-acceptance.py <npm-package.tgz>` extracts the npm artifact
into an isolated build context and builds its Dockerfile. It runs two disposable
containers as uid 1000, with read-only root filesystems, dropped capabilities,
no-new-privileges and no external network. The first provisions fixture endpoints,
completes an authenticated job, queues another and creates an encrypted checkpoint.
The second receives the checkpoint and nonsecret fixture expectations, restores
into a fresh tmpfs directory, verifies the original result and completed retry,
and processes the queued request using the restored identity.

Ten assertions passed on Node 24.14.0. The report records the exact package hash,
image digest and test-harness hash in output/container-recovery-acceptance.json.
This tests the artifact's bundled provisioning, relay, worker and recovery commands;
no local source checkout is used as the application runtime. Test fixtures and
password are ephemeral. Wallet state and live paid settlement are excluded.
Both containers run on the same Docker host: separate-host/network/TLS deployment
and real-wallet recovery remain unverified.
