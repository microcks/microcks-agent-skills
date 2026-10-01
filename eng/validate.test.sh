#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$TMP_ROOT/plugins/broken-plugin/skills/missing-skill"
printf '%s\n' '{"name":"broken-plugin"}' > "$TMP_ROOT/plugins/broken-plugin/plugin.json"

mkdir -p "$TMP_ROOT/.agents" "$TMP_ROOT/.claude-plugin" "$TMP_ROOT/.github/plugin"
printf '%s\n' '{"plugins":[]}' > "$TMP_ROOT/.agents/marketplace.json"
printf '%s\n' '{"plugins":[]}' > "$TMP_ROOT/.claude-plugin/marketplace.json"
printf '%s\n' '{"plugins":[]}' > "$TMP_ROOT/.github/plugin/marketplace.json"
printf '%s\n' '# Test catalogue' > "$TMP_ROOT/README.md"

set +e
OUTPUT="$(REPOSITORY_ROOT="$TMP_ROOT" bash "$ROOT/eng/validate.sh" 2>&1)"
EXIT_CODE=$?
set -e

if [[ "$EXIT_CODE" -eq 0 ]]; then
  echo "Expected validation to fail for an invalid repository." >&2
  exit 1
fi

for expected in \
  "plugins/broken-plugin/README.md" \
  "plugins/broken-plugin/LICENSE" \
  "plugins/broken-plugin/skills/missing-skill/SKILL.md" \
  ".agents/marketplace.json" \
  ".claude-plugin/marketplace.json" \
  ".github/plugin/marketplace.json" \
  "README.md" \
  "blocking error(s)"; do
  if ! grep -Fq "$expected" <<<"$OUTPUT"; then
    echo "Expected validation output to contain: $expected" >&2
    echo "$OUTPUT" >&2
    exit 1
  fi
done

echo "validation aggregation test passed"