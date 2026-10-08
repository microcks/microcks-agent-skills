# microcks-oidc

Mock OpenID Connect provider served by Microcks, with generated keys, signed tokens and dispatch rules.

## What's Included

A skill that builds and maintains a fake identity provider from a single declaration file. A bundled
generator owns every RSA key, JWKS, signed `id_token` / `access_token` and Microcks dispatch rule, so
tokens served by the mock validate like real ones. Running Microcks, importing the artefacts and wiring
the mock into an application stay out of scope.

Requires [`uv`](https://docs.astral.sh/uv/) to run the generator.

## Skills

| Skill | Description |
|-------|-------------|
| [microcks-oidc](./skills/microcks-oidc/SKILL.md) | Add clients, machine-to-machine clients, users and claims to a Microcks OIDC mock, regenerate signed tokens, and verify the result. |

## Installation

### Copilot CLI / Claude Code

```
/plugin marketplace add microcks/microcks-agent-skills
/plugin install microcks-oidc@microcks-agent-skills
```

### VS Code

```json
{
  "chat.plugins.enabled": true,
  "chat.plugins.marketplaces": ["microcks/microcks-agent-skills"]
}
```

Then install the `microcks-oidc` plugin from the plugin browser.
