#!/usr/bin/env python3
"""Apply a Phase-4 i18n round to BOTH sacred dict copies, byte-identically.

Usage:
    python3 agents/orch-b-recon/apply-i18n-round.py <round.apply.json> [--write]

Without --write : dry-run (validates, prints counts, touches nothing).
With    --write : appends the round's keys to
                  docs/extract/i18n-full.json  AND  packages/i18n/src/i18n-full.json
                  as dict[key] = {th,en,zh,ar} all equal to the verbatim 'th'.

SACRED WRITE (PLAN.md §0). Run only under a Wei-approved override
(B-105 subcon/accept · B-106 pm) recorded in BLOCKERS.md. Preserves exact
byte format (json.dumps indent=2, ensure_ascii=False, no trailing newline)
and guarantees both copies stay md5-identical.
"""
import json, sys, hashlib

COPIES = ["docs/extract/i18n-full.json", "packages/i18n/src/i18n-full.json"]

def md5(path):
    return hashlib.md5(open(path, "rb").read()).hexdigest()

def dump(path, obj):
    # byte-exact to the source format (verified round-trip identical, no trailing \n)
    open(path, "w", encoding="utf-8").write(json.dumps(obj, indent=2, ensure_ascii=False))

def main():
    if len(sys.argv) < 2:
        sys.exit("usage: apply-i18n-round.py <round.apply.json> [--write]")
    apply_path = sys.argv[1]
    write = "--write" in sys.argv
    a = json.load(open(apply_path, encoding="utf-8"))
    newkeys, override = a["dict"], a.get("override")

    if md5(COPIES[0]) != md5(COPIES[1]):
        sys.exit("ABORT: dict copies differ BEFORE apply — reconcile first.")
    d = json.load(open(COPIES[0], encoding="utf-8"))
    already = [k for k in newkeys if k in d["dict"]]
    if already:
        sys.exit(f"ABORT: {len(already)} keys already present, e.g. {already[:5]}")
    empties = [k for k, v in newkeys.items() if not str(v).strip()]
    if empties:
        sys.exit(f"ABORT: empty th for {empties[:5]}")

    before = len(d["dict"])
    print(f"override={override} · +{len(newkeys)} keys · dict {before} -> {before+len(newkeys)}")
    if not write:
        k0, v0 = next(iter(newkeys.items()))
        print(f"DRY-RUN (pass --write to apply). sample: {k0!r} = {v0!r}")
        return

    for p in COPIES:
        dd = json.load(open(p, encoding="utf-8"))
        for k, th in newkeys.items():
            dd["dict"][k] = {"th": th, "en": th, "zh": th, "ar": th}
        dump(p, dd)
    if md5(COPIES[0]) != md5(COPIES[1]):
        sys.exit("FATAL: copies DIFFER after apply — investigate immediately.")
    print(f"APPLIED · both copies md5={md5(COPIES[0])} (identical) · dict now="
          f"{len(json.load(open(COPIES[0], encoding='utf-8'))['dict'])}")

if __name__ == "__main__":
    main()
