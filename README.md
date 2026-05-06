# 🚀 ADOExt — Azure DevOps for VS Code

A full-featured Azure DevOps integration for Visual Studio Code, bringing the power of ADO directly into your editor. Manage work items, pull requests, builds, and team collaboration—all without leaving VS Code.

## Changelog

### 1.3.0
- **Performance fix**: Limited pull request list to 100 items per scope to prevent UI freezing with large PR backlogs.
- **Pull request filtering**: Added regex-based filtering for PRs; run `ADOExt: Filter Pull Requests` to filter by PR ID or title.
- **Pull request sorting**: Added sort options for PRs: sort by Title (A-Z) or Date (Newest first) via `ADOExt: Sort Pull Requests` command.
- **Backlog/Sprint filtering & sorting**: Added filter (regex) and sort (Name/Date) controls to the Backlog and Sprint planning views in the webview panel.
- All filter and sort preferences persist in VS Code settings across sessions.

### 1.2.0
- Added regex-based filtering for work items: run `ADOExt: Filter Work Items` to filter by work item ID or title.
- Added sorting options for work items: sort by Name (A-Z) or Date (Newest first) via `ADOExt: Sort Work Items` command.
- Filter and sort preferences persist in VS Code settings across sessions.

### 1.1.1
- Fixed image loading in work item descriptions by widening CSP to allow Azure DevOps image sources and rewriting relative image paths to fully qualified URLs.

### 1.1.0
- Fixed pull request branch checkout in multi-repository workspaces by matching the PR against Azure DevOps remotes instead of guessing from folder names.
- Fixed checked-out pull request comment threads so they attach to the correct workspace repository and show inline in the affected files.

---

## ✨ Key Features

### 📋 **Work Item Management**
- **Browse & Filter** — View work items assigned to you, created by you, or across your entire portfolio
- **Multi-Org Aggregation** — Work items aggregate seamlessly across selected organizations and projects, grouped by project and state
- **Rich Details Panel** — One-click to open full work item details in a dedicated webview panel
  - Edit title, description, state, priority, assignee, area path, iteration, and tags
  - View and participate in discussion comments
  - See work item history and linked items
  - Open in browser anytime for advanced ADO features
- **ADO-Style Icons** — Custom icons for bugs, tasks, epics, features, stories, PBIs, and issues
- **State Changes** — Change work item state directly from the sidebar

### 🎯 **Create Work Items from Your Code**
- **From Selection** — Highlight text in the editor and run `ADOExt: Create Work Item from Selection` to create a new work item with your selected text as the title
- **From TODO Comments** — VS Code code action (💡) appears on TODO comments; click to create a work item directly from the comment
- **File Context** — Work items automatically include the source file path and context lines for quick reference

### 🔍 **Smart Code Completions**
- **Work Item References** — Type `#` or `AB#` in markdown, plaintext, or git commits to see IntelliSense completions for recent work items
  - Shows work item ID, title, type, and state
  - Filter by typing ID digits or title keywords
  - Works with both `#123` and `AB#123` reference formats
- **Team Mentions** — Type `@` to autocomplete team member names from your project
  - Quickly mention colleagues in descriptions, comments, and commit messages
  - Filters by display name and email prefix

### 🎨 **Hover Cards for ADO References**
- **Work Item Hovers** — Hover over `AB#123` or `#123` references in any open file to see a rich detail card
  - Shows title, type, state, assignee, and project scope
  - Quick actions: Open in Browser, View Details panel
- **Pull Request Hovers** — Hover over `PR #123`, `PR!123`, or `!123` to see PR details
  - Shows title, status, repository, and author
  - Quick link to open in browser
- **Smart Scope Resolution** — Hovers work across multi-project setups; when ambiguous, shows the matched scope

### ✅ **Pull Request Management**
- **Browse PRs** — View active pull requests (yours, created, assigned to you, all) aggregated across organizations/projects
- **Inline Review** — Expand PRs in the tree to see all comment threads; reply, resolve, or reopen directly from the sidebar
- **Rich PR Details Panel** — One-click to see full PR information, discussions, and reviewer status
- **Familiar Review UX** — The pull request review flow is inspired by the GitHub Pull Requests and Issues extension for VS Code, adapted for Azure DevOps workflows
- **Native Diff Editor** — Review changes in VS Code's native multi-diff editor (same UX as GitHub PR extension)
  - All changed files visible at once
  - Inline PR comments in the gutter
  - Add new line comments with the `+` affordance
- **Checked-Out Branch** — After running "Checkout Pull Request Branch", existing PR threads light up in your regular editor
- **Smart Notifications** — Toast notifications for new PR comments; configure poll frequency and notification types
- **PR Queries & Buckets** — Organize PRs by review state (Waiting for My Review, Created by Me, All Open) or save custom queries

### 📦 **Backlog, Sprints & Boards**
- **Hierarchical Backlog** — View parent/child work item relationships in a collapsible tree
- **Sprint Planning** — Browse work grouped by sprint/iteration with drag-and-drop reordering
- **Board View** — See work organized by state columns (To Do, In Progress, Done, etc.)
- **Editor Views** — Open Backlog and Board editor views for wider planning layouts
- **State Changes** — Update work item state from planning views; sidebar automatically refreshes
- **Linked Details** — Open any work item from planning views in the shared details panel

### 🔐 **Multi-Account & Multi-Organization**
- **Built-in Auth** — Uses VS Code's Microsoft authentication (no manual token management)
- **Multiple Accounts** — Sign in with multiple Microsoft accounts and switch seamlessly
- **Organization Picker** — Select one or multiple organizations or all orgs in your account
- **Project Picker** — Choose projects per organization or select all projects
- **Smart Aggregation** — All views (work items, PRs) automatically aggregate across your selection

