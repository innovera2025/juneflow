# infra/ — เขต DevOps · อ่านราก `CLAUDE.md` + `PLAN.md` §0 (Design Fidelity Protocol) ก่อนเริ่มงานทุกครั้ง

## เขตความรับผิดชอบ (PLAN.md §8)
- `infra/` — ตำแหน่งหมุนเวียน (เข้า-ออกตามรอบงาน infra/CI)

## Docker Compose
- `docker-compose.yml`: **pg16 + redis + api + web + worker** — `docker compose up` เดียวได้ระบบครบ + seed
  (milestone Phase 0 — PLAN.md §5/§7)
- Deploy = Docker Compose บน **VPS Singapore** · Edge = Cloudflare DNS+CDN+WAF+rate limit+Turnstile (ภาคผนวก A)

## CI (GitHub Actions)
- **stage ของ CI ต้อง mirror 5 verification gates** (PLAN.md §9) ตามลำดับ:
  1. schema gate → 2. contract test → 3. unit business logic → 4. E2E Playwright → 5. visual gate
- CI config (`.github/workflows/*`) = **sacred file** — แก้ผ่าน blocker เท่านั้น
- Branch flow: `feature → dev (auto เมื่อ CI เขียว + diff-reviewer PASS) → main (Wei promote คนเดียว)` — **ห้าม commit main** · ด่าน 4.5 = subagent `.claude/agents/diff-reviewer.md` (PLAN.md §10)

## Secrets
- **ห้ามมี secret ใดๆ ใน repo** — ทุกค่าเข้าผ่าน env / secret store เท่านั้น · secrets = sacred (PLAN.md §10)

## Runbook
- ขั้นตอน runbook ทั้ง 3 เรื่อง — **deploy dev** · **promote main** (Wei คนเดียว) · **restore DB** → `.claude/skills/run-gates` (section "Runbook infra")
