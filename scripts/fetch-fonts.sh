#!/usr/bin/env bash
# Regenerate apps/web/public/fonts/ from Google Fonts (B-440 = ก).
#
# The app SELF-HOSTS its webfonts. It used to <link> fonts.googleapis.com, which made
# what it renders depend on a third-party fetch — measured, one browser and one stack
# with the only variable being whether the CDN was reachable, `login` differed by 8.18%
# of the screen, against a CI gap of 1.42-3.74% that three re-baselines had failed to
# close. It also sent every user's IP to Google on every page load.
#
# Run this ONLY when the family/weight list in apps/web/index.html changes. It rewrites
# public/fonts/fonts.css and public/fonts/files/, and both are committed.
#
# WHY A CHROME USER-AGENT: the css2 endpoint serves a DIFFERENT stylesheet per browser
# — woff2 with unicode-range subsetting to modern Chrome, older formats and no
# subsetting to anything it does not recognise. Fetching without one gives a fatter,
# differently-shaped stylesheet, so the UA is load-bearing, not cargo.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/apps/web/public/fonts"
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

# The family list this app asks for. Kept in step with apps/web/index.html by hand;
# the two are checked against each other by the fonts test in apps/web.
URL='https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Thai:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap'

tmp=$(mktemp -d)

curl -fsS -A "$UA" "$URL" -o "$tmp/google.css"
grep -oE 'https://fonts\.gstatic\.com/[^)]*' "$tmp/google.css" | sort -u > "$tmp/urls.txt"
echo "stylesheet fetched · $(wc -l < "$tmp/urls.txt" | tr -d ' ') distinct font files referenced"

mkdir -p "$OUT/files"
while read -r u; do
  f="$OUT/files/$(basename "$u")"
  [ -f "$f" ] || curl -fsS "$u" -o "$f"
done < "$tmp/urls.txt"

# Rewrite every CDN URL to the local copy. The unicode-range blocks are Google's own
# subsetting and are kept verbatim — they are why a few megabytes cover Latin, Thai,
# Arabic and Simplified Chinese, and why a Thai page never downloads the CJK ranges.
python3 - "$tmp/google.css" "$OUT/fonts.css" <<'PY'
import os, re, sys
src = open(sys.argv[1], encoding="utf-8").read()
out = re.sub(r"https://fonts\.gstatic\.com/[^)]*/([^/)]+\.woff2)", r"/fonts/files/\1", src)
if "fonts.gstatic.com" in out:
    raise SystemExit("REFUSING: a gstatic URL survived the rewrite")
# Keep the existing banner comment so the rationale is not lost on a regenerate.
header = ""
if os.path.exists(sys.argv[2]):
    prev = open(sys.argv[2], encoding="utf-8").read()
    if prev.startswith("/*"):
        header = prev[: prev.index("*/") + 2] + "\n"
open(sys.argv[2], "w", encoding="utf-8").write(header + out)
print(f"fonts.css rewritten · {out.count('/fonts/files/')} local references")
PY

echo "files now shipped: $(ls "$OUT/files" | wc -l | tr -d ' ') · $(du -sh "$OUT" | cut -f1)"
echo "temp dir left at $tmp (delete it yourself; this script does not sweep directories)"
echo "NOTE: licences are NOT refetched. Adding a family means adding its copyright row to $OUT/LICENSE.md"
