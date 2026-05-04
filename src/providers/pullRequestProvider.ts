import * as vscode from 'vscode';
import type { AdoClient, GitPullRequest, GitPullRequestCommentThread, Comment, GitPullRequestStatus, PolicyEvaluationRecord } from '../api/adoClient';
import { GitStatusState, PolicyEvaluationStatus } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import {
    resolveProjectScopes,
    scopeKey,
    scopeLabel,
    type ProjectScope
} from './projectScopes';
import { mapWithConcurrencyLimit } from '../utils/async';

const MAX_CONCURRENT_SCOPE_REQUESTS = 4;

interface ScopedPullRequest {
    pr: GitPullRequest;
    scope: ProjectScope;
}

export class PullRequestScopeGroup extends vscode.TreeItem {
    constructor(
        public readonly scope: ProjectScope,
        public readonly prs: ScopedPullRequest[]
    ) {
        super(scopeLabel(scope), vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${prs.length} PR${prs.length !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon('project');
        this.contextValue = 'pullRequestScopeGroup';
    }
}

export class PullRequestGroup extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly prs: ScopedPullRequest[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${prs.length} PR${prs.length !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon('git-pull-request');
        this.contextValue = 'pullRequestGroup';
    }
}

export class PullRequestNode extends vscode.TreeItem {
    public readonly organization?: string;
    public readonly project?: string;

    constructor(
        public readonly pr: GitPullRequest,
        public readonly scope?: ProjectScope
    ) {
        const id = pr.pullRequestId ?? 0;
        const title = pr.title ?? '(no title)';
        super(`#${id} ${title}`, vscode.TreeItemCollapsibleState.Collapsed);

        this.organization = scope?.organization;
        this.project = scope?.project;

        const repo = pr.repository?.name ?? '';
        const sourceBranch = pr.sourceRefName?.replace('refs/heads/', '') ?? '';
        const targetBranch = pr.targetRefName?.replace('refs/heads/', '') ?? '';
        this.description = `${repo}: ${sourceBranch} -> ${targetBranch}`;
        this.tooltip = [
            `PR #${id}: ${title}`,
            `${sourceBranch} -> ${targetBranch}`,
            scope ? `Project: ${scopeLabel(scope)}` : undefined
        ].filter(Boolean).join('\n');
        this.contextValue = 'pullRequest';
        this.iconPath = prIcon(pr);
        this.command = {
            command: 'adoext.viewPullRequestDetails',
            title: 'View Pull Request Details',
            arguments: [this]
        };
    }
}

export class PullRequestThreadNode extends vscode.TreeItem {
    public readonly organization?: string;
    public readonly project?: string;

    constructor(
        public readonly thread: GitPullRequestCommentThread,
        public readonly pr: GitPullRequest,
        public readonly scope?: ProjectScope
    ) {
        const firstComment = thread.comments?.[0];
        const content = firstComment?.content ?? '(empty comment)';
        const truncated = content.length > 80 ? content.slice(0, 77) + '...' : content;
        super(truncated, vscode.TreeItemCollapsibleState.Collapsed);

        this.organization = scope?.organization;
        this.project = scope?.project;

        const isResolved = thread.status === 2 /* Fixed */ || thread.status === 4; /* ByDesign */
        this.description = isResolved ? 'Resolved' : 'Active';
        this.contextValue = isResolved ? 'prCommentThreadResolved' : 'prCommentThreadActive';
        this.iconPath = isResolved
            ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'))
            : new vscode.ThemeIcon('comment');
        this.tooltip = content;
    }
}

export class PullRequestCommentNode extends vscode.TreeItem {
    public readonly organization?: string;
    public readonly project?: string;

    constructor(
        public readonly comment: Comment,
        public readonly thread: GitPullRequestCommentThread,
        public readonly pr: GitPullRequest,
        public readonly scope?: ProjectScope
    ) {
        const author = comment?.author?.displayName ?? 'Unknown';
        const content = comment?.content ?? '';
        const truncated = content.length > 72 ? content.slice(0, 69) + '...' : content;
        super(truncated, vscode.TreeItemCollapsibleState.None);

        this.organization = scope?.organization;
        this.project = scope?.project;

        this.description = author;
        this.tooltip = `${author}: ${content}`;
        this.contextValue = 'prComment';
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
    }
}

export class PullRequestChecksNode extends vscode.TreeItem {
    public readonly organization?: string;
    public readonly project?: string;

    constructor(
        statuses: GitPullRequestStatus[],
        policies: PolicyEvaluationRecord[],
        public readonly scope?: ProjectScope
    ) {
        const { icon, label, description } = PullRequestChecksNode.summarize(statuses, policies);
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = description;
        this.iconPath = icon;
        this.contextValue = 'prChecks';
        this.organization = scope?.organization;
        this.project = scope?.project;
        this._statusChildren = PullRequestChecksNode.buildChildren(statuses, policies);
    }

    private readonly _statusChildren: vscode.TreeItem[];

    getChildren(): vscode.TreeItem[] {
        return this._statusChildren;
    }

    private static summarize(
        statuses: GitPullRequestStatus[],
        policies: PolicyEvaluationRecord[]
    ): { icon: vscode.ThemeIcon; label: string; description: string } {
        const totalChecks = statuses.length + policies.length;
        if (totalChecks === 0) {
            return {
                icon: new vscode.ThemeIcon('circle-outline'),
                label: 'Checks',
                description: 'No checks'
            };
        }

        const failed = statuses.filter(s =>
            s.state === GitStatusState.Failed || s.state === GitStatusState.Error
        ).length + policies.filter(p =>
            p.status === PolicyEvaluationStatus.Rejected || p.status === PolicyEvaluationStatus.Broken
        ).length;

        const pending = statuses.filter(s =>
            s.state === GitStatusState.Pending || s.state === GitStatusState.NotSet
        ).length + policies.filter(p =>
            p.status === PolicyEvaluationStatus.Queued || p.status === PolicyEvaluationStatus.Running
        ).length;

        if (failed > 0) {
            return {
                icon: new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')),
                label: 'Checks',
                description: `${failed} failed`
            };
        }
        if (pending > 0) {
            return {
                icon: new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow')),
                label: 'Checks',
                description: `${pending} pending`
            };
        }
        return {
            icon: new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green')),
            label: 'Checks',
            description: `${totalChecks} passed`
        };
    }

    private static buildChildren(
        statuses: GitPullRequestStatus[],
        policies: PolicyEvaluationRecord[]
    ): vscode.TreeItem[] {
        const children: vscode.TreeItem[] = [];

        for (const status of statuses) {
            const name = [status.context?.genre, status.context?.name].filter(Boolean).join('/') || 'Check';
            const node = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
            node.description = status.description ?? statusStateLabel(status.state);
            node.iconPath = statusStateIcon(status.state);
            node.tooltip = status.description ?? name;
            children.push(node);
        }

        for (const policy of policies) {
            const name = policy.configuration?.type?.displayName ?? 'Policy';
            const node = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
            node.description = policyStatusLabel(policy.status);
            node.iconPath = policyStatusIcon(policy.status);
            node.tooltip = name;
            children.push(node);
        }

        return children;
    }
}

function statusStateLabel(state?: GitStatusState): string {
    switch (state) {
        case GitStatusState.Succeeded: return 'Succeeded';
        case GitStatusState.Failed: return 'Failed';
        case GitStatusState.Error: return 'Error';
        case GitStatusState.Pending: return 'Pending';
        case GitStatusState.NotApplicable: return 'Not applicable';
        default: return 'Unknown';
    }
}

function statusStateIcon(state?: GitStatusState): vscode.ThemeIcon {
    switch (state) {
        case GitStatusState.Succeeded:
            return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
        case GitStatusState.Failed:
        case GitStatusState.Error:
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        case GitStatusState.Pending:
            return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow'));
        case GitStatusState.NotApplicable:
            return new vscode.ThemeIcon('circle-slash');
        default:
            return new vscode.ThemeIcon('circle-outline');
    }
}

function policyStatusLabel(status?: PolicyEvaluationStatus): string {
    switch (status) {
        case PolicyEvaluationStatus.Approved: return 'Approved';
        case PolicyEvaluationStatus.Rejected: return 'Rejected';
        case PolicyEvaluationStatus.Running: return 'Running';
        case PolicyEvaluationStatus.Queued: return 'Queued';
        case PolicyEvaluationStatus.Broken: return 'Broken';
        case PolicyEvaluationStatus.NotApplicable: return 'Not applicable';
        default: return 'Unknown';
    }
}

function policyStatusIcon(status?: PolicyEvaluationStatus): vscode.ThemeIcon {
    switch (status) {
        case PolicyEvaluationStatus.Approved:
            return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
        case PolicyEvaluationStatus.Rejected:
        case PolicyEvaluationStatus.Broken:
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        case PolicyEvaluationStatus.Running:
        case PolicyEvaluationStatus.Queued:
            return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow'));
        case PolicyEvaluationStatus.NotApplicable:
            return new vscode.ThemeIcon('circle-slash');
        default:
            return new vscode.ThemeIcon('circle-outline');
    }
}

function prIcon(pr: GitPullRequest): vscode.ThemeIcon {
    if (pr.isDraft) {
        return new vscode.ThemeIcon('git-pull-request-draft', new vscode.ThemeColor('charts.gray'));
    }
    return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.blue'));
}

type PullRequestTreeNode =
    | PullRequestScopeGroup
    | PullRequestGroup
    | PullRequestNode
    | PullRequestChecksNode
    | PullRequestThreadNode
    | PullRequestCommentNode
    | vscode.TreeItem;

export class PullRequestProvider implements vscode.TreeDataProvider<PullRequestTreeNode> {
    private _onDidChangeTreeData =
        new vscode.EventEmitter<PullRequestTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PullRequestTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PullRequestTreeNode): Promise<PullRequestTreeNode[]> {
        if (element instanceof PullRequestScopeGroup) {
            return [new PullRequestGroup(`Pull Requests (${element.prs.length})`, element.prs)];
        }

        if (element instanceof PullRequestGroup) {
            return element.prs.map(item => new PullRequestNode(item.pr, item.scope));
        }

        if (element instanceof PullRequestNode) {
            return this.loadPrChildren(element.pr, element.scope);
        }

        if (element instanceof PullRequestChecksNode) {
            return element.getChildren();
        }

        if (element instanceof PullRequestThreadNode) {
            return (element.thread.comments ?? []).map(
                comment => new PullRequestCommentNode(comment, element.thread, element.pr, element.scope)
            );
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

            const prs = await this.loadPullRequests(scopes);
            if (prs.length === 0) {
                const node = new vscode.TreeItem('No pull requests found', vscode.TreeItemCollapsibleState.None);
                node.iconPath = new vscode.ThemeIcon('info');
                return [node];
            }

            if (scopes.length === 1) {
                return [new PullRequestGroup(`Pull Requests (${prs.length})`, prs)];
            }

            const byScope = new Map<string, ScopedPullRequest[]>();
            const scopeByKey = new Map<string, ProjectScope>();
            for (const item of prs) {
                const key = scopeKey(item.scope);
                scopeByKey.set(key, item.scope);
                if (!byScope.has(key)) {
                    byScope.set(key, []);
                }
                byScope.get(key)!.push(item);
            }

            return [...byScope.entries()]
                .map(([key, scopedPrs]) => new PullRequestScopeGroup(scopeByKey.get(key)!, scopedPrs))
                .sort((left, right) => `${left.label}`.localeCompare(`${right.label}`));
        } catch (err) {
            const node = new vscode.TreeItem(`Error: ${err}`, vscode.TreeItemCollapsibleState.None);
            node.iconPath = new vscode.ThemeIcon('error');
            return [node];
        } finally {
            this._loading = false;
        }
    }

    private async loadPullRequests(scopes: ProjectScope[]): Promise<ScopedPullRequest[]> {
        const query = this.config.activePullRequestQuery;
        const results = await mapWithConcurrencyLimit(scopes, MAX_CONCURRENT_SCOPE_REQUESTS, async scope => {
            const prs = await this.client.getPullRequests(
                scope.project,
                query.filter,
                undefined,
                scope.organization
            );
            return prs.map(pr => ({ pr, scope }));
        });
        return results.flat();
    }

    private async loadPrChildren(
        pr: GitPullRequest,
        scope?: ProjectScope
    ): Promise<PullRequestTreeNode[]> {
        const repoId = pr.repository?.id ?? '';
        const prId = pr.pullRequestId ?? 0;
        const project = scope?.project ?? this.config.project;
        const organization = scope?.organization ?? this.config.organization;

        const [checksNode, threadNodes] = await Promise.all([
            this.loadChecks(pr, project, organization, repoId, prId, scope),
            this.loadThreads(pr, scope)
        ]);

        return [checksNode, ...threadNodes];
    }

    private async loadChecks(
        pr: GitPullRequest,
        project: string,
        organization: string | undefined,
        repoId: string,
        prId: number,
        scope?: ProjectScope
    ): Promise<PullRequestChecksNode> {
        let statuses: GitPullRequestStatus[] = [];
        let policies: PolicyEvaluationRecord[] = [];

        try {
            statuses = await this.client.getPullRequestStatuses(project, repoId, prId, organization);
        } catch {
            // Statuses unavailable – continue with empty array
        }

        const projectId = pr.repository?.project?.id;
        if (projectId) {
            try {
                policies = await this.client.getPullRequestPolicyEvaluations(project, prId, projectId, organization);
            } catch {
                // Policies unavailable – continue with empty array
            }
        }

        return new PullRequestChecksNode(statuses, policies, scope);
    }

    private async loadThreads(
        pr: GitPullRequest,
        scope?: ProjectScope
    ): Promise<PullRequestTreeNode[]> {
        try {
            const repoId = pr.repository?.id ?? '';
            const prId = pr.pullRequestId ?? 0;
            const project = scope?.project ?? this.config.project;
            const organization = scope?.organization ?? this.config.organization;
            const threads = await this.client.getPullRequestThreads(project, repoId, prId, organization);
            const meaningful = (threads ?? []).filter(
                thread => (thread.comments ?? []).some(comment => !!comment.content) && !thread.isDeleted
            );
            if (meaningful.length === 0) {
                const node = new vscode.TreeItem('No comments', vscode.TreeItemCollapsibleState.None);
                node.iconPath = new vscode.ThemeIcon('comment');
                return [node];
            }
            return meaningful.map(thread => new PullRequestThreadNode(thread, pr, scope));
        } catch (err) {
            const node = new vscode.TreeItem(`Error loading comments: ${err}`, vscode.TreeItemCollapsibleState.None);
            node.iconPath = new vscode.ThemeIcon('error');
            return [node];
        }
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
