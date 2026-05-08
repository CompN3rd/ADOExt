import * as vscode from 'vscode';
import type { AdoClient, Build, Timeline } from '../api/adoClient';
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

interface TimelineRecordLike {
    id?: string;
    parentId?: string;
    name?: string;
    type?: string;
    state?: unknown;
    result?: unknown;
    startTime?: Date;
    finishTime?: Date;
    order?: number;
    log?: { id?: number; url?: string };
}

interface PipelineTimelineRecord {
    id: string;
    parentId: string;
    name: string;
    recordType: string;
    state?: unknown;
    result?: unknown;
    startTime?: Date;
    finishTime?: Date;
    order?: number;
    logId?: number;
    children: PipelineTimelineRecord[];
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
        this.iconPath = new vscode.ThemeIcon('list-tree');
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
        super(
            `${pipelineName} #${runNumber}`,
            build.id ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

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

export class PipelineTimelineNode extends vscode.TreeItem {
    public readonly organization: string;
    public readonly project: string;
    public readonly buildId: number;
    public readonly runLabel: string;

    constructor(
        public readonly build: Build,
        public readonly scope: ProjectScope,
        public readonly record: PipelineTimelineRecord
    ) {
        super(record.name, record.children.length > 0 || record.logId ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.organization = scope.organization;
        this.project = scope.project;
        this.buildId = build.id ?? 0;
        this.runLabel = runLabel(build);

        const statusLabel = recordStatusLabel(record.state, record.result);
        const duration = recordDurationLabel(record.startTime, record.finishTime);
        this.description = [record.recordType, statusLabel, duration].filter(Boolean).join(' · ');
        this.tooltip = [
            record.name,
            record.recordType ? `Type: ${record.recordType}` : undefined,
            statusLabel ? `Status: ${statusLabel}` : undefined,
            duration ? `Duration: ${duration}` : undefined,
            record.logId ? `Log: ${record.logId}` : undefined
        ].filter(Boolean).join('\n');
        this.iconPath = timelineIcon(record);
        this.contextValue = record.logId ? 'pipelineTimelineRecordWithLog' : 'pipelineTimelineRecord';
    }
}

export class PipelineStepLogNode extends vscode.TreeItem {
    public readonly organization: string;
    public readonly project: string;
    public readonly buildId: number;
    public readonly runLabel: string;
    public readonly stepName: string;

    constructor(
        public readonly build: Build,
        public readonly scope: ProjectScope,
        public readonly record: PipelineTimelineRecord,
        public readonly logId: number
    ) {
        super('Log', vscode.TreeItemCollapsibleState.None);
        this.organization = scope.organization;
        this.project = scope.project;
        this.buildId = build.id ?? 0;
        this.runLabel = runLabel(build);
        this.stepName = record.name;
        this.description = `#${logId}`;
        this.tooltip = `Open log for ${record.name}`;
        this.iconPath = new vscode.ThemeIcon('output');
        this.contextValue = 'pipelineStepLog';
        this.command = {
            command: 'adoext.openPipelineStepLog',
            title: 'Open Step Log',
            arguments: [this]
        };
    }
}

type PipelinesTreeNode =
    | PipelineScopeGroup
    | PipelineRunGroup
    | PipelineRunNode
    | PipelineTimelineNode
    | PipelineStepLogNode
    | vscode.TreeItem;

export class PipelinesProvider implements vscode.TreeDataProvider<PipelinesTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<PipelinesTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;
    private readonly timelineCache = new Map<string, PipelineTimelineRecord[]>();

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    refresh(): void {
        this.timelineCache.clear();
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

        if (element instanceof PipelineRunNode) {
            return this.getTimelineChildren(element);
        }

        if (element instanceof PipelineTimelineNode) {
            const children: PipelinesTreeNode[] = [];
            if (element.record.logId !== undefined && element.build.id !== undefined) {
                children.push(new PipelineStepLogNode(element.build, element.scope, element.record, element.record.logId));
            }
            children.push(...element.record.children.map(record => new PipelineTimelineNode(element.build, element.scope, record)));
            return children;
        }

        if (element instanceof PipelineStepLogNode) {
            return [];
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

    private async getTimelineChildren(node: PipelineRunNode): Promise<PipelinesTreeNode[]> {
        const buildId = node.build.id;
        if (!buildId) {
            return [];
        }

        const records = await this.loadTimeline(node.scope, buildId);
        if (records.length === 0) {
            const emptyNode = new vscode.TreeItem('No timeline records found', vscode.TreeItemCollapsibleState.None);
            emptyNode.iconPath = new vscode.ThemeIcon('info');
            return [emptyNode];
        }

        return records.map(record => new PipelineTimelineNode(node.build, node.scope, record));
    }

    private async loadTimeline(scope: ProjectScope, buildId: number): Promise<PipelineTimelineRecord[]> {
        const key = `${scopeKey(scope)}\u0000${buildId}`;
        const cached = this.timelineCache.get(key);
        if (cached) {
            return cached;
        }

        const timeline = await this.client.getPipelineRunTimeline(scope.project, buildId, scope.organization);
        const records = buildTimelineRecords(timeline);
        this.timelineCache.set(key, records);
        return records;
    }

    private buildGroups(runs: ScopedPipelineRun[], groupBy: PipelineRunsGroupBy): PipelinesTreeNode[] {
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
    return [...runs].sort((a, b) => buildSortTime(b.build) - buildSortTime(a.build));
}

function buildSortTime(build: Build): number {
    const date = build.queueTime ?? build.startTime ?? build.finishTime;
    return date ? new Date(date).getTime() : 0;
}

export function isBuildRunning(build: Build): boolean {
    return build.status === BuildStatus.InProgress ||
        build.status === BuildStatus.NotStarted ||
        build.status === BuildStatus.Cancelling;
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
        if (build.status === BuildStatus.NotStarted) {
            return 'Queued';
        }
        if (build.status === BuildStatus.Cancelling) {
            return 'Cancelling';
        }
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

export function friendlyBranch(refName?: string): string {
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

function buildTimelineRecords(timeline: Timeline | undefined): PipelineTimelineRecord[] {
    const records = (timeline?.records ?? []) as TimelineRecordLike[];
    if (!Array.isArray(records) || records.length === 0) {
        return [];
    }

    const nodesById = new Map<string, PipelineTimelineRecord>();
    for (const record of records) {
        const id = record.id ?? '';
        if (!id) {
            continue;
        }
        nodesById.set(id, {
            id,
            parentId: record.parentId ?? '',
            name: record.name ?? '(unnamed)',
            recordType: record.type ?? '',
            state: record.state,
            result: record.result,
            startTime: record.startTime,
            finishTime: record.finishTime,
            order: record.order,
            logId: record.log?.id,
            children: []
        });
    }

    const roots: PipelineTimelineRecord[] = [];
    for (const node of nodesById.values()) {
        const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }

    return sortTimelineRecords(roots);
}

function sortTimelineRecords(records: PipelineTimelineRecord[]): PipelineTimelineRecord[] {
    const sorted = [...records].sort((left, right) => {
        const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return left.name.localeCompare(right.name);
    });

    for (const record of sorted) {
        record.children = sortTimelineRecords(record.children);
    }

    return sorted;
}

function runLabel(build: Build): string {
    return `${build.definition?.name ?? 'Pipeline'} #${build.buildNumber ?? build.id ?? ''}`;
}

function timelineIcon(record: PipelineTimelineRecord): vscode.ThemeIcon {
    const status = recordStatusKind(record.state, record.result);
    switch (status) {
        case 'succeeded':
            return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
        case 'failed':
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        case 'running':
            return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow'));
        case 'canceled':
            return new vscode.ThemeIcon('circle-slash');
        default:
            return new vscode.ThemeIcon('symbol-method');
    }
}

function recordDurationLabel(start?: Date, finish?: Date): string {
    if (!start) {
        return '';
    }

    const startMs = new Date(start).getTime();
    const endMs = finish ? new Date(finish).getTime() : Date.now();
    const durationMs = Math.max(0, endMs - startMs);
    return formatDuration(durationMs);
}

function recordStatusLabel(state?: unknown, result?: unknown): string {
    const stateText = timelineText(state);
    const resultText = timelineText(result);
    if (stateText) {
        return resultText ? `${stateText} (${resultText})` : stateText;
    }
    return resultText;
}

function recordStatusKind(state?: unknown, result?: unknown): 'succeeded' | 'failed' | 'running' | 'canceled' | 'other' {
    const stateText = timelineText(state).toLowerCase();
    const resultText = timelineText(result).toLowerCase();
    if (stateText.includes('inprogress') || stateText.includes('in progress') || stateText.includes('running')) {
        return 'running';
    }
    if (resultText.includes('succeeded') && !resultText.includes('partial')) {
        return 'succeeded';
    }
    if (resultText.includes('failed') || resultText.includes('partial')) {
        return 'failed';
    }
    if (resultText.includes('canceled') || resultText.includes('cancelled') || stateText.includes('cancel')) {
        return 'canceled';
    }
    return 'other';
}

function timelineText(value?: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    return String(value);
}