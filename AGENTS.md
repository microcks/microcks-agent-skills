# Repository Instructions

This repository is a marketplace of AI agent skills and plugins for working with [Microcks](https://microcks.io/).
All plugins live under `plugins/`. Each subdirectory is an independent, installable plugin.

## Repository structure

```
.agents/
  marketplace.json          # Codex / OpenAI Agents marketplace manifest
  skills/
    <skill-name>/
      SKILL.md              # Repo-level agent skill installed via apm (not distributed)
apm.yml                     # apm dependency manifest (equivalent to package.json)
apm.lock.yaml               # apm lock file — commit this to pin skill versions
.claude-plugin/
  marketplace.json          # Claude Code marketplace manifest
.github/
  plugin/
    marketplace.json        # GitHub Copilot marketplace manifest
  workflows/
    plugin-structure.yml    # CI: validates each plugin directory structure
    marketplace-sync.yml    # CI: verifies all marketplace.json files are in sync
    readme-plugins.yml      # CI: verifies README.md lists every plugin
plugins/
  <plugin-name>/
    skills/
      <skill-name>/
        SKILL.md            # Required — "Use when…" trigger + instructions
        assets/             # Optional — images, data files used by the skill
        examples/           # Optional — usage examples
        references/         # Optional — reference documents
        scripts/            # Optional — helper scripts
    agents/                 # Optional — .agent.md files for custom agents
    hooks/                  # Optional — Claude/Copilot hook scripts (.mjs)
    instructions/           # Optional — GitHub Copilot .instructions.md files
    plugin.json             # Required — plugin manifest (name, version, skills)
    README.md               # Required — plugin description and skill table
    LICENSE                 # Required — plugin-level license (Apache 2.0)
AGENTS.md                   # This file
```

## Adding a new plugin

Follow these steps when adding a new plugin. The CI pipelines enforce every rule below.

### 1. Create the plugin directory

```
plugins/<your-plugin-name>/
```

Use kebab-case. The name must match the `name` field in `plugin.json` and the entries in all `marketplace.json` files.

### 2. Add the required files

Every plugin **must** contain:

| File | Purpose |
|------|---------|
| `plugin.json` | Plugin manifest: name, version, description, skill paths |
| `README.md` | Human-readable description + skills table |
| `LICENSE` | Symlink to the root `LICENSE` — **never copy** |
| `skills/<skill>/SKILL.md` | At least one skill with a `Use when…` trigger line |

Create the `LICENSE` symlink with:

```bash
ln -s ../../LICENSE plugins/<your-plugin-name>/LICENSE
```

### 3. Register the plugin in all marketplace.json files

All three marketplace files **must** be updated together and must remain identical in their `plugins` list:

- `.agents/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.github/plugin/marketplace.json`

Add the same entry to each:

```json
{
  "name": "<your-plugin-name>",
  "source": "./plugins/<your-plugin-name>",
  "description": "One-line description."
}
```

> The `marketplace-sync` CI job will fail if any file is out of sync with the others.

### 4. Update the root README.md

Add a row for your plugin to the **Plugins** table in `README.md`:

```markdown
| [your-plugin-name](./plugins/your-plugin-name) | One-line description |
```

> The `readme-plugins` CI job will fail if a plugin directory exists but is not mentioned in `README.md`.

### 5. Open a Pull Request

The three CI checks run automatically on every PR that touches `plugins/**` or a marketplace file:

| Workflow | What it checks |
|----------|---------------|
| `plugin-structure` | `plugin.json`, `README.md`, `LICENSE`, and at least one `SKILL.md` per plugin |
| `marketplace-sync` | All plugins are registered in all three `marketplace.json` files and the lists are identical |
| `readme-plugins` | Every plugin directory is mentioned in the root `README.md` |

## SKILL.md format

Each `SKILL.md` must start with a `Use when` section so agents can determine when to activate the skill:

```markdown
# skill-name

Use when you need to <trigger description>.

## When to use
...

## What this skill does
...

## Prerequisites
...

## References
...
```

## Versioning

Plugin versions follow [Semantic Versioning](https://semver.org/). Bump `version` in `plugin.json` on every change:

- **patch** — bug fix or content correction in an existing skill
- **minor** — new skill added to an existing plugin
- **major** — breaking change to skill interface or removal of a skill

## Agent skills (`.agents/skills/`)

The `.agents/skills/` directory contains **repo-level agent skills** that enhance the coding agent itself — not Microcks plugins distributed to end-users. These skills are managed with [`apm`](https://github.com/anthropics/skills) (Agent Package Manager).

### Install a skill

```bash
apm install <org>/<repo>/<path-to-skill> --target <agent>
```

Example — install the Anthropic `skill-creator` skill for GitHub Copilot:

```bash
apm install anthropics/skills/skills/skill-creator --target copilot
```

The skill is written to `.agents/skills/<skill-name>/SKILL.md` and becomes available to the agent immediately.

### Update a skill

Re-run the same `apm install` command. `apm` overwrites the existing skill with the latest upstream version:

```bash
apm install anthropics/skills/skills/skill-creator --target copilot
```

Then commit the updated `SKILL.md`:

```bash
git add .agents/skills/
git commit -s -m "chore(agents): update skill-creator to latest"
```

### Add a new repo-level skill

1. Run `apm install <source> --target <agent>` — the file is created automatically.
2. Commit the new `SKILL.md` under `.agents/skills/<skill-name>/`.
3. No marketplace registration is needed — repo-level skills are not distributed as plugins.

> **Convention:** keep all repo-level skills in `.agents/skills/`. Do not place them under `plugins/` — that directory is reserved for distributable Microcks plugins.
