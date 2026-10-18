#!/usr/bin/env bash
# Usage: ./test-scrapers.sh [query] [platform] [find-text]
#   ./test-scrapers.sh lisbon                    all three platforms
#   ./test-scrapers.sh lisbon tripcom            just Trip.com
#   ./test-scrapers.sh lisbon tripcom hotelName  Trip.com + show text around "hotelName"
BASE="${BASE:-https://rentrover-backend.kaelentechnologies.workers.dev}"
KEY="${DEBUG_KEY:-f233844bc57a10578180015e5eaceeb6}"
Q="${1:-lisbon}"
PLATFORMS="booking tripcom airbnb"
[ -n "$2" ] && PLATFORMS="$2"

for platform in $PLATFORMS; do
  echo "=== $platform (q=$Q) ==="
  args=(--data-urlencode "platform=$platform" --data-urlencode "q=$Q")
  [ -n "$3" ] && args+=(--data-urlencode "find=$3")
  curl -s -G --max-time 60 "$BASE/api/debug/raw" -H "X-Debug-Key: $KEY" "${args[@]}" \
  | python3 -c '
import sys, json, re
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    print("  (no JSON back - check the URL, your network, or that the deploy finished)")
    print("  raw:", re.sub(r"\s+", " ", raw[:200]))
    sys.exit()
if "error" in d and "status" not in d:
    print("  error:", d["error"], d.get("detail", ""))
    sys.exit()
for k, v in d.items():
    if k in ("sample", "matches"):
        continue
    print("  %s: %s" % (k, json.dumps(v)))
print("  sample:", re.sub(r"\s+", " ", d.get("sample") or "")[:300])
for m in d.get("matches") or []:
    print("  match @%s: %s" % (m.get("at"), re.sub(r"\s+", " ", m.get("context", ""))[:500]))
'
  echo
done
