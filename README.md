# @yocoolab/mcp-server

[![npm version](https://img.shields.io/npm/v/@yocoolab/mcp-server.svg?style=flat-square)](https://www.npmjs.com/package/@yocoolab/mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/@yocoolab/mcp-server.svg?style=flat-square)](https://www.npmjs.com/package/@yocoolab/mcp-server)
[![CI](https://img.shields.io/github/actions/workflow/status/Yocoolab/mcp-server/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/Yocoolab/mcp-server/actions/workflows/ci.yml)
[![License](https://img.shields.io/npm/l/@yocoolab/mcp-server.svg?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/node/v/@yocoolab/mcp-server.svg?style=flat-square)](./package.json)
[![Types](https://img.shields.io/npm/types/@yocoolab/mcp-server.svg?style=flat-square)](./package.json)
[![OpenSSF Best Practices](https://img.shields.io/badge/OpenSSF-best%20practices-blue?style=flat-square)](https://www.bestpractices.dev/)

MCP (Model Context Protocol) server that exposes [Yocoolab](https://yocoolab.com) feedback threads, design selections, and activity events as tools for Claude Code and other MCP-compatible clients.

With this installed, your AI coding assistant can:

- List and triage open design feedback threads on your repo
- Pull rich context for a thread (selection, screenshot, conversation, files touched)
- Reply to designers and mark threads as addressed
- Open PRs that close out feedback threads
- Inspect element context and selection history from the Yocoolab Chrome extension
- Read activity summaries, AI conversations, and Pendo product analytics

## Install

One command:

```bash
npx -y @yocoolab/mcp-server@2 setup
```

The `setup` wizard auto-detects your installed AI agents (Claude Code, Cursor, Cline, Roo Code, Windsurf) and writes the correct MCP config for each. Restart your agent and the `yocoolab` server appears with all tools available.

> `init` is kept as an alias for `setup` for backwards compatibility with v1.0.x install instructions.

If you'd rather configure manually, the equivalent `~/.mcp.json` looks like:

```json
{
  "mcpServers": {
    "yocoolab": {
      "command": "npx",
      "args": ["-y", "@yocoolab/mcp-server@2"],
      "env": {
        "YOCOOLAB_API_URL": "https://app.yocoolab.com",
        "YOCOOLAB_TOKEN": "<your-yocoolab-jwt>",
        "GITHUB_TOKEN": "<your-github-pat>",
        "YOCOOLAB_BRIDGE_PORT": "9800",
        "YOCOOLAB_BRIDGE_WORKSPACE": "/absolute/path/to/your/workspace"
      }
    }
  }
}
```

The `@2` version pin keeps you on the v2 major line — you'll receive bug fixes and new features automatically, but a future v3 with breaking changes won't break your setup. (Pin to `@1` if you need Node 18 support — v1.x will receive security patches for 90 days after v2.0.)

## Requirements

- **Node.js 20 or newer.** We test on Node 20 and 22 in CI. We support whichever Node.js versions are currently in [Active LTS or Maintenance LTS](https://nodejs.org/en/about/previous-releases) status, and drop versions within 30 days of their EOL. Node 18 was dropped in v2.0.0 (EOL April 2025).
- **A Yocoolab account and JWT token** — get yours from the Yocoolab Chrome extension settings, or via your account at [app.yocoolab.com](https://app.yocoolab.com).
- **A GitHub personal access token** with `repo` scope, if you want to use the PR-creation tools.

## Configuration

| Env var | Required | Default | Description |
|---|---|---|---|
| `YOCOOLAB_TOKEN` | no | — | Your Yocoolab JWT (from the Chrome extension). When unset, thread feedback tools are disabled but bridge / companion / activity tools still work. |
| `YOCOOLAB_API_URL` | no | `https://app.yocoolab.com` | Yocoolab API base URL |
| `GITHUB_TOKEN` | only for PR tools | — | GitHub PAT with `repo` scope |
| `YOCOOLAB_BRIDGE_PORT` | no | `9800` | Local port for the HTTP bridge to the Chrome extension |
| `YOCOOLAB_BRIDGE_WORKSPACE` | no | `process.cwd()` | Absolute path to your project workspace, used to resolve file references in selections |
| `YOCOOLAB_AGENT_NAME` | no | `Claude Code` | Display name shown in the Chrome extension's agent picker |
| `YOCOOLAB_AGENT_TYPE` | no | `claude-code` | Agent type identifier (`claude-code`, `roo`, `cline`, `cursor`, `windsurf`, or `custom`) |

## CLI

```
yocoolab-mcp           Run the MCP server (used by your agent via .mcp.json)
yocoolab-mcp setup     Interactive setup — auto-detects agents and writes their configs
yocoolab-mcp init      Alias for `setup` (backwards compatible with v1.0.x)
yocoolab-mcp --help    Show this help
```

The `mcp-server` command is a synonym for `yocoolab-mcp`. Either works.

## Tools

The server exposes tools across several categories:

- **Threads** — `list_open_threads`, `get_thread_context`, `add_thread_message`, `mark_thread_addressed`, `create_pr_for_thread`
- **Selection / Bridge** — `get_latest_selection`, `get_selection_history`, `get_element_context`, `find_source_for_selection`, `ai_analyze_page`
- **Activity** — `get_recent_events`, `get_activity_summary`, `get_files_touched`, `get_companion_messages`, `reply_to_companion`
- **AI** — `get_ai_conversations`
- **Deployment** — `get_deployment_preview`
- **Pendo (optional)** — `pendo_list_guides`, `pendo_page_analytics`, `pendo_feature_usage`, `pendo_track_event`

For full tool descriptions and parameters, your MCP client will list them after the server starts.

## Troubleshooting

**`yocoolab-mcp: command not found`** — make sure you're on v1.0.1 or newer. Run `npx -y @yocoolab/mcp-server@latest setup` to get the current release.

**`[yocoolab] Warning: YOCOOLAB_TOKEN not set`** — thread feedback tools are disabled without a token, but bridge / companion / activity tools still work. To enable everything, run `yocoolab-mcp setup` to (re)generate the config with your JWT.

**Tools don't appear in your agent after install** — restart your agent completely (quit & reopen). MCP servers load at startup.

**`Port 9800 is already in use`** — another instance of the MCP server is running, or another app has the port. Set `YOCOOLAB_BRIDGE_PORT` to a different value (e.g. `9801`) in your `.mcp.json`.

**Verbose diagnostic logs** — set `DEBUG=yocoolab:*` in your env block. All diagnostic output goes to stderr (so it doesn't interfere with the MCP stdio protocol on stdout).

## Support

- **Documentation:** this README, plus inline tool descriptions visible in your MCP client
- **Bug reports:** [github.com/Yocoolab/mcp-server/issues](https://github.com/Yocoolab/mcp-server/issues) (use the bug template)
- **Security issues:** see [SECURITY.md](./SECURITY.md) — do **not** open a public issue
- **Other questions:** support@yocoolab.com

## Development

```bash
git clone https://github.com/Yocoolab/mcp-server.git
cd mcp-server
npm install
npm run build       # compile TypeScript to dist/
npm test            # run the vitest suite
npm run dev         # tsc --watch
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contributor workflow.

## Security & supply chain

- Released with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) — every published version is cryptographically signed by GitHub Actions OIDC, traceable back to the exact commit and workflow run.
- Each release ships with a CycloneDX SBOM attached to the GitHub Release.
- We run `npm audit signatures` and CodeQL static analysis in CI on every PR.
- See [SECURITY.md](./SECURITY.md) for vulnerability reporting.

## License

[Apache 2.0](./LICENSE) — © 2026 Yocoolab
