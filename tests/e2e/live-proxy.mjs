/*
 * live-proxy — single-origin bridge for the login→shell E2E (Gate G4).
 *
 * WHY THIS EXISTS
 * The compose `web` service (infra/docker-compose.yml) serves the built SPA via
 * nginx with an SPA fallback only — it does NOT proxy /api/* to the api service
 * (apps/web/Dockerfile inlines `location / { try_files ... /index.html }`). The
 * SPA's generated client talks to a RELATIVE base url `/api/v1` (apps/web
 * api-client.ts: `import.meta.env.VITE_API_BASE_URL ?? "/api/v1"`). So when the
 * browser loads the app straight from :5173, every /api/v1 call hits nginx and
 * gets index.html back — login can never reach the api.
 *
 * This tiny dependency-free reverse proxy puts the SPA and the api behind ONE
 * origin so the browser makes same-origin /api/v1 requests (no CORS, real bearer
 * flow): `/api/*` → the api (:3000, which already mounts contract routes under
 * /api/v1, see apps/api/src/app.ts), everything else → the compose web (:5173).
 *
 * It is E2E harness plumbing only (QA zone, tests/**): it does NOT change the
 * product. The missing nginx /api proxy in the compose image is a separate infra
 * gap owned by the apps/web + infra zones — flagged in the QA handoff, not fixed
 * here (apps/** is out of the QA zone).
 *
 * Targets and port are env-overridable; defaults match the compose dev stack.
 */
import http from "node:http";

const PORT = Number(process.env.PROXY_PORT ?? 5199);
const WEB = (process.env.PROXY_WEB_TARGET ?? "http://localhost:5173").replace(/\/$/, "");
const API = (process.env.PROXY_API_TARGET ?? "http://localhost:3000").replace(/\/$/, "");

/** /api/* → api service; everything else → the SPA (nginx). */
function upstreamBase(url) {
  return url.startsWith("/api/") ? API : WEB;
}

const server = http.createServer((req, res) => {
  const base = upstreamBase(req.url ?? "/");
  const target = new URL(req.url ?? "/", base);
  const proxyReq = http.request(
    target,
    { method: req.method, headers: { ...req.headers, host: target.host } },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`live-proxy upstream error (${base}${req.url}): ${err.message}`);
  });
  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[live-proxy] :${PORT} → SPA ${WEB} · /api/* → ${API}`);
});
