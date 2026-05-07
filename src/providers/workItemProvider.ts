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
import { bundledWorkItemTypeIconFile } from '../utils/workItemTypeIcons';
import { WorkItemIconResolver } from './workItemIconResolver';

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
        collapsibleState = vscode.TreeItemCollapsibleState.None,
        iconPath?: vscode.ThemeIcon | vscode.Uri
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
        this.iconPath = iconPath ?? bundledTypeIcon(wiType);

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

function bundledTypeIcon(wiType: string): vscode.ThemeIcon | vscode.Uri {
    const fileName = bundledWorkItemTypeIconFile(wiType);
    if (fileName) {
        const extension = vscode.extensions.getExtension('MarcKassubeck.adoext');
        if (extension) {
            return vscode.Uri.joinPath(extension.extensionUri, 'media', 'icons', 'workitems', fileName);
        }
    }

    return new vscode.ThemeIcon('issues');
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
    private readonly _iconResolver: WorkItemIconResolver;

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager,
        iconResolver?: WorkItemIconResolver
    ) {
        this._iconResolver = iconResolver ?? new WorkItemIconResolver(client, config);
    }

    get iconResolver(): WorkItemIconResolver {
        return this._iconResolver;
    }

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
            return element.items.map(item => {
                const workItemType = (item.workItem.fields?.['System.WorkItemType'] as string | undefined) ?? '';
                return new WorkItemNode(
                    item.workItem,
                    item.scope,
                    vscode.TreeItemCollapsibleState.None,
                    this._iconResolver.resolve(workItemType, item.scope)
                );
            });
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

            await this._iconResolver.loadForScopes(scopes);
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
        const query = this.config.activeWorkItemQuery;
        const results = await mapWithConcurrencyLimit(scopes, MAX_CONCURRENT_SCOPE_REQUESTS, async scope => {
            const workItems = await this.client.getWorkItems(
                scope.project,
                query.filter,
                scope.organization
            );
            return workItems.map(workItem => ({ workItem, scope }));
        });
        return results.flat();
    }

    private buildStateGroups(items: ScopedWorkItem[]): WorkItemStateGroup[] {
        // Apply regex filtering
        const filtered = items.filter(item => this.matchesFilter(item));

        // Apply state hide list
        const hideStates = new Set(this.config.workItemHideStates.map(s => s.toLowerCase()));
        const stateFiltered = hideStates.size > 0
            ? filtered.filter(item => {
                const state = (item.workItem.fields?.['System.State'] as string | undefined) ?? 'Unknown';
                return !hideStates.has(state.toLowerCase());
            })
            : filtered;

        // Apply sorting within each group
        const byState = new Map<string, ScopedWorkItem[]>();
        for (const item of stateFiltered) {
            const state = (item.workItem.fields?.['System.State'] as string | undefined) ?? 'Unknown';
            if (!byState.has(state)) {
                byState.set(state, []);
            }
            byState.get(state)!.push(item);
        }

        return [...byState.entries()]
            .map(([state, groupItems]) => {
                const sortedItems = this.sortedItems(groupItems);
                return new WorkItemStateGroup(state, sortedItems.length, sortedItems);
            })
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

    private matchesFilter(item: ScopedWorkItem): boolean {
        const filterRegex = this.config.workItemFilterRegex.trim();
        if (!filterRegex) {
            return true;
        }

        try {
            const regex = new RegExp(filterRegex, 'i');
            const id = item.workItem.id ?? 0;
            const title = (item.workItem.fields?.['System.Title'] as string | undefined) ?? '';
            return regex.test(`#${id} ${title}`);
        } catch {
            // Invalid regex - show all items
            return true;
        }
    }

    private sortedItems(items: ScopedWorkItem[]): ScopedWorkItem[] {
        const sortOrder = this.config.workItemSortOrder;
        const sorted = [...items];

        if (sortOrder === 'date') {
            sorted.sort((a, b) => {
                const dateA = new Date(a.workItem.fields?.['System.CreatedDate'] as string ?? '').getTime();
                const dateB = new Date(b.workItem.fields?.['System.CreatedDate'] as string ?? '').getTime();
                return dateB - dateA; // Newest first
            });
        } else {
            sorted.sort((a, b) => {
                const titleA = (a.workItem.fields?.['System.Title'] as string ?? '').toLowerCase();
                const titleB = (b.workItem.fields?.['System.Title'] as string ?? '').toLowerCase();
                return titleA.localeCompare(titleB);
            });
        }

        return sorted;
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
