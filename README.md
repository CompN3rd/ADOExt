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
  - Opens the multi-diff editor showing every changed file at once (same UX as the GitHub Pull Request extension); click any entry to focus its diff
  - Existing PR comment threads appear inline in the gutter, with full reply / resolve / reopen support
  - Add new line comments using the same `+` gutter affordance and floating editor as the built-in GitHub PR extension
- **Inline PR comments on the checked-out branch** — after running "Checkout Pull Request Branch", existing PR threads light up in the regular editor view so you can read and reply to them while editing the code, just like the built-in GitHub PR extension
- **New-comment notifications** — a small toast appears when tracked pull requests receive new comments. Toggle via `adoext.notifyOnNewPullRequestComments` (or the "Mute Notifications" action on the toast); poll interval via `adoext.pullRequestCommentPollIntervalSeconds`.
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
| `adoext.workItemQueries` | `[]` | Saved work item query definitions. When empty, ADOExt falls back to `adoext.workItemQuery`. |
| `adoext.activeWorkItemQueryId` | `""` | Active saved work item query ID. Falls back to the first saved query or the legacy query setting. |
| `adoext.workItemQuery` | `assigned` | Legacy work item filter used when no saved work item queries are defined. |
| `adoext.pullRequestQueries` | `[]` | Saved pull request bucket definitions. These are appended below built-in buckets in the Pull Requests view. |
| `adoext.activePullRequestQueryId` | `""` | Legacy pull request query selector state kept for backward compatibility with older versions. |
| `adoext.pullRequestFilter` | `mine` | Legacy pull request filter used as compatibility fallback when older settings are migrated. |

### Query and bucket management

Use **ADOExt: Select Work Item Query** to switch the active work item preset. In the Pull Requests view, built-in review buckets are always shown (Waiting for My Review, Created by Me, All Open), and **ADOExt: Save Pull Request Query Preset** adds custom buckets to that list. Use the inline refresh action on a bucket to reload only that bucket.

## Development

```bash
npm install
npm run compile
# or for watch mode:
npm run watch
```

Press `F5` in VS Code to launch the Extension Development Host.

## MCP Server Integration

ADOExt integrates with the official [Microsoft Azure DevOps MCP server](https://github.com/microsoft/azure-devops-mcp) (`@azure-devops/mcp`), providing a single-install experience with shared configuration. Updates to the official server flow through automatically.

### Quick Setup

Use the **ADOExt: Copy MCP Server Configuration** command to get a ready-to-paste configuration for `.vscode/mcp.json`. The command offers multiple authentication options:

**Interactive (browser-based, default — no PAT needed):**
```json
{
  "servers": {
    "azure-devops": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp", "your-org"]
    }
  }
}
```

> **Windows note:** If not using VS Code's native MCP provider (which handles this automatically), replace `"npx"` with `"npx.cmd"` in the command field.

**Bearer token via environment variable (e.g. from ADOExt sign-in session):**
```json
{
  "servers": {
    "azure-devops": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp", "your-org", "--authentication", "envvar"],
      "env": {
        "ADO_MCP_AUTH_TOKEN": "${ADO_MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

**PAT via environment variable:**
```json
{
  "servers": {
    "azure-devops": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp", "your-org", "--authentication", "pat"],
      "env": {
        "PERSONAL_ACCESS_TOKEN": "${PERSONAL_ACCESS_TOKEN}"
      }
    }
  }
}
```

### Available Tools

The official Azure DevOps MCP server provides tools across multiple domains:
- **Core** — Projects, teams, iterations
- **Work Items** — Query, create, update work items
- **Work** — Boards, sprints, backlogs
- **Repositories** — Repos, pull requests, branches
- **Pipelines** — Builds, releases
- **Wiki** — Pages, content
- **Search** — Code and work item search
- **Test Plans** — Test suites and results
- **Advanced Security** — Alerts and scanning

Use the `--domains` (`-d`) flag to load only specific domains. See the [official toolset docs](https://github.com/microsoft/azure-devops-mcp/blob/main/docs/TOOLSET.md) for the full list.

### Development Wrapper

For development/testing purposes, the repository includes a wrapper script that bridges environment variables to the official server CLI:

```bash
# Interactive browser-based auth (default, no env vars needed)
npx -y @azure-devops/mcp your-org

# Development wrapper (run from repo after `npm run compile`)
export ADO_ORGANIZATION="your-org"
node out/mcp/main.js                              # interactive (browser)

export ADO_ACCESS_TOKEN="bearer-token-here"       # maps to ADO_MCP_AUTH_TOKEN
node out/mcp/main.js                              # uses --authentication envvar

export AZURE_DEVOPS_PAT="your-pat-here"           # maps to PERSONAL_ACCESS_TOKEN
node out/mcp/main.js                              # uses --authentication pat
```

> **Note:** The `node out/mcp/main.js` path is only valid when running from the source repository after compilation. End users should use the `npx @azure-devops/mcp` configurations above.

### Authentication

The MCP server supports multiple authentication methods (checked in order by the wrapper):

1. **Interactive (browser)** — Default. Opens a browser for Microsoft OAuth sign-in. No environment variables needed.
2. **Bearer token** (`ADO_MCP_AUTH_TOKEN`) — Pass a bearer token via the `--authentication envvar` method. The wrapper maps `ADO_ACCESS_TOKEN` → `ADO_MCP_AUTH_TOKEN`.
3. **PAT** (`PERSONAL_ACCESS_TOKEN`) — Personal access token for automation scenarios. The wrapper maps `AZURE_DEVOPS_PAT` → `PERSONAL_ACCESS_TOKEN`.

The **ADOExt: Copy MCP Server Configuration** command generates env-var-based configurations that reference `${ADO_MCP_AUTH_TOKEN}` or `${PERSONAL_ACCESS_TOKEN}` — tokens are never embedded directly in the config file.

