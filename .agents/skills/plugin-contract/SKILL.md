---
name: plugin-contract
description: "Define and validate the installable artifact contract for this repository's plugins, skills, agents, registrations, and documentation. Used by plugin-authoring when a change affects distributable content."
user-invocable: false
allowed-tools: Read, Grep, Glob, Edit, Write
---

# Plugin contract

Define the smallest complete installable change after the public coordinator has identified its boundary. This internal skill owns the distribution contract; it does not decide whether external evidence is needed.

## Plugin contract

A new plugin uses a kebab-case name and contains:

```text
plugins/<plugin-name>/
├── plugin.json
├── README.md
├── LICENSE -> ../../LICENSE
└── skills/<skill-name>/SKILL.md
```

At least one skill or agent is required. Create `LICENSE` as a symbolic link to `../../LICENSE`; never copy the root license.

Register a new plugin with the same name, source, and description in:

- `.agents/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.github/plugin/marketplace.json`

Add the plugin to the root README catalogue. Do not register repository-local developer tools.

## Skill and agent contract

Place a skill at `plugins/<plugin>/skills/<skill>/SKILL.md`. Its frontmatter name matches its folder, and its description explains both behavior and trigger conditions. The body gives input assumptions, ordered workflow, observable output, and constraints. Put detailed material in `references/` rather than overloading the main file.

Place an agent at `plugins/<plugin>/agents/<agent>.agent.md`. State its mission, inputs, outputs, constraints, and collaboration boundary. Prefer a skill unless the work needs isolated context, a distinct role, or tool restrictions.

## Change rules

- Inspect the plugin manifest and README before editing either.
- Update a published plugin version according to Semantic Versioning when published content changes.
- Preserve public names and compatible behavior unless the requested change says otherwise.
- A skill-only or agent-only change belongs in an existing plugin when it fits that plugin's boundary.
- Do not create a plugin merely to hold repository developer tooling.

## Static checks

Before returning control to the coordinator, verify the applicable contract:

- required plugin files and declared skill or agent paths exist;
- `LICENSE` is a symbolic link resolving to the root license;
- all marketplace registrations are identical;
- each new plugin appears in the root README;
- published metadata and documentation agree.
