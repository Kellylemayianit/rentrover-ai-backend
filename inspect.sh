#!/usr/bin/env bash
# Usage: ./inspect.sh PLATFORM [query] [script=<id>] [at=<path>]
#   ./inspect.sh airbnb lisbon
#   ./inspect.sh tripcom lisbon script=__NEXT_DATA__
#   ./inspect.sh airbnb lisbon script=data-deferred-state-0 at=some/path/*/here
BASE="${BASE:-https://rentrover-backend.kaelentechnologies.workers.dev}"
KEY="${DEBUG_KEY:-f233844bc57a10578180015e5eaceeb6}"
PLATFORM="${1:?usage: ./inspect.sh booking|tripcom|airbnb [query] [script=<id>] [at=<path>]}"
Q="${2:-lisbon}"
args=(--data-urlencode "platform=$PLATFORM" --data-urlencode "q=$Q")
for extra in "${@:3}"; do args+=(--data-urlencode "$extra"); done
curl -s -G --max-time 60 "$BASE/api/debug/inspect" -H "X-Debug-Key: $KEY" "${args[@]}" | python3 -m json.tool
