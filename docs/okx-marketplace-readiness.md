# OKX AI marketplace preparation

Prepared 28 October 2026. Not registered, submitted for review, activated or deployed by this change. The Solana signing-gate extension remains outside this branch and outside the listing.

## Exact product boundary

VeilDesk provides authenticated encrypted coordination, request-bound invoices, shielded ZEC settlement verification and encrypted delivery. PolyDesk supplies research. The paid pilot completed; public self-service enrollment and native marketplace ZEC checkout have not been established.

The candidate package adds public, credential-free integration metadata at `/agent-integration.json`, instructions at `/agent-integration.md`, an OpenAPI contract, and a standalone encrypted HTTP client. These are integration resources, not a callable paid service or proof of marketplace acceptance. They become public only after deployment.

## Current platform requirements

Checked against the official [A2MCP guide](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp) and [registration guide](https://web3.okx.com/onchainos/dev-docs/okxai/registerasp).

- A2MCP accepts deployed public HTTPS APIs or compatible hosted MCP endpoints. Valid calls must return complete business results within 180 seconds.
- Callers must not be asked to supply sensitive credentials such as API tokens, private keys or seeds. The existing enrolled relay's bearer-authenticated job API is not directly suitable for this listing contract.
- Free endpoints return the actual advertised result. Paid A2MCP uses x402; A2A uses the marketplace's negotiated task flow and escrow. No verified native ZEC checkout integration exists here.
- The current MCP adapter is local stdio and preview-only. Do not register it as a hosted paid research endpoint.
- The 23-minute pilot cannot be represented as synchronous 180-second service delivery. Returning a job ID alone is not the advertised completed research result.

## Draft identity for owner review

Name: **VeilDesk**

Description: **Private coordination for agents buying services: authenticated encrypted requests, shielded Zcash settlement and encrypted delivery. PolyDesk is the first demonstrated research provider. Enrollment is currently operator-managed.**

Avatar: the existing VeilDesk logo, subject to owner selection/upload. Never modify PolyDesk's identity, service listings or avatar.

No prices or registration fields have been submitted. Listing scope and pricing require owner agreement before validation/registration.

## Two launch paths

### Narrow first listing: integration and onboarding

Proposed service name: **Private Agent Integration**. Type: **A2A**. Proposed fee: **Free**, requiring owner agreement.

Draft description: **Help agent developers integrate VeilDesk's encrypted request and response protocol with dedicated identities, pinned provider keys and separate payment authorization. Provide your public integration requirements and requested capability, not credentials or private briefs. Delivery is an integration plan and an enrollment decision; successful approved enrollment includes a verified preview round trip. This service does not include paid research, ZEC purchases, trading, a security audit or automatic access to the pilot.**

This is a bounded onboarding service, not a rebranding of free onboarding as paid private commerce. Before activation, verify the A2A communication runtime and fulfill a real task through the advertised flow. Do not require an undisclosed external payment to complete a free task. Do not collect private transaction intent in marketplace chat.

### Full private service access

Before advertising unattended paid coordination, implement and accept-test dedicated buyer onboarding, provider enrollment/revocation, agreed marketplace payment semantics, and a complete deliverable within the marketplace's chosen service contract. Preserve client-side encryption and do not share pilot credentials. Test an independently enrolled buyer through the actual marketplace invocation, including wrong-tenant access, retries, expiry, payment review and delivery verification. Keep ZEC service settlement distinct from marketplace billing; no double charging or unverified shielded-checkout claim.

## Reproducible checks

```powershell
npm test
$env:POLYDESK_ROOT='C:/Users/USER/Desktop/polydesk-veildesk-release'
node scripts/test-encrypted-http-polydesk.mjs
node scripts/check-marketplace-surface.mjs
```

The final command makes only read-only, unauthenticated requests to the production VeilDesk origin. It reports public integration resource availability and whether provider discovery remains protected. It always distinguishes surface readiness from listing readiness, and never sends a payment, creates a task, enrolls a tenant or reads a private config. A successful surface probe cannot approve a listing.

## Release sequence

### Preparation evidence

The candidate passed 90 tests, with 2 optional tests skipped and zero failures. The separate encrypted HTTP integration against PolyDesk's actual research engine passed 2 tests with controlled external inputs and synthetic settlement. These are local integration results, not new mainnet transactions or marketplace task acceptance.

A read-only production probe confirmed the public page returned 200 and unauthenticated provider discovery returned 401. The candidate integration JSON and Markdown resources returned 401 because they are not deployed. The OpenAPI request did not complete successfully in that probe. Therefore public integration surface readiness remains false. The local probe test passes all five checks against the candidate server and rejects missing resources, accidentally public discovery, invalid JSON and oversized responses.

The marketplace CLI's required update downloaded and verified its checksum but Windows denied replacing its executable. No identity creation, update, activation or marketplace task was attempted. Resolve that administrative issue before registration.

1. Agree exact service scope and pricing; review the VeilDesk identity and logo.
2. Deploy and verify the public integration package after reviewing its changes.
3. Complete the appropriate live marketplace deliverable acceptance, without private payloads in chat.
4. Validate the exact listing, confirm the final fields, register the separate VeilDesk ASP and complete review/activation.
5. Claim availability only when the listing and intended service can actually be used. Base marketplace expansion remains future work.
