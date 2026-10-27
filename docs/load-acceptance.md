# Bounded local load acceptance

Run `node scripts/load-acceptance.mjs` to create isolated fixture identities and a
private temporary database, start a separate loopback relay process, and exercise
300 authenticated preview jobs in batches of 10, paced at one batch per second.
The harness decrypts and verifies every completed result. It invokes the actual
provider processing function concurrently in the load generator; it does not
measure the production polling worker's throughput or a deployed TLS endpoint.

The run sets pending capacity to 32, total records to 364, and request quota to
100000/minute. The raised request quota isolates queue/storage behavior and is
not a recommended production configuration. Production defaults remain unchanged.
It verifies pending-capacity 429, drain and continued work, storage-capacity 503,
all completed and queued records after restart, idempotent replay at capacity,
SQLite integrity and absence of a known plaintext payload marker in the relay DB.

A timestamped JSON report under output includes runtime/host information, workload
duration, HTTP latency percentiles and status counts, record size and relevant
source hashes. HTTP latency covers individual RPC calls; job throughput includes
crypto, disk writes and the intentional pacing. These measurements are observed
local results, not maximum capacity, production SLAs or independent benchmarks.

This experiment does not certify long-duration soak behavior, concurrent shutdown,
unauthenticated flood resistance, proxy limits, retention, networked storage,
production worker scheduling, live payments or marketplace traffic. Existing
request-rate and body-limit regression tests cover their respective local cases.

## Observed run: 2026-10-27

Evidence: output/load-acceptance-2026-10-27T05-53-48-124Z.json. Passed on Windows,
Node 24.14.1, Intel i5-10210U. The paced 300-job workload took 30.22 seconds
(9.93 jobs/s). Across 1727 HTTP calls, 1725 succeeded and exactly two expected
quota failures occurred (429 and 503). HTTP p50 was 41.3 ms, p95 140.9 ms and p99
215.7 ms. All 364 stored records remained retrievable after relay restart; database
integrity and completed-request replay at full capacity passed. The database was
3899392 bytes. These are local observations under the configuration above.

## Production worker backlog acceptance

Run `node scripts/worker-acceptance.mjs` for separate relay and actual worker
processes. It submits 120 authenticated preview mandates, preclaims 105, creates
one precise interrupted-work reservation, then starts the worker with default
claimBatch=5 and pendingLimit=20. It requires 119 authenticated validated results,
including the 15 initially queued requests, while the uncertain job remains
processing. The request quota is raised for observation polling, so this is a
bounded scheduling/correctness test, not a production rate-limit throughput claim.
The report includes runtime, elapsed time and source hashes. Wallets and payments
are not involved; paid-path regressions remain covered by synthetic receipt tests.

Observed 2026-10-27: the production worker completed and authenticated 119 results
in 15.41 seconds from the mixed backlog; the deliberately uncertain reservation
remained blocked. Evidence: output/worker-acceptance-2026-10-27T06-00-15-624Z.json.
All 41 regression tests passed, including pending cursor validation, tenant
isolation beyond 100 pending jobs, bounded claiming and rate-limit propagation.
