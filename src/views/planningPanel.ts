import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { WorkItem } from '../api/adoClient';
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

type PlanningPanelKind = 'backlog' | 'board';

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
}

const COMMON_STATES = [
    'New',
    'Proposed',
    'Active',
    'Committed',
    'In Progress',
    'Resolved',
    'Closed',
    'Done',
    'Removed'
];

export class PlanningPanel {
    private static readonly _panels = new Map<PlanningPanelKind, PlanningPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _disposables: vscode.Disposable[] = [];

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
        const title = _kind === 'backlog' ? 'Azure DevOps Backlog' : 'Azure DevOps Board';
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

        if (typeof message.id !== 'number') {
            return;
        }

        const organization = message.organization ?? this._config.organization;
        const project = message.project ?? this._config.project;
        if (!organization || !project) {
            vscode.window.showWarningMessage('Unable to complete the action because organization or project is missing.');
            return;
        }

        if (message.type === 'openWorkItem') {
            try {
                const workItem = await this._client.getWorkItemById(project, message.id, organization);
                if (!workItem) {
                    vscode.window.showWarningMessage(`Work item #${message.id} could not be loaded.`);
                    return;
                }
                await WorkItemDetailsPanel.show(this._client, this._config, workItem, { organization, project });
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open work item: ${this.formatError(err)}`);
            }
            return;
        }

        if (message.type === 'setState' && message.state) {
            try {
                await this._client.updateWorkItemState(project, message.id, message.state, organization);
                vscode.window.showInformationMessage(`Work item #${message.id} moved to ${message.state}.`);
                this._onDidUpdate?.();
                await this.refresh();
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to update work item state: ${this.formatError(err)}`);
            }
        }
    }

    private buildHtml(scopes: ProjectScope[], items: ScopedWorkItem[]): string {
        const webview = this._panel.webview;
        const nonce = crypto.randomBytes(16).toString('hex');
        const title = this._kind === 'backlog' ? 'Backlog' : 'Board';
        const subtitle = `${items.length} item${items.length !== 1 ? 's' : ''} across ${scopes.length} project${scopes.length !== 1 ? 's' : ''}`;
        const content = items.length === 0
            ? '<p class="empty">No planning work items found.</p>'
            : this._kind === 'backlog'
                ? this.buildBacklogHtml(scopes, items)
                : this.buildBoardHtml(scopes, items);

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
  .btn { border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; padding: 4px 10px; font: inherit; cursor: pointer; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .scope { margin: 0 0 18px; }
  .scope-title { font-size: 0.98rem; font-weight: 600; margin: 0 0 8px; color: var(--vscode-sideBarTitle-foreground); }
  .scope-count { color: var(--vscode-descriptionForeground); font-weight: 400; }
  .backlog { border-top: 1px solid var(--vscode-panel-border); }
  .backlog-row { border-bottom: 1px solid var(--vscode-panel-border); }
  .row-main { display: grid; grid-template-columns: minmax(260px, 1fr) auto; align-items: center; gap: 12px; min-height: 38px; padding: 5px 8px 5px calc(8px + var(--depth) * 22px); }
  .row-main:hover, .card:hover { background: var(--vscode-list-hoverBackground); }
  .title-line { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .id { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  .type { color: var(--vscode-charts-blue); white-space: nowrap; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .state-control { display: flex; align-items: center; gap: 6px; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); border-radius: 3px; padding: 3px 22px 3px 6px; max-width: 160px; }
  .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; align-items: start; }
  .column { border: 1px solid var(--vscode-panel-border); border-radius: 4px; min-height: 120px; background: var(--vscode-sideBar-background); }
  .column-header { display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; }
  .cards { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
  .card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px; }
  .card-title { display: flex; gap: 6px; min-width: 0; margin-bottom: 6px; }
  .card-title .title { white-space: normal; }
  .card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  @media (max-width: 720px) {
    .row-main { grid-template-columns: 1fr; align-items: start; }
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
    <button class="btn btn-secondary" data-action="refresh">Refresh</button>
  </div>
  ${content}
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

document.querySelector('[data-action="refresh"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
});

document.addEventListener('click', event => {
    const target = /** @type {HTMLElement} */ (event.target);
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
                : `<div class="backlog">${roots.map(root => this.buildBacklogItemHtml(root, scopedItems, 0, new Set())).join('')}</div>`;
            return `<section class="scope"><h2 class="scope-title">${this.esc(scopeLabel(scope))} <span class="scope-count">${scopedItems.length}</span></h2>${hierarchy}</section>`;
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
        const row = this.buildWorkItemRow(item, depth);
        const childRows = children.map(child => this.buildBacklogItemHtml(child, scopedItems, depth + 1, new Set(seen))).join('');
        return `<div class="backlog-row">${row}${childRows}</div>`;
    }

    private buildBoardHtml(scopes: ProjectScope[], items: ScopedWorkItem[]): string {
        return scopes.map(scope => {
            const scopedItems = items.filter(item => scopeKey(item.scope) === scopeKey(scope));
            const byState = new Map<string, ScopedWorkItem[]>();
            for (const item of scopedItems) {
                const state = (item.workItem.fields?.['System.State'] as string | undefined) ?? 'Unknown';
                if (!byState.has(state)) {
                    byState.set(state, []);
                }
                byState.get(state)!.push(item);
            }

            const columns = [...byState.entries()]
                .sort((left, right) => stateSortValue(left[0]) - stateSortValue(right[0]))
                .map(([state, columnItems]) => {
                    const cards = columnItems.sort(compareWorkItems).map(item => this.buildBoardCardHtml(item)).join('');
                    return `<section class="column"><div class="column-header"><span>${this.esc(state)}</span><span class="meta">${columnItems.length}</span></div><div class="cards">${cards}</div></section>`;
                }).join('');

            const board = columns || '<p class="empty">No board items in this project.</p>';
            return `<section class="scope"><h2 class="scope-title">${this.esc(scopeLabel(scope))} <span class="scope-count">${scopedItems.length}</span></h2><div class="board">${board}</div></section>`;
        }).join('');
    }

    private buildWorkItemRow(item: ScopedWorkItem, depth: number): string {
        const fields = item.workItem.fields ?? {};
        const id = item.workItem.id ?? 0;
        const wiType = (fields['System.WorkItemType'] as string | undefined) ?? 'Work Item';
        const title = (fields['System.Title'] as string | undefined) ?? '(no title)';
        const state = (fields['System.State'] as string | undefined) ?? '';
        const iteration = (fields['System.IterationPath'] as string | undefined) ?? '';
        const assignee = identityName(fields['System.AssignedTo']) ?? 'Unassigned';
        return `<div class="row-main" style="--depth:${depth}">
  <div>
    <div class="title-line"><span class="type">${this.esc(wiType)}</span><span class="id">#${id}</span><button class="btn btn-secondary" data-action="open-work-item" data-id="${id}" data-organization="${this.escAttr(item.scope.organization)}" data-project="${this.escAttr(item.scope.project)}"><span class="title">${this.esc(title)}</span></button></div>
    <div class="meta">${this.esc(assignee)}${iteration ? ` · ${this.esc(iteration)}` : ''}</div>
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
        return `<article class="card">
  <div class="card-title"><span class="type">${this.esc(wiType)}</span><span class="id">#${id}</span><span class="title">${this.esc(title)}</span></div>
  <div class="meta">${this.esc(assignee)}</div>
  <div class="card-footer">
    <button class="btn btn-secondary" data-action="open-work-item" data-id="${id}" data-organization="${this.escAttr(item.scope.organization)}" data-project="${this.escAttr(item.scope.project)}">Open</button>
    ${this.buildStateControl(item, state)}
  </div>
</article>`;
    }

    private buildStateControl(item: ScopedWorkItem, state: string): string {
        const id = item.workItem.id ?? 0;
        const states = COMMON_STATES.includes(state) || !state ? COMMON_STATES : [state, ...COMMON_STATES];
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
