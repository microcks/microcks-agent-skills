#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

FAKE_VALLY="$TMP_ROOT/fake-vally"
cat > "$FAKE_VALLY" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$FAKE_VALLY_ARGS"

if [[ "${3:-}" == "experiment" && "${4:-}" == "run" ]]; then
  if [[ " $* " == *" --dry-run "* ]]; then
    exit 0
  fi
  output_dir=""
  for (( index = 1; index <= $#; index++ )); do
    if [[ "${!index}" == "--output-dir" ]]; then
      next=$((index + 1))
      output_dir="${!next}"
      break
    fi
  done
  [[ -n "$output_dir" ]]
  run_dir="$output_dir/fake-run"
  mkdir -p "$run_dir/baseline" "$run_dir/skilled"
  for variant in baseline skilled; do
    for trial in 0 1 2 3 4; do
      printf '%s\n' "{\"type\":\"trial-result\",\"evalFilePath\":\"$PWD/tests/plugin1/skill1/eval.yaml\",\"variant\":\"$variant\",\"stimulus\":\"Creates examples\",\"trialIndex\":$trial,\"status\":\"success\"}"
    done > "$run_dir/$variant/results.jsonl"
  done
elif [[ "${3:-}" == "compare" ]]; then
  output=""
  for (( index = 1; index <= $#; index++ )); do
    if [[ "${!index}" == "--output" ]]; then
      next=$((index + 1))
      output="${!next}"
      break
    fi
  done
  [[ -n "$output" ]]
  printf '%s\n' '{"summary":{"meanScore":0.4,"ciLow":0.2,"ciHigh":0.6,"wins":5,"ties":0,"losses":0,"winRate":1,"trialCount":5,"erroredCount":0},"stimuli":[{"stimulusName":"Creates examples","meanScore":0.4,"trials":[{"winner":"treatment"},{"winner":"treatment"},{"winner":"treatment"},{"winner":"treatment"},{"winner":"treatment"}]}],"unmatchedBaseline":[],"unmatchedTreatment":[]}' > "$output"
fi
SCRIPT
chmod +x "$FAKE_VALLY"

FAKE_VALLY_ARGS="$TMP_ROOT/arguments" \
  VALLY_BIN="$FAKE_VALLY" \
  VALLY_PACKAGE="ignored" \
  RESULTS_DIR="$TMP_ROOT/results" \
  "$ROOT/eng/run-skill-evals.sh" plugin1 skill1 --dry-run

grep -Fx 'experiment' "$TMP_ROOT/arguments" >/dev/null
grep -Fx 'run' "$TMP_ROOT/arguments" >/dev/null
grep -Fx 'tests/plugin1/skill1/eval.yaml' "$TMP_ROOT/arguments" >/dev/null
grep -Fx -- '--dry-run' "$TMP_ROOT/arguments" >/dev/null
test -d "$TMP_ROOT/results/_experiment"

FAKE_VALLY_ARGS="$TMP_ROOT/arguments" \
  GITHUB_TOKEN="test-token" \
  VALLY_BIN="$FAKE_VALLY" \
  VALLY_PACKAGE="ignored" \
  RESULTS_DIR="$TMP_ROOT/results" \
  "$ROOT/eng/run-skill-evals.sh" plugin1 skill1

test -f "$TMP_ROOT/results/plugin1/skill1/results.json"
node -e '
  const result = require(process.argv[1]);
  if (!result.verdicts?.[0]?.passed) process.exit(1);
' "$TMP_ROOT/results/plugin1/skill1/results.json"

echo "run-skill-evals wrapper tests passed"
