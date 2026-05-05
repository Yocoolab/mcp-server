# Changelog

All notable changes to `@yocoolab/mcp-server` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.1] — 2026-04-30

### Fixed
- **Deterministic agent IDs.** Previously each MCP server start generated a fresh agent ID (`${type}-${Date.now()}`) and registered it with the bridge, so each Claude Code restart left a stale entry. The extension's agent picker would fill up with duplicate "Claude Code" rows. Agent ID is now derived from a SHA-256 of `agentType | workspace | agentName` (truncated to 12 hex chars), so re-launching on the same workspace updates the existing entry instead of creating a new one. Different workspaces still get distinct IDs.

## [2.1.0] — 2026-04-30

### Added
- **`--token` and `--github-token` CLI flags** for the setup wizard. Lets the wizard accept the Yocoolab JWT (and optional GitHub PAT) inline so the user doesn't have to paste them into the generated config:
  ```bash
  npx -y @yocoolab/mcp-server@2 setup --token=<jwt>
  ```
  The flags are the underlying contract for the new one-click "Install for Claude Code" button in the Yocoolab Chrome extension, which mints a one-time session and hands it off to a dashboard install page that writes `.mcp.json` for the user — no terminal at all on Chromium browsers.

### Changed
- Setup wizard's "Next steps" output now adapts to which flags were passed: skips the JWT-paste step when `--token` was provided, and skips the GitHub-PAT step when `--github-token` was provided (or always shows it as Optional).

## [2.0.0] — 2026-04-30

### BREAKING CHANGES
- **Dropped Node.js 18.** The minimum supported version is now Node 20. Node 18 went EOL on 2025-04-30 and is no longer in our test matrix. Per our [support policy](./CONTRIBUTING.md), we drop Node versions within 30 days of EOL.
  - Migration: upgrade to Node 20 or newer (`nvm install 20 && nvm use 20`, or your preferred version manager). The Yocoolab tooling itself is unchanged — `npx -y @yocoolab/mcp-server@2 setup` works the same as before.

### Added
- **Multi-agent setup wizard.** `yocoolab-mcp setup` auto-detects Claude Code, Cursor, Cline, Roo Code, and Windsurf, and writes the correct MCP config for each. (`init` is kept as an alias for backwards compatibility.)
- **Agent registry on the bridge.** The HTTP bridge now tracks connected agents — the MCP server auto-registers on startup and heartbeats every 15 s, and the bridge cleans up stale registrations after 30 s. New endpoints: `GET /agents`, `POST /agents/register`, `DELETE /agents/:id`.
- **Configurable agent identity.** `YOCOOLAB_AGENT_NAME` and `YOCOOLAB_AGENT_TYPE` env vars let the server announce itself by name/type to the bridge — the Chrome extension uses this for its agent picker.
- **Multi-context bridge selections.** The bridge accepts `screenshots[]` and `elements[]` arrays so users can gather multiple captures before sending to the agent.
- **Token now optional.** When `YOCOOLAB_TOKEN` is unset, thread-feedback tools are disabled but bridge / companion / activity tools still work. The server prints a warning instead of refusing to start.
- `CODE_OF_CONDUCT.md`, GitHub issue templates (bug, feature), pull-request template, and `.github/dependabot.yml`.

### Changed
- `YOCOOLAB_API_URL` default changed from `http://localhost:3000` to `https://app.yocoolab.com` (production).
- `SECURITY.md` reporting address is now `contact@yocoolab.com`.
- Subcommand dispatcher in `index.ts` was refactored so `setup` / `init` / `--help` no longer fall through to server startup.

### Fixed
- Tools `get_element_context` and `find_source_for_selection` now return a structured error when called without `YOCOOLAB_TOKEN`, instead of crashing.

### Known issues
- Test suites for `http-bridge` and `create-pr` are currently skipped — the mocks were stale against API surface changes that landed before this release. New tests pass; this only affects the legacy suites. Tracked in CONTRIBUTING / repo issues.

## [1.0.1] — 2026-04-30

### Fixed
- `npx -y @yocoolab/mcp-server` now resolves the bin correctly. Added an `mcp-server` bin alias matching the unscoped package name so npx finds it without requiring `--package=…` or `-- yocoolab-mcp`. The original `yocoolab-mcp` command name still works.

## [1.0.0] — 2026-04-23

### Added
- Initial public release of the Yocoolab MCP server.
- `yocoolab-mcp init` interactive setup wizard — writes `~/.mcp.json` with correct paths, prompts for the Yocoolab JWT, and adds `.mcp.json` to `.gitignore` in git repos.
- `yocoolab-mcp --help` CLI help.
- Thread tools: `list_open_threads`, `get_thread_context`, `add_thread_message`, `mark_thread_addressed`, `create_pr_for_thread`.
- Selection / Bridge tools: `get_latest_selection`, `get_selection_history`, `get_element_context`, `find_source_for_selection`, `ai_analyze_page`.
- Activity tools: `get_recent_events`, `get_activity_summary`, `get_files_touched`, `get_companion_messages`, `reply_to_companion`.
- AI tools: `get_ai_conversations`.
- Deployment tools: `get_deployment_preview`.
- Pendo integration tools: `pendo_list_guides`, `pendo_page_analytics`, `pendo_feature_usage`, `pendo_track_event`.

[2.1.1]: https://github.com/Yocoolab/mcp-server/releases/tag/v2.1.1
[2.1.0]: https://github.com/Yocoolab/mcp-server/releases/tag/v2.1.0
[2.0.0]: https://github.com/Yocoolab/mcp-server/releases/tag/v2.0.0
[1.0.1]: https://github.com/Yocoolab/mcp-server/releases/tag/v1.0.1
[1.0.0]: https://github.com/Yocoolab/mcp-server/releases/tag/v1.0.0
