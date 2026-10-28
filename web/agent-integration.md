# Integrate an agent with VeilDesk

VeilDesk transports authenticated encrypted requests and results. PolyDesk owns research generation. Paying for a service does not authorize a trade.

This is an integration guide, not an offer of permissionless paid access. The paid PolyDesk capability currently serves its enrolled pilot buyer. VeilDesk is not yet listed on OKX AI or Base's marketplace ecosystem.

## Before connecting

1. Request a dedicated enrollment from the VeilDesk operator through https://x.com/UseVeilDesk. Share only your intended capability and public integration requirements. Do not send a private research brief, wallet seed, private key or API token in marketplace chat.
2. Provision separate signing and encryption identities in the buyer runtime. Agree provider public-key fingerprints with the operator through a trusted channel. A key returned by an untrusted endpoint is not proof of provider identity.
3. Receive the dedicated relay credential through the operator's private enrollment channel. Keep it in your runtime secret store; never put it in marketplace tool arguments or logs. Do not copy the pilot buyer's configuration.
4. Request only approved capabilities. Enrollment does not authorize payment, arbitrary providers, research inference or trading.

## Choose an interface

- HTTPS: the OpenAPI contract is at `/openapi.json`. Sign and encrypt locally, then submit the envelope to `POST /v1/jobs`; poll `GET /v1/jobs/{id}` and verify/decrypt results locally. Do not send plaintext briefs to the relay.
- JavaScript: use `createMandateClient` or `createPaidResearchClient` from the repository. Retain the private outbox across restarts.
- MCP: run `scripts/mcp-server.mjs` alongside your agent with operator-owned configuration paths. This stdio adapter supports preview validation only. It is not a hosted marketplace MCP endpoint and cannot send payments.

Full protocol: https://github.com/Cyano88/veildesk/blob/main/docs/encrypted-http.md

## Paid research lifecycle

The enrolled buyer submits an encrypted request, verifies the provider's signed invoice and request binding, and obtains separate approval for a bounded shielded ZEC payment. After an approved wallet sends the payment, the buyer submits an encrypted payment hint. The provider verifies settlement before returning an authenticated encrypted report.

Preserve the same request ID and prepared ciphertext when retrying. After an uncertain payment outcome, reconcile the original transaction; never automatically send a replacement. Payment review is not permission to execute. Verify the report digest and receipt before using results. Research never becomes trading authorization.

The completed pilot used 20,000 zatoshis for the service and 10,000 for its network fee. These historical values are not current quotes. Its roughly 23-minute delivery delay is not a service-level guarantee. Do not map this lifecycle to an OKX pay-per-call purchase until the marketplace payment and delivery contract has been verified.

## Privacy boundaries

The provider sees the request it is authorized to service. The agent host sees its local tool inputs and decrypted outputs. The relay sees routing, size and timing metadata. Wallet and indexer observations are trusted. VeilDesk does not hide public trades, provide network anonymity, attest research quality, or guarantee prevention of wallet exploits.

Never use marketplace chat as a substitute for the encrypted request channel. Public marketplace identities, service descriptions, prices and task metadata are outside VeilDesk's confidentiality boundary.
