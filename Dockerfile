FROM node:24.14.0-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/relay-server.mjs scripts/provider-worker.mjs scripts/provision-relay.mjs scripts/checkpoint.mjs scripts/payment-backup.mjs scripts/backup-relay.mjs scripts/payment-preflight.mjs scripts/mandate-client.mjs ./scripts/
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=5181
EXPOSE 5181
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:5181/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","scripts/relay-server.mjs"]

