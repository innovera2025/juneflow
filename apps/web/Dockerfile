# syntax=docker/dockerfile:1
# Juneflow web image — Vite build, served by nginx.
#
# Build context MUST be the repo root (a pnpm workspace install needs the whole
# monorepo):
#   docker build -f apps/web/Dockerfile .
#
# Consumed by infra/docker-compose.yml (published as ${WEB_PORT:-5173}:80) and by
# infra/docker-compose.prod.yml via ${WEB_IMAGE}, where it sits behind the `edge`
# reverse proxy with no published ports of its own.

# ---- base -------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# ---- deps: warm the pnpm store from the LOCKFILE + THE PIN ------------------
# Same reasoning as apps/api/Dockerfile, including why package.json is here: it
# carries the `packageManager` pin, and without it this stage and the next run
# different pnpm versions — with the next one fetching its pinned pnpm from the
# registry, defeating the `--offline` on the line below.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm fetch --store-dir=/pnpm/store

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline --store-dir=/pnpm/store
# VITE_API_BASE_URL is BAKED AT BUILD TIME — Vite inlines import.meta.env into
# the bundle, so it cannot be changed by a runtime environment variable on the
# container. Override it only when the API lives on a different origin, and
# expect to rebuild to change it.
#
# The default is spelled out here rather than left to a fallback in
# api-client.ts, because `ARG X` + `ENV X=${X}` does NOT leave X unset when the
# arg is not passed: Docker substitutes the empty string and `ENV` DEFINES it.
# Vite then inlined "" and every request lost its prefix, hitting the origin
# root where nginx's SPA fallback answered index.html with 200 — the app served
# its shell and no data. Measured on the image built from aba803f: 0
# occurrences of "/api/v1" in the bundle. api-client.ts now also treats a blank
# value as absent, so the two guards are independent.
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter @juneflow/web build

# ---- serve ------------------------------------------------------------------
FROM nginx:1.27-alpine AS serve
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# The official image runs envsubst over /etc/nginx/templates/*.template at start
# and writes the result into /etc/nginx/conf.d/. Replacing the packaged default
# is deliberate: leaving it in place would keep a second server block listening
# on the same port.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=http://api:3000

# Still root, and stating why rather than claiming otherwise: binding port 80
# needs a privileged port, and moving to 8080 would mean changing this image,
# infra/docker-compose.yml AND the prod Caddyfile — which is NOT in this repo
# (docker-compose.prod.yml mounts it from ${EDGE_CONFIG_DIR} on the host). A
# port change here would break prod ingress through a file no one reviewing this
# diff can see. nginx already drops its worker processes to the unprivileged
# `nginx` user; only the master stays root.

EXPOSE 80

# Hits the exact-match /healthz above, so a broken app cannot answer green via
# the SPA fallback. wget is in the base alpine image; no extra layer.
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
