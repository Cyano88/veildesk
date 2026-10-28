#!/bin/sh
set -eu
case "${VEILDESK_WALLET_NETWORK:-test}" in
 test) lock=/var/data/veildesk-wallet-process.lock ;;
 main) lock=/var/data/veildesk-mainnet-recipient.lock ;;
 *) echo 'Unsupported wallet network' >&2; exit 1 ;;
esac
exec flock --no-fork "$lock" node scripts/light-wallet-worker.mjs
