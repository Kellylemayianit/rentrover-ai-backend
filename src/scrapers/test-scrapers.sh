#!/usr/bin/env bash
# One command to test all three scrapers and print a compact summary.
# Usage:  ./test-scrapers.sh            (defaults to "lisbon")
#         ./test-scrapers.sh paris
# Override the target or key without editing the file:
#         BASE=https://other.workers.dev DEBUG_KEY=xxxx ./test-scrapers.sh

BASE="${BASE:-https://rentrover-backend.kaelentechnologies.workers.dev}"
KEY="${DEBUG_KEY:-f233844bc57a10578180015e5eaceeb6}"
Q="${1:-lisbon}"

for platform in booking tripcom airbnb; do
  echo "=== $platform (q=$Q) ==="
  curl -s --max-time 40 "$BASE/api/debug/raw?platform=$platform&q=$Q" \
    -H "X-Debug-Key: $KEY" \
  | python3 -c '
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    print("  (no JSON back - check the URL, your network, or that the deploy finished)")
    print("  raw:", raw[:200])
    sys.exit()
if "error" in d and "status" not in d:
    print("  error:", d["error"])
    sys.exit()
for k in ["status", "finalUrl", "textLength", "jsonLdBlockCount",
          "lodgingBlockCount", "lodgingBlockTypes", "extractedCount", "extractError"]:
    print(f"  {k}: {d.get(k)}")
print("  sample (first 300 chars):", (d.get("sample") or "")[:300].replace("\n", " "))
'
  echo
done
