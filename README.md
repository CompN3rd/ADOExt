# ADOExt
Azure DevOps Extension for VS Code

## Features

ADOExt is a full-featured Azure DevOps integration for Visual Studio Code, providing an experience similar to the GitHub Issues & Pull Requests extension but for Azure DevOps.

### Work Items
- Browse work items assigned to you, created by you, or all active items
- Items aggregate across the selected organizations/projects and are grouped by project and state
- Work item type icons use custom ADO-style icons for bugs, tasks, epics, features, stories, PBIs, and issues
- **One-click to view full work item details in a dedicated webview panel** — no browser needed
  - See title, type, state, priority, assignee, description, area path, iteration, and tags
  - Change work item state directly from VS Code
  - View and add discussion comments directly from the panel
  - Open in browser available as a secondary action

### Backlog, Sprints, and Boards
- View a hierarchical backlog using Azure DevOps parent/child work item links
- Browse sprint work grouped by iteration path
- Browse board work grouped by state columns
- Open Backlog and Board editor views for wider nested planning layouts
- Change work item state from the editor planning views and refresh the sidebar views automatically
- Open any work item from these planning views in the same details panel used by the Work Items view

### Pull Requests
- View active pull requests (yours, created, assigned to you, or all) aggregated across selected organizations/projects
- Expand pull requests to see all comment threads inline
- Reply to comment threads directly from the tree view
- Resolve or reopen comment threads without leaving VS Code
- **One-click to view full PR details in a dedicated webview panel** — no browser needed
  - See title, description, reviewers, source/target branches, and all comment threads
  - Reply to threads, resolve/reopen, and add new comments from the panel
  - Open in browser available as a secondary action
- **Native diff editor for pull requests** — picks up VS Code's normal side-by-side diff UI instead of a custom webview
  - Pick a changed file from a quick pick to open the side-by-side diff
  - Existing PR comment threads appear inline in the gutter, with full reply / resolve / reopen support
  - Add new line comments using the same `+` gutter affordance and floating editor as the built-in GitHub PR extension
- **Inline PR comments on the checked-out branch** — after running "Checkout Pull Request Branch", existing PR threads light up in the regular editor view so you can read and reply to them while editing the code, just like the built-in GitHub PR extension
- **Checkout a PR branch** with a single click using the built-in Git extension

### Multi-Account & Multi-Organization Support
- Uses VS Code's built-in Microsoft authentication — no manual token management
- Works seamlessly with multiple Microsoft accounts already signed in to VS Code
- Organization picker lists all ADO organizations your account belongs to and supports selecting multiple organizations or all organizations
- Project picker supports selecting multiple projects per organization or all projects
- Switch organization/project aggregation anytime via the toolbar commands

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
| `adoext.organizations` | `[]` | Organizations selected for aggregated views |
| `adoext.projectsByOrganization` | `{}` | Project selections by organization; `["*"]` means all projects |
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

