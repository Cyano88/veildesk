# Connect a prediction-market application

VeilDesk v0.2 validates an authenticated, bounded preview mandate and returns an
encrypted, signed response tied to that same mandate. It does not verify that a
market exists, assess an outcome, create research or execute a trade. Keep that
boundary in your application's UI and authorization model.

## Connect to the live service

The relay and provider are live on Render. Obtain a dedicated enrolled client
configuration pointing to https://veildesk-relay.onrender.com; preserve its keys
and your persistent outbox. No Privy login or blockchain node is required.
Agents can use the [dependency-free MCP adapter](agent-mcp.md) with the existing
source/package. Application integrations can call the SDK directly.

The local pilot below is optional; it is not a requirement for cloud access.

## Install and run

Use Node 24.14.x. Extract the release ZIP, then install its local package in your
server application: `npm install /absolute/path/to/veildesk-0.2.0.tgz`.
This is a local package distribution, not a published npm registry package.
Copy `node_modules/veildesk/examples/prediction-market-client.mjs` into your app.
The example imports the public `veildesk/mandate-client` package export.

For an isolated local pilot, provision a NEW private directory with:
`node node_modules/veildesk/scripts/provision-relay.mjs /absolute/private/pilot`.
This creates an enrolled client and provider with pinned keys and tokens; it is
not permissionless signup. Keep private files outside the application checkout.
The initial principal is named polydesk for compatibility; the independent app
example works with that client configuration without depending on PolyDesk code.
Additional tenants require explicit operator enrollment in relay principals and
provider peers, with distinct keys/tokens. Never share one tenant's private config.

Start relay and worker in separate terminals using the appropriate configuration:

- `VEILDESK_RELAY_CONFIG=/absolute/private/pilot/relay.json` then
  `node node_modules/veildesk/scripts/relay-server.mjs`.
- `VEILDESK_PROVIDER_CONFIG=/absolute/private/pilot/provider.json` then
  `node node_modules/veildesk/scripts/provider-worker.mjs`.

Set `VEILDESK_CLIENT_CONFIG` to the absolute client.json path and
`VEILDESK_CLIENT_STATE` to an absolute persistent outbox directory. In PowerShell,
set variables with `$env:NAME='value'`; in a POSIX shell use `export NAME='value'`.
The default relay URL is local http://127.0.0.1:5181. For cloud operation use your enrolled Render configuration instead.

## Request contract

Generate a UUID once and preserve the exact request for retries:

```js
const mandate = {
  schema: 'veildesk.mandate.v1', id: crypto.randomUUID(),
  mode: 'dry_run', market: 'your-market-reference', side: 'YES',
  maxSpendUsd: '5.00', limitPrice: '0.5',
  expiresAt: Date.now() + 10 * 60 * 1000, approval: 'preview_only'
};
```

Save it to a private JSON file, then run:

```text
node prediction-market-client.mjs submit /absolute/private/mandate.json
node prediction-market-client.mjs get <job-id>
```

Poll get until completed, or stop at expiry/review/error. Handle queued and
processing states explicitly. After transport failure, retry submit using the
same UUID and unchanged fields: the persistent outbox reuses ciphertext. A changed
request under the same UUID is rejected. Do not erase reservations to force retry.
Only the authorized application caller should receive decrypted CLI output.

To integrate directly, import `createMandateClient` from `veildesk/mandate-client`,
construct it with the private config and persistent stateDirectory, then use
`submit(mandate)` and `get(id)`. Returned validation is never permission to trade;
`executionAuthorized` remains false. Keep config paths, tokens and keys server-side
and operator-controlled; never accept paths or identity keys from HTTP callers.

## Optional payment lane and release boundaries

Default provisioning is unpaid. The optional testnet-paid lane requires explicit
provider wallet settings, an enrolled paid capability and a client amount cap.
`submitPaymentHint(id,txid)` (example CLI: payment) reports an already-sent transfer;
it does not send funds. Read payment-lifecycle.md before configuring it. NU7
Ironwood verification is fixture-tested; real shielded settlement is still unproven.

The release ZIP also includes the exact PolyDesk TypeScript adapter, CLI and
integration documentation under polydesk/. They are an opt-in integration snapshot,
not the entire PolyDesk application or a public trade endpoint. Its CLI requires
the consuming project's tsx tooling. File hashes are recorded in the release.
