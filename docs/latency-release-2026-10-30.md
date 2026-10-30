# Latency release: 30 October 2026

The restricted mainnet research pilot remains the only recorded end-to-end paid
purchase. Its approximately 23-minute completion time has not been remeasured.
The public walkthrough remains a local browser demonstration, not paid enrollment.

## Deployed changes

- Provider runtime `9c55226ba7a2f9789a6e169e87557ee12551dcf1`, pinned by PolyDesk
  `7203fdcaf5f337e7872e881457bbdd9f3e31a8ef`, avoids one redundant recipient scan
  for funded native requests. Two fresh captures before research and two before
  final delivery remain required.
- Wallet worker `4cf4804a97c3f3f3a091a0e564d560edb54701e0` processes queued work
  before due maintenance and combines synchronization and status queries into
  one online CLI session. Offline recovery, persisted-height verification and
  native receipt checks remain in place.
- The buyer status watcher authenticates existing results without sending payment
  or creating a new request. A pending watch result is not a failed payment.

## Verification and limits

The wallet deployment became ready at 09:49:22 UTC. Its first online snapshot
stage took 57.401 seconds. Subsequent observed stages at 13:30 and 13:33 UTC took
55.859 and 54.196 seconds, with mainnet sync readiness, offline recovery and native
recipient verification passing. These are individual scan timings, not purchase
latencies or an availability guarantee.

The release test run passed 94 tests with two optional live checks skipped.
Read-only rechecks of the existing purchase authenticated its invoice, signed
receipt and 11,784-byte encrypted report, and returned identical content on replay.
The receipt's four confirmations describe original acceptance; replay did not
rescan the chain or make a new payment. Wallet/indexer trust remains unchanged.

No trade was submitted. This release does not establish OKX listing approval,
authorize extra ZEC charges on marketplace tasks, or enable automatic marketplace
progress messages. A newly authorized paid run is needed to measure full latency.
