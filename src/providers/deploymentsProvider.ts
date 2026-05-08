import * as vscode from 'vscode';
import type { AdoClient, Release } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import {
    resolveProjectScopes,
    scopeKey,
    scopeLabel,
    type ProjectScope
} from './projectScopes';
import { mapWithConcurrencyLimit } from '../utils/async';
import { PipelineRunNode } from './pipelinesProvider';
import { classicReleaseUrl } from '../utils/releaseUrls';

const MAX_CONCURRENT_SCOPE_REQUESTS = 4;

interface ScopedDeployments {
    scope: ProjectScope;
    pipelineRuns: PipelineRunNode[];
    releases: Release[];
    releaseError?: string;
}

export class DeploymentsScopeGroup extends vscode.TreeItem {
    constructor(public readonly data: ScopedDeployments) {
        super(scopeLabel(data.scope), vscode.TreeItemCollapsibleState.Expanded);
        this.description = '';
        this.iconPath = new vscode.ThemeIcon('project');
        this.contextValue = 'deploymentsScopeGroup';
    }
}

type DeploymentsCategory = 'pipelines' | 'releases';

export class DeploymentsCategoryGroup extends vscode.TreeItem {
    constructor(
        public readonly category: DeploymentsCategory,
        public readonly data: ScopedDeployments
    ) {
        const label = category === 'pipelines' ? 'Pipeline Runs' : 'Releases';
        super(label, vscode.TreeItemCollapsibleState.Expanded);

        const count = category === 'pipelines' ? data.pipelineRuns.length : data.releases.length;
        this.description = `${count} item${count !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon(category === 'pipelines' ? 'rocket' : 'package');
        this.contextValue = category === 'pipelines' ? 'deploymentsPipelinesGroup' : 'deploymentsReleasesGroup';
    }
}

export class ClassicReleaseNode extends vscode.TreeItem {
    public readonly organization: string;
    public readonly project: string;
    public readonly releaseId: number;

    constructor(
        public readonly release: Release,
        public readonly scope: ProjectScope
    ) {
        const definitionName = release.releaseDefinition?.name ?? 'Release';
        const releaseName = release.name ?? String(release.id ?? '');
        super(`${definitionName} ${releaseName}`, vscode.TreeItemCollapsibleState.Collapsed);

        this.organization = scope.organization;
        this.project = scope.project;
        this.releaseId = release.id ?? 0;

        const status = release.status !== undefined ? String(release.status) : '';
        const createdBy = release.createdBy?.displayName ?? '';
        const createdOn = release.createdOn ? new Date(release.createdOn).toLocaleString() : '';
        const artifactVersion = firstArtifactVersion(release);
        this.description = [status, artifactVersion, createdBy, createdOn].filter(Boolean).join(' · ');

        this.tooltip = [
            `${definitionName} ${releaseName}`,
            status ? `Status: ${status}` : undefined,
            artifactVersion ? `Artifact: ${artifactVersion}` : undefined,
            createdBy ? `Created by: ${createdBy}` : undefined,
            createdOn ? `Created: ${createdOn}` : undefined,
            `Project: ${scopeLabel(scope)}`
        ].filter(Boolean).join('\n');

        this.iconPath = new vscode.ThemeIcon('package');
        this.contextValue = 'classicRelease';
        this.command = {
            command: 'adoext.viewReleaseDetails',
            title: 'View Release Details',
            arguments: [this]
        };
    }
}

export class ClassicReleaseEnvironmentNode extends vscode.TreeItem {
    public readonly organization: string;
    public readonly project: string;
    public readonly releaseId: number;
    public readonly environmentId: number;

    constructor(
        public readonly release: Release,
        public readonly scope: ProjectScope,
        public readonly environment: NonNullable<Release['environments']>[number]
    ) {
        super(environment.name ?? '(unnamed)', vscode.TreeItemCollapsibleState.None);

        this.organization = scope.organization;
        this.project = scope.project;
        this.releaseId = release.id ?? 0;
        this.environmentId = environment.id ?? 0;

        const status = environment.status !== undefined ? String(environment.status) : '';
        const approvals = approvalSummaryLabel(environment);
        const modifiedOn = environment.modifiedOn ? new Date(environment.modifiedOn).toLocaleString() : '';

        this.description = [status, approvals, modifiedOn].filter(Boolean).join(' · ');
        this.tooltip = [
            environment.name ?? '(unnamed)',
            status ? `Status: ${status}` : undefined,
            approvals ? `Approvals: ${approvals}` : undefined,
            modifiedOn ? `Updated: ${modifiedOn}` : undefined,
            this.environmentId ? `Open: ${classicReleaseUrl(this.organization, this.project, this.releaseId, { environmentId: this.environmentId })}` : undefined
        ].filter(Boolean).join('\n');

        this.iconPath = new vscode.ThemeIcon('server-environment');
        this.contextValue = 'classicReleaseEnvironment';
        this.command = {
            command: 'adoext.viewReleaseDetails',
            title: 'View Release Details',
            arguments: [new ClassicReleaseNode(release, scope)]
        };
    }
}

type DeploymentsTreeNode =
    | DeploymentsScopeGroup
    | DeploymentsCategoryGroup
    | PipelineRunNode
    | ClassicReleaseNode
    | ClassicReleaseEnvironmentNode
    | vscode.TreeItem;

export class DeploymentsProvider implements vscode.TreeDataProvider<DeploymentsTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DeploymentsTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DeploymentsTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: DeploymentsTreeNode): Promise<DeploymentsTreeNode[]> {
        if (element instanceof DeploymentsScopeGroup) {
            return this.categoriesFor(element.data);
        }

        if (element instanceof DeploymentsCategoryGroup) {
            return this.childrenForCategory(element.category, element.data);
        }

        if (element instanceof ClassicReleaseNode) {
            const environments = element.release.environments ?? [];
            if (environments.length === 0) {
                const node = new vscode.TreeItem('No environments found', vscode.TreeItemCollapsibleState.None);
                node.iconPath = new vscode.ThemeIcon('info');
                return [node];
            }
            return environments.map(env => new ClassicReleaseEnvironmentNode(element.release, element.scope, env));
        }

        if (element instanceof ClassicReleaseEnvironmentNode) {
            return [];
        }

        if (element instanceof PipelineRunNode) {
            // Pipeline runs already have their own tree under the Pipelines view;
            // keep Deployments read-only and shallow.
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

            const scoped = await this.loadDeployments(scopes);
            if (scoped.length === 0) {
                const node = new vscode.TreeItem('No deployments found', vscode.TreeItemCollapsibleState.None);
                node.iconPath = new vscode.ThemeIcon('info');
                return [node];
            }

            if (scopes.length === 1) {
                return this.categoriesFor(scoped[0]);
            }

            const byScope = new Map<string, ScopedDeployments>();
            for (const item of scoped) {
                byScope.set(scopeKey(item.scope), item);
            }

            return [...byScope.values()]
                .map(item => new DeploymentsScopeGroup(item))
                .sort((left, right) => `${left.label}`.localeCompare(`${right.label}`));
        } catch (err) {
            const node = new vscode.TreeItem(`Error: ${err}`, vscode.TreeItemCollapsibleState.None);
            node.iconPath = new vscode.ThemeIcon('error');
            return [node];
        } finally {
            this._loading = false;
        }
    }

    private categoriesFor(data: ScopedDeployments): DeploymentsTreeNode[] {
        return [
            new DeploymentsCategoryGroup('pipelines', data),
            new DeploymentsCategoryGroup('releases', data)
        ];
    }

    private childrenForCategory(category: DeploymentsCategory, data: ScopedDeployments): DeploymentsTreeNode[] {
        if (category === 'pipelines') {
            if (data.pipelineRuns.length === 0) {
                const node = new vscode.TreeItem('No pipeline runs found', vscode.TreeItemCollapsibleState.None);
                node.iconPath = new vscode.ThemeIcon('info');
                return [node];
            }
            return data.pipelineRuns;
        }

        if (data.releaseError) {
            const node = new vscode.TreeItem(`Classic releases unavailable: ${data.releaseError}`, vscode.TreeItemCollapsibleState.None);
            node.iconPath = new vscode.ThemeIcon('warning');
            return [node];
        }

        if (data.releases.length === 0) {
            const node = new vscode.TreeItem('No releases found', vscode.TreeItemCollapsibleState.None);
            node.iconPath = new vscode.ThemeIcon('info');
            return [node];
        }

        return data.releases.map(release => new ClassicReleaseNode(release, data.scope));
    }

    private async loadDeployments(scopes: ProjectScope[]): Promise<ScopedDeployments[]> {
        const pipelineTop = this.config.pipelineRunsTop;
        const pipelineFilter = this.config.pipelineRunsFilter;
        const releasesTop = this.config.classicReleasesTop;

        return mapWithConcurrencyLimit(scopes, MAX_CONCURRENT_SCOPE_REQUESTS, async scope => {
            const [runsResult, releasesResult] = await Promise.allSettled([
                this.client.listPipelineRuns(scope.project, scope.organization, { top: pipelineTop, filter: pipelineFilter }),
                this.client.listClassicReleases(scope.project, scope.organization, { top: releasesTop })
            ]);

            const runs = runsResult.status === 'fulfilled'
                ? runsResult.value.map(build => {
                    const node = new PipelineRunNode(build, scope);
                    node.collapsibleState = vscode.TreeItemCollapsibleState.None;
                    return node;
                })
                : [];

            let releases: Release[] = [];
            let releaseError: string | undefined;
            if (releasesResult.status === 'fulfilled') {
                releases = releasesResult.value ?? [];
            } else {
                releaseError = stringifyError(releasesResult.reason);
            }

            return {
                scope,
                pipelineRuns: runs,
                releases,
                ...(releaseError ? { releaseError } : {})
            };
        });
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

function firstArtifactVersion(release: Release): string {
    const artifact = release.artifacts?.[0];
    const version = artifact?.definitionReference?.version?.name ?? artifact?.definitionReference?.version?.id ?? '';
    return version ? String(version) : '';
}

function approvalSummaryLabel(environment: { preDeployApprovals?: Array<{ status?: unknown }>; postDeployApprovals?: Array<{ status?: unknown }> }): string {
    const pre = summarizeApprovals(environment.preDeployApprovals ?? []);
    const post = summarizeApprovals(environment.postDeployApprovals ?? []);
    const parts = [
        pre ? `Pre: ${pre}` : '',
        post ? `Post: ${post}` : ''
    ].filter(Boolean);
    return parts.join(' · ');
}

function summarizeApprovals(approvals: Array<{ status?: unknown }>): string {
    if (approvals.length === 0) {
        return '';
    }
    const byStatus = new Map<string, number>();
    for (const approval of approvals) {
        const key = approvalStatusLabel(approval.status);
        if (!key) { continue; }
        byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
    }
    if (byStatus.size === 0) {
        return '';
    }
    return [...byStatus.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([status, count]) => count > 1 ? `${status} (${count})` : status)
        .join(', ');
}

function approvalStatusLabel(status: unknown): string {
    if (typeof status === 'string') {
        return status;
    }
    if (typeof status !== 'number') {
        return '';
    }
    switch (status) {
        case 1:
            return 'Pending';
        case 2:
            return 'Approved';
        case 4:
            return 'Rejected';
        case 6:
            return 'Reassigned';
        case 7:
            return 'Canceled';
        case 8:
            return 'Skipped';
        default:
            return String(status);
    }
}

function stringifyError(err: unknown): string {
    if (err instanceof Error) {
        return err.message || String(err);
    }
    return String(err);
}
