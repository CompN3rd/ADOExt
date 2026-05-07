import * as vscode from 'vscode';
import type { AdoClient, Build } from '../api/adoClient';
import { BuildStatus, BuildResult } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import {
    resolveProjectScopes,
    scopeKey,
    scopeLabel,
    type ProjectScope
} from './projectScopes';
import { mapWithConcurrencyLimit } from '../utils/async';

const MAX_CONCURRENT_SCOPE_REQUESTS = 4;
const MAX_RUNS_PER_SCOPE = 50;

interface ScopedRun {
    run: Build;
    scope: ProjectScope;
}

export class PipelineBucketNode extends vscode.TreeItem {
    constructor(
        public readonly bucketId: string,
        label: string,
        public readonly filter: 'recent' | 'running' | 'failed' | 'all'
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'pipelineBucket';
        this.iconPath = bucketIcon(filter);
    }
}

function bucketIcon(filter: 'recent' | 'running' | 'failed' | 'all'): vscode.ThemeIcon {
    switch (filter) {
        case 'recent': return new vscode.ThemeIcon('history');
        case 'running': return new vscode.ThemeIcon('sync~spin');
        case 'failed': return new vscode.ThemeIcon('error');
        case 'all': return new vscode.ThemeIcon('list-filter');
    }
}

export class PipelineScopeGroup extends vscode.TreeItem {
    constructor(
        public readonly scope: ProjectScope,
        public readonly runs: ScopedRun[]
    ) {
        super(scopeLabel(scope), vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${runs.length} run${runs.length !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon('project');
        this.contextValue = 'pipelineScopeGroup';
    }
}

export class PipelineRunNode extends vscode.TreeItem {
    public readonly organization?: string;
    public readonly project?: string;

    constructor(
        public readonly run: Build,
        public readonly scope?: ProjectScope
    ) {
        const id = run.id ?? 0;
        const buildNumber = run.buildNumber ?? `#${id}`;
        const pipelineName = run.definition?.name ?? 'Unknown';
        super(`${pipelineName} ${buildNumber}`, vscode.TreeItemCollapsibleState.None);

        this.organization = scope?.organization;
        this.project = scope?.project;

        const status = getRunStatusLabel(run);
        this.description = status;
        this.tooltip = [
            `Build #${id}: ${pipelineName}`,
            `Status: ${status}`,
            run.requestedFor?.displayName ? `Requested by: ${run.requestedFor.displayName}` : undefined,
            run.sourceBranch ? `Branch: ${run.sourceBranch.replace('refs/heads/', '')}` : undefined,
            scope ? `Project: ${scopeLabel(scope)}` : undefined
        ].filter(Boolean).join('\n');
        this.contextValue = 'pipelineRun';
        this.iconPath = runIcon(run);
        this.command = {
            command: 'adoext.viewPipelineRunDetails',
            title: 'View Pipeline Run Details',
            arguments: [this]
        };
    }
}

function getRunStatusLabel(run: Build): string {
    const status = run.status;
    const result = run.result;

    if (status === BuildStatus.Completed) {
        if (result === BuildResult.Succeeded) {
            return 'Succeeded';
        } else if (result === BuildResult.PartiallySucceeded) {
            return 'Partially Succeeded';
        } else if (result === BuildResult.Failed) {
            return 'Failed';
        } else if (result === BuildResult.Canceled) {
            return 'Canceled';
        } else {
            return 'Completed';
        }
    } else if (status === BuildStatus.InProgress) {
        return 'In Progress';
    } else if (status === BuildStatus.NotStarted) {
        return 'Queued';
    } else if (status === BuildStatus.Cancelling) {
        return 'Cancelling';
    } else {
        return 'Unknown';
    }
}

function runIcon(run: Build): vscode.ThemeIcon {
    const status = run.status;
    const result = run.result;

    if (status === BuildStatus.InProgress) {
        return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
    } else if (status === BuildStatus.Completed) {
        if (result === BuildResult.Succeeded) {
            return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
        } else if (result === BuildResult.Failed) {
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        } else if (result === BuildResult.PartiallySucceeded) {
            return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
        } else if (result === BuildResult.Canceled) {
            return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('descriptionForeground'));
        }
    } else if (status === BuildStatus.NotStarted) {
        return new vscode.ThemeIcon('clock', new vscode.ThemeColor('descriptionForeground'));
    } else if (status === BuildStatus.Cancelling) {
        return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.orange'));
    }

    return new vscode.ThemeIcon('circle-outline');
}

type PipelineTreeNode = PipelineBucketNode | PipelineScopeGroup | PipelineRunNode;

export class PipelineProvider implements vscode.TreeDataProvider<PipelineTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<PipelineTreeNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _runCache = new Map<string, ScopedRun[]>();
    private _buckets: PipelineBucketNode[] = [];

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {
        this._initBuckets();
    }

