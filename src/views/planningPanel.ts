import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { WorkItem, WorkItemType } from '../api/adoClient';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { WorkItemDetailsPanel } from './workItemDetailsPanel';
import {
    resolveProjectScopes,
    scopeKey,
    scopeLabel,
    type ProjectScope
} from '../providers/projectScopes';
import { mapWithConcurrencyLimit } from '../utils/async';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';

type PlanningPanelKind = 'backlog' | 'board' | 'sprint';

const BACKLOG_TYPES = new Set(['epic', 'feature', 'user story', 'product backlog item', 'pbi', 'requirement', 'bug']);

const MAX_CONCURRENT_SCOPE_REQUESTS = 4;

interface ScopedWorkItem {
    workItem: WorkItem;
    scope: ProjectScope;
}

interface PlanningMessage {
    type: string;
    id?: number;
    state?: string;
    organization?: string;
    project?: string;
    // quick-create carries no extra payload — title/type are gathered via InputBox
}

export class PlanningPanel {
    private static readonly _panels = new Map<PlanningPanelKind, PlanningPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _disposables: vscode.Disposable[] = [];
    private _allowedStatesByItemKey = new Map<string, string[]>();

    static async show(
        kind: PlanningPanelKind,
        client: AdoClient,
        config: ConfigManager,
        onDidUpdate?: () => void
    ): Promise<void> {
        const existing = PlanningPanel._panels.get(kind);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            await existing.refresh();
            return;
        }

