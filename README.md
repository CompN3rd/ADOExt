# ADOExt
Azure Devops Extension for VS Code

## Features

ADOExt is a full-featured Azure DevOps integration for Visual Studio Code, providing an experience similar to the GitHub Issues & Pull Requests extension but for Azure DevOps.

### Work Items
- Browse work items assigned to you, created by you, or all active items
- Items are grouped by state (Active, New, Resolved, etc.)
- One-click to open a work item in the browser

### Pull Requests
- View active pull requests (yours, created, assigned to you, or all)
- Expand pull requests to see all comment threads inline
- Reply to comment threads directly from the tree view
- Resolve or reopen comment threads without leaving VS Code
- View full PR details (description, reviewers, all comments) in a dedicated webview panel
- **Checkout a PR branch** with a single click using the built-in Git extension

### Multi-Account & Multi-Organization Support
- Uses VS Code's built-in Microsoft authentication — no manual token management
- Works seamlessly with multiple Microsoft accounts already signed in to VS Code
- Organization picker lists all ADO organizations your account belongs to
- Switch organization/project anytime via the toolbar commands

## Getting Started

1. Open the **Azure DevOps** activity bar icon (sidebar)
2. Click **Sign In** (or the organization icon) to authenticate with your Microsoft account
3. Select your Azure DevOps **organization** from the auto-populated list
4. Select your **project** from the auto-populated list
5. Work items and pull requests will load automatically

## Configuration

| Setting | Default | Description |
|---|---|---|
| `adoext.organization` | *(empty)* | ADO organization name |
| `adoext.project` | *(empty)* | ADO project name |
| `adoext.workItemQuery` | `assigned` | Which work items to show: `assigned`, `created`, `mentioned`, `all` |
| `adoext.pullRequestFilter` | `mine` | Which PRs to show: `mine`, `created`, `assigned`, `all` |

## Development

```bash
npm install
npm run compile
# or for watch mode:
npm run watch
```

Press `F5` in VS Code to launch the Extension Development Host.

