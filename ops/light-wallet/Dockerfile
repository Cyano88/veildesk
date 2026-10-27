FROM node:24.14.1-bookworm-slim AS node
FROM ubuntu:24.04
RUN apt-get update -qq && apt-get install -y --no-install-recommends ca-certificates curl libssl3 libsqlite3-0 libstdc++6 util-linux && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ARG WALLET_RELEASE=wallet-kit-bfb0a21-v1
RUN mkdir -p /opt/veildesk-wallet && cd /opt/veildesk-wallet && \
    curl -fLsS "https://github.com/Cyano88/veildesk/releases/download/${WALLET_RELEASE}/wallet-kit.tar.gz" -o kit.tar.gz && \
    curl -fLsS "https://github.com/Cyano88/veildesk/releases/download/${WALLET_RELEASE}/wallet-kit.tar.gz.sha256" -o kit.sha256 && \
    echo "f8d65345681dbc4d99d210992bf545424879ec6e437e887fcb0713fe340ad5ac  kit.tar.gz" | sha256sum -c - && tar -xzf kit.tar.gz && rm kit.tar.gz kit.sha256 && \
    test "$(cat source-commit.txt)" = bfb0a2156819ea7f75a9b09b1724abfd06c8925e && chmod 700 zingo-cli nym-proxy
RUN curl -fLsS https://github.com/Cyano88/veildesk/releases/download/wallet-evidence-bfb0a21-v1/veildesk-evidence -o /opt/veildesk-wallet/veildesk-evidence && \
    echo "4fbeab26d309c3dfe10acdfc5c7f5bb0912e2672b6679f4981e3a4f1b422e0e1  /opt/veildesk-wallet/veildesk-evidence" | sha256sum -c - && \
    chmod 700 /opt/veildesk-wallet/veildesk-evidence
COPY src ./src/
COPY scripts/light-wallet-worker.mjs ./scripts/
ENV ZINGO_NYM_PROXY=/opt/veildesk-wallet/nym-proxy
# No network listener, wallet RPC, spend command or publicly exposed port.
CMD ["flock","--no-fork","/var/data/veildesk-wallet-process.lock","node","scripts/light-wallet-worker.mjs"]
