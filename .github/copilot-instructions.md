# RTK — Token-Optimized CLI

**rtk** is a CLI proxy that filters and compresses command outputs, saving 60-90% tokens.

## Rule

Always prefix shell commands with `rtk`:

```bash
# Instead of:              Use:
git status                 rtk git status
git log -10                rtk git log -10
cargo test                 rtk cargo test
docker ps                  rtk docker ps
kubectl get pods           rtk kubectl pods
```

## Meta commands (use directly)

```bash
rtk gain              # Token savings dashboard
rtk gain --history    # Per-command savings history
rtk discover          # Find missed rtk opportunities
rtk proxy <cmd>       # Run raw (no filtering) but track usage
```

---

# ADOExt Extension Development

> Full guide: **[AGENTS.md](../AGENTS.md)**

## Quick Reference

```bash
rtk npm run compile       # full build (type check + esbuild)
rtk npm run lint          # ESLint (max-warnings=0)
rtk npm run watch         # incremental rebuild
```

## Architecture in One Line

`src/commands/` → `AdoClient` (`src/api/adoClient.ts`) → `azure-devops-node-api` SDK.
`src/providers/` feeds 6 tree views. `src/views/webview/` uses Lit, compiled separately via `tsconfig.webviews.json`.

## Key Rules

- Use `ConfigManager` (not raw `workspace.getConfiguration`), `AdoClient` (not direct SDK calls)
- All features must work across multiple orgs/projects — use `projectScopes.ts` for scope resolution
- VS Code engine target is `^1.101.0` — verify API availability before use
- New commands: register in both `package.json` contributions and `src/extension.ts`

## MCP Servers Available

- **`github`** — issues, PRs, releases on CompN3rd/ADOExt (configured in `.vscode/mcp.json`)
- **`playwright`** — browser automation for testing webview panels (configured in `.vscode/mcp.json`)
- **ADO MCP** — the extension's own feature, auto-registered by `McpServerManager` when running
