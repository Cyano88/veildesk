# Combined wallet session

`syncWalletCycle` accepts `combinedSession: true` for an established wallet.
It verifies receiving identity and the encrypted recovery copy offline before
opening one online CLI session with startup `--waitsync`, then fixed `info`,
`sync status` and `quit` commands. A separate offline process reads the saved
height after the session exits. New wallets retain the original bootstrap path.

The parser requires exactly two JSON results and the quit acknowledgement.
Malformed, missing or extra output fails closed. Existing readiness checks still
reject the wrong chain, incomplete block/output scanning and a saved height below
the observed chain tip. A new block between synchronization and `info` can cause
a safe readiness failure; no stale-success fallback is used. Recovery checks,
exclusive wallet ownership and native receipt verification are unchanged.

On 2026-10-30 an isolated unfunded wallet on the Render host confirmed that the
pinned CLI supports piped commands. Two info queries shared one startup and took
48.7 seconds on reopening. Separate synchronized probes took 109.9 and 75.0
seconds, including startup and synchronization. The latter passed the production
parser and reported 100% block/output scanning with matching tip and wallet height.
Reopening that synchronized wallet completed in 68.2 seconds and again passed
the parser with complete scanning and matching height. These are diagnostic
timings, not paid-research end-to-end measurements.

Tests cover nested JSON, escaped strings, command failure output, missing results,
extra output, offline recovery ordering and rejection of stale persisted height.
The combined path is opt-in; the cloud worker enables it. Other callers retain
the original separate commands by default.
