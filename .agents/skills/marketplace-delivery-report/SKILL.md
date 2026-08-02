---
name: marketplace-delivery-report
description: "Produce the final scope, evidence, validation, and runtime-status report for a marketplace authoring change. Used by marketplace-authoring after applicable checks finish."
user-invocable: false
allowed-tools: Read
---

# Marketplace delivery report

Produce the final concise delivery report after the coordinator has completed the applicable artifact and evidence checks. Report facts only; do not infer a passing result from an unrun command.

## Required structure

```markdown
## Marketplace change

### Scope
- Target: <plugin | skill | agent | evaluation>
- Plugin: <plugin-name | not applicable>
- Changed artifacts: <workspace-relative paths>

### Delivered behavior
- <observable outcome>

### Evidence
- Evaluation: <workspace-relative path | not applicable, with reason>
- Scenarios: <names and behavior measured | not applicable>
- Trials: <stimuli> × <runs> = <total | not configured>

### Validation
- <check>: <passed | failed | not run, with reason>

### Runtime status
- <not configured | advisory pilot | executed with artifact location>
```

## Reporting rules

- Include only artifacts actually changed or inspected for the request.
- Link each workspace file path when the chat environment supports it.
- State why evidence is not applicable rather than silently omitting it.
- Identify a failed or skipped validation explicitly.
- Do not claim model-backed execution, credentials, artifacts, or comparison results unless they exist.
- Keep the report focused on the requested change; do not propose unrelated repository work.
