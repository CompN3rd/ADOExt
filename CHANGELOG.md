# Changelog

## 1.6.1 — 2026-05-08

### Fixed

- **Auth reliability**: Recover from stale Azure DevOps tokens when API calls reject the cached Microsoft session, refresh affected views and notifications, and preserve real permission errors after a one-time refresh attempt.

## 1.6.0 — 2026-05-07

### Added

- **PR merge & auto-complete**: Complete or set auto-complete on pull requests directly from the PR details panel. An in-panel modal lets you choose merge strategy, edit commit message, delete source branch, and transition associated work items.

### Fixed

- Marketplace icon background now fills corners (removed rounded corner radius).

## 1.5.0 — 2026-05-07

### Added

- **Custom marketplace icon**: New trinity-style icon combining Azure DevOps, Git, and MCP logos on a three-way gradient background.
- **Updated Azure DevOps logo**: Replaced the old cube/boards glyph with the official infinity-loop mark in both the marketplace icon and the sidebar/tree-view icon.
- **Hide completed work items**: New setting `adoext.workItemHideStates` (defaults to `["Done"]`) and toggle command `adoext.toggleHideDoneWorkItems` to show/hide work items by state.
- **Work item type icons**: Fetch type-specific icons from Azure DevOps metadata (including custom process icons) with scoped cache and bundled SVG fallback. Applies consistently across Work Items, Backlog, Sprint, and Board views. Controlled by `adoext.useRemoteWorkItemIcons`.
- **Bot PR thread differentiation**: Visually distinguish bot/service comments in the PR tree and details views with a "Tool" label and `hubot` icon.
- **Resolved-thread toggle**: New command `adoext.toggleResolvedPullRequestThreads` and setting `adoext.showResolvedPullRequestThreads` to show/hide resolved PR comment threads.
- **Hide system PR threads**: New setting `adoext.hideSystemPullRequestThreads` (default `true`) to auto-hide system-generated threads (policy status updates, ref updates, vote notifications) that Azure DevOps also hides in its web UI.
- **Assignee-scoped planning filter**: New setting `adoext.planningAssignedFilter` (`all` or `mine`) to filter Backlog, Sprint, and Board views by assigned user.

### Fixed

- Work item state hiding (`adoext.workItemHideStates`) now applies to Backlog, Sprint, and Board views in addition to the Work Items tree.

## 1.4.3 — 2025-05-07

### Fixed

- Fix "not a registered configuration" error when writing `pullRequestSortOrder`, `workItemFilterRegex`, `workItemSortOrder`, `backlogFilterRegex`, `backlogSortOrder`, and `pullRequestFilterRegex` to User Settings.
- Fix UI flickering caused by `onDidChangeSessions` re-entrancy loop (token refresh triggering recursive session-change events).
- Fix output panel dropdown closing prematurely due to rapid cascading tree-view refreshes; configuration change handler is now debounced (300 ms).

## 1.4.2

- **Host bundling**: Bundled the extension host entrypoint into a single runtime artifact with esbuild while preserving VS Code API externals.
- **Lean runtime package**: Switched VSIX packaging to ship bundled outputs only, removing `node_modules` from the published extension package.
- **Package size reduction**: Reduced the packaged extension footprint significantly by keeping only required runtime assets.

## 1.4.1

- **Packaging optimization**: Reduced VSIX size and file count by tightening `.vscodeignore` rules to exclude source/tooling files and dev-only dependency content from the published extension package.
- **Marketplace follow-up**: Published as a patch release because Marketplace package versions are immutable and cannot be overwritten in place.

## 1.4.0

- **Modernized webviews**: Rebuilt the PR details, work item details, backlog, board, sprint, and build summary panels on bundled Lit components. The extension host now focuses on loading Azure DevOps data and handling commands, while the webviews own rendering, responsive layout, and local interaction state.
- **Shared webview foundation**: Added reusable webview document/CSP helpers, typed view models, typed message contracts, and a browser-side rich text renderer. This reduces large inline HTML templates in the extension host and makes future panel work easier to evolve consistently.

## 1.3.1

- **Auth reliability**: The extension now automatically picks up token refreshes and session changes without requiring a window reload. The MCP server is also re-provisioned with a fresh token when the Microsoft authentication session changes.

## 1.3.0

- **Performance fix**: Limited pull request list to 100 items per scope to prevent UI freezing with large PR backlogs.
- **Pull request filtering**: Added regex-based filtering for PRs; run `ADOExt: Filter Pull Requests` to filter by PR ID or title.
- **Pull request sorting**: Added sort options for PRs: sort by Title (A-Z) or Date (Newest first) via `ADOExt: Sort Pull Requests` command.
- **Backlog/Sprint filtering & sorting**: Added filter (regex) and sort (Name/Date) controls to the Backlog and Sprint planning views in the webview panel.
- All filter and sort preferences persist in VS Code settings across sessions.

## 1.2.0

- Added regex-based filtering for work items: run `ADOExt: Filter Work Items` to filter by work item ID or title.
- Added sorting options for work items: sort by Name (A-Z) or Date (Newest first) via `ADOExt: Sort Work Items` command.
- Filter and sort preferences persist in VS Code settings across sessions.

## 1.1.1

- Fixed image loading in work item descriptions by widening CSP to allow Azure DevOps image sources and rewriting relative image paths to fully qualified URLs.

## 1.1.0

- Fixed pull request branch checkout in multi-repository workspaces by matching the PR against Azure DevOps remotes instead of guessing from folder names.
- Fixed checked-out pull request comment threads so they attach to the correct workspace repository and show inline in the affected files.
