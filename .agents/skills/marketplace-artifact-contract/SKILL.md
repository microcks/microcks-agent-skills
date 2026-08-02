---
name: marketplace-artifact-contract
description: "Define and validate the installable artifact contract for this repository's marketplace plugins, skills, agents, registrations, and documentation. Used by marketplace-authoring when a change affects distributable content."
user-invocable: false
allowed-tools: Read, Grep, Glob, Edit, Write
---

# Marketplace artifact contract

Define the smallest complete installable change after the public coordinator has identified its boundary. This internal skill owns the artifact contract; it does not decide whether external evidence is needed.

## Plugin contract

A new plugin must use a kebab-case name and contain:

```text
plugins/<plugin-name>/
├── plugin.json
├── README.md
├── LICENSE -> ../../LICENSE
└── skills/<skill-name>/SKILL.md
```

At least one skill or agent is required. Create `LICENSE` as a symbolic link to `../../LICENSE`; never copy the root license.

Register a new plugin with the same name, source, and description in all of these manifests:

- `.agents/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.github/plugin/marketplace.json`

Add the plugin to the root README catalogue and installation guidance. Do not register repository-local developer tools.

## Skill contract

Place a distributable skill at:

```text
plugins/<plugin-name>/skills/<skill-name>/SKILL.md
```

Its frontmatter must have a name matching its folder and a description that states both behavior and trigger conditions. The body must give an agent the input assumptions, ordered workflow, observable output, and applicable constraints. Move detailed material into `references/` instead of making the main skill difficult to load.

A skill must enable a specific artifact, decision, change, or report. Do not write generic advice that has no observable outcome.

## Agent contract

Place an agent at:

```text
plugins/<plugin-name>/agents/<agent-name>.agent.md
```

Use an agent only for isolated context, a distinct role, or different tool boundaries. Otherwise prefer a skill. State the agent's mission, inputs, outputs, constraints, and collaboration boundary. Do not duplicate an existing skill workflow without a clear isolation reason.

## Change rules

- Inspect the plugin manifest and README before editing either.
- Update a published plugin version according to Semantic Versioning when its published content changes.
- Preserve public names and compatible behavior unless the requested change explicitly changes them.
- A skill-only or agent-only change belongs in an existing plugin when it fits that plugin's boundary.
- Do not create a plugin merely to hold repository developer tooling.

## Static checks

Before returning control to the coordinator, verify the applicable contract:

- required plugin files and declared skill or agent paths exist;
- `LICENSE` is a symbolic link resolving to the root license;
- all marketplace registrations are identical;
- each new plugin appears in the root README;
- published metadata and documentation agree.
