# Changelog

All notable changes to `@yocoolab/mcp-server` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.1]: https://github.com/yocoolab/mcp-server/releases/tag/v1.0.1
[1.0.0]: https://github.com/yocoolab/mcp-server/releases/tag/v1.0.0
