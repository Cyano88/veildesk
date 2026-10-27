# Agent access through MCP

VeilDesk's core service does not require Privy or another consumer login provider.
An operator enrolls each application or agent with separate endpoint keys and a
relay bearer credential. Its own app decides how to authenticate human users.
PolyDesk's existing HTTP facade uses Privy; this direct MCP client does not.

## Run without installing dependencies

Use the existing VeilDesk source/package with Node 24.14.x. No npm install,
blockchain node, wallet synchronization, MCP SDK package or browser login is needed.
The small stdio adapter runs alongside the agent and calls the HTTPS relay and
provider already hosted on Render. It is not a public hosted MCP URL.

Set operator-owned absolute paths:

```json
{
  "mcpServers": {
    "veildesk": {
      "command": "node",
      "args": ["/absolute/path/to/veildesk/scripts/mcp-server.mjs"],
      "env": {
        "VEILDESK_CLIENT_CONFIG": "/absolute/private/client.json",
        "VEILDESK_CLIENT_STATE": "/absolute/persistent/veildesk-agent-outbox"
      }
    }
  }
}
```

Use your own enrolled client configuration pointing to
`https://veildesk-relay.onrender.com`. Enrollment is operator-managed; there is no
self-service signup yet. Never copy another application's credentials. Pin the
provider keys in the client configuration, protect the outbox, and retain both
across restarts. Tool arguments cannot change URLs, paths or keys. HTTPS is
required and paid capabilities are refused by this adapter.

On Windows use absolute paths with escaped backslashes or forward slashes. The
agent host may run on a server, including Render; only the client adapter runs
where the agent runs. Service processing does not depend on a developer laptop.

## Tools

| Tool | Purpose |
| --- | --- |
| `veildesk_capabilities` | Inspect scope and whether config paths were supplied; does not prove remote health. |
| `veildesk_submit_preview` | Submit a signed encrypted preview; returns job ID and state. |
| `veildesk_get_preview` | Retrieve a job from the same client's outbox and verify its signed encrypted result. |

Submit arguments are `{ "mandate": { ... } }`, using exactly the mandate schema
in [the integration guide](integrator-quickstart.md). Keep a single UUID and all
fields unchanged for retries. Get arguments are `{ "id": "<same UUID>" }`.
Poll get at a moderate interval until completed or expired. An uncertain transport
failure does not mean the job was never accepted; keep the outbox and reconcile
rather than creating an automatic replacement.

The provider validates preview mandate structure, expiry and bounds. Validation
is not market verification, research, payment or trade authorization. Results
retain `executionAuthorized: false`. There are no payment or trading tools.

## Privacy

Obtain authorization before disclosing a mandate to the provider. The MCP host
and its model see the tool arguments and decrypted result. They may retain them
in conversation history. The adapter encrypts transport payloads to the provider;
the relay sees routing metadata. This does not provide anonymity or hide public
trades. Restrict host logs and transcript sharing. Private config, tokens and
error traces are never returned as tool content. Stdout is exclusively JSON-RPC;
its valid tool results can contain private mandates and must not be sent to
shared logs.

## Protocol and verification

The adapter supports the MCP `2025-06-18` initialize/initialized lifecycle and
newline-delimited stdio messages. A newer discovery probe receives an explicit
supported-version response so clients can use legacy negotiation. Messages are
limited to 16 KiB and handled serially. Unsupported methods and tools are rejected.
No claim is made of supporting the 2026 stateless protocol or Streamable HTTP.

References: [lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle),
[tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools),
[stdio transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

Run `node --test tests/mcp.test.mjs`. Set `VEILDESK_MCP_LIVE_CONFIG` to an existing
private enrolled configuration to enable the real Render test. On 2026-10-27,
all six MCP tests passed with that live case enabled: the subprocess submitted a
mandate, verified the completed response, restarted with its persistent outbox,
retried the identical mandate and retrieved the same verified result. No payments,
trades, consumer login or new downloads were involved.

PolyDesk's older `scripts/veildesk-mcp.ts` remains discovery-only. Configure this
standalone `scripts/mcp-server.mjs` for functional agent submission and retrieval.
