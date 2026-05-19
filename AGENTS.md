# AGENTS.md

Agent instructions for the ADOExt VS Code extension.

## Purpose

Help coding agents make safe, minimal changes in this TypeScript VS Code extension that integrates with Azure DevOps.

## Read First

1. [README.md](README.md)
2. [src/extension.ts](src/extension.ts)
3. [src/api/adoClient.ts](src/api/adoClient.ts)
4. [src/auth/authProvider.ts](src/auth/authProvider.ts)
5. [src/config/configManager.ts](src/config/configManager.ts)

## Build And Validate

- Install: `npm install`
- Compile: `npm run compile`
- Watch: `npm run watch`
- Lint: `npm run lint`

Always run `npm run compile` after TypeScript changes. Run `npm run lint` when touching multiple files or refactoring.

## Architecture Map

- `src/extension.ts`: activation entrypoint; registers commands, providers, and views.
- `src/api/adoClient.ts`: Azure DevOps API wrapper; prefer extending this instead of calling SDK clients from UI layers.
- `src/auth/`: Microsoft auth/session management.
- `src/config/`: extension settings read/write (`adoext.*`).
- `src/commands/`: command handlers only; keep orchestration here, not low-level API details.
- `src/providers/`: TreeDataProviders, completion, hover, and planning providers.
- `src/views/`: webview panels and PR content/comment integrations.
- `src/notifications/`: polling + notification handlers.
- `src/utils/`: shared helpers (scope resolution, regex, async helpers, repo context).

## Conventions

- Use `ConfigManager` for configuration access; avoid direct ad-hoc `workspace.getConfiguration` usage in new code.
- Use `AdoClient` for Azure DevOps calls; keep API-specific logic centralized.
- Guard command flows with sign-in checks before org/project operations.
- Preserve multi-org/multi-project behavior. New data fetches should work with resolved project scopes, not single hardcoded project context.
- Prefer existing user notification helpers from `src/utils/notifications.ts` for consistent UX and logging.
- Keep provider and command changes incremental; avoid broad refactors unless requested.

## Release Versioning

- Follow SemVer conservatively for extension releases.
- Use a patch bump for bug fixes, regressions, packaging changes, and documentation-only release follow-ups.
- Use a minor bump only for new backward-compatible user-facing features.
- Use a major bump only for intentional breaking changes.
- If a requested version bump appears larger than the actual change scope, call that out and suggest the smallest appropriate bump before editing version metadata or publishing.

## Provider Patterns

- Tree views: update via existing refresh/event emitter patterns.
- Completion/hover: keep caches scoped and time-bounded; avoid storing position-bound editor objects in long-lived caches.
- PR/work item details: reuse existing panel/controller patterns instead of adding duplicate webviews.

## Pitfalls

- VS Code engine target is `^1.101.0`; avoid APIs requiring newer versions unless the engine is updated.
- PR and work item features must continue to work across multiple selected orgs/projects.
- Avoid markdown injection in hover/webview content; treat service-returned text as untrusted.
- Keep concurrent cross-scope calls bounded; do not remove existing concurrency controls without reason.

## Change Scope Rules

- Prefer minimal diffs in the relevant module.
- Do not rename commands/settings/contribution IDs unless explicitly requested.
- If command IDs are added or changed, update both `package.json` contributions and `src/extension.ts` registration.

## When Adding Features

1. Add/extend command implementation under `src/commands/` or provider under `src/providers/`.
2. Register in `src/extension.ts`.
3. Add contribution metadata (commands/menus/views) in `package.json` when needed.
4. Compile and fix TypeScript errors.
5. Update [README.md](README.md) only if user-visible behavior changed.

## Webview Architecture

The extension has two separate TypeScript compilation targets:

- **Extension host** (`tsconfig.json`): `src/` → `out/extension.js` via esbuild, Node/CJS target, VS Code API available.
- **Webviews** (`tsconfig.webviews.json`): `src/views/webview/` → `media/webviews/*.js` via esbuild, browser/IIFE target, no Node APIs.

Webview components use [Lit](https://lit.dev/) (`lit` npm package). Communication between host and webview goes through `vscode.postMessage` / `window.addEventListener('message')`. The `src/views/webview/vscodeApi.ts` shim acquires the VS Code webview API.

Never import host-side modules from webview files or vice versa — the build will either fail or silently break at runtime.

## Key Patterns

**Provider refresh**: Call the provider's `refresh()` method or fire its `_onDidChangeTreeData` emitter. Do not replace provider instances.

**Cross-org fetch** (`src/providers/projectScopes.ts`): Always resolve project scopes via `ProjectScopes.resolveScopes()` before making API calls. New data fetches must iterate over all resolved scopes, not a single hardcoded project.

**Concurrency** (`src/utils/async.ts`): Use the existing `parallelLimit` / `mapParallelLimit` helpers when fetching across multiple orgs/projects. Do not remove concurrency bounds.

**Notifications** (`src/utils/notifications.ts`): Use `showInformationMessage`, `showWarningMessage`, `showErrorMessage` from this module — they add structured logging alongside VS Code toasts.

**Error handling** (`src/utils/adoErrors.ts`, `src/providers/providerErrors.ts`): Classify ADO errors before surfacing them. Auth errors trigger re-auth via `src/utils/authRecovery.ts`.

## Common Debug Flows

**Tree view is empty**:
1. Check `AuthProvider.isSignedIn` — if false, sign-in gate is blocking.
2. Check `ConfigManager.selectedOrganizations` — if empty, no org is configured.
3. Check `ProjectScopes.resolveScopes()` return value — may be filtering out all projects.
4. Look for uncaught errors in the provider's `getChildren()` — wrap in try/catch and check Output panel.

**API call fails silently**:
1. Check `AdoClient` method — it wraps SDK calls; look for swallowed exceptions.
2. Enable the ADO Extension output channel in VS Code for structured logs.
3. Use `adoErrors.ts` classification to distinguish auth vs. network vs. not-found errors.

**Webview shows blank/broken**:
1. Run `npm run compile:webviews` — webview JS is compiled separately.
2. Open VS Code Developer Tools (Help → Toggle Developer Tools) and check the webview iframe console.
3. Check that the panel's `getWebviewContent()` passes the correct `media/webviews/*.js` URIs with `webview.asWebviewUri()`.

## MCP Server (Development)

The extension's own ADO MCP server is registered by `McpServerManager` and appears in VS Code automatically when the extension is running. It delegates to the official `@azure-devops/mcp` package.

For agent tools available during development (not the extension's own feature), see `.claude/settings.json` (Claude Code), `.vscode/mcp.json` (VS Code Copilot), and `opencode.json` (opencode): GitHub MCP and Playwright MCP are configured in all three.

## Agent Tooling

This repo supports three agent tools side-by-side. All three read **AGENTS.md** as the source of truth — tool-specific files are thin shims.

- **Claude Code** — `.claude/settings.json` (MCP + permissions + rtk hook), `.claude/commands/`
- **VS Code Copilot** — `.github/copilot-instructions.md`, `.vscode/mcp.json`, `.github/hooks/rtk-rewrite.json`
- **opencode** — `opencode.json` (MCP + permissions), `.opencode/commands/`

**rtk integration**: Claude and Copilot use per-repo hooks. opencode uses a **global** plugin installed once via `rtk init -g --opencode` at `~/.config/opencode/plugins/rtk.ts` — no per-repo opencode plugin needed (and committing one would duplicate the global hook).
