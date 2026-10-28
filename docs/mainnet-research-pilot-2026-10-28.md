# Mainnet private research pilot — 2026-10-28

PolyDesk owns the research engine, Tavily retrieval and direct 0G inference configuration. The existing Render provider worker now deploys from the PolyDesk repository. It loads a pinned VeilDesk runtime; VeilDesk supplies authenticated encrypted requests, invoice binding, receipt verification, durable payment-note reservations and encrypted report delivery. The public PolyDesk application is unchanged by this worker deployment.

The pilot advertises `polydesk.research.mainnet-paid.v1` only to the enrolled independent buyer. Other enrolled clients retain public validation access but cannot discover or invoke this capability. The invoice requests 20,000 zatoshis. Its operator-configured lifetime is 45 minutes, always bounded by the authenticated request deadline. Trade execution remains disabled and requires separate authorization.

Verification now allows a chain tip to advance between native wallet captures only when the second verified chain retains every previously observed block and the same payment note, mining height and block hash. A changed retained block, missing note or reorg still fails. This avoids starving valid confirmations on slow network connections.

Release checks: 85 tests passed, two optional integration checks skipped; an additional test with the real PolyDesk research engine and controlled external inputs passed. Live PolyDesk research returned AVAILABLE. Live wallet bridge preflight authenticated the recipient and returned awaiting_payment for an unknown transaction. These checks do not prove a paid purchase.

The cloud buyer has a separately backed-up mainnet wallet. Operator payment preparation checks the authenticated invoice binding, fresh shielded balance, exact 20,000-zatoshi amount, quoted wallet fee and fresh USD price against the user's one-dollar service-plus-fee cap. An offline signed transaction must pass native shielded-only inspection before any separately invoked broadcast. Exclusive attempt records prevent automatic resending after uncertain outcomes. Buyer funding is not counted as a completed service payment.

Live acceptance completed at 2026-10-28T09:15:01.239Z. The independent buyer paid 20,000 zatoshis plus a 10,000-zatoshi network fee (0.0003 ZEC total, approximately $0.394 at the checked quote). VeilDesk authenticated the invoice and payment hint, verified the exact recipient note and finality, reserved one note, and delivered PolyDesk's 11,784-byte encrypted research report. The signed receipt records four confirmations. The buyer verified the report digest and fetched an identical result on replay. Both executionAuthorized and tradeSubmitted remain false.

The real flow exposed slow/intermittent wallet freshness checks. Those checks delayed delivery but were not bypassed; the final result arrived before the invoice deadline. This is one successful controlled mainnet purchase, not a throughput, availability, anonymity or independent-security certification. A consistent provider ledger snapshot containing one job and one note was copied off-host; it is not a coordinated whole-service recovery checkpoint.

Live footage, the sanitized result and artifact hashes are kept under ignored output/playwright. Private addresses, credentials, invoice memo and transaction identifiers stay outside public footage. The payment and research were real; earlier fixture-based videos remain separately labeled.

Trust boundary: the service provider decrypts its authorized request; the wallet and configured indexer are trusted for chain observations. Encryption does not hide endpoint IP addresses or timing and does not make public prediction-market trades anonymous. Provider compute policy is not independently verified by VeilDesk.
