import * as path from 'path';
import * as vscode from 'vscode';
import type { WorkItem } from '../api/adoClient';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import {
    resolveProjectScopes,
    scopeKey,
    scopeLabel,
    type ProjectScope
} from './projectScopes';
import { mapWithConcurrencyLimit } from '../utils/async';

const MAX_CONCURRENT_SCOPE_REQUESTS = 4;

interface ScopedWorkItem {
    workItem: WorkItem;
    scope: ProjectScope;
}

export class WorkItemScopeGroup extends vscode.TreeItem {
    constructor(
        public readonly scope: ProjectScope,
        public readonly items: ScopedWorkItem[]
    ) {
        super(scopeLabel(scope), vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${items.length} item${items.length !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon('project');
        this.contextValue = 'workItemScopeGroup';
    }
}

export class WorkItemStateGroup extends vscode.TreeItem {
    constructor(
        public readonly state: string,
        public readonly count: number,
        public readonly items: ScopedWorkItem[]
    ) {
        super(state, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${count} item${count !== 1 ? 's' : ''}`;
        this.iconPath = stateIcon(state);
        this.contextValue = 'workItemStateGroup';
    }
}

export class WorkItemNode extends vscode.TreeItem {
    public readonly organization?: string;
    public readonly project?: string;

    constructor(
        public readonly workItem: WorkItem,
        scope?: ProjectScope,
        collapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        const id = workItem.id ?? 0;
        const title = workItem.fields?.['System.Title'] as string ?? '(no title)';
        super(`#${id} ${title}`, collapsibleState);

        this.organization = scope?.organization;
        this.project = scope?.project;

        const wiType = workItem.fields?.['System.WorkItemType'] as string ?? 'Work Item';
        const state = workItem.fields?.['System.State'] as string ?? '';
        this.description = `${wiType} · ${state}`;
        this.tooltip = [
            `${wiType} #${id}: ${title}`,
            state ? `State: ${state}` : undefined,
            scope ? `Project: ${scopeLabel(scope)}` : undefined
        ].filter(Boolean).join('\n');
        this.contextValue = 'workItem';
        this.iconPath = typeIcon(wiType);

        this.command = {
            command: 'adoext.viewWorkItemDetails',
            title: 'View Work Item',
            arguments: [this]
        };
    }
}

export function stateIcon(state: string): vscode.ThemeIcon {
    switch (state.toLowerCase()) {
        case 'active':
        case 'in progress':
        case 'committed':
            return new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.blue'));
        case 'new':
        case 'proposed':
            return new vscode.ThemeIcon('circle-outline');
        case 'resolved':
            return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
        case 'closed':
        case 'done':
            return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        case 'blocked':
            return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.red'));
        default:
            return new vscode.ThemeIcon('issues');
    }
}

export function typeIcon(wiType: string): vscode.ThemeIcon | vscode.Uri {
    const fileName = workItemTypeIconFile(wiType);
    if (fileName) {
        return vscode.Uri.file(path.join(__dirname, '..', '..', 'media', 'icons', 'workitems', fileName));
    }

    return new vscode.ThemeIcon('issues');
}

function workItemTypeIconFile(wiType: string): string | undefined {
    switch (wiType.trim().toLowerCase()) {
        case 'bug':
            return 'bug.svg';
        case 'task':
            return 'task.svg';
        case 'epic':
            return 'epic.svg';
        case 'feature':
            return 'feature.svg';
        case 'user story':
            return 'user-story.svg';
        case 'product backlog item':
        case 'pbi':
            return 'product-backlog-item.svg';
        case 'issue':
            return 'issue.svg';
        default:
            return undefined;
    }
}

type WorkItemTreeNode =
    | WorkItemScopeGroup
    | WorkItemStateGroup
    | WorkItemNode
    | vscode.TreeItem;

export class WorkItemProvider implements vscode.TreeDataProvider<WorkItemTreeNode> {
    private _onDidChangeTreeData =
        new vscode.EventEmitter<WorkItemTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkItemTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WorkItemTreeNode): Promise<WorkItemTreeNode[]> {
        if (element instanceof WorkItemScopeGroup) {
            return this.buildStateGroups(element.items);
        }

        if (element instanceof WorkItemStateGroup) {
            return element.items.map(item => new WorkItemNode(item.workItem, item.scope));
        }

        if (this._loading) {
            return [];
        }
        this._loading = true;

        try {
            const setupNode = this.getSetupNode();
            if (setupNode) {
                return [setupNode];
            }

            const scopes = await resolveProjectScopes(this.client, this.config);
            if (scopes.length === 0) {
                return [this.createConfigureNode()];
            }

            const scopedItems = await this.loadWorkItems(scopes);
            if (scopedItems.length === 0) {
                const node = new vscode.TreeItem('No work items found', vscode.TreeItemCollapsibleState.None);
                node.iconPath = new vscode.ThemeIcon('info');
                return [node];
            }

            if (scopes.length === 1) {
                return this.buildStateGroups(scopedItems);
            }

            const byScope = new Map<string, ScopedWorkItem[]>();
            const scopeByKey = new Map<string, ProjectScope>();
            for (const item of scopedItems) {
                const key = scopeKey(item.scope);
                scopeByKey.set(key, item.scope);
                if (!byScope.has(key)) {
                    byScope.set(key, []);
                }
                byScope.get(key)!.push(item);
            }

            return [...byScope.entries()]
                .map(([key, items]) => new WorkItemScopeGroup(scopeByKey.get(key)!, items))
                .sort((left, right) => `${left.label}`.localeCompare(`${right.label}`));
        } catch (err) {
            const node = new vscode.TreeItem(`Error: ${err}`, vscode.TreeItemCollapsibleState.None);
            node.iconPath = new vscode.ThemeIcon('error');
            return [node];
        } finally {
            this._loading = false;
        }
    }

    private async loadWorkItems(scopes: ProjectScope[]): Promise<ScopedWorkItem[]> {
        const results = await mapWithConcurrencyLimit(scopes, MAX_CONCURRENT_SCOPE_REQUESTS, async scope => {
            const workItems = await this.client.getWorkItems(
                scope.project,
                this.config.workItemQuery,
                scope.organization
            );
            return workItems.map(workItem => ({ workItem, scope }));
        });
        return results.flat();
    }

    private buildStateGroups(items: ScopedWorkItem[]): WorkItemStateGroup[] {
        const byState = new Map<string, ScopedWorkItem[]>();
        for (const item of items) {
            const state = (item.workItem.fields?.['System.State'] as string | undefined) ?? 'Unknown';
            if (!byState.has(state)) {
                byState.set(state, []);
            }
            byState.get(state)!.push(item);
        }

        return [...byState.entries()]
            .map(([state, groupItems]) => new WorkItemStateGroup(state, groupItems.length, groupItems))
            .sort((left, right) => stateSortValue(left.state) - stateSortValue(right.state));
    }

    private getSetupNode(): vscode.TreeItem | undefined {
        if (!this.client.isConnected) {
            const node = new vscode.TreeItem('Sign in to Azure DevOps...', vscode.TreeItemCollapsibleState.None);
            node.command = { command: 'adoext.signIn', title: 'Sign In' };
            node.iconPath = new vscode.ThemeIcon('sign-in');
            return node;
        }

        if (!this.config.isConfigured) {
            return this.createConfigureNode();
        }

        return undefined;
    }

    private createConfigureNode(): vscode.TreeItem {
        const node = new vscode.TreeItem('Configure organizations and projects...', vscode.TreeItemCollapsibleState.None);
        node.command = { command: 'adoext.selectOrganization', title: 'Select Organizations' };
        node.iconPath = new vscode.ThemeIcon('settings-gear');
        return node;
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
