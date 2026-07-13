# apps/web - build (Vite) + serve (nginx)
# Build context MUST be the repo root (pnpm workspace install needs the whole monorepo):
#   docker build -f apps/web/Dockerfile .
# TODO(P0-DEV-01): wired into infra/docker-compose.yml (pg16 + redis + api + web + worker).

# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @juneflow/web build

# --- serve stage ---
FROM nginx:1.27-alpine AS serve
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# SPA fallback: every unknown path serves index.html (client-side routing via TanStack Router).
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
