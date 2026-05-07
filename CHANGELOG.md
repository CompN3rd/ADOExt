# Changelog

## 1.4.3 — 2025-05-07

### Fixed

- Fix "not a registered configuration" error when writing `pullRequestSortOrder`, `workItemFilterRegex`, `workItemSortOrder`, `backlogFilterRegex`, `backlogSortOrder`, and `pullRequestFilterRegex` to User Settings.
- Fix UI flickering caused by `onDidChangeSessions` re-entrancy loop (token refresh triggering recursive session-change events).
- Fix output panel dropdown closing prematurely due to rapid cascading tree-view refreshes; configuration change handler is now debounced (300 ms).
