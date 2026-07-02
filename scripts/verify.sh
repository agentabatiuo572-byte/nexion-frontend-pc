#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

echo "== [1/4] typecheck =="
(cd "$ROOT" && npx --no-install tsc --noEmit)

echo "== [2/4] runtime mock import guard =="
(cd "$ROOT" && node scripts/check-runtime-mock-imports.mjs)

echo "== [3/4] sentinels =="
(cd "$ROOT" && node scripts/kill-switch-count-sentinel.mjs)
(cd "$ROOT" && node scripts/rhythm-single-source-sentinel.mjs)

echo "== [4/4] production build =="
(cd "$ROOT" && npm run build)

echo "verify OK"
