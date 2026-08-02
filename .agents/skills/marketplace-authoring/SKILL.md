---
name: marketplace-authoring
description: "Create, extend, review, or repair this repository's marketplace plugins, plugin skills, custom agents, and external evaluation specifications. Use when a contributor asks to add a plugin, create or revise a SKILL.md, define an agent, register marketplace content, or add eval.yaml scenarios and fixtures."
skills:
  - marketplace-artifact-contract
  - marketplace-evaluation-design
  - marketplace-delivery-report
allowed-tools: Read, Grep, Glob, Edit, Write
---

# Marketplace authoring

Coordinate a complete marketplace change. This is the single public workflow for a distributable plugin, skill, agent, or evaluation change. Its focused supporting skills define artifact contracts, evidence design, and the final delivery report.

This is a repository developer tool. Never publish it in a marketplace manifest or add it to the public plugin catalogue.

Read [ARCHITECTURE.md](../../../ARCHITECTURE.md) before changing marketplace topology, validation workflows, or evaluation infrastructure. Use [AGENTS.md](../../../AGENTS.md) as the concise operational checklist.

## Input

Determine the requested outcome and the smallest affected boundary. If a request names a path, read it. Otherwise, inspect the existing plugin and its nearest equivalent before deciding what to change.

Use this target map:

| Target | Create or update | Required companion work |
|--------|------------------|-------------------------|
| Plugin | `plugins/<plugin>/` | Manifest registrations, root README row, license link, version decision, and at least one skill or agent |
| Skill | `plugins/<plugin>/skills/<skill>/SKILL.md` | Plugin manifest path, plugin README table, and external evaluation when directly invocable |
| Agent | `plugins/<plugin>/agents/<agent>.agent.md` | Plugin manifest path, plugin README table, and behavior-oriented evaluation where applicable |
| Evaluation | `tests/<plugin>/<target>/eval.yaml` | Minimal tracked fixtures beside the spec and deterministic validation |

Do not create a new plugin when the request only adds a skill or agent to an existing plugin. Do not put repository-only developer tools under `plugins/`.

## Process

Use the following four stages in order. Keep the public workflow concise by applying the preloaded supporting skills rather than duplicating their contracts.

### 1. Discover the change boundary

Inspect the target plugin manifest, its README, relevant existing skills or agents, the three marketplace manifests, the root README, and relevant tests. Identify:

1. The observable contributor or end-user outcome.
2. Whether the target is a plugin, skill, agent, or a combination.
3. Whether an existing plugin is the correct boundary.
4. Whether the target is directly invocable or is a dependency/reference component.
5. Which metadata, documentation, registration, and evaluation artifacts must change together.

Summarize this scope before editing. Preserve public names and existing versions unless the requested behavior changes them.

### 2. Apply the artifact contract

Use `marketplace-artifact-contract` to create or update only the installable artifacts and registrations required by the discovered boundary. Its rules govern plugin structure, license links, marketplace synchronization, documentation, versioning, skills, and agents.

### 3. Design external evidence

When a directly invocable behavior changes, use `marketplace-evaluation-design` to add or evolve its external specification and fixtures. Do not create unrelated evaluations for a focused documentation-only change.

### 4. Validate and deliver

Run the applicable deterministic checks. Then use `marketplace-delivery-report` to report the scope, changed artifacts, observable behavior, evidence, validation results, and runtime status. Never invent a passing result or claim runtime evidence was executed when it was not.

## Interaction rules

- Prefer inspection over assumptions: read current artifacts before modifying them.
- Keep changes proportionate to the requested outcome.
- Preserve public names and versions unless a behavior change requires a version decision.
- Escalate only an ambiguity that changes the artifact boundary, behavior, or public contract.
- Do not ask for credentials or add runtime automation while the repository has only adopted static validation.

## Constraints

- Keep repository-local developer tools under `.agents/skills/` and out of marketplace manifests.
- Keep distributable plugin content and test-only material at their separate architecture boundaries.
- Preserve marketplace, README, license-link, and versioning conventions.
- Do not fabricate execution results, credentials, or passing comparisons.