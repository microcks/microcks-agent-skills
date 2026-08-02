---
name: marketplace-evaluation-design
description: "Design and validate external evaluation specifications and fixtures for directly invocable marketplace skills and agents. Used by marketplace-authoring when behavior needs evidence."
user-invocable: false
allowed-tools: Read, Grep, Glob, Edit, Write
---

# Marketplace evaluation design

Design evidence for a changed directly invocable skill or agent behavior. This internal skill owns evaluation placement, scenarios, graders, fixtures, and static validation. It does not create distributable plugin artifacts.

## Evidence boundary

Store each specification outside the plugin package:

```text
tests/<plugin-name>/<target-name>/eval.yaml
```

Store test inputs alongside it under `fixtures/`. Every referenced fixture must exist and be tracked. Repository-local developer skills use the dedicated `tests/repository-skills/<skill-name>/eval.yaml` namespace instead.

Do not put prompts, graders, fixtures, or experimental results under `plugins/`.

## Scenario design

Write scenarios from observable user outcomes, not from instruction headings. Select only the scenarios relevant to the changed behavior:

1. **Positive** — requires the intended capability.
2. **Boundary** — distinguishes the correct result from a plausible wrong one.
3. **Non-hijacking** — shows that unrelated work remains focused when the behavior could overreach.

Prefer diverse prompts over repeated rewordings. Do not add evidence for a documentation-only change unless the documentation itself is the behavior being evaluated.

## Grader design

Use the least subjective evidence that proves the outcome, in this order:

1. Deterministic output, file, command, or tool-call checks.
2. Pattern checks for stable structured output.
3. Semantic rubrics only for correctness, completeness, or relevance that deterministic checks cannot establish.

Use `defaults:` for shared timeout and run settings. Never declare both `defaults:` and `config:` in one specification. Every scenario needs a realistic prompt and configured grader.

The number of planned trials is:

$$
\text{trials} = \text{number of stimuli} \times \text{runs per stimulus}
$$

Plan at least five trials before making a future comparison verdict. This is a minimum evidence floor, not proof against ties or model variance.

## Runtime boundary

Static parsing and fixture validation are required now. Credentialed runtime execution is a later maintainer-controlled phase. Do not add credentials, unpinned runtime dependencies, or a model-backed pull-request gate.

When comparisons are later available, keep these variants distinct:

- **Baseline**: no skill or agent instruction loaded.
- **Targeted**: only the behavior under evaluation loaded.
- **Plugin**: the complete plugin loaded where interaction matters.

Treat timeout, missing-trajectory, and judge failures as harness evidence to investigate. Do not present inconclusive or underpowered results as a regression.

## Static checks

Before returning control to the coordinator, verify that the YAML parses, every fixture exists, the specification uses only one shared configuration style, and deterministic graders precede semantic rubrics where both are needed.