        const panel = new PlanningPanel(kind, client, config, onDidUpdate);
        PlanningPanel._panels.set(kind, panel);
        await panel.refresh();
    }

    private constructor(
        private readonly _kind: PlanningPanelKind,
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private readonly _onDidUpdate?: () => void
    ) {
        const title = _kind === 'backlog'
            ? 'Azure DevOps Backlog'
            : _kind === 'board'
                ? 'Azure DevOps Board'
                : 'Azure DevOps Sprint';
        this._panel = vscode.window.createWebviewPanel(
            `adoext.${_kind}`,
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message as PlanningMessage),
            null,
            this._disposables
        );
    }

    private async refresh(): Promise<void> {
        this._panel.webview.html = this.buildLoadingHtml();

        try {
            if (!this._client.isConnected) {
                this._panel.webview.html = this.buildMessageHtml('Sign in to Azure DevOps to load planning data.');
                return;
            }

            if (!this._config.isConfigured) {
                this._panel.webview.html = this.buildMessageHtml('Select organizations and projects to load planning data.');
                return;
            }

            const scopes = await resolveProjectScopes(this._client, this._config);
            if (scopes.length === 0) {
                this._panel.webview.html = this.buildMessageHtml('No projects are selected for planning views.');
                return;
            }

            const scopedItems = await this.loadItems(scopes);
            this._allowedStatesByItemKey = await this.loadAllowedStates(scopedItems);
            this._panel.webview.html = this.buildHtml(scopes, scopedItems);
        } catch (err) {
            this._panel.webview.html = this.buildMessageHtml(`Failed to load planning data: ${this.formatError(err)}`);
        }
    }

    private async loadItems(scopes: ProjectScope[]): Promise<ScopedWorkItem[]> {
        const results = await mapWithConcurrencyLimit(scopes, MAX_CONCURRENT_SCOPE_REQUESTS, async scope => {
            const workItems = await this._client.getPlanningWorkItems(scope.project, scope.organization);
            return workItems.map(workItem => ({ workItem, scope }));
        });
        return results.flat();
    }

    private async handleMessage(message: PlanningMessage): Promise<void> {
        if (message.type === 'refresh') {
            await this.refresh();
            return;
        }

        if (message.type === 'quickCreate') {
            await this.handleQuickCreate(message.organization, message.project);
            return;
        }

        if (typeof message.id !== 'number') {
            return;
        }

        const organization = message.organization ?? this._config.organization;
        const project = message.project ?? this._config.project;
        if (!organization || !project) {
            showWarningMessage('Unable to complete the action because organization or project is missing.');
            return;
        }

        if (message.type === 'openWorkItem') {
            try {
                const workItem = await this._client.getWorkItemById(project, message.id, organization);
                if (!workItem) {
                    showWarningMessage(`Work item #${message.id} could not be loaded.`);
                    return;
                }
                await WorkItemDetailsPanel.show(this._client, this._config, workItem, { organization, project });
            } catch (err) {
                showErrorMessage(`Failed to open work item: ${this.formatError(err)}`);
            }
            return;
        }

        if (message.type === 'setState' && message.state) {
            try {
                await this._client.updateWorkItemState(project, message.id, message.state, organization);
                showInformationMessage(`Work item #${message.id} moved to ${message.state}.`);
                this._onDidUpdate?.();
                await this.refresh();
            } catch (err) {
                const action = await vscode.window.showErrorMessage(
                    `Failed to update work item state: ${this.formatError(err)}`,
                    'Refresh'
                );
                if (action === 'Refresh') {
                    await this.refresh();
                }
            }
            return;
        }

        if (message.type === 'editAssignee') {
            await this.handleEditAssignee(message.id, organization, project);
            return;
        }

        if (message.type === 'editIteration') {
            await this.handleEditIteration(message.id, organization, project);
            return;
        }
    }

    private async handleQuickCreate(orgHint?: string, projectHint?: string): Promise<void> {
        const scopes = await resolveProjectScopes(this._client, this._config);
        if (scopes.length === 0) {
            showWarningMessage('No projects are configured. Please select an organization and project first.');
            return;
        }

        let organization = orgHint;
        let project = projectHint;

        if (!organization || !project) {
            if (scopes.length === 1) {
                organization = scopes[0].organization;
                project = scopes[0].project;
            } else {
                const scopeItems = scopes.map(s => ({
                    label: scopeLabel(s),
                    description: `${s.organization} / ${s.project}`,
                    scope: s
                }));
                const picked = await vscode.window.showQuickPick(scopeItems, {
                    placeHolder: 'Select the project for the new work item'
                });
                if (!picked) { return; }
                organization = picked.scope.organization;
                project = picked.scope.project;
            }
        }

        if (!organization || !project) {
            showWarningMessage('Unable to determine the target project for the new work item.');
            return;
        }

        const title = await vscode.window.showInputBox({
            prompt: `New work item in ${project}`,
            placeHolder: 'Enter title...',
            validateInput: v => v?.trim() ? undefined : 'Title cannot be empty'
        });
        if (!title?.trim()) { return; }

        let workItemTypes: WorkItemType[];
        try {
            workItemTypes = await this._client.getWorkItemTypes(project, organization);
        } catch (err) {
            showErrorMessage(`Failed to load work item types: ${this.formatError(err)}`);
            return;
        }

        const typeItems = workItemTypes
            .map(type => type.name)
            .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
            .sort((left, right) => left.localeCompare(right));
        if (typeItems.length === 0) {
            showWarningMessage(`No work item types are available for ${project}.`);
            return;
        }

        const workItemType = await vscode.window.showQuickPick(typeItems, {
            placeHolder: 'Select work item type'
        });
        if (!workItemType) { return; }

        try {
            const created = await this._client.createWorkItem(project, title.trim(), workItemType, undefined, organization);
            showInformationMessage(`Created work item #${created.id}: ${title.trim()}`);
            this._onDidUpdate?.();
            await this.refresh();
        } catch (err) {
            const action = await vscode.window.showErrorMessage(
                `Failed to create work item: ${this.formatError(err)}`,
                'Retry'
            );
            if (action === 'Retry') {
                await this.handleQuickCreate(orgHint, projectHint);
            }
        }
    }

    private async handleEditAssignee(id: number, organization: string, project: string): Promise<void> {
        const value = await vscode.window.showInputBox({
            prompt: `New assignee for work item #${id}`,
            placeHolder: 'Display name or email address'
        });
        if (value === undefined) { return; }

        try {
            await this._client.updateWorkItemFields(project, id, { 'System.AssignedTo': value }, organization);
            showInformationMessage(`Work item #${id} reassigned.`);
            this._onDidUpdate?.();
            await this.refresh();
        } catch (err) {
            const action = await vscode.window.showErrorMessage(
                `Failed to reassign work item #${id}: ${this.formatError(err)}`,
                'Refresh'
            );
            if (action === 'Refresh') {
                await this.refresh();
            }
        }
    }

    private async handleEditIteration(id: number, organization: string, project: string): Promise<void> {
        const value = await vscode.window.showInputBox({
            prompt: `New iteration path for work item #${id}`,
            placeHolder: 'Project\\Iteration\\Sprint'
        });
        if (value === undefined) { return; }

        try {
            await this._client.updateWorkItemFields(project, id, { 'System.IterationPath': value }, organization);
            showInformationMessage(`Work item #${id} iteration updated.`);
            this._onDidUpdate?.();
            await this.refresh();
        } catch (err) {
            const action = await vscode.window.showErrorMessage(
                `Failed to update iteration for work item #${id}: ${this.formatError(err)}`,
                'Refresh'
            );
            if (action === 'Refresh') {
                await this.refresh();
            }
        }
    }

    private async loadAllowedStates(items: ScopedWorkItem[]): Promise<Map<string, string[]>> {
        const allowedStates = new Map<string, string[]>();
        const requests = new Map<string, { project: string; organization: string; workItemType: string }>();
        const failures: string[] = [];

        for (const item of items) {
            const workItemType = (item.workItem.fields?.['System.WorkItemType'] as string | undefined) ?? '';
            if (!workItemType) {
                continue;
            }

            const requestKey = JSON.stringify([item.scope.organization, item.scope.project, workItemType]);
            if (!requests.has(requestKey)) {
                requests.set(requestKey, {
                    project: item.scope.project,
                    organization: item.scope.organization,
                    workItemType
                });
            }
        }

        await mapWithConcurrencyLimit([...requests.values()], MAX_CONCURRENT_SCOPE_REQUESTS, async request => {
            try {
                const states = await this._client.getWorkItemTypeStates(request.project, request.workItemType, request.organization);
                allowedStates.set(JSON.stringify([request.organization, request.project, request.workItemType]), states);
            } catch {
                failures.push(`${request.organization}/${request.project} (${request.workItemType})`);
            }
        });

        if (failures.length > 0) {
            const preview = failures.slice(0, 3).join(', ');
            const suffix = failures.length > 3 ? `, and ${failures.length - 3} more` : '';
            showWarningMessage(
                `Some work item state lists could not be loaded. Planning views will still render, but affected items may not offer transitions: ${preview}${suffix}.`
            );
        }

        return allowedStates;
    }

    private buildHtml(scopes: ProjectScope[], items: ScopedWorkItem[]): string {
        const webview = this._panel.webview;
        const nonce = crypto.randomBytes(16).toString('hex');
        const title = this._kind === 'backlog'
            ? 'Backlog'
            : this._kind === 'board'
                ? 'Board'
                : 'Sprint';
        const subtitle = `${items.length} item${items.length !== 1 ? 's' : ''} across ${scopes.length} project${scopes.length !== 1 ? 's' : ''}`;
        const content = items.length === 0
            ? '<p class="empty">No planning work items found.</p>'
            : this._kind === 'backlog'
                ? this.buildBacklogHtml(scopes, items)
                : this._kind === 'board'
                    ? this.buildBoardHtml(scopes, items)
                    : this.buildSprintHtml(scopes, items);

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>${title}</title>
<style>
  body { margin: 0; padding: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .shell { padding: 16px; }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 1.25rem; font-weight: 600; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-top: 4px; }
  .toolbar { display: flex; gap: 6px; align-items: center; }
  .btn { border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; padding: 4px 10px; font: inherit; cursor: pointer; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-link { background: transparent; border: none; color: var(--vscode-textLink-foreground); padding: 0; cursor: pointer; font: inherit; text-align: left; }
  .btn-link:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
  .scope { margin: 0 0 22px; }
  .scope-title { font-size: 0.98rem; font-weight: 600; margin: 0 0 8px; color: var(--vscode-sideBarTitle-foreground); display: flex; align-items: center; gap: 8px; }
  .scope-count { color: var(--vscode-descriptionForeground); font-weight: 400; }

  /* Backlog tree */
  .backlog { border-top: 1px solid var(--vscode-panel-border); }
  .tree-row { display: grid; grid-template-columns: minmax(280px, 1fr) auto; align-items: center; gap: 12px; min-height: 32px; padding: 3px 8px 3px calc(8px + var(--depth, 0) * 18px); border-bottom: 1px solid var(--vscode-panel-border); }
  .tree-row:hover, .card:hover, .lane-cell .card:hover { background: var(--vscode-list-hoverBackground); }
  .tree-twisty { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: none; background: transparent; color: var(--vscode-foreground); cursor: pointer; padding: 0; margin-right: 2px; }
  .tree-twisty.placeholder { cursor: default; visibility: hidden; }
  .tree-twisty[aria-expanded="false"] .chev { transform: rotate(-90deg); }
  .chev { display: inline-block; transition: transform 120ms ease; }
  .title-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .id { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  .type { white-space: nowrap; padding: 1px 6px; border-radius: 8px; font-size: 0.78em; color: var(--vscode-editor-background); background: var(--vscode-charts-blue); }
  .type.epic { background: var(--vscode-charts-purple, #8a2be2); }
  .type.feature { background: var(--vscode-charts-orange, #d9822b); }
  .type.user-story, .type.product-backlog-item, .type.pbi, .type.requirement { background: var(--vscode-charts-blue, #007acc); }
  .type.bug { background: var(--vscode-charts-red, #c4314b); }
  .type.task { background: var(--vscode-charts-yellow, #d7a416); color: #000; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .state-badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 0.78em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .state-control { display: flex; align-items: center; gap: 6px; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); border-radius: 3px; padding: 3px 22px 3px 6px; max-width: 160px; }
  .children { display: block; }
  .children.collapsed { display: none; }

  /* Board with swim lanes */
  .board-table { display: grid; gap: 1px; background: var(--vscode-panel-border); border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: hidden; }
  .board-cell { background: var(--vscode-sideBar-background); padding: 8px; min-height: 60px; }
  .board-head { background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)); font-weight: 600; }
  .lane-head { background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)); font-weight: 600; display: flex; align-items: flex-start; }
  .lane-corner { background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)); }
  .lane-head .title-line { flex-direction: column; align-items: flex-start; gap: 2px; }
  .col-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .lane-cell { display: flex; flex-direction: column; gap: 6px; }
  .card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 6px 8px; }
  .card-title { display: flex; gap: 6px; min-width: 0; margin-bottom: 4px; flex-wrap: wrap; }
  .card-title .title { white-space: normal; }
  .card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }

  /* Sprint */
  .sprint { margin-bottom: 18px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .sprint-head { padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)); border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
    .sprint-head[aria-expanded="false"] .chev { transform: rotate(-90deg); }
  .sprint-head h3 { margin: 0; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .sprint-body { padding: 6px 0; }
  .sprint-body.collapsed { display: none; }
  .sprint-parent { padding: 4px 10px; }
  .sprint-parent-header { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-weight: 600; }
  .sprint-task { display: grid; grid-template-columns: minmax(280px, 1fr) auto; align-items: center; gap: 12px; padding: 3px 0 3px 26px; min-height: 28px; border-bottom: 1px dotted var(--vscode-panel-border); }
  .sprint-task:last-child { border-bottom: none; }

  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 8px; }
  .meta-edit { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .meta-edit:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
  .btn-small { padding: 2px 7px; font-size: 0.82em; }
  .scope-new-item { margin-left: auto; }

  /* Filter/Sort Controls */
  .filter-sort-controls { display: flex; gap: 8px; align-items: center; padding: 8px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; }
  .filter-sort-controls input { padding: 4px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 2px; font-size: 0.9em; }
  .filter-sort-controls select { padding: 4px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 2px; font-size: 0.9em; }
  .filter-sort-controls label { font-size: 0.9em; color: var(--vscode-descriptionForeground); }
  .filter-sort-controls button { padding: 4px 10px; font-size: 0.85em; }

  @media (max-width: 720px) {
    .tree-row, .sprint-task { grid-template-columns: 1fr; align-items: start; }
    .state-control { justify-content: flex-start; }
    .header { align-items: flex-start; flex-direction: column; }
  }
</style>
</head>
<body>
<main class="shell">
  <div class="header">
    <div>
      <h1>${title}</h1>
      <div class="subtitle">${subtitle}</div>
    </div>
    <div class="toolbar">
      ${this._kind === 'backlog' || this._kind === 'sprint' ? '<button class="btn btn-secondary" data-action="expand-all">Expand all</button><button class="btn btn-secondary" data-action="collapse-all">Collapse all</button>' : ''}
      <button class="btn btn-primary" data-action="quick-create">+ New Item</button>
      <button class="btn btn-secondary" data-action="refresh">Refresh</button>
    </div>
  </div>
  <div class="filter-sort-controls">
    <label for="filter-input">Filter:</label>
    <input id="filter-input" type="text" placeholder="Regex pattern (e.g., bug|critical)" title="Filter items by regex pattern matching ID and title">
    <label for="sort-select">Sort:</label>
    <select id="sort-select">
      <option value="name">Name (A-Z)</option>
      <option value="date">Date (Newest first)</option>
    </select>
    <button class="btn btn-small" data-action="clear-filter">Clear filter</button>
  </div>
  ${content}
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// Store original content for filtering
const originalContent = document.body.innerHTML;
let currentFilter = '';
let currentSort = 'name';

document.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
});

// Filter input handler
document.querySelector('#filter-input')?.addEventListener('input', (e) => {
    currentFilter = e.target.value.trim();
    applyFilterAndSort();
});

// Sort select handler
document.querySelector('#sort-select')?.addEventListener('change', (e) => {
    currentSort = e.target.value;
    applyFilterAndSort();
});

// Clear filter button handler
document.querySelector('[data-action="clear-filter"]')?.addEventListener('click', () => {
    document.querySelector('#filter-input').value = '';
    currentFilter = '';
    applyFilterAndSort();
});

function applyFilterAndSort() {
    // Get all visible item containers
    const items = document.querySelectorAll('.tree-row, .sprint-task, .sprint-parent');
    
    items.forEach(item => {
        const itemText = item.textContent.toLowerCase();
        
        // Apply filter
        if (currentFilter) {
            try {
                const regex = new RegExp(currentFilter, 'i');
                item.style.display = regex.test(itemText) ? '' : 'none';
            } catch {
                // Invalid regex, show all
                item.style.display = '';
            }
        } else {
            item.style.display = '';
        }
    });
}

document.querySelector('[data-action="expand-all"]')?.addEventListener('click', () => {
    document.querySelectorAll('.tree-twisty:not(.placeholder)').forEach(btn => {
        btn.setAttribute('aria-expanded', 'true');
        const controls = btn.getAttribute('aria-controls');
        if (!controls) { return; }
        document.getElementById(controls)?.classList.remove('collapsed');
    });
    document.querySelectorAll('.sprint-head').forEach(head => head.setAttribute('aria-expanded', 'true'));
    document.querySelectorAll('.sprint-body').forEach(el => el.classList.remove('collapsed'));
});

document.querySelector('[data-action="collapse-all"]')?.addEventListener('click', () => {
    document.querySelectorAll('.tree-twisty:not(.placeholder)').forEach(btn => {
        btn.setAttribute('aria-expanded', 'false');
        const controls = btn.getAttribute('aria-controls');
        if (!controls) { return; }
        document.getElementById(controls)?.classList.add('collapsed');
    });
    document.querySelectorAll('.sprint-head').forEach(head => head.setAttribute('aria-expanded', 'false'));
    document.querySelectorAll('.sprint-body').forEach(el => el.classList.add('collapsed'));
});

document.addEventListener('click', event => {
    const target = /** @type {HTMLElement} */ (event.target);

    const twisty = target.closest('.tree-twisty:not(.placeholder)');
    if (twisty) {
        const expanded = twisty.getAttribute('aria-expanded') === 'true';
        twisty.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        const controls = twisty.getAttribute('aria-controls');
        if (controls) {
            const region = document.getElementById(controls);
            region?.classList.toggle('collapsed', expanded);
        }
        return;
    }

    const sprintHead = target.closest('.sprint-head');
    if (sprintHead) {
        const region = sprintHead.parentElement?.querySelector('.sprint-body');
        const expanded = sprintHead.getAttribute('aria-expanded') !== 'false';
        sprintHead.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        region?.classList.toggle('collapsed', expanded);
        return;
    }

    const openButton = target.closest('[data-action="open-work-item"]');
    if (openButton) {
        vscode.postMessage({
            type: 'openWorkItem',
            id: Number(openButton.getAttribute('data-id')),
            organization: openButton.getAttribute('data-organization') || undefined,
            project: openButton.getAttribute('data-project') || undefined
        });
        return;
    }

    const stateButton = target.closest('[data-action="save-state"]');
    if (stateButton) {
        const id = stateButton.getAttribute('data-id');
        const select = stateButton.closest('.state-control')?.querySelector('select');
        if (!select) { return; }
        vscode.postMessage({
            type: 'setState',
            id: Number(id),
            state: /** @type {HTMLSelectElement} */ (select).value,
            organization: stateButton.getAttribute('data-organization') || undefined,
            project: stateButton.getAttribute('data-project') || undefined
        });
    }

    const quickCreateButton = target.closest('[data-action="quick-create"]');
    if (quickCreateButton) {
        vscode.postMessage({
            type: 'quickCreate',
            organization: quickCreateButton.getAttribute('data-organization') || undefined,
            project: quickCreateButton.getAttribute('data-project') || undefined
        });
        return;
    }

    const editAssigneeButton = target.closest('[data-action="edit-assignee"]');
    if (editAssigneeButton) {
        vscode.postMessage({
            type: 'editAssignee',
            id: Number(editAssigneeButton.getAttribute('data-id')),
            organization: editAssigneeButton.getAttribute('data-organization') || undefined,
            project: editAssigneeButton.getAttribute('data-project') || undefined
        });
        return;
    }

    const editIterationButton = target.closest('[data-action="edit-iteration"]');
    if (editIterationButton) {
        vscode.postMessage({
            type: 'editIteration',
            id: Number(editIterationButton.getAttribute('data-id')),
            organization: editIterationButton.getAttribute('data-organization') || undefined,
            project: editIterationButton.getAttribute('data-project') || undefined
        });
        return;
    }
});

document.addEventListener('keydown', event => {
    const target = /** @type {HTMLElement} */ (event.target);
    const sprintHead = target.closest('.sprint-head');
    if (!sprintHead) {
        return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }
    event.preventDefault();
    sprintHead.click();
});
</script>
</body>
</html>`;
    }

    private buildBacklogHtml(scopes: ProjectScope[], items: ScopedWorkItem[]): string {
        return scopes.map(scope => {
            const scopedItems = items.filter(item => scopeKey(item.scope) === scopeKey(scope));
            const roots = this.backlogRoots(scope, scopedItems);
            const hierarchy = roots.length === 0
                ? '<p class="empty">No backlog items in this project.</p>'
                : `<div class="backlog" role="tree">${roots.map(root => this.buildBacklogItemHtml(root, scopedItems, 0, new Set())).join('')}</div>`;
            return `<section class="scope"><h2 class="scope-title">${this.esc(scopeLabel(scope))} <span class="scope-count">${scopedItems.length}</span><button class="btn btn-primary btn-small scope-new-item" data-action="quick-create" data-organization="${this.escAttr(scope.organization)}" data-project="${this.escAttr(scope.project)}">+ New Item</button></h2>${hierarchy}</section>`;
        }).join('');
    }

    private buildBacklogItemHtml(
        item: ScopedWorkItem,
        scopedItems: ScopedWorkItem[],
        depth: number,
        seen: Set<number>
    ): string {
        const id = item.workItem.id ?? 0;
        if (seen.has(id)) {
            return '';
        }
        seen.add(id);

        const children = scopedItems
            .filter(candidate => parentId(candidate.workItem) === id)
            .sort(compareWorkItems);
        const row = this.buildWorkItemRow(item, depth, children.length > 0);
        if (children.length === 0) {
            return row;
        }
        const childRows = children.map(child => this.buildBacklogItemHtml(child, scopedItems, depth + 1, new Set(seen))).join('');
        const regionId = backlogRegionId(item);
        return `${row}<div class="children" id="${regionId}" role="group">${childRows}</div>`;
    }

    private buildBoardHtml(scopes: ProjectScope[], items: ScopedWorkItem[]): string {
        return scopes.map(scope => {
            const scopedItems = items.filter(item => scopeKey(item.scope) === scopeKey(scope));
            if (scopedItems.length === 0) {
                return `<section class="scope"><h2 class="scope-title">${this.esc(scopeLabel(scope))} <span class="scope-count">0</span><button class="btn btn-primary btn-small scope-new-item" data-action="quick-create" data-organization="${this.escAttr(scope.organization)}" data-project="${this.escAttr(scope.project)}">+ New Item</button></h2><p class="empty">No board items in this project.</p></section>`;
            }

            // Discover columns (states) and lanes (parent backlog items, like ADO swim lanes).
            const states = uniqueSortedStates(scopedItems);
            const lanes = this.boardLanes(scope, scopedItems);

            const colTemplate = `minmax(200px, 1.4fr) ${states.map(() => 'minmax(220px, 1fr)').join(' ')}`;
            const headerCells = [
                `<div class="board-cell lane-corner"></div>`,
                ...states.map(state => `<div class="board-cell board-head"><div class="col-head"><span>${this.esc(state)}</span></div></div>`)
            ].join('');

            const laneRows = lanes.map(lane => {
                const laneHead = lane.parent
                    ? this.buildLaneHeadCell(lane.parent)
                    : `<div class="board-cell lane-head"><div class="title-line"><span class="title">Unparented</span><span class="meta">${lane.cards.length} item${lane.cards.length !== 1 ? 's' : ''}</span></div></div>`;
                const cells = states.map(state => {
                    const cards = lane.cards
                        .filter(card => ((card.workItem.fields?.['System.State'] as string | undefined) ?? 'Unknown') === state)
                        .sort(compareWorkItems)
                        .map(card => this.buildBoardCardHtml(card))
                        .join('');
                    return `<div class="board-cell lane-cell">${cards}</div>`;
                }).join('');
                return `${laneHead}${cells}`;
            }).join('');

            return `<section class="scope">
  <h2 class="scope-title">${this.esc(scopeLabel(scope))} <span class="scope-count">${scopedItems.length}</span><button class="btn btn-primary btn-small scope-new-item" data-action="quick-create" data-organization="${this.escAttr(scope.organization)}" data-project="${this.escAttr(scope.project)}">+ New Item</button></h2>
  <div class="board-table" style="grid-template-columns: ${colTemplate};">
    ${headerCells}
    ${laneRows}
  </div>
</section>`;
        }).join('');
    }

    private buildLaneHeadCell(parent: ScopedWorkItem): string {
        const fields = parent.workItem.fields ?? {};
        const id = parent.workItem.id ?? 0;
        const wiType = (fields['System.WorkItemType'] as string | undefined) ?? 'Work Item';
        const title = (fields['System.Title'] as string | undefined) ?? '(no title)';
        const assignee = identityName(fields['System.AssignedTo']) ?? 'Unassigned';
        return `<div class="board-cell lane-head">
  <div class="title-line">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
      <span class="type ${typeClass(wiType)}">${this.esc(wiType)}</span>
      <span class="id">#${id}</span>
      <button class="btn-link" data-action="open-work-item" data-id="${id}" data-organization="${this.escAttr(parent.scope.organization)}" data-project="${this.escAttr(parent.scope.project)}"><span class="title">${this.esc(title)}</span></button>
    </div>
    <span class="meta">${this.esc(assignee)}</span>
  </div>
</div>`;
    }

    private buildSprintHtml(scopes: ProjectScope[], items: ScopedWorkItem[]): string {
        return scopes.map(scope => {
            const scopedItems = items.filter(item => scopeKey(item.scope) === scopeKey(scope));
            if (scopedItems.length === 0) {
                return `<section class="scope"><h2 class="scope-title">${this.esc(scopeLabel(scope))} <span class="scope-count">0</span><button class="btn btn-primary btn-small scope-new-item" data-action="quick-create" data-organization="${this.escAttr(scope.organization)}" data-project="${this.escAttr(scope.project)}">+ New Item</button></h2><p class="empty">No sprint items in this project.</p></section>`;
            }

            const byIteration = new Map<string, ScopedWorkItem[]>();
            for (const item of scopedItems) {
                const iteration = (item.workItem.fields?.['System.IterationPath'] as string | undefined) ?? 'Unscheduled';
                if (!byIteration.has(iteration)) {
                    byIteration.set(iteration, []);
                }
                byIteration.get(iteration)!.push(item);
            }

            const sortedIterations = [...byIteration.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            const sprintBlocks = sortedIterations.map(([iteration, iterationItems]) => {
                const lanes = this.boardLanes(scope, iterationItems, scopedItems);
                const body = lanes.map(lane => {
                    const headerHtml = lane.parent
                        ? this.buildSprintParentHeader(lane.parent)
                        : `<div class="sprint-parent-header"><span class="title">Unparented</span><span class="meta">${lane.cards.length}</span></div>`;
                    const taskRows = lane.cards
                        .sort(compareWorkItems)
                        .map(card => this.buildSprintTaskRow(card))
                        .join('');
                    return `<div class="sprint-parent">${headerHtml}${taskRows || '<div class="meta" style="padding-left:26px;">No child items.</div>'}</div>`;
                }).join('');

                return `<section class="sprint">
    <header class="sprint-head" role="button" tabindex="0" aria-expanded="true">
    <h3><span class="chev">▾</span>${this.esc(iterationLabel(iteration))}</h3>
    <span class="meta">${iterationItems.length} item${iterationItems.length !== 1 ? 's' : ''} · ${this.esc(iteration)}</span>
  </header>
  <div class="sprint-body">${body}</div>
</section>`;
            }).join('');

            return `<section class="scope"><h2 class="scope-title">${this.esc(scopeLabel(scope))} <span class="scope-count">${scopedItems.length}</span><button class="btn btn-primary btn-small scope-new-item" data-action="quick-create" data-organization="${this.escAttr(scope.organization)}" data-project="${this.escAttr(scope.project)}">+ New Item</button></h2>${sprintBlocks}</section>`;
        }).join('');
    }

    private buildSprintParentHeader(parent: ScopedWorkItem): string {
        const fields = parent.workItem.fields ?? {};
        const id = parent.workItem.id ?? 0;
        const wiType = (fields['System.WorkItemType'] as string | undefined) ?? 'Work Item';
        const title = (fields['System.Title'] as string | undefined) ?? '(no title)';
        const state = (fields['System.State'] as string | undefined) ?? '';
        return `<div class="sprint-parent-header">
  <span class="type ${typeClass(wiType)}">${this.esc(wiType)}</span>
  <span class="id">#${id}</span>
  <button class="btn-link" data-action="open-work-item" data-id="${id}" data-organization="${this.escAttr(parent.scope.organization)}" data-project="${this.escAttr(parent.scope.project)}"><span class="title">${this.esc(title)}</span></button>
  ${state ? `<span class="state-badge">${this.esc(state)}</span>` : ''}
</div>`;
    }

    private buildSprintTaskRow(item: ScopedWorkItem): string {
        const fields = item.workItem.fields ?? {};
        const id = item.workItem.id ?? 0;
        const wiType = (fields['System.WorkItemType'] as string | undefined) ?? 'Work Item';
        const title = (fields['System.Title'] as string | undefined) ?? '(no title)';
        const state = (fields['System.State'] as string | undefined) ?? '';
        const assignee = identityName(fields['System.AssignedTo']) ?? 'Unassigned';
        const iteration = (fields['System.IterationPath'] as string | undefined) ?? '';
        return `<div class="sprint-task">
  <div class="title-line">
    <span class="type ${typeClass(wiType)}">${this.esc(wiType)}</span>
    <span class="id">#${id}</span>
    <button class="btn-link" data-action="open-work-item" data-id="${id}" data-organization="${this.escAttr(item.scope.organization)}" data-project="${this.escAttr(item.scope.project)}"><span class="title">${this.esc(title)}</span></button>
    ${this.buildEditableMetaLink('edit-assignee', id, item.scope, this.esc(assignee), '· ')}${this.buildEditableMetaLink('edit-iteration', id, item.scope, this.iterationMetaLabel(iteration), ' · ')}
  </div>
  ${this.buildStateControl(item, state)}
</div>`;
    }

    private boardLanes(
        scope: ProjectScope,
        items: ScopedWorkItem[],
        laneLookupItems: ScopedWorkItem[] = items
    ): Array<{ parent: ScopedWorkItem | undefined; cards: ScopedWorkItem[] }> {
        const itemsById = new Map<number, ScopedWorkItem>();
        for (const item of laneLookupItems) {
            const id = item.workItem.id;
            if (typeof id === 'number') {
                itemsById.set(id, item);
            }
        }

        const lanesByParentId = new Map<number, { parent: ScopedWorkItem; cards: ScopedWorkItem[] }>();
        const orphanCandidates: ScopedWorkItem[] = [];

        for (const item of items) {
            const owner = laneOwner(item, itemsById);
            if (owner && (item.workItem.id ?? -1) !== (owner.workItem.id ?? -2)) {
                const ownerId = owner.workItem.id ?? -1;
                if (!lanesByParentId.has(ownerId)) {
                    lanesByParentId.set(ownerId, { parent: owner, cards: [] });
                }
                lanesByParentId.get(ownerId)!.cards.push(item);
            } else {
                // Backlog-typed items that own themselves, or items without a known parent.
                orphanCandidates.push(item);
            }
        }

        // Backlog items that have at least one child became lanes — those should
        // appear as lane headers, not as orphan cards. Everything else (childless
        // backlog items + true orphans) shows in the unparented lane as a card.
        const orphanCards = orphanCandidates.filter(item => {
            const id = item.workItem.id;
            return typeof id !== 'number' || !lanesByParentId.has(id);
        });

        const lanes: Array<{ parent: ScopedWorkItem | undefined; cards: ScopedWorkItem[] }> = [...lanesByParentId.values()]
            .sort((left, right) => compareWorkItems(left.parent, right.parent));

        if (orphanCards.length > 0) {
            lanes.push({ parent: undefined, cards: orphanCards });
        }

        // Defensive: ensure all cards belong to the requested scope.
        return lanes
            .map(lane => ({
                parent: lane.parent,
                cards: lane.cards.filter(card => scopeKey(card.scope) === scopeKey(scope))
            }))
            .filter(lane => lane.parent || lane.cards.length > 0);
    }

    /**
     * Renders a small clickable meta link that triggers an inline edit action.
     * @param action  The `data-action` value, e.g. `'edit-assignee'`.
     * @param id      The work item id.
     * @param scope   The work item's project scope.
     * @param label   The display text (already HTML-escaped by the caller).
     * @param prefix  Optional prefix text (e.g. `'· '`) shown before the label.
     */
    private buildEditableMetaLink(
        action: string,
        id: number,
        scope: ProjectScope,
        label: string,
        prefix: string = ''
    ): string {
        const titleAttr = action === 'edit-assignee' ? 'Edit assignee' : 'Edit iteration';
        return `<button class="btn-link meta-edit" data-action="${action}" data-id="${id}" data-organization="${this.escAttr(scope.organization)}" data-project="${this.escAttr(scope.project)}" title="${titleAttr}">${prefix}${label}</button>`;
    }

    private buildWorkItemRow(item: ScopedWorkItem, depth: number, hasChildren: boolean): string {
        const fields = item.workItem.fields ?? {};
        const id = item.workItem.id ?? 0;
        const wiType = (fields['System.WorkItemType'] as string | undefined) ?? 'Work Item';
        const title = (fields['System.Title'] as string | undefined) ?? '(no title)';
        const state = (fields['System.State'] as string | undefined) ?? '';
        const iteration = (fields['System.IterationPath'] as string | undefined) ?? '';
        const assignee = identityName(fields['System.AssignedTo']) ?? 'Unassigned';
        const regionId = backlogRegionId(item);
        const twisty = hasChildren
            ? `<button class="tree-twisty" type="button" aria-expanded="true" aria-controls="${regionId}" aria-label="Toggle children of work item ${id}"><span class="chev">▾</span></button>`
            : `<span class="tree-twisty placeholder" aria-hidden="true"></span>`;
        return `<div class="tree-row" role="treeitem" style="--depth:${depth}">
  <div class="title-line">
    ${twisty}
    <span class="type ${typeClass(wiType)}">${this.esc(wiType)}</span>
    <span class="id">#${id}</span>
    <button class="btn-link" data-action="open-work-item" data-id="${id}" data-organization="${this.escAttr(item.scope.organization)}" data-project="${this.escAttr(item.scope.project)}"><span class="title">${this.esc(title)}</span></button>
    ${this.buildEditableMetaLink('edit-assignee', id, item.scope, this.esc(assignee), '· ')}${this.buildEditableMetaLink('edit-iteration', id, item.scope, this.iterationMetaLabel(iteration), ' · ')}
  </div>
  ${this.buildStateControl(item, state)}
</div>`;
    }

    private buildBoardCardHtml(item: ScopedWorkItem): string {
        const fields = item.workItem.fields ?? {};
        const id = item.workItem.id ?? 0;
        const wiType = (fields['System.WorkItemType'] as string | undefined) ?? 'Work Item';
        const title = (fields['System.Title'] as string | undefined) ?? '(no title)';
        const state = (fields['System.State'] as string | undefined) ?? '';
                const assignee = identityName(fields['System.AssignedTo']) ?? 'Unassigned';
                const iteration = (fields['System.IterationPath'] as string | undefined) ?? '';
        return `<article class="card">
  <div class="card-title">
    <span class="type ${typeClass(wiType)}">${this.esc(wiType)}</span>
    <span class="id">#${id}</span>
    <button class="btn-link" data-action="open-work-item" data-id="${id}" data-organization="${this.escAttr(item.scope.organization)}" data-project="${this.escAttr(item.scope.project)}"><span class="title">${this.esc(title)}</span></button>
  </div>
    ${this.buildEditableMetaLink('edit-assignee', id, item.scope, this.esc(assignee))}${this.buildEditableMetaLink('edit-iteration', id, item.scope, this.iterationMetaLabel(iteration), ' · ')}
  <div class="card-footer">
    ${this.buildStateControl(item, state)}
  </div>
</article>`;
    }

        private iterationMetaLabel(iteration: string): string {
                return this.esc(iteration ? iterationLabel(iteration) : 'No iteration');
        }

    private buildStateControl(item: ScopedWorkItem, state: string): string {
        const id = item.workItem.id ?? 0;
        const workItemType = (item.workItem.fields?.['System.WorkItemType'] as string | undefined) ?? '';
        const cacheKey = JSON.stringify([item.scope.organization, item.scope.project, workItemType]);
        const allowedStates = this._allowedStatesByItemKey.get(cacheKey) ?? [];
        const states = allowedStates.includes(state) || !state
            ? allowedStates
            : [state, ...allowedStates];
        const options = states.map(option => `<option value="${this.escAttr(option)}"${option === state ? ' selected' : ''}>${this.esc(option)}</option>`).join('');
        return `<div class="state-control"><select data-id="${id}" aria-label="State for work item ${id}">${options}</select><button class="btn btn-primary" data-action="save-state" data-id="${id}" data-organization="${this.escAttr(item.scope.organization)}" data-project="${this.escAttr(item.scope.project)}">Save</button></div>`;
    }

    private backlogRoots(scope: ProjectScope, items: ScopedWorkItem[]): ScopedWorkItem[] {
        const ids = new Set(items.map(item => item.workItem.id).filter((id): id is number => typeof id === 'number'));
        return items
            .filter(item => {
                const parent = parentId(item.workItem);
                return typeof parent !== 'number' || !ids.has(parent) || scopeKey(item.scope) !== scopeKey(scope);
            })
            .sort(compareWorkItems);
    }

    private buildLoadingHtml(): string {
        return this.buildMessageHtml('Loading planning data...');
    }

    private buildMessageHtml(message: string): string {
        const webview = this._panel.webview;
        return /* html */`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px}.empty{color:var(--vscode-descriptionForeground)}</style></head><body><p class="empty">${this.esc(message)}</p></body></html>`;
    }

    private dispose(): void {
        PlanningPanel._panels.delete(this._kind);
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
    }

    private esc(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private escAttr(text: string): string {
        return this.esc(text).replace(/'/g, '&#39;');
    }

    private formatError(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }
}

function compareWorkItems(left: ScopedWorkItem, right: ScopedWorkItem): number {
    const leftType = (left.workItem.fields?.['System.WorkItemType'] as string | undefined) ?? '';
    const rightType = (right.workItem.fields?.['System.WorkItemType'] as string | undefined) ?? '';
    const typeDiff = workItemTypeSortValue(leftType) - workItemTypeSortValue(rightType);
    if (typeDiff !== 0) {
        return typeDiff;
    }
    return (left.workItem.id ?? 0) - (right.workItem.id ?? 0);
}

function parentId(workItem: WorkItem): number | undefined {
    const parentField = workItem.fields?.['System.Parent'];
    if (typeof parentField === 'number') {
        return parentField;
    }
    if (typeof parentField === 'string' && /^\d+$/.test(parentField)) {
        return Number(parentField);
    }

    const relation = workItem.relations?.find(item => item.rel === 'System.LinkTypes.Hierarchy-Reverse');
    const idMatch = relation?.url?.match(/\/workItems\/(\d+)$/i);
    return idMatch ? Number(idMatch[1]) : undefined;
}

function identityName(value: unknown): string | undefined {
    if (!value) { return undefined; }
    if (typeof value === 'string') { return value; }
    if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        return (obj['displayName'] as string | undefined) ?? (obj['uniqueName'] as string | undefined);
    }
    return undefined;
}

function workItemTypeSortValue(wiType: string): number {
    switch (wiType.toLowerCase()) {
        case 'epic':
            return 10;
        case 'feature':
            return 20;
        case 'user story':
        case 'product backlog item':
        case 'pbi':
            return 30;
        case 'bug':
            return 40;
        case 'task':
            return 50;
        default:
            return 100;
    }
}

function stateSortValue(state: string): number {
    switch (state.toLowerCase()) {
        case 'new':
        case 'proposed':
            return 10;
        case 'active':
        case 'committed':
        case 'in progress':
            return 20;
        case 'resolved':
            return 30;
        case 'closed':
        case 'done':
            return 40;
        default:
            return 100;
    }
}

function typeClass(wiType: string): string {
    return wiType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function scopeDomId(scope: ProjectScope): string {
    return `${encodeURIComponent(scope.organization)}--${encodeURIComponent(scope.project)}`;
}

function backlogRegionId(item: ScopedWorkItem): string {
    return `children-${scopeDomId(item.scope)}-${item.workItem.id ?? 0}`;
}

function iterationLabel(iterationPath: string): string {
    const pieces = iterationPath.split('\\').filter(Boolean);
    return pieces.length > 0 ? pieces[pieces.length - 1] : iterationPath;
}

function uniqueSortedStates(items: ScopedWorkItem[]): string[] {
    const set = new Set<string>();
    for (const item of items) {
        set.add((item.workItem.fields?.['System.State'] as string | undefined) ?? 'Unknown');
    }
    return [...set].sort((left, right) => {
        const diff = stateSortValue(left) - stateSortValue(right);
        return diff !== 0 ? diff : left.localeCompare(right);
    });
}

/**
 * Returns the work item that should serve as the swim-lane owner for the given item.
 * For ADO-style boards, the lane is the parent backlog item (User Story / PBI / Bug).
 * If the item is itself a backlog-level item, it owns its own lane.
 * Walks up the parent chain (within the loaded items) when needed.
 */
function laneOwner(
    item: ScopedWorkItem,
    itemsById: Map<number, ScopedWorkItem>
): ScopedWorkItem | undefined {
    const wiType = ((item.workItem.fields?.['System.WorkItemType'] as string | undefined) ?? '').toLowerCase();
    if (BACKLOG_TYPES.has(wiType)) {
        return item;
    }

    let current: ScopedWorkItem | undefined = item;
    const visited = new Set<number>();
    while (current) {
        const id = current.workItem.id;
        if (typeof id === 'number') {
            if (visited.has(id)) { break; }
            visited.add(id);
        }
        const parent = parentId(current.workItem);
        if (typeof parent !== 'number') {
            return undefined;
        }
        const parentItem = itemsById.get(parent);
        if (!parentItem) {
            return undefined;
        }
        const parentType = ((parentItem.workItem.fields?.['System.WorkItemType'] as string | undefined) ?? '').toLowerCase();
        if (BACKLOG_TYPES.has(parentType)) {
            return parentItem;
        }
        current = parentItem;
    }
    return undefined;
}
