# Microcks Agent Skills

A marketplace of AI agent skills and plugins to ease your life working with [Microcks](https://microcks.io/).

## Plugins

| Plugin | Description |
|--------|-------------|
| [plugin1](./plugins/plugin1) | Plugin 1 placeholder — replace with your plugin description. |
| [plugin2](./plugins/plugin2) | Plugin 2 placeholder — replace with your plugin description. |

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
See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution workflow.
