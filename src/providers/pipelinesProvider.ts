import * as vscode from 'vscode';
import type { AdoClient, Build } from '../api/adoClient';
import { BuildResult, BuildStatus } from '../api/adoClient';
import type { ConfigManager, PipelineRunsGroupBy } from '../config/configManager';
import {
    resolveProjectScopes,
    scopeKey,
    scopeLabel,
    type ProjectScope
} from './projectScopes';
import { mapWithConcurrencyLimit } from '../utils/async';

const MAX_CONCURRENT_SCOPE_REQUESTS = 4;

interface ScopedPipelineRun {
    build: Build;
    scope: ProjectScope;
}

export class PipelineScopeGroup extends vscode.TreeItem {
    constructor(
        public readonly scope: ProjectScope,
        public readonly runs: ScopedPipelineRun[]
    ) {
        super(scopeLabel(scope), vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${runs.length} run${runs.length !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon('project');
        this.contextValue = 'pipelineScopeGroup';
    }
}

export class PipelineRunGroup extends vscode.TreeItem {
    constructor(
        label: string,
        public readonly runs: ScopedPipelineRun[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${runs.length} run${runs.length !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon('rocket');
        this.contextValue = 'pipelineRunGroup';
    }
}

export class PipelineRunNode extends vscode.TreeItem {
    public readonly organization?: string;
    public readonly project?: string;

    constructor(
        public readonly build: Build,
        public readonly scope: ProjectScope
    ) {
        const pipelineName = build.definition?.name ?? 'Pipeline';
        const runNumber = build.buildNumber ?? String(build.id ?? '');
        super(`${pipelineName} #${runNumber}`, vscode.TreeItemCollapsibleState.None);

        this.organization = scope.organization;
        this.project = scope.project;

        const branch = friendlyBranch(build.sourceBranch);
        const requestedBy = build.requestedFor?.displayName ?? '';
        const statusLabel = buildStatusLabel(build);
        const duration = buildDurationLabel(build);
        this.description = [statusLabel, branch, requestedBy, duration].filter(Boolean).join(' · ');
        this.tooltip = [
            `${pipelineName} #${runNumber}`,
            statusLabel ? `Status: ${statusLabel}` : undefined,
            branch ? `Branch: ${branch}` : undefined,
            requestedBy ? `Requested by: ${requestedBy}` : undefined,
            duration ? `Duration: ${duration}` : undefined,
            `Project: ${scopeLabel(scope)}`
        ].filter(Boolean).join('\n');

        this.iconPath = buildIcon(build);
        this.contextValue = isBuildRunning(build) ? 'pipelineRunRunning' : 'pipelineRun';
        this.command = {
            command: 'adoext.viewPipelineRunDetails',
            title: 'View Pipeline Run Details',
            arguments: [this]
        };
    }
}

type PipelinesTreeNode =
    | PipelineScopeGroup
    | PipelineRunGroup
    | PipelineRunNode
    | vscode.TreeItem;

export class PipelinesProvider implements vscode.TreeDataProvider<PipelinesTreeNode> {
    private _onDidChangeTreeData =
        new vscode.EventEmitter<PipelinesTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PipelinesTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PipelinesTreeNode): Promise<PipelinesTreeNode[]> {
        if (element instanceof PipelineScopeGroup) {
            return this.buildGroups(element.runs, this.config.pipelineRunsGroupBy);
        }

        if (element instanceof PipelineRunGroup) {
            return element.runs.map(run => new PipelineRunNode(run.build, run.scope));
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

            const scopedRuns = await this.loadRuns(scopes);
            if (scopedRuns.length === 0) {
                const node = new vscode.TreeItem('No pipeline runs found', vscode.TreeItemCollapsibleState.None);
                node.iconPath = new vscode.ThemeIcon('info');
                return [node];
            }

            const sortedRuns = sortRuns(scopedRuns);
            const forceScopeGrouping = scopes.length > 1;
            if (!forceScopeGrouping) {
                return this.buildGroups(sortedRuns, this.config.pipelineRunsGroupBy);
            }

            const byScope = new Map<string, ScopedPipelineRun[]>();
            const scopeByKey = new Map<string, ProjectScope>();
            for (const run of sortedRuns) {
                const key = scopeKey(run.scope);
                scopeByKey.set(key, run.scope);
                if (!byScope.has(key)) {
                    byScope.set(key, []);
                }
                byScope.get(key)!.push(run);
            }

            return [...byScope.entries()]
                .map(([key, runs]) => new PipelineScopeGroup(scopeByKey.get(key)!, runs))
                .sort((left, right) => `${left.label}`.localeCompare(`${right.label}`));
        } catch (err) {
            const node = new vscode.TreeItem(`Error: ${err}`, vscode.TreeItemCollapsibleState.None);
            node.iconPath = new vscode.ThemeIcon('error');
            return [node];
        } finally {
            this._loading = false;
        }
    }

    private async loadRuns(scopes: ProjectScope[]): Promise<ScopedPipelineRun[]> {
        const filter = this.config.pipelineRunsFilter;
        const top = this.config.pipelineRunsTop;
        const results = await mapWithConcurrencyLimit(scopes, MAX_CONCURRENT_SCOPE_REQUESTS, async scope => {
            const builds = await this.client.listPipelineRuns(scope.project, scope.organization, { top, filter });
            return builds.map(build => ({ build, scope }));
        });
        return results.flat();
    }

    private buildGroups(
        runs: ScopedPipelineRun[],
        groupBy: PipelineRunsGroupBy
    ): PipelinesTreeNode[] {
        if (runs.length === 0) {
            return [];
        }

        if (groupBy === 'none') {
            return runs.map(run => new PipelineRunNode(run.build, run.scope));
        }

        const grouped = new Map<string, ScopedPipelineRun[]>();
        for (const run of runs) {
            const key = groupBy === 'repository'
                ? (run.build.repository?.name ?? '(No repository)')
                : (friendlyBranch(run.build.sourceBranch) || '(No branch)');
            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key)!.push(run);
        }

        return [...grouped.entries()]
            .map(([key, values]) => new PipelineRunGroup(key, values))
            .sort((a, b) => `${a.label}`.localeCompare(`${b.label}`));
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

function sortRuns(runs: ScopedPipelineRun[]): ScopedPipelineRun[] {
    return [...runs].sort((a, b) => {
        const dateA = buildSortTime(a.build);
        const dateB = buildSortTime(b.build);
        return dateB - dateA;
    });
}

function buildSortTime(build: Build): number {
    const date =
        build.queueTime ??
        build.startTime ??
        build.finishTime;
    return date ? new Date(date).getTime() : 0;
}

function isBuildRunning(build: Build): boolean {
    return build.status === BuildStatus.InProgress || build.status === BuildStatus.NotStarted;
}

function buildIcon(build: Build): vscode.ThemeIcon {
    if (isBuildRunning(build)) {
        return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow'));
    }

    switch (build.result) {
        case BuildResult.Succeeded:
            return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
        case BuildResult.PartiallySucceeded:
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
        case BuildResult.Failed:
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        case BuildResult.Canceled:
            return new vscode.ThemeIcon('circle-slash');
        default:
            return new vscode.ThemeIcon('rocket');
    }
}

function buildStatusLabel(build: Build): string {
    if (isBuildRunning(build)) {
        return 'Running';
    }

    switch (build.result) {
        case BuildResult.Succeeded:
            return 'Succeeded';
        case BuildResult.PartiallySucceeded:
            return 'Partially succeeded';
        case BuildResult.Failed:
            return 'Failed';
        case BuildResult.Canceled:
            return 'Canceled';
        default:
            return build.status !== undefined ? String(build.status) : '';
    }
}

function buildDurationLabel(build: Build): string {
    const start = build.startTime ?? build.queueTime;
    if (!start) {
        return '';
    }

    const startMs = new Date(start).getTime();
    const endMs = build.finishTime ? new Date(build.finishTime).getTime() : Date.now();
    const durationMs = Math.max(0, endMs - startMs);
    return formatDuration(durationMs);
}

function formatDuration(ms: number): string {
    const secondsTotal = Math.floor(ms / 1000);
    const minutes = Math.floor(secondsTotal / 60);
    const seconds = secondsTotal % 60;
    const hours = Math.floor(minutes / 60);
    const minutesRemaining = minutes % 60;

    if (hours > 0) {
        return `${hours}h ${minutesRemaining}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

function friendlyBranch(refName?: string): string {
    if (!refName) {
        return '';
    }
    if (refName.startsWith('refs/heads/')) {
        return refName.replace('refs/heads/', '');
    }
    if (refName.startsWith('refs/')) {
        return refName.replace('refs/', '');
    }
    return refName;
}

