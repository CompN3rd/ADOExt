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
