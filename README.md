# Microcks Agent Skills

A marketplace of AI agent skills and plugins to ease your life working with [Microcks](https://microcks.io/).

## Plugins

| Plugin | Description |
|--------|-------------|
| [microcks-oidc](./plugins/microcks-oidc) | Mock OpenID Connect provider served by Microcks, with generated keys, signed tokens and dispatch rules. |

## Installation

### Copilot CLI / Claude Code

1. Add the marketplace:
   ```
   /plugin marketplace add microcks/microcks-agent-skills
   ```
2. Install a plugin:
   ```
   /plugin install <plugin>@microcks-agent-skills
   ```
3. Restart to load the new plugins.
4. View available skills:
   ```
   /skills
   ```

### VS Code / VS Code Insiders

```json
// settings.json
{
  "chat.plugins.enabled": true,
  "chat.plugins.marketplaces": ["microcks/microcks-agent-skills"]
}
```

Then type `/plugins` in Copilot Chat to browse and install plugins.

## Contributing

See [AGENTS.md](./AGENTS.md) for the plugin structure conventions and how to add a new plugin.
See [Developer workflows](./docs/developer-workflows.md) for how contributors use the local authoring and evaluation skills.
See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution workflow.
