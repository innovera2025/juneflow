# syntax=docker/dockerfile:1
# Juneflow API image - Fastify server + BullMQ worker (same image, different CMD).
# Build context MUST be the monorepo root:
#   docker build -f apps/api/Dockerfile .
# TODO(P0-BE-13): finalize alongside the full Fastify app skeleton.
# TODO(P0-DEV-01): devops zone wires this into infra/docker-compose.yml
#   (pg16 + redis + api + web + worker, single `docker compose up` + seed).

# ---- base: node 22 + pnpm via corepack --------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- build: install workspace deps + compile TypeScript ---------------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Compile @juneflow/db to dist/ FIRST: the prod deploy packs it under
# node_modules, where node refuses to type-strip raw .ts
# (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Its `default` export
# condition resolves the compiled JS at runtime (P0-FIX-08 / B-033).
RUN pnpm --filter @juneflow/db build
RUN pnpm --filter @juneflow/api build
# Self-contained production deploy of @juneflow/api (prod deps only).
# Includes @juneflow/db with its built dist/ so `node dist/index.js` boots.
RUN pnpm --filter @juneflow/api deploy --prod /out

# ---- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
COPY --from=build /app/apps/api/dist ./dist
EXPOSE 3000
# API server (default). Worker service overrides CMD with:
#   ["node", "dist/worker.js"]
CMD ["node", "dist/index.js"]
