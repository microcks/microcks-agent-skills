# Repository Instructions

This repository is a marketplace of AI agent plugins for [Microcks](https://microcks.io/).

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing repository structure, CI, marketplace manifests, repository-local skills, or evaluation infrastructure. It is the source of truth for those decisions.

## Contributor rules

- Create installable plugins under `plugins/<plugin-name>/` using kebab-case.
- Every plugin needs `plugin.json`, `README.md`, at least one `skills/<skill>/SKILL.md`, and a `LICENSE` symbolic link to `../../LICENSE`.
- Register each plugin identically in the three marketplace manifests and add it to the root [README.md](./README.md) table.
- Bump `plugin.json` according to Semantic Versioning when changing a published plugin.
- Keep repository-only developer skills under `.agents/skills/`; never register them as marketplace plugins.
- Keep plugin evaluation specifications and fixtures outside distributable plugin content under `tests/<plugin-name>/<skill-name>/`.
- Give every distributed skill and agent valid YAML frontmatter. Directly invocable skills require `tests/<plugin>/<skill>/eval.yaml`; only skills declaring `disable-model-invocation: true` are exempt from direct-activation evaluations.
- Run `bash eng/validate.sh --base-ref HEAD` before review. Objective errors on new or changed components block delivery; unchanged legacy findings remain visible as grandfathered debt.

The existing CI workflows enforce plugin structure, marketplace synchronization, and README registration. Use the local `plugin-authoring` skill when creating or evolving a plugin, skill, agent, or its evaluation specification. Use `plugin-test` to create or review external evaluation scenarios and fixtures.

See [Developer workflows](./docs/developer-workflows.md) for the purpose of each local skill and the end-to-end contributor workflow.

Maintainers run Vally on a pull request with a `/evals [plugin] [skill]` comment; results are posted back as one aggregate pull-request comment. Dashboard publication is disabled unless the `DASHBOARD_PUBLISHING` repository variable is `true`. Never publish raw prompts, trajectories, or comparison evidence to pull-request comments or dashboard data.

## Repository-local skills

Use APM for third-party developer skills:

```bash
apm install <org>/<repo>/<path-to-skill> --target copilot
```

Commit the resulting `apm.yml`, `apm.lock.yaml`, and `.agents/skills/` changes together. Locally-authored skills are stored in `.agents/skills/` but are not APM dependencies.