### 🏗️ **Build & Integration**
- **Build Summaries** — Lightweight build status cards in PR and work item detail panels
- **MCP Server** — Foundry integration for AI-powered workflows and automations
- **Azure Boards Integration** — Full WIQL query support for advanced filtering and bulk operations

---

## 📥 Installation

**From VS Code Marketplace:**
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "ADOExt"
4. Click Install

**From Source:**
```bash
git clone https://github.com/CompN3rd/ADOExt
cd ADOExt
npm install
npm run compile
code --install-extension ./adoext-<version>.vsix
```

---

## 🚀 Quick Start

### 1. **Sign In**
   - Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
   - Run `ADOExt: Sign In`
   - Authenticate with your Microsoft account

### 2. **Select Organization**
   - Run `ADOExt: Select Organization`
   - Choose your Azure DevOps organization(s)

### 3. **Select Projects**
   - Run `ADOExt: Select Project`
   - Choose project(s) to work with

### 4. **Explore the Sidebar**
   - **Work Items** — Browse assigned, created, and all work items
   - **Pull Requests** — View PRs organized by bucket (Waiting for Review, Created by Me, All Open)
   - **Backlog** — Hierarchical view of all work
   - **Sprints** — Current and future sprint planning
   - **Boards** — Kanban-style board view

---

## 💡 Usage Examples

### Create a Work Item from Code
```typescript
// 1. Highlight problematic code:
const buggyFunction = () => {
  return undefined; // Fix null handling here
};

// 2. Right-click → "Create Azure DevOps Work Item from Selection"
// 3. Type title and choose work item type
// 4. Work item created with file:line context embedded
```

### Use TODO Code Action
```python
# Line 42 in main.py
# TODO: Refactor database queries for performance

# 1. Click the 💡 lightbulb that appears
# 2. Select "Create Azure DevOps Work Item from TODO"
# 3. Work item created from the TODO text
```

### Complete Work Item References
```markdown
# PR Description

This fixes AB#4521 and relates to #4522

# As you type "AB#" or "#", VS Code shows matching work items:
# - AB#4521 | Bug · Login timeout · Active · Jane Smith
# - AB#4520 | Feature · Dark mode · Planned · Bob Wilson
```

### Hover Over References
```text
# In any editor, hover over a work item or PR reference:

AB#4521      ← Hover here to see rich card:
             │ Bug · Fix login timeout · Active
             │ Assigned To: Jane Smith
             │ Scope: contoso/backlog
             │ [Open in Browser] [View Details]

PR #123      ← Hover here to see:
             │ Pull Request #123
             │ Title: Add retry logic
             │ Status: Active
             │ Repository: backend
             │ Author: Bob Wilson
             │ [Open in Browser]
```

### Review a Pull Request
```
1. Open Pull Requests sidebar
2. Expand a PR to see comment threads
3. Right-click a thread → Reply, Resolve, or Reopen
4. Or click the PR to open full details panel
5. Or run "Checkout Pull Request Branch" to pull the code
   → Existing PR threads now light up in your editor
```

---

## ⚙️ Configuration

Open VS Code Settings (Ctrl+, / Cmd+,) and search for `adoext` to customize:

| Setting | Description | Default |
|---------|-------------|---------|
| `adoext.notifyOnNewPullRequestComments` | Show toast when PRs get new comments | `true` |
| `adoext.pullRequestCommentPollIntervalSeconds` | How often to check for new PR comments | `60` |
| `adoext.workItemQueries` | Custom saved work item query filters | (defaults) |
| `adoext.pullRequestQueries` | Custom saved PR query filters | (defaults) |
| `adoext.projectsByOrganization` | Multi-org project selection | `{}` |

---

## 🎯 Commands

| Command | Shortcut | Purpose |
|---------|----------|---------|
| `ADOExt: Sign In` | — | Authenticate with Microsoft |
| `ADOExt: Select Organization` | — | Choose organization(s) |
| `ADOExt: Select Project` | — | Choose project(s) |
| `ADOExt: Create Work Item` | — | Create a new work item interactively |
| `ADOExt: Create Work Item from Selection` | — | Create work item from highlighted text |
| `ADOExt: Create Work Item from TODO` | — | Scan active file for TODO comments |
| `ADOExt: Open Saved Query` | — | Browse and open saved work item queries |
| `ADOExt: Refresh Work Items` | — | Manually refresh work items tree |
| `ADOExt: Refresh Pull Requests` | — | Manually refresh PR tree |
| `ADOExt: Checkout Pull Request Branch` | — | Check out a PR branch locally |

---

## 📋 Requirements

- **VS Code** 1.101.0 or later
- **Git** (for PR branch checkout)
- **Azure DevOps Account** with at least read access to your organization
- **Microsoft Authentication** in VS Code (built-in; uses existing sign-in)

---

## 🤝 Contributing

We welcome contributions! Please feel free to open issues or pull requests on [GitHub](https://github.com/CompN3rd/ADOExt).

### Development Setup
```bash
git clone https://github.com/CompN3rd/ADOExt
cd ADOExt
npm install
npm run compile      # Build TypeScript
npm run watch        # Watch mode during development
code .               # Open in VS Code for testing
```

---

## 📝 License

This extension is open source and available under the [MIT License](LICENSE).

---

## 🐛 Feedback & Support

Found a bug or have a feature request? [Open an issue](https://github.com/CompN3rd/ADOExt/issues) on GitHub.

Happy coding! 🎉

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

