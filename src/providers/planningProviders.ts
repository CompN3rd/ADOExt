import * as vscode from 'vscode';
import type { WorkItem } from '../api/adoClient';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { WorkItemNode, stateIcon } from './workItemProvider';
import {
    resolveProjectScopes,
    scopeKey,
    scopeLabel,
    type ProjectScope
} from './projectScopes';

interface ScopedWorkItem {
    workItem: WorkItem;
    scope: ProjectScope;
}

type PlanningTreeNode =
    | PlanningScopeGroup
    | SprintGroup
    | BoardColumnGroup
    | WorkItemNode
    | vscode.TreeItem;

class PlanningScopeGroup extends vscode.TreeItem {
    constructor(
        public readonly scope: ProjectScope,
        public readonly items: ScopedWorkItem[],
        contextValue: string
    ) {
        super(scopeLabel(scope), vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${items.length} item${items.length !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon('project');
        this.contextValue = contextValue;
    }
}

class SprintGroup extends vscode.TreeItem {
    constructor(
        public readonly iterationPath: string,
        public readonly items: ScopedWorkItem[]
    ) {
        super(iterationLabel(iterationPath), vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${items.length} item${items.length !== 1 ? 's' : ''}`;
        this.tooltip = iterationPath;
        this.iconPath = new vscode.ThemeIcon('calendar');
        this.contextValue = 'sprintGroup';
    }
}

class BoardColumnGroup extends vscode.TreeItem {
    constructor(
        public readonly state: string,
        public readonly items: ScopedWorkItem[]
    ) {
        super(state, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${items.length} item${items.length !== 1 ? 's' : ''}`;
        this.iconPath = stateIcon(state);
        this.contextValue = 'boardColumnGroup';
    }
}

export class BacklogProvider implements vscode.TreeDataProvider<PlanningTreeNode> {
    private _onDidChangeTreeData =
        new vscode.EventEmitter<PlanningTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;
    private _childrenByKey = new Map<string, ScopedWorkItem[]>();
    private _rootsByScope = new Map<string, ScopedWorkItem[]>();

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    refresh(): void {
        this._childrenByKey.clear();
        this._rootsByScope.clear();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PlanningTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PlanningTreeNode): Promise<PlanningTreeNode[]> {
        if (element instanceof PlanningScopeGroup) {
            return this.itemNodes(this._rootsByScope.get(scopeKey(element.scope)) ?? []);
        }

        if (element instanceof WorkItemNode) {
            const scope = nodeScope(element, this.config);
            const id = element.workItem.id;
            if (!scope || typeof id !== 'number') {
                return [];
            }
            return this.itemNodes(this._childrenByKey.get(itemKey(scope, id)) ?? []);
        }

        if (this._loading) {
            return [];
        }
        this._loading = true;

        try {
            const setupNode = getSetupNode(this.client, this.config);
            if (setupNode) {
                return [setupNode];
            }

            const { scopes, items } = await loadPlanningItems(this.client, this.config);
            if (scopes.length === 0) {
                return [createConfigureNode()];
            }

            this.buildHierarchy(items);
            if (items.length === 0) {
                return [emptyNode('No backlog work items found')];
            }

            if (scopes.length === 1) {
                return this.itemNodes(this._rootsByScope.get(scopeKey(scopes[0])) ?? []);
            }

            return groupByScope(items, 'backlogScopeGroup');
        } catch (err) {
            return [errorNode(err)];
        } finally {
            this._loading = false;
        }
    }

    private buildHierarchy(items: ScopedWorkItem[]): void {
        this._childrenByKey.clear();
        this._rootsByScope.clear();

        const byKey = new Map<string, ScopedWorkItem>();
        for (const item of items) {
            const id = item.workItem.id;
            if (typeof id === 'number') {
                byKey.set(itemKey(item.scope, id), item);
            }
        }

        for (const item of items) {
            const parent = parentId(item.workItem);
            const scopeRootKey = scopeKey(item.scope);
            if (typeof parent === 'number' && byKey.has(itemKey(item.scope, parent))) {
                const key = itemKey(item.scope, parent);
                if (!this._childrenByKey.has(key)) {
                    this._childrenByKey.set(key, []);
                }
                this._childrenByKey.get(key)!.push(item);
            } else {
                if (!this._rootsByScope.has(scopeRootKey)) {
                    this._rootsByScope.set(scopeRootKey, []);
                }
                this._rootsByScope.get(scopeRootKey)!.push(item);
            }
        }

        for (const children of this._childrenByKey.values()) {
            children.sort(compareWorkItems);
        }
        for (const roots of this._rootsByScope.values()) {
            roots.sort(compareWorkItems);
        }
    }

    private itemNodes(items: ScopedWorkItem[]): WorkItemNode[] {
        return items.map(item => {
            const id = item.workItem.id;
            const hasChildren = typeof id === 'number' && this._childrenByKey.has(itemKey(item.scope, id));
            return new WorkItemNode(
                item.workItem,
                item.scope,
                hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
            );
        });
    }
}

export class SprintProvider implements vscode.TreeDataProvider<PlanningTreeNode> {
    private _onDidChangeTreeData =
        new vscode.EventEmitter<PlanningTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PlanningTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PlanningTreeNode): Promise<PlanningTreeNode[]> {
        if (element instanceof PlanningScopeGroup) {
            return sprintGroups(element.items);
        }

        if (element instanceof SprintGroup) {
            return element.items.map(item => new WorkItemNode(item.workItem, item.scope));
        }

        if (this._loading) {
            return [];
        }
        this._loading = true;

        try {
            const setupNode = getSetupNode(this.client, this.config);
            if (setupNode) {
                return [setupNode];
            }

            const { scopes, items } = await loadPlanningItems(this.client, this.config);
            if (scopes.length === 0) {
                return [createConfigureNode()];
            }
            if (items.length === 0) {
                return [emptyNode('No sprint work items found')];
            }

            if (scopes.length === 1) {
                return sprintGroups(items);
            }

            return groupByScope(items, 'sprintScopeGroup');
        } catch (err) {
            return [errorNode(err)];
        } finally {
            this._loading = false;
        }
    }
}

export class BoardProvider implements vscode.TreeDataProvider<PlanningTreeNode> {
    private _onDidChangeTreeData =
        new vscode.EventEmitter<PlanningTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PlanningTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PlanningTreeNode): Promise<PlanningTreeNode[]> {
        if (element instanceof PlanningScopeGroup) {
            return boardColumns(element.items);
        }

        if (element instanceof BoardColumnGroup) {
            return element.items.map(item => new WorkItemNode(item.workItem, item.scope));
        }

        if (this._loading) {
            return [];
        }
        this._loading = true;

        try {
            const setupNode = getSetupNode(this.client, this.config);
            if (setupNode) {
                return [setupNode];
            }

            const { scopes, items } = await loadPlanningItems(this.client, this.config);
            if (scopes.length === 0) {
                return [createConfigureNode()];
            }
            if (items.length === 0) {
                return [emptyNode('No board work items found')];
            }

            if (scopes.length === 1) {
                return boardColumns(items);
            }

            return groupByScope(items, 'boardScopeGroup');
        } catch (err) {
            return [errorNode(err)];
        } finally {
            this._loading = false;
        }
    }
}

async function loadPlanningItems(
    client: AdoClient,
    config: ConfigManager
): Promise<{ scopes: ProjectScope[]; items: ScopedWorkItem[] }> {
    const scopes = await resolveProjectScopes(client, config);
    const results = await Promise.all(scopes.map(async scope => {
        const workItems = await client.getPlanningWorkItems(scope.project, scope.organization);
        return workItems.map(workItem => ({ workItem, scope }));
    }));
    return { scopes, items: results.flat() };
}

function groupByScope(items: ScopedWorkItem[], contextValue: string): PlanningScopeGroup[] {
    const byScope = new Map<string, ScopedWorkItem[]>();
    const scopeByKey = new Map<string, ProjectScope>();
    for (const item of items) {
        const key = scopeKey(item.scope);
        scopeByKey.set(key, item.scope);
        if (!byScope.has(key)) {
            byScope.set(key, []);
        }
        byScope.get(key)!.push(item);
    }

    return [...byScope.entries()]
        .map(([key, scopedItems]) => new PlanningScopeGroup(scopeByKey.get(key)!, scopedItems, contextValue))
        .sort((left, right) => `${left.label}`.localeCompare(`${right.label}`));
}

function sprintGroups(items: ScopedWorkItem[]): SprintGroup[] {
    const byIteration = new Map<string, ScopedWorkItem[]>();
    for (const item of items) {
        const iteration = (item.workItem.fields?.['System.IterationPath'] as string | undefined) ?? 'Unscheduled';
        if (!byIteration.has(iteration)) {
            byIteration.set(iteration, []);
        }
        byIteration.get(iteration)!.push(item);
    }

    return [...byIteration.entries()]
        .map(([iteration, iterationItems]) => new SprintGroup(iteration, iterationItems.sort(compareWorkItems)))
        .sort((left, right) => left.iterationPath.localeCompare(right.iterationPath));
}

function boardColumns(items: ScopedWorkItem[]): BoardColumnGroup[] {
    const byState = new Map<string, ScopedWorkItem[]>();
    for (const item of items) {
        const state = (item.workItem.fields?.['System.State'] as string | undefined) ?? 'Unknown';
        if (!byState.has(state)) {
            byState.set(state, []);
        }
        byState.get(state)!.push(item);
    }

    return [...byState.entries()]
        .map(([state, stateItems]) => new BoardColumnGroup(state, stateItems.sort(compareWorkItems)))
        .sort((left, right) => stateSortValue(left.state) - stateSortValue(right.state));
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

function nodeScope(node: WorkItemNode, config: ConfigManager): ProjectScope | undefined {
    const organization = node.organization ?? config.organization;
    const project = node.project ?? config.project;
    return organization && project ? { organization, project } : undefined;
}

function itemKey(scope: ProjectScope, id: number): string {
    return `${scopeKey(scope)}\u0000${id}`;
}

function iterationLabel(iterationPath: string): string {
    const pieces = iterationPath.split('\\').filter(Boolean);
    return pieces.length > 0 ? pieces[pieces.length - 1] : iterationPath;
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

function getSetupNode(client: AdoClient, config: ConfigManager): vscode.TreeItem | undefined {
    if (!client.isConnected) {
        const node = new vscode.TreeItem('Sign in to Azure DevOps...', vscode.TreeItemCollapsibleState.None);
        node.command = { command: 'adoext.signIn', title: 'Sign In' };
        node.iconPath = new vscode.ThemeIcon('sign-in');
        return node;
    }

    if (!config.isConfigured) {
        return createConfigureNode();
    }

    return undefined;
}

function createConfigureNode(): vscode.TreeItem {
    const node = new vscode.TreeItem('Configure organizations and projects...', vscode.TreeItemCollapsibleState.None);
    node.command = { command: 'adoext.selectOrganization', title: 'Select Organizations' };
    node.iconPath = new vscode.ThemeIcon('settings-gear');
    return node;
}

function emptyNode(label: string): vscode.TreeItem {
    const node = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    node.iconPath = new vscode.ThemeIcon('info');
    return node;
}

function errorNode(err: unknown): vscode.TreeItem {
    const node = new vscode.TreeItem(`Error: ${err}`, vscode.TreeItemCollapsibleState.None);
    node.iconPath = new vscode.ThemeIcon('error');
    return node;
}