    private _initBuckets(): void {
        this._buckets = [
            new PipelineBucketNode('recent', 'Recent', 'recent'),
            new PipelineBucketNode('running', 'Running', 'running'),
            new PipelineBucketNode('failed', 'Failed', 'failed'),
            new PipelineBucketNode('all', 'All Runs', 'all')
        ];
    }

    refresh(): void {
        this._runCache.clear();
        this._onDidChangeTreeData.fire();
    }

    refreshBucket(bucket: PipelineBucketNode): void {
        this._runCache.delete(bucket.bucketId);
        this._onDidChangeTreeData.fire(bucket);
    }

    getTreeItem(element: PipelineTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PipelineTreeNode): Promise<PipelineTreeNode[]> {
        if (!element) {
            // Root: show buckets
            return this._buckets;
        }

        if (element instanceof PipelineBucketNode) {
            // Bucket level: load runs and group by scope if needed
            const runs = await this._loadRunsForBucket(element);

            if (runs.length === 0) {
                return [];
            }

            // Group by scope if multiple scopes
            const scopes = await resolveProjectScopes(this.client, this.config);
            if (scopes.length > 1) {
                const grouped = new Map<string, ScopedRun[]>();
                for (const run of runs) {
                    const key = scopeKey(run.scope);
                    if (!grouped.has(key)) {
                        grouped.set(key, []);
                    }
                    grouped.get(key)!.push(run);
                }
                return Array.from(grouped.values()).map(
                    scopeRuns => new PipelineScopeGroup(scopeRuns[0].scope, scopeRuns)
                );
            } else {
                // Single scope: show runs directly
                return runs.map(r => new PipelineRunNode(r.run, r.scope));
            }
        }

        if (element instanceof PipelineScopeGroup) {
            // Scope group: show runs
            return element.runs.map(r => new PipelineRunNode(r.run, r.scope));
        }

        return [];
    }

    private async _loadRunsForBucket(bucket: PipelineBucketNode): Promise<ScopedRun[]> {
        const cacheKey = bucket.bucketId;
        const cached = this._runCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const scopes = await resolveProjectScopes(this.client, this.config);
        if (scopes.length === 0) {
            return [];
        }

        const allRunsResults = await mapWithConcurrencyLimit(
            scopes,
            MAX_CONCURRENT_SCOPE_REQUESTS,
            async (scope: ProjectScope) => {
                try {
                    const runs = await this.client.getPipelineRuns(
                        scope.project,
                        undefined,
                        MAX_RUNS_PER_SCOPE,
                        scope.organization
                    );
                    return { scope, runs };
                } catch {
                    return { scope, runs: [] };
                }
            }
        );

        const allRuns: ScopedRun[] = [];
        for (const result of allRunsResults) {
            for (const run of result.runs) {
                allRuns.push({ run, scope: result.scope });
            }
        }

        // Filter based on bucket type
        let filteredRuns = allRuns;
        switch (bucket.filter) {
            case 'running':
                filteredRuns = allRuns.filter(r =>
                    r.run.status === BuildStatus.InProgress ||
                    r.run.status === BuildStatus.NotStarted
                );
                break;
            case 'failed':
                filteredRuns = allRuns.filter(r =>
                    r.run.status === BuildStatus.Completed &&
                    r.run.result === BuildResult.Failed
                );
                break;
            case 'recent':
                // Sort by start time and take top 20
                filteredRuns = allRuns
                    .sort((a, b) => {
                        const timeA = a.run.startTime ? new Date(a.run.startTime).getTime() : 0;
                        const timeB = b.run.startTime ? new Date(b.run.startTime).getTime() : 0;
                        return timeB - timeA;
                    })
                    .slice(0, 20);
                break;
            case 'all':
                // Sort by start time
                filteredRuns = allRuns.sort((a, b) => {
                    const timeA = a.run.startTime ? new Date(a.run.startTime).getTime() : 0;
                    const timeB = b.run.startTime ? new Date(b.run.startTime).getTime() : 0;
                    return timeB - timeA;
                });
                break;
        }

        this._runCache.set(cacheKey, filteredRuns);
        return filteredRuns;
    }
}
