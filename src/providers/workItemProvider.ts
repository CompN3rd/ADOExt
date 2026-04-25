import * as vscode from 'vscode';
import type { WorkItem } from '../api/adoClient';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';

// ---------------------------------------------------------------------------
// Tree node types
// ---------------------------------------------------------------------------

export class WorkItemStateGroup extends vscode.TreeItem {
    constructor(
        public readonly state: string,
        public readonly count: number,
        public readonly items: WorkItem[]
    ) {
        super(state, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${count} item${count !== 1 ? 's' : ''}`;
        this.iconPath = stateIcon(state);
        this.contextValue = 'workItemStateGroup';
    }
}

export class WorkItemNode extends vscode.TreeItem {
    constructor(public readonly workItem: WorkItem) {
        const id = workItem.id ?? 0;
        const title = workItem.fields?.['System.Title'] as string ?? '(no title)';
        super(`#${id} ${title}`, vscode.TreeItemCollapsibleState.None);

        const wiType = workItem.fields?.['System.WorkItemType'] as string ?? 'WorkItem';
        const state = workItem.fields?.['System.State'] as string ?? '';
        this.description = `${wiType} · ${state}`;
        this.tooltip = `${wiType} #${id}: ${title}\nState: ${state}`;
        this.contextValue = 'workItem';
        this.iconPath = typeIcon(wiType);

        this.command = {
            command: 'adoext.openWorkItem',
            title: 'Open Work Item',
            arguments: [this]
        };
    }
}

function stateIcon(state: string): vscode.ThemeIcon {
    switch (state.toLowerCase()) {
        case 'active':
        case 'in progress':
            return new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.blue'));
        case 'new':
            return new vscode.ThemeIcon('circle-outline');
        case 'resolved':
            return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
        case 'closed':
            return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        case 'blocked':
            return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.red'));
        default:
            return new vscode.ThemeIcon('issues');
    }
}

function typeIcon(wiType: string): vscode.ThemeIcon {
    switch (wiType.toLowerCase()) {
        case 'bug':
            return new vscode.ThemeIcon('bug', new vscode.ThemeColor('charts.red'));
        case 'task':
            return new vscode.ThemeIcon('tasklist');
        case 'feature':
            return new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
        case 'epic':
            return new vscode.ThemeIcon('rocket', new vscode.ThemeColor('charts.purple'));
        case 'user story':
            return new vscode.ThemeIcon('person', new vscode.ThemeColor('charts.blue'));
        default:
            return new vscode.ThemeIcon('issues');
    }
}

// ---------------------------------------------------------------------------
// Tree Data Provider
// ---------------------------------------------------------------------------

type WorkItemTreeNode = WorkItemStateGroup | WorkItemNode | vscode.TreeItem;

export class WorkItemProvider
    implements vscode.TreeDataProvider<WorkItemTreeNode>
{
    private _onDidChangeTreeData =
        new vscode.EventEmitter<WorkItemTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _groups: WorkItemStateGroup[] = [];
    private _loading = false;
    private _error: string | undefined;

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    refresh(): void {
        this._groups = [];
        this._error = undefined;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkItemTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(
        element?: WorkItemTreeNode
    ): Promise<WorkItemTreeNode[]> {
        if (element instanceof WorkItemStateGroup) {
            return element.items.map(wi => new WorkItemNode(wi));
        }

        // Root level: load work items and group by state
        if (this._loading) {
            return [];
        }
        this._loading = true;

        try {
            if (!this.config.isConfigured) {
                const node = new vscode.TreeItem(
                    'Configure organization and project…',
                    vscode.TreeItemCollapsibleState.None
                );
                node.command = {
                    command: 'adoext.selectOrganization',
                    title: 'Select Organization'
                };
                node.iconPath = new vscode.ThemeIcon('settings-gear');
                return [node];
            }

            const workItems = await this.client.getWorkItems(
                this.config.project,
                this.config.workItemQuery
            );

            const byState = new Map<string, WorkItem[]>();
            for (const wi of workItems) {
                const state =
                    (wi.fields?.['System.State'] as string | undefined) ?? 'Unknown';
                if (!byState.has(state)) {
                    byState.set(state, []);
                }
                byState.get(state)!.push(wi);
            }

            if (byState.size === 0) {
                const node = new vscode.TreeItem(
                    'No work items found',
                    vscode.TreeItemCollapsibleState.None
                );
                node.iconPath = new vscode.ThemeIcon('info');
                return [node];
            }

            this._groups = [...byState.entries()].map(
                ([state, items]) => new WorkItemStateGroup(state, items.length, items)
            );
            return this._groups;
        } catch (err) {
            this._error = `${err}`;
            const node = new vscode.TreeItem(
                `Error: ${this._error}`,
                vscode.TreeItemCollapsibleState.None
            );
            node.iconPath = new vscode.ThemeIcon('error');
            return [node];
        } finally {
            this._loading = false;
        }
    }
}
