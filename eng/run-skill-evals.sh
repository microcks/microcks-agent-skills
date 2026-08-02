#!/usr/bin/env bash
# Run Vally skill-vs-baseline evaluations locally.
#
# Usage:
#   ./eng/run-skill-evals.sh                  # every evaluated skill
#   ./eng/run-skill-evals.sh <plugin>         # one plugin
#   ./eng/run-skill-evals.sh <plugin> <skill> # one skill
#
# Add --dry-run to validate the resolved experiment without using a model.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPERIMENT_FILE="${EXPERIMENT_FILE:-$ROOT/microcks-agent-skills.experiment.yaml}"
RESULTS_DIR="${RESULTS_DIR:-$ROOT/eval-results}"
WORKERS="${WORKERS:-5}"
VALLY_BIN="${VALLY_BIN:-npx}"
VALLY_PACKAGE="${VALLY_PACKAGE:-@microsoft/vally-cli@0.12.0}"
VALLY_NPM_CACHE="${VALLY_NPM_CACHE:-${TMPDIR:-/tmp}/microcks-agent-skills-npm-cache}"
VALLY_COMMAND="${VALLY_COMMAND:-$VALLY_BIN --yes $VALLY_PACKAGE}"
ADAPTER="$ROOT/eng/vally-adapter/adapt.mjs"

usage() {
  sed -n '2,9p' "$0"
}

is_name() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9-]*$ ]]
}

DRY_RUN=false
POSITIONAL=()
for argument in "$@"; do
  case "$argument" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage; exit 0 ;;
    --*) echo "Unknown option: $argument" >&2; usage >&2; exit 2 ;;
    *) POSITIONAL+=("$argument") ;;
  esac
done

if (( ${#POSITIONAL[@]} > 2 )); then
  usage >&2
  exit 2
fi

PLUGIN="${POSITIONAL[0]:-}"
SKILL="${POSITIONAL[1]:-}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js $(node --version) is too old; install Node.js 22 or newer." >&2
  exit 1
fi

if [[ ! -f "$EXPERIMENT_FILE" ]]; then
  echo "Experiment file not found: $EXPERIMENT_FILE" >&2
  exit 1
fi
if [[ ! -f "$ADAPTER" ]]; then
  echo "Vally adapter not found: $ADAPTER" >&2
  exit 1
fi

if [[ -n "$PLUGIN" ]] && ! is_name "$PLUGIN"; then
  echo "Invalid plugin name: $PLUGIN" >&2
  exit 2
fi
if [[ -n "$SKILL" ]] && ! is_name "$SKILL"; then
  echo "Invalid skill name: $SKILL" >&2
  exit 2
fi

FILTER=()
if [[ -n "$PLUGIN" && -n "$SKILL" ]]; then
  EVAL_PATH="tests/$PLUGIN/$SKILL/eval.yaml"
  SKILL_PATH="plugins/$PLUGIN/skills/$SKILL/SKILL.md"
  if [[ ! -f "$ROOT/$EVAL_PATH" || ! -f "$ROOT/$SKILL_PATH" ]]; then
    echo "Expected $EVAL_PATH and $SKILL_PATH." >&2
    exit 1
  fi
  FILTER=(--eval-filter "$EVAL_PATH")
elif [[ -n "$PLUGIN" ]]; then
  if [[ ! -d "$ROOT/plugins/$PLUGIN" ]]; then
    echo "Plugin not found: plugins/$PLUGIN" >&2
    exit 1
  fi
  FILTER=(--eval-filter "tests/$PLUGIN/**/eval.yaml")
fi

if [[ "$DRY_RUN" == false && -z "${GITHUB_TOKEN:-}" ]]; then
  if command -v gh >/dev/null 2>&1 && gh auth token >/dev/null 2>&1; then
    export GITHUB_TOKEN="$(gh auth token)"
  else
    echo "Authenticate with 'gh auth login' or set GITHUB_TOKEN before running an evaluation." >&2
    exit 1
  fi
fi

mkdir -p "$RESULTS_DIR/_experiment"
mkdir -p "$VALLY_NPM_CACHE"
cd "$ROOT"

# Keep npx downloads out of a globally shared cache, which may be owned by a
# different user after an earlier system-wide npm invocation.
export npm_config_cache="$VALLY_NPM_CACHE"
export VALLY_TELEMETRY_OPTOUT=1

echo "Running ${PLUGIN:-all plugins}${SKILL:+/$SKILL} with $WORKERS worker(s)."
COMMAND=("$VALLY_BIN" --yes "$VALLY_PACKAGE" experiment run "$EXPERIMENT_FILE")
if (( ${#FILTER[@]} > 0 )); then
  COMMAND+=("${FILTER[@]}")
fi
COMMAND+=(--output-dir "$RESULTS_DIR/_experiment" --workers "$WORKERS")
if [[ "$DRY_RUN" == true ]]; then
  COMMAND+=(--dry-run)
fi

RUN_DIRECTORIES_BEFORE="$(find "$RESULTS_DIR/_experiment" -mindepth 1 -maxdepth 1 -type d -print | sort)"
EXPERIMENT_EXIT_CODE=0
"${COMMAND[@]}" || EXPERIMENT_EXIT_CODE=$?

echo "Raw Vally output: $RESULTS_DIR/_experiment"

if [[ "$DRY_RUN" == true ]]; then
  exit "$EXPERIMENT_EXIT_CODE"
fi

RUN_DIRECTORIES_AFTER="$(find "$RESULTS_DIR/_experiment" -mindepth 1 -maxdepth 1 -type d -print | sort)"
RUN_DIRECTORY="$(comm -13 <(printf '%s\n' "$RUN_DIRECTORIES_BEFORE") <(printf '%s\n' "$RUN_DIRECTORIES_AFTER") | awk 'NF' | tail -1)"
if [[ -z "$RUN_DIRECTORY" ]]; then
  echo "No Vally experiment output directory was produced." >&2
  exit 1
fi

if (( EXPERIMENT_EXIT_CODE != 0 )); then
  echo "Vally experiment exited $EXPERIMENT_EXIT_CODE; adapting available results." >&2
fi

"$(command -v node)" "$ADAPTER" \
  --experiment-dir "$RUN_DIRECTORY" \
  --output-root "$RESULTS_DIR" \
  --vally "$VALLY_COMMAND" \
  --model "$(awk '/^  model:/ { print $2; exit }' "$EXPERIMENT_FILE")" \
  --judge-model "$(awk '/^  judge_model:/ { print $2; exit }' "$EXPERIMENT_FILE")"
