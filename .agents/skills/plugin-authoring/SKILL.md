---
name: plugin-authoring
description: "Create, extend, review, or repair this repository's installable plugins, plugin skills, custom agents, and external evaluations. Use when adding a plugin, revising a SKILL.md, defining an agent, registering plugin content, or creating eval.yaml scenarios and fixtures."
argument-hint: "[plugin, skill, agent, or evaluation request]"
skills:
  - skill-creator
  - plugin-contract
  - plugin-test
  - plugin-delivery-report
allowed-tools: Read, Grep, Glob, Edit, Write
---

# Plugin authoring

Coordinate a complete plugin change. This is the public workflow for a distributable plugin, skill, agent, or evaluation change. It composes focused skills so authoring guidance, distribution rules, tests, and reporting remain independently maintainable.

This is a repository developer tool. Never publish it in a marketplace manifest or add it to the public plugin catalogue.

Read [ARCHITECTURE.md](../../../ARCHITECTURE.md) before changing plugin topology, validation workflows, or evaluation infrastructure. Use [AGENTS.md](../../../AGENTS.md) as the concise operational checklist.

## Input

Determine the requested outcome and the smallest affected boundary. If a request names a path, read it. Otherwise, inspect the existing plugin and its nearest equivalent before deciding what to change.

| Target | Create or update | Required companion work |
|--------|------------------|-------------------------|
| Plugin | `plugins/<plugin>/` | Registrations, root README row, license link, version decision, and at least one skill or agent |
| Skill | `plugins/<plugin>/skills/<skill>/SKILL.md` | Plugin manifest path, plugin README table, and an external evaluation when directly invocable |
| Agent | `plugins/<plugin>/agents/<agent>.agent.md` | Plugin manifest path, plugin README table, and behavior-oriented evaluation where applicable |
| Evaluation | `tests/<plugin>/<target>/eval.yaml` | Fixtures beside the specification and deterministic validation |

Do not create a new plugin when a skill or agent belongs in an existing one. Do not put repository-only developer tools under `plugins/`.

## Process

### 1. Discover the change boundary

Inspect the target manifest, README, relevant skills or agents, marketplace manifests, root README, and relevant tests. Identify the observable outcome, the target type, the correct plugin boundary, whether it is directly invocable, and which artifacts must change together.

Summarize the scope before editing. Preserve public names and versions unless behavior changes them.

### 2. Author the distributable behavior

For a `SKILL.md`, apply `skill-creator` first: give the skill a trigger-oriented description, an observable outcome, and a focused workflow. Then apply `plugin-contract` for repository-specific paths, metadata, registration, license, and versioning rules.

For a plugin or agent, apply `plugin-contract` directly. Use an agent only when the work needs isolated context, a distinct role, or different tool boundaries.

### 3. Add outcome-focused evidence

For a directly invocable skill or agent, use `plugin-test`. Keep the specification and fixtures outside `plugins/`, write natural user prompts that do not name the target, prefer broad deterministic checks, and evaluate outcomes rather than implementation techniques.

A focused documentation-only change does not require unrelated evaluation work.

### 4. Validate and deliver

Run the applicable deterministic checks. Then use `plugin-delivery-report` to report scope, changed artifacts, observable behavior, evidence, validation results, and runtime status. Never claim that an unrun check passed.

## Constraints

- Keep repository-local developer tools under `.agents/skills/` and out of marketplace manifests.
- Keep distributable plugin content and test-only material at their separate architecture boundaries.
- Preserve marketplace, README, license-link, and versioning conventions.
- Do not add credentials or model-backed pull-request automation until the repository explicitly adopts it.
- Do not fabricate execution results, credentials, or passing comparisons.
