import * as vscode from 'vscode';
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
import { buildMessageDocument, buildWebviewDocument, webviewAssetRoots } from './webviewHtml';
import type { PlanningItemViewModel, PlanningMessage as PlanningWebviewMessage, PlanningViewModel } from './webviewTypes';

type PlanningPanelKind = 'backlog' | 'board' | 'sprint';

const MAX_CONCURRENT_SCOPE_REQUESTS = 4;

interface ScopedWorkItem {
    workItem: WorkItem;
    scope: ProjectScope;
}

type PlanningMessage = PlanningWebviewMessage;

export class PlanningPanel {
    private static readonly _panels = new Map<PlanningPanelKind, PlanningPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _disposables: vscode.Disposable[] = [];
    private _allowedStatesByItemKey = new Map<string, string[]>();

    static async show(
        context: vscode.ExtensionContext,
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

        const panel = new PlanningPanel(context, kind, client, config, onDidUpdate);
        PlanningPanel._panels.set(kind, panel);
        await panel.refresh();
    }

    private constructor(
        private readonly _context: vscode.ExtensionContext,
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
                retainContextWhenHidden: true,
                localResourceRoots: webviewAssetRoots(_context)
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
                await WorkItemDetailsPanel.show(this._context, this._client, this._config, workItem, { organization, project });
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

    private buildViewModel(scopes: ProjectScope[], items: ScopedWorkItem[]): PlanningViewModel {
        const title = this._kind === 'backlog'
            ? 'Backlog'
            : this._kind === 'board'
                ? 'Board'
                : 'Sprint';
        const subtitle = `${items.length} item${items.length !== 1 ? 's' : ''} across ${scopes.length} project${scopes.length !== 1 ? 's' : ''}`;

        return {
            kind: this._kind,
            title,
            subtitle,
            scopes: scopes.map(scope => ({
                key: scopeKey(scope),
                label: scopeLabel(scope),
                organization: scope.organization,
                project: scope.project
            })),
            items: items
                .sort(compareWorkItems)
                .map(item => this.buildItemViewModel(item))
        };
    }

    private buildItemViewModel(item: ScopedWorkItem): PlanningItemViewModel {
        const fields = item.workItem.fields ?? {};
        const id = item.workItem.id ?? 0;
        const workItemType = (fields['System.WorkItemType'] as string | undefined) ?? 'Work Item';
        const state = (fields['System.State'] as string | undefined) ?? '';
        const iteration = (fields['System.IterationPath'] as string | undefined) ?? '';
        const allowedStates = this.allowedStatesFor(item, state);

        return {
            id,
            scopeKey: scopeKey(item.scope),
            organization: item.scope.organization,
            project: item.scope.project,
            title: (fields['System.Title'] as string | undefined) ?? '(no title)',
            workItemType,
            typeClass: typeClass(workItemType),
            state,
            allowedStates,
            assignee: identityName(fields['System.AssignedTo']) ?? 'Unassigned',
            iteration,
            iterationLabel: iteration ? iterationLabel(iteration) : 'No iteration',
            parentId: parentId(item.workItem)
        };
    }

    private allowedStatesFor(item: ScopedWorkItem, state: string): string[] {
        const workItemType = (item.workItem.fields?.['System.WorkItemType'] as string | undefined) ?? '';
        const cacheKey = JSON.stringify([item.scope.organization, item.scope.project, workItemType]);
        const allowedStates = this._allowedStatesByItemKey.get(cacheKey) ?? [];
        const states = allowedStates.includes(state) || !state
            ? allowedStates
            : [state, ...allowedStates];
        return [...new Set(states.filter(Boolean))];
    }

    private buildHtml(scopes: ProjectScope[], items: ScopedWorkItem[]): string {
        const data = this.buildViewModel(scopes, items);
        return buildWebviewDocument(this._context, this._panel.webview, {
            title: data.title,
            entry: 'planning.js',
            appTag: 'ado-planning-app',
            data
        });
    }

    private buildLoadingHtml(): string {
        return this.buildMessageHtml('Loading planning data...');
    }

    private buildMessageHtml(message: string): string {
        return buildMessageDocument(this._panel.webview, message);
    }

    private dispose(): void {
        PlanningPanel._panels.delete(this._kind);
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
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

function typeClass(wiType: string): string {
    return wiType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function iterationLabel(iterationPath: string): string {
    const pieces = iterationPath.split('\\').filter(Boolean);
    return pieces.length > 0 ? pieces[pieces.length - 1] : iterationPath;
}
