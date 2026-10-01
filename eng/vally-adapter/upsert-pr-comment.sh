#!/usr/bin/env bash
#
# upsert-pr-comment.sh
# Create or update the single Vally evaluation comment on a pull request.
#
# Usage: upsert-pr-comment.sh <owner/repo> <pr-number> <body-file>
# Requires an authenticated `gh` (GH_TOKEN) with pull-requests: write.

set -euo pipefail

MARKER="<!-- vally-evals -->"
BOT_LOGIN="${BOT_LOGIN:-github-actions[bot]}"

main() {
  local repository="${1:-}" pull_request="${2:-}" body_file="${3:-}"
  [[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Invalid repository: $repository" >&2; exit 2; }
  [[ "$pull_request" =~ ^[0-9]+$ ]] || { echo "Invalid pull request number: $pull_request" >&2; exit 2; }
  [[ -f "$body_file" ]] || { echo "Comment body not found: $body_file" >&2; exit 2; }
  [[ "$(head -n 1 "$body_file")" == "$MARKER" ]] || { echo "Comment body must start with $MARKER" >&2; exit 2; }

  local comment_id
  comment_id="$(gh api --paginate "repos/$repository/issues/$pull_request/comments" \
    --jq ".[] | select(.user.login == \"$BOT_LOGIN\" and (.body | startswith(\"$MARKER\"))) | .id" | tail -n 1)"

  if [[ -n "$comment_id" ]]; then
    gh api --method PATCH "repos/$repository/issues/comments/$comment_id" -F "body=@$body_file" >/dev/null
    echo "Updated evaluation comment $comment_id on #$pull_request."
  else
    gh api --method POST "repos/$repository/issues/$pull_request/comments" -F "body=@$body_file" >/dev/null
    echo "Created evaluation comment on #$pull_request."
  fi
}

main "$@"
