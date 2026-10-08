#!/usr/bin/env bash
# Stable entry point for every deterministic repository contract.
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${REPOSITORY_ROOT:-$SCRIPT_ROOT}"
VALIDATOR="$SCRIPT_ROOT/eng/validation/validate.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required to validate repository contracts." >&2
  exit 2
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js $(node --version) is too old; install Node.js 22 or newer." >&2
  exit 2
fi

if [[ ! -f "$VALIDATOR" ]]; then
  echo "Repository validator not found: $VALIDATOR" >&2
  exit 2
fi

exec node "$VALIDATOR" --root "$ROOT" "$@"