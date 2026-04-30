# Contributing to @yocoolab/mcp-server

Thanks for your interest! This guide covers how to file issues, propose changes, and get them merged.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating you're expected to uphold it. Report unacceptable behavior to contact@yocoolab.com.

## Filing issues

- **Bugs:** use the bug report template (auto-loaded when you click "New issue").
- **Feature requests:** use the feature request template. Explain the use case before proposing the implementation.
- **Security vulnerabilities:** do **not** open a public issue. See [SECURITY.md](./SECURITY.md).

Search existing issues before opening a new one — duplicates are closed.

## Development setup

```bash
git clone https://github.com/Yocoolab/mcp-server.git
cd mcp-server
npm install
npm run build
npm test
```

You'll need Node.js 20 or newer. Active LTS lines (20, 22) are tested in CI. Node 18 (EOL April 2025) was dropped in v2.0.0.

## Branching and commits

- Branch from `main`. Use descriptive names: `fix/bin-resolution`, `feat/sse-transport`, `docs/troubleshooting`.
- We follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for messages so the changelog stays useful:

  | Prefix | Meaning | Effect on next release |
  |---|---|---|
  | `feat:` | New feature | minor version bump |
  | `fix:` | Bug fix | patch version bump |
  | `docs:` / `test:` / `refactor:` / `chore:` | No user-facing change | no version bump |
  | `feat!:` or footer `BREAKING CHANGE:` | Breaking change | major version bump |

  Example: `feat(setup): auto-detect Cursor on Windows`

## Pull request workflow

1. Fork the repo and create your branch.
2. Make your change. **Add or update tests** — the vitest suite lives in `src/__tests__/`.
3. Run `npm run build` and `npm test` locally before pushing.
4. Open a PR against `main`. Fill out the PR template.
5. CI must pass on Node 20 and 22.
6. A maintainer will review. At least one approval required to merge.
7. Squash-merge into `main`.

## Releases

Releases happen on `main` via tagged commits:

1. Update `CHANGELOG.md` under the new version heading.
2. Bump `package.json` with `npm version <patch|minor|major>` (creates the git tag).
3. Push tags: `git push --follow-tags`.
4. The GitHub Actions release workflow publishes to npm with cryptographic provenance via OIDC.

Maintainers only — see internal docs.

## Support policy

- **Latest major** gets active development and security patches.
- **Previous major** gets security patches for 90 days after a new major releases.
- **Older majors** are unsupported.

We support Node.js versions in [Active or Maintenance LTS](https://nodejs.org/en/about/previous-releases). EOL Node versions are dropped within 30 days of their end-of-life date.

## Questions

For non-bug questions, email contact@yocoolab.com.
