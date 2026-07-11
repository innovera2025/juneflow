---
name: merge-worktree
description: Merge a zone agent's worktree feature branch per the Juneflow review flow (PLAN.md §10) - preconditions (5 gates green + diff-reviewer PASS), push feature branch for CI auto-merge into dev, sync the worktree back onto dev, clean up merged branches/worktrees. Never merge to main (Wei promotes alone). Trigger keywords - merge worktree, merge branch, worktree, feature branch, auto-merge, dev branch, sync dev, cleanup branch, รวม branch, ล้าง worktree.
---

# merge-worktree — รวมงานจาก worktree เข้าตาม flow `feature → dev → main`

> Flow เดียวที่อนุญาต (PLAN.md §10): `feature/<เขต>` → `dev` (auto เมื่อ CI เขียว + diff-reviewer PASS)
> → `main` (**Wei promote คนเดียว — ห้าม agent merge/push เข้า main ทุกกรณี**)
> หนึ่ง agent = หนึ่ง worktree = หนึ่ง feature branch (PLAN.md §8 · `scripts/loop-config.json`)

## 1) Preconditions — ครบก่อน push เท่านั้น

1. Gates ครบ 5 เขียวในเครื่อง (`.claude/skills/run-gates`)
2. **ด่าน 4.5 ผ่านแล้ว:** subagent `diff-reviewer` ตัดสิน **PASS** — FAIL = ห้าม push, task กลับ rework
3. Loop bookkeeping ครบ: `TASKS.md` (status → `review`) · แถวใน `REVIEW-QUEUE.md` · journal ของเขต
4. Diff สะอาด: ไม่มี sacred files · ไม่มีไฟล์นอกเขตตัวเอง · ไม่มี secrets/`.env`

## 2) Push เพื่อ auto-merge เข้า dev

```bash
git -C <worktree> push -u origin feature/<เขต>   # ห้าม --force ทุกกรณี
```

- CI เขียวบน feature branch → auto-merge เข้า `dev` อัตโนมัติ (`.github/workflows/ci.yml`)
- CI แดง → แก้ใน worktree เดิมแล้ว push เพิ่ม — ห้าม rewrite history ที่ push แล้ว

## 3) Sync worktree กลับมาบน dev ล่าสุด (ก่อนเริ่ม task ถัดไป)

```bash
git fetch origin
git -C <worktree> merge origin/dev    # เอา dev ล่าสุดเข้า feature branch ของตัวเอง
```

- Conflict เฉพาะไฟล์ในเขตตัวเอง → แก้เองได้ · conflict แตะไฟล์นอกเขต/sacred → หยุด เขียน `BLOCKERS.md`

## 4) Cleanup (เฉพาะ branch ที่ merge เข้า dev แล้วจริง)

```bash
git branch --merged dev               # ตรวจก่อนเสมอว่า merge แล้วจริง
git worktree list
git worktree remove <path>            # เฉพาะ worktree ที่จบงานและไม่มี diff ค้าง
git worktree prune
git branch -d feature/<เขต>           # ใช้ -d เท่านั้น (ห้าม -D บังคับลบ)
```

- มี diff ค้างใน worktree = ยังไม่จบ — ห้าม remove · ไม่แน่ใจ → ปล่อยไว้แล้วบันทึก journal
- ห้ามลบ branch `dev` / `main` · ห้ามใช้ `rm -rf` ลบ worktree เอง (ใช้ `git worktree remove` เท่านั้น)
