# syntax=docker/dockerfile:1
# Juneflow API image — Fastify server + BullMQ worker (same image, different CMD).
#
# Build context MUST be the monorepo root:
#   docker build -f apps/api/Dockerfile .
#
# Consumed by infra/docker-compose.yml (migrate-seed, api and worker all build or
# reuse this image) and by infra/docker-compose.prod.yml via ${API_IMAGE}, which
# expects a CI-built ref rather than a local build.

# ---- base: node 22 + pnpm via corepack --------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- deps: warm the pnpm store from the LOCKFILE ALONE -----------------------
# `pnpm fetch` reads pnpm-lock.yaml and nothing else, so this layer is invalidated
# by a dependency change and by no other edit. Before this, `COPY . .` came before
# the install, which meant editing one line of one route re-resolved and re-
# downloaded the entire workspace on every single build.
FROM base AS deps
COPY pnpm-lock.yaml ./
RUN pnpm fetch --store-dir=/pnpm/store

# ---- build: install workspace deps + compile TypeScript ---------------------
FROM deps AS build
COPY . .
# --offline: everything is already in the store from the deps layer, so a network
# hiccup here can no longer produce a half-installed build.
RUN pnpm install --frozen-lockfile --offline --store-dir=/pnpm/store
# Compile @juneflow/db to dist/ FIRST: the prod deploy packs it under
# node_modules, where node refuses to type-strip raw .ts
# (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Its `default` export
# condition resolves the compiled JS at runtime (P0-FIX-08 / B-033).
RUN pnpm --filter @juneflow/db build
RUN pnpm --filter @juneflow/tax-engine build
RUN pnpm --filter @juneflow/bank-file build
RUN pnpm --filter @juneflow/notifications build
RUN pnpm --filter @juneflow/api build
# Self-contained production deploy of @juneflow/api (prod deps only).
# Includes @juneflow/db with its built dist/ so `node dist/index.js` boots.
RUN pnpm --filter @juneflow/api deploy --prod /out

# ---- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Runs as the `node` user (uid 1000), which the base image already provides.
# The API listens on 3000 — above 1024, so no capability is needed to bind it —
# and writes nothing to disk at runtime (uploads go to R2 through a presigned
# URL, logs go to stdout), so an unwritable /app is a feature rather than a
# constraint to work around.
COPY --from=build --chown=node:node /out .
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
USER node
EXPOSE 3000

# Mirrors the healthcheck infra/docker-compose.prod.yml already declares, so the
# image is self-describing and `docker compose` in DEV — which declares none for
# this service — gets one too. PORT is honoured because index.ts reads it
# (`Number(process.env.PORT ?? 3000)`); a compose file that moves the port keeps
# a working probe instead of a probe that silently checks the wrong one.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "const p=process.env.PORT??3000;fetch('http://127.0.0.1:'+p+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# API server (default). The worker service overrides CMD with:
#   ["node", "dist/worker.js"]
CMD ["node", "dist/index.js"]
