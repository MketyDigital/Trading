FROM node:22-bookworm-slim

WORKDIR /probe
COPY cloudflare-v2/package.json ./package.json
COPY cloudflare-v2/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --no-audit --no-fund

COPY cloudflare-v2/scripts/check_staging_postgres_connection.mjs ./cloudflare-v2/scripts/check_staging_postgres_connection.mjs
COPY cloudflare-v2/scripts/apply_trading_postgres_migrations.mjs ./cloudflare-v2/scripts/apply_trading_postgres_migrations.mjs
COPY cloudflare-v2/scripts/trading_data_snapshot.mjs ./cloudflare-v2/scripts/trading_data_snapshot.mjs
COPY cloudflare-v2/scripts/cloudflare_d1_snapshot_database.mjs ./cloudflare-v2/scripts/cloudflare_d1_snapshot_database.mjs
COPY cloudflare-v2/scripts/trading_snapshot_import_runner.mjs ./cloudflare-v2/scripts/trading_snapshot_import_runner.mjs
COPY cloudflare-v2/scripts/run_trading_snapshot_import.mjs ./cloudflare-v2/scripts/run_trading_snapshot_import.mjs
COPY cloudflare-v2/src/security ./cloudflare-v2/src/security
COPY cloudflare-v2/src/execution/account_symbol_catalog.js ./cloudflare-v2/src/execution/account_symbol_catalog.js
COPY cloudflare-v2/src/normalization/trading_normalizer.js ./cloudflare-v2/src/normalization/trading_normalizer.js
COPY docs/supabase-trading-schema-snapshot-2026-10-17.json ./docs/supabase-trading-schema-snapshot-2026-10-17.json
COPY cloudflare-v2/db/d1-migrations ./cloudflare-v2/db/d1-migrations
COPY cloudflare-v2/db/postgres-migrations ./cloudflare-v2/db/postgres-migrations
COPY ops/coolify-staging-postgres-probe/probe.mjs ./probe.mjs

EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD node -e "const req=require('http').get('http://127.0.0.1:3000/health',res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));req.setTimeout(2000,()=>{req.destroy();process.exit(1)})"
USER node
CMD ["node", "probe.mjs"]
