# Mainnet service payment operator

These are deliberately separate operator commands for the controlled 20,000-zatoshi research pilot, not a public payment API or an autonomous wallet. The wallet, recipient, approved invoice and independent backup must already be provisioned. Run only on the wallet host under the buyer's exclusive OS lock.

1. Save the invoice returned by `createPaidResearchClient.get` as `/var/data/veildesk-mainnet-buyer/service-authorization.json`, with its verified `invoiceHash` and `requestHash`. Never substitute a caller-provided unsigned quote.
2. Complete a fresh buyer scan and record its shielded-only balance as `ready-to-propose.json` using the operator readiness helper. The receipt worker never sends funds.
3. Invoke `prepare-invoice-transaction.mjs`. It validates the fixed amount and remaining invoice time, obtains the actual CLI fee, checks a fresh USD price against a one-dollar service-plus-fee budget, reserves the attempt, signs offline and inspects the actual transaction with the native exporter. It contains no broadcast command.
4. Recheck the authenticated invoice is still pending. Only then invoke `broadcast-invoice-transaction.mjs` under the same exclusive lock. It rechecks the binding, price, budget and native shielded-only transaction, and fsyncs an exclusive attempt record before transmitting that exact transaction ID.
5. After a verified broadcast result, submit the txid as an authenticated encrypted payment hint through the buyer client. A broadcast is not a verified receipt or completed service purchase.

The wallet RPC is never exposed. Recovery secrets are never arguments or stdout. Private diagnostic files can contain invoice or transaction details and must stay private. The scripts require the pinned CLI/native exporter already installed on the cloud host. They download no wallet binaries or chain data onto the operator PC.

If either attempt record already exists, stop and reconcile it. Never remove a record to force another send. A timeout after transmission is uncertain, not proof of failure. A signed but unbroadcast transaction remains live value in flight; preserve its wallet and records. These tools intentionally do not implement automatic refunds, retries, arbitrary amounts or multi-user spending.

Funding the buyer is separate from this service-plus-fee budget. The budget's quoted USD conversion is evaluated at signing and transmission; it is not a promise about later market prices.
