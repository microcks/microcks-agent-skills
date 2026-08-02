# Local skill evaluations

[run-skill-evals.sh](run-skill-evals.sh) runs the repository's Vally experiment in the same baseline-versus-skilled model used by `dotnet/skills`.

## Prerequisites

- Node.js 22 or later;
- an authenticated GitHub CLI (`gh auth login`) or a `GITHUB_TOKEN` accepted by the Copilot SDK.

## Run evaluations

```sh
# Validate the experiment without calling a model.
./eng/run-skill-evals.sh plugin1 skill1 --dry-run

# Run one skill, one plugin, or all covered skills.
./eng/run-skill-evals.sh plugin1 skill1
./eng/run-skill-evals.sh plugin1
./eng/run-skill-evals.sh
```

The experiment runs the same external [eval.yaml](../tests/plugin1/skill1/eval.yaml) twice: once without any skill and once with only the skill resolved from its test path. After a model run, [vally-adapter/adapt.mjs](vally-adapter/adapt.mjs) compares the paired trajectories and writes one verdict per skill at `eval-results/<plugin>/<skill>/results.json`. A verdict is credible only when its head-to-head direction clears an exact one-sided sign test at $p \leq 0.05$ with at least five trials. An underpowered or incomplete evaluation is reported as inconclusive, not as a skill regression.

Raw run records and reports are written beneath `eval-results/_experiment/`, which is ignored by Git. The runner still attempts adaptation when Vally returns a non-zero status because a failed scenario may leave enough completed trajectories for a useful comparison.

`WORKERS` limits concurrent trials; `RESULTS_DIR`, `EXPERIMENT_FILE`, `VALLY_BIN`, `VALLY_PACKAGE`, `VALLY_COMMAND`, and `VALLY_NPM_CACHE` support local overrides. The runner defaults its npm cache to a temporary directory, avoiding a globally shared cache with incompatible ownership. The default Vally CLI is pinned to `@microsoft/vally-cli@0.12.0`.
