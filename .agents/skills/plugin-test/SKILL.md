---
name: plugin-test
description: "Create or review external eval.yaml tests and fixtures for directly invocable plugin skills and agents. Use when adding evaluation scenarios, assertions, rubrics, fixtures, non-activation cases, or checking tests for prompt and rubric overfitting. Do not use for authoring a SKILL.md or debugging a runtime harness."
argument-hint: "[plugin and skill or agent to test]"
allowed-tools: Read, Grep, Glob, Edit, Write
---

# Plugin test

Create outcome-focused external evidence for a directly invocable plugin skill or agent. Test material remains outside the distributable plugin so marketplace installations contain runtime content only.

## When not to use

- Do not author or substantially revise `SKILL.md` content here; use `skill-creator` or `plugin-authoring`.
- Do not change the runtime evaluator or diagnose a failing evaluator harness.
- Do not add tests for a documentation-only change unless the documentation is itself the observable behavior.

## Inputs

| Input | Required | Purpose |
|-------|----------|---------|
| Plugin name | Yes | Identifies the owning installable plugin |
| Target name and type | Yes | Identifies a skill or agent to evaluate |
| Target content | Recommended | Defines user outcomes and boundaries to test |
| Scenario descriptions | Recommended | Provides real situations that should be covered |

## Workflow

### 1. Locate and read the target

For a skill, verify `plugins/<plugin>/skills/<skill>/SKILL.md` exists. For an agent, verify `plugins/<plugin>/agents/<agent>.agent.md` exists. Read the target before creating its test; outcome-focused rubrics depend on understanding the behavior without copying its instructions.

Use these external test paths:

```text
# Skill
tests/<plugin>/<skill>/eval.yaml

# Agent
tests/<plugin>/agent.<agent>/eval.yaml
```

The `agent.` prefix prevents collisions between agent and skill test directories.

### 2. Choose fixtures deliberately

Use inline setup data for small, self-contained scenarios. Place larger or shared input files under `fixtures/` beside `eval.yaml`. Every referenced fixture must exist and be tracked.

Use setup commands only when the scenario genuinely requires generated artifacts. Keep each setup isolated and deterministic.

### 3. Write natural scenarios

A scenario describes what a developer would ask for, not how the target works. Its prompt must not name the skill or agent, instruct the model to use a skill, or copy target wording.

Cover relevant cases:

1. **Positive** — the user needs the intended behavior.
2. **Boundary** — a plausible wrong result is rejected.
3. **Non-activation** — the request resembles the target but falls outside its stated boundary.

Use `expect_activation: false` for the last case when the evaluator supports activation expectations. The expected response should recognize why the target does not apply, avoid its workflow, and redirect the user to an appropriate next step.

### 4. Write broad deterministic checks

Use the least subjective evidence that proves an outcome:

1. Output or file checks for objective facts.
2. Pattern checks that allow legitimate alternative wording or implementation.
3. Semantic rubrics for outcome quality that cannot be checked deterministically.

Avoid assertions that require an implementation-specific command, flag, vocabulary, or sequence. A correct result reached by a different valid approach must pass.

### 5. Write independent outcome rubrics

A rubric item states one observable result, never a technique. It must not name the target or repeat its proprietary vocabulary.

Good: “Identified the missing dependency as the cause of the build failure.”

Overfitted: “Ran the target diagnostic command with the required flag.”

For non-activation cases, assess recognition, restraint, and redirection separately.

### 6. Validate the specification

Use `defaults:` for shared timeout and run settings; never declare both `defaults:` and `config:`. Every scenario needs a realistic prompt and at least one configured grader. Parse the YAML and verify every fixture and source path.

Plan enough comparative evidence before declaring an improvement:

$$
\text{trials} = \text{number of stimuli} \times \text{runs per stimulus}
$$

Use at least five trials for a future comparison verdict. Static checks are required now; credentialed runtime comparisons are a separate maintainer-controlled phase.

## Checklist

- Target exists and was read before test authoring.
- Test directory follows the skill or `agent.` convention.
- Prompts are natural developer requests and do not name the target.
- Assertions accept more than one valid approach.
- Rubrics assess outcomes rather than techniques or vocabulary.
- Clear boundaries have non-activation cases.
- Fixtures are external to `plugins/`, present, and tracked.
- YAML and all fixture references validate.
