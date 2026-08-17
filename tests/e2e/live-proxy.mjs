/*
 * live-proxy — single-origin bridge for the login→shell E2E (Gate G4).
 *
 * WHY THIS EXISTS
 * The compose `web` service (infra/docker-compose.yml) serves the built SPA via
 * nginx. When this bridge was written, that config had an SPA fallback ONLY and
 * did not proxy /api/* to the api service, so every /api/v1 call from the
 * browser came back as index.html with status 200 and login could never reach
 * the api. Since aba803f the config — which lives in apps/web/nginx.conf.template,
 * NOT inlined in the Dockerfile — also carries
 * `location /api/ { proxy_pass $api_upstream$request_uri; }`, so the compose web
 * origin can now reach the api on its own. This bridge is still wired in
 * (playwright.config.ts + smoke.spec.ts) and still guarantees the single origin
 * regardless of how the web image is configured.
 *
 * The SPA's generated client talks to a RELATIVE base url (apps/web
 * api-client.ts: `resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL)`, which
 * defaults to `/api/v1` and treats a blank override as absent — B-410). So
 * whatever serves the app must also answer that prefix.
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
