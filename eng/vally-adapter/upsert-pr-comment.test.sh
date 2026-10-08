#!/usr/bin/env bash
#
# upsert-pr-comment.test.sh
# Verify that the Vally PR comment is created once and then updated in place.

set -euo pipefail

TMP_ROOT=""
cleanup() {
  [[ -z "$TMP_ROOT" ]] || rm -rf "$TMP_ROOT"
}

main() {
  local root tmp_root
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  TMP_ROOT="$(mktemp -d)"
  tmp_root="$TMP_ROOT"
  trap cleanup EXIT

  mkdir -p "$tmp_root/bin"
  cat > "$tmp_root/bin/gh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_GH_LOG"
if [[ " $* " == *" --paginate "* ]]; then
  cat "$FAKE_GH_EXISTING"
fi
SCRIPT
  chmod +x "$tmp_root/bin/gh"

  local body="$tmp_root/body.md"
  printf '%s\n%s\n' '<!-- vally-evals -->' '## Vally evaluation' > "$body"

  : > "$tmp_root/existing"
  PATH="$tmp_root/bin:$PATH" FAKE_GH_LOG="$tmp_root/create.log" FAKE_GH_EXISTING="$tmp_root/existing" \
    "$root/eng/vally-adapter/upsert-pr-comment.sh" microcks/microcks-agent-skills 42 "$body"
  grep -F -- "--method POST repos/microcks/microcks-agent-skills/issues/42/comments -F body=@$body" "$tmp_root/create.log" >/dev/null

  printf '%s\n' 101 > "$tmp_root/existing"
  PATH="$tmp_root/bin:$PATH" FAKE_GH_LOG="$tmp_root/update.log" FAKE_GH_EXISTING="$tmp_root/existing" \
    "$root/eng/vally-adapter/upsert-pr-comment.sh" microcks/microcks-agent-skills 42 "$body"
  grep -F -- "--method PATCH repos/microcks/microcks-agent-skills/issues/comments/101" "$tmp_root/update.log" >/dev/null
  if grep -F -- "--method POST" "$tmp_root/update.log" >/dev/null; then
    echo "Expected an update, not a new comment." >&2
    exit 1
  fi

  printf '%s\n' 'no marker' > "$tmp_root/bad.md"
  if PATH="$tmp_root/bin:$PATH" FAKE_GH_LOG="$tmp_root/bad.log" FAKE_GH_EXISTING="$tmp_root/existing" \
    "$root/eng/vally-adapter/upsert-pr-comment.sh" microcks/microcks-agent-skills 42 "$tmp_root/bad.md" 2>/dev/null; then
    echo "Expected a body without the marker to be rejected." >&2
    exit 1
  fi
  if PATH="$tmp_root/bin:$PATH" FAKE_GH_LOG="$tmp_root/bad.log" FAKE_GH_EXISTING="$tmp_root/existing" \
    "$root/eng/vally-adapter/upsert-pr-comment.sh" microcks/microcks-agent-skills '42;id' "$body" 2>/dev/null; then
    echo "Expected an invalid pull request number to be rejected." >&2
    exit 1
  fi

  echo "upsert-pr-comment tests passed"
}

main "$@"
