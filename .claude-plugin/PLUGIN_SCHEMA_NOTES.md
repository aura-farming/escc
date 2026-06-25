# Plugin Schema Notes

Reference notes for the two manifests in this directory — `plugin.json` and
`marketplace.json`. This file is documentation only; it does not configure
anything. Do not treat it as a source of truth that overrides the manifests
themselves.

## 1. Placeholder URLs — replace before publishing

Both `plugin.json` and `marketplace.json` set:

- `homepage`: `https://github.com/aura-farming/escc`
- `repository`: `https://github.com/aura-farming/escc`

`https://github.com/aura-farming/escc` is the published repository URL. Keep
`homepage` and `repository` in both manifests pointing at it; never substitute a
personal or machine-local path.

## 2. Schema choices already made

These decisions are baked into the manifests. Keep them consistent if you edit.

### marketplace.json

- **`source`: `"./"`** — the plugin is sourced from a **local path** (this repo
  root), not a remote Git reference. This is what makes a local `/plugin
  marketplace add` install work directly from a checkout.
- **`strict`: `false`** — relaxed validation. Skills and commands are discovered
  from their directories rather than each being enumerated explicitly, so new
  content can be added without amending the manifest.
- A single plugin entry named `escc`, `category: "workflow"`, with sales-domain
  `keywords`/`tags`.

### plugin.json

- **`skills`: `["./skills/"]`** — skills are loaded from the `./skills/`
  directory. Each subfolder with a `SKILL.md` becomes one skill.
- **`commands`: `["./commands/"]`** — commands are loaded from the
  `./commands/` directory (thin shims over skills).
- `name`: `escc`, `version`: `1.2.0`, `license`: `MIT`. `mcpServers` is left as
  an empty object — MCP servers (HubSpot, Gmail, Google Calendar, Fireflies) are
  configured by the operator's environment, not bundled here.

## 3. Local-marketplace install path

The default and supported install flow is the local marketplace:

1. From a Claude Code session, run `/plugin marketplace add` pointed at this
   repository (the directory containing this `.claude-plugin/` folder).
2. Claude Code reads `marketplace.json`, resolves the `escc` plugin via its
   local `"./"` source, and installs from the working copy.
3. Once installed, skills load under the **`escc:` namespace** and are invoked
   as `escc:<skill-name>` (for example `escc:cold-outreach`). Commands become
   available as their corresponding slash commands.

Because `source` is `"./"`, there is no separate publish/fetch step for local
use — the repo checkout *is* the marketplace entry. Replace the placeholder URLs
in section 1 only when you move to a remotely published distribution.
