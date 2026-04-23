# @yocoolab/mcp-server

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
npx -y @yocoolab/mcp-server@1 init
```

The `init` wizard prompts for your Yocoolab JWT, writes a working `~/.mcp.json` with correct paths and `npx` invocation, and adds `.mcp.json` to your project's `.gitignore` if it's a git repo. Then restart Claude Code (or your MCP client of choice) and the `yocoolab` server appears with all tools available.

If you'd rather configure manually, the equivalent `~/.mcp.json` looks like:

```json
{
  "mcpServers": {
    "yocoolab": {
      "command": "npx",
      "args": ["-y", "@yocoolab/mcp-server@1"],
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

The `@1` version pin keeps you on the v1 major line — you'll receive bug fixes and new features automatically, but a future v2 with breaking changes won't break your setup.

## Requirements

- Node.js 18 or newer
- A Yocoolab account and JWT token (get yours from the Yocoolab Chrome extension settings)
- A GitHub personal access token if you want to use the PR-creation tools

## Configuration

| Env var | Required | Default | Description |
|---|---|---|---|
| `YOCOOLAB_TOKEN` | yes | — | Your Yocoolab JWT, copied from the Chrome extension |
| `YOCOOLAB_API_URL` | no | `http://localhost:3000` | Yocoolab API base URL. Use `https://app.yocoolab.com` for production. |
| `GITHUB_TOKEN` | only for PR tools | — | GitHub PAT with `repo` scope |
| `YOCOOLAB_BRIDGE_PORT` | no | `9800` | Local port for the HTTP bridge to the Chrome extension |
| `YOCOOLAB_BRIDGE_WORKSPACE` | no | `process.cwd()` | Absolute path to your project workspace, used to resolve file references in selections |

## Tools

The server exposes tools across several categories:

- **Threads** — `list_open_threads`, `get_thread_context`, `add_thread_message`, `mark_thread_addressed`, `create_pr_for_thread`
- **Selection / Bridge** — `get_latest_selection`, `get_selection_history`, `get_element_context`, `find_source_for_selection`, `ai_analyze_page`
- **Activity** — `get_recent_events`, `get_activity_summary`, `get_files_touched`, `get_companion_messages`, `reply_to_companion`
- **AI** — `get_ai_conversations`
- **Deployment** — `get_deployment_preview`
- **Pendo (optional)** — `pendo_list_guides`, `pendo_page_analytics`, `pendo_feature_usage`, `pendo_track_event`

For full tool descriptions and parameters, your MCP client will list them after the server starts.

## Development

```bash
git clone https://github.com/yocoolab/mcp-server.git
cd mcp-server
npm install
npm run build       # compile TypeScript to dist/
npm test            # run the vitest suite
npm run dev         # tsc --watch
```

## Security

For security issues please see [SECURITY.md](./SECURITY.md). Please **do not** open public GitHub issues for vulnerability reports.

## License

[Apache 2.0](./LICENSE) — © 2026 Yocoolab
