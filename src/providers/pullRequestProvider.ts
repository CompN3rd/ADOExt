import * as vscode from 'vscode';
import type { AdoClient, GitPullRequest, GitPullRequestCommentThread, Comment, GitPullRequestStatus, PolicyEvaluationRecord } from '../api/adoClient';
import { GitStatusState, PolicyEvaluationStatus, PullRequestAsyncStatus, PullRequestMergeFailureType } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { isToolIdentity, isSystemThread } from '../utils/prCommentIdentity';
import {
    resolveProjectScopes,
    scopeKey,
    scopeLabel,
    type ProjectScope
} from './projectScopes';
import { mapWithConcurrencyLimit } from '../utils/async';
import type { AuthRecoveryHandler } from '../utils/authRecovery';
import { handleProviderError } from './providerErrors';

const MAX_CONCURRENT_SCOPE_REQUESTS = 4;

interface ScopedPullRequest {
    pr: GitPullRequest;
    scope: ProjectScope;
}

export class PullRequestBucketNode extends vscode.TreeItem {
    constructor(
        public readonly bucketId: string,
        label: string,
        public readonly filter: 'mine' | 'created' | 'assigned' | 'all'
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'pullRequestBucket';
        this.iconPath = bucketIcon(filter);
    }
}

function bucketIcon(filter: 'mine' | 'created' | 'assigned' | 'all'): vscode.ThemeIcon {
    switch (filter) {
        case 'assigned': return new vscode.ThemeIcon('eye');
        case 'created': return new vscode.ThemeIcon('person');
        case 'mine': return new vscode.ThemeIcon('account'); // used by custom saved views
        case 'all': return new vscode.ThemeIcon('list-filter');
    }
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
        const isToolThread = isToolIdentity(firstComment?.author);
        this.description = `${isResolved ? 'Resolved' : 'Active'}${isToolThread ? ' • Tool' : ''}`;
        this.contextValue = isResolved ? 'prCommentThreadResolved' : 'prCommentThreadActive';
        if (isToolThread) {
            this.iconPath = new vscode.ThemeIcon('hubot', new vscode.ThemeColor('descriptionForeground'));
        } else {
            this.iconPath = isResolved
                ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'))
                : new vscode.ThemeIcon('comment');
        }
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

        const isToolComment = isToolIdentity(comment.author);
        this.description = isToolComment ? `${author} (Tool)` : author;
        this.tooltip = `${author}: ${content}`;
        this.contextValue = 'prComment';
        this.iconPath = isToolComment
            ? new vscode.ThemeIcon('hubot', new vscode.ThemeColor('descriptionForeground'))
            : new vscode.ThemeIcon('comment-discussion');
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

        const { failed, pending, passed, neutral } = summarizeChecks(statuses, policies);

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
        if (passed === 0) {
            return {
                icon: new vscode.ThemeIcon('circle-outline'),
                label: 'Checks',
                description: `${neutral} neutral`
            };
        }
        return {
            icon: new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green')),
            label: 'Checks',
            description: neutral > 0 ? `${passed} passed, ${neutral} neutral` : `${passed} passed`
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

export class PullRequestBranchStatusNode extends vscode.TreeItem {
    public readonly organization?: string;
    public readonly project?: string;

    constructor(
        pr: GitPullRequest,
        public readonly scope?: ProjectScope
    ) {
        const summary = summarizeBranchStatus(pr);
        super('Branch Status', vscode.TreeItemCollapsibleState.Collapsed);
        this.description = summary.description;
        this.iconPath = summary.icon;
        this.tooltip = summary.tooltip;
        this.contextValue = 'prBranchStatus';
        this.organization = scope?.organization;
        this.project = scope?.project;
        this._children = buildBranchStatusChildren(pr);
    }

    private readonly _children: vscode.TreeItem[];

    getChildren(): vscode.TreeItem[] {
        return this._children;
    }
}

function statusStateLabel(state?: GitStatusState): string {
    switch (state) {
        case GitStatusState.Succeeded: return 'Succeeded';
        case GitStatusState.Failed: return 'Failed';
        case GitStatusState.Error: return 'Error';
        case GitStatusState.Pending: return 'Pending';
        case GitStatusState.NotSet: return 'Pending';
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
        case GitStatusState.NotSet:
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

function summarizeBranchStatus(pr: GitPullRequest): { icon: vscode.ThemeIcon; description: string; tooltip: string } {
    if (pr.mergeStatus === PullRequestAsyncStatus.Conflicts) {
        return {
            icon: new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red')),
            description: 'Conflicts',
            tooltip: branchStatusTooltip(pr, 'This pull request has merge conflicts.')
        };
    }

    if (pr.mergeStatus === PullRequestAsyncStatus.Failure) {
        return {
            icon: new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')),
            description: 'Merge failed',
            tooltip: branchStatusTooltip(pr, 'Azure DevOps could not compute a clean merge for this pull request.')
        };
    }

    if (pr.mergeStatus === PullRequestAsyncStatus.RejectedByPolicy) {
        return {
            icon: new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow')),
            description: 'Blocked by policy',
            tooltip: branchStatusTooltip(pr, 'This pull request cannot complete until policy requirements pass.')
        };
    }

    if (pr.mergeStatus === PullRequestAsyncStatus.Queued) {
        return {
            icon: new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow')),
            description: 'Queued',
            tooltip: branchStatusTooltip(pr, 'Azure DevOps is computing merge status for this pull request.')
        };
    }

    if (pr.hasMultipleMergeBases) {
        return {
            icon: new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow')),
            description: 'Multiple merge bases',
            tooltip: branchStatusTooltip(pr, 'Multiple merge bases were detected for this pull request.')
        };
    }

    if (pr.mergeStatus === PullRequestAsyncStatus.Succeeded) {
        return {
            icon: new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green')),
            description: 'Up to date',
            tooltip: branchStatusTooltip(pr, 'This pull request can be merged cleanly.')
        };
    }

    return {
        icon: new vscode.ThemeIcon('circle-outline'),
        description: 'Not computed',
        tooltip: branchStatusTooltip(pr, 'Azure DevOps has not computed merge status yet.')
    };
}

function buildBranchStatusChildren(pr: GitPullRequest): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];
    const mergeState = createLeafItem('Merge state', branchStatusLabel(pr));
    mergeState.iconPath = summarizeBranchStatus(pr).icon;
    items.push(mergeState);

    if (pr.hasMultipleMergeBases) {
        const mergeBases = createLeafItem('Merge bases', 'Multiple detected');
        mergeBases.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
        items.push(mergeBases);
    }

    if (hasMergeFailure(pr)) {
        const failureReason = pr.mergeFailureMessage ?? mergeFailureTypeLabel(pr.mergeFailureType) ?? 'Unknown';
        const failure = createLeafItem('Failure reason', failureReason || 'Unknown');
        failure.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        items.push(failure);
    }

    if (pr.completionQueueTime) {
        const queuedAt = createLeafItem('Last merge queue time', new Date(pr.completionQueueTime).toLocaleString());
        queuedAt.iconPath = new vscode.ThemeIcon('history');
        items.push(queuedAt);
    }

    return items;
}

function summarizeChecks(
    statuses: GitPullRequestStatus[],
    policies: PolicyEvaluationRecord[]
): { failed: number; pending: number; passed: number; neutral: number } {
    let failed = 0;
    let pending = 0;
    let passed = 0;
    let neutral = 0;

    for (const status of statuses) {
        switch (status.state) {
            case GitStatusState.Failed:
            case GitStatusState.Error:
                failed++;
                break;
            case GitStatusState.Pending:
            case GitStatusState.NotSet:
                pending++;
                break;
            case GitStatusState.Succeeded:
                passed++;
                break;
            default:
                neutral++;
                break;
        }
    }

    for (const policy of policies) {
        switch (policy.status) {
            case PolicyEvaluationStatus.Rejected:
            case PolicyEvaluationStatus.Broken:
                failed++;
                break;
            case PolicyEvaluationStatus.Queued:
            case PolicyEvaluationStatus.Running:
                pending++;
                break;
            case PolicyEvaluationStatus.Approved:
                passed++;
                break;
            default:
                neutral++;
                break;
        }
    }

    return { failed, pending, passed, neutral };
}

function createLeafItem(label: string, description: string): vscode.TreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = description;
    item.tooltip = `${label}: ${description}`;
    return item;
}

function hasMergeFailure(pr: GitPullRequest): boolean {
    return (
        (pr.mergeFailureType !== undefined && pr.mergeFailureType !== PullRequestMergeFailureType.None) ||
        !!pr.mergeFailureMessage
    );
}

function branchStatusLabel(pr: GitPullRequest): string {
    switch (pr.mergeStatus) {
        case PullRequestAsyncStatus.NotSet: return 'Not computed';
        case PullRequestAsyncStatus.Queued: return 'Queued';
        case PullRequestAsyncStatus.Conflicts: return 'Conflicts';
        case PullRequestAsyncStatus.Succeeded: return pr.hasMultipleMergeBases ? 'Succeeded with multiple merge bases' : 'Succeeded';
        case PullRequestAsyncStatus.RejectedByPolicy: return 'Rejected by policy';
        case PullRequestAsyncStatus.Failure: return 'Failed';
        default: return 'Unknown';
    }
}

function mergeFailureTypeLabel(type?: PullRequestMergeFailureType): string {
    switch (type) {
        case PullRequestMergeFailureType.None: return '';
        case PullRequestMergeFailureType.Unknown: return 'Unknown merge failure';
        case PullRequestMergeFailureType.CaseSensitive: return 'Case-sensitive file conflict';
        case PullRequestMergeFailureType.ObjectTooLarge: return 'Merge object too large';
        default: return '';
    }
}

function branchStatusTooltip(pr: GitPullRequest, detail: string): string {
    const parts = ['Branch Status', detail];
    if (pr.mergeFailureMessage && pr.mergeFailureMessage !== detail) {
        parts.push(pr.mergeFailureMessage);
    }
    return parts.filter(Boolean).join('\n');
}

function prIcon(pr: GitPullRequest): vscode.ThemeIcon {
    if (pr.isDraft) {
        return new vscode.ThemeIcon('git-pull-request-draft', new vscode.ThemeColor('charts.gray'));
    }
    return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.blue'));
}

type PullRequestTreeNode =
    | PullRequestBucketNode
    | PullRequestScopeGroup
    | PullRequestGroup
    | PullRequestNode
    | PullRequestBranchStatusNode
    | PullRequestChecksNode
    | PullRequestThreadNode
    | PullRequestCommentNode
    | vscode.TreeItem;

const BUILT_IN_BUCKETS: Array<{ id: string; label: string; filter: 'mine' | 'created' | 'assigned' | 'all' }> = [
    { id: 'waiting-for-review', label: 'Waiting for My Review', filter: 'assigned' },
    { id: 'created-by-me', label: 'Created by Me', filter: 'created' },
    { id: 'all-open', label: 'All Open', filter: 'all' }
];

export class PullRequestProvider implements vscode.TreeDataProvider<PullRequestTreeNode> {
    private _onDidChangeTreeData =
        new vscode.EventEmitter<PullRequestTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _buckets: PullRequestBucketNode[] = [];
    private _prCache = new Map<string, ScopedPullRequest[]>();
    private _bucketScopeGrouping = new Map<string, boolean>();
    private _loadingPromises = new Map<string, Promise<PullRequestTreeNode[]>>();

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager,
        private readonly onAuthError?: AuthRecoveryHandler
    ) {}

    refresh(): void {
        this._prCache.clear();
        this._bucketScopeGrouping.clear();
        this._loadingPromises.clear();
        this._buckets = [];
        this._onDidChangeTreeData.fire();
    }

    refreshBucket(bucket: PullRequestBucketNode): void {
        this._prCache.delete(bucket.bucketId);
        this._bucketScopeGrouping.delete(bucket.bucketId);
        this._loadingPromises.delete(bucket.bucketId);
        this._onDidChangeTreeData.fire(bucket);
    }

    getTreeItem(element: PullRequestTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PullRequestTreeNode): Promise<PullRequestTreeNode[]> {
        if (element instanceof PullRequestBucketNode) {
            return this.loadBucketChildren(element);
        }

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

        if (element instanceof PullRequestBranchStatusNode) {
            return element.getChildren();
        }

        if (element instanceof PullRequestThreadNode) {
            return (element.thread.comments ?? []).map(
                comment => new PullRequestCommentNode(comment, element.thread, element.pr, element.scope)
            );
        }

        // Root: return setup node or buckets
        const setupNode = this.getSetupNode();
        if (setupNode) {
            return [setupNode];
        }

        return this.getBuckets();
    }

    private getBuckets(): PullRequestBucketNode[] {
        if (this._buckets.length === 0) {
            this._buckets = this.buildBuckets();
        }
        return this._buckets;
    }

    private buildBuckets(): PullRequestBucketNode[] {
        const builtIn = BUILT_IN_BUCKETS.map(
            b => new PullRequestBucketNode(b.id, b.label, b.filter)
        );
        const custom = this.config.savedPullRequestQueries.map(
            q => new PullRequestBucketNode(q.id, q.label, q.filter)
        );
        return [...builtIn, ...custom];
    }

    private loadBucketChildren(bucket: PullRequestBucketNode): Promise<PullRequestTreeNode[]> {
        const cached = this._prCache.get(bucket.bucketId);
        if (cached) {
            return Promise.resolve(
                this.buildBucketNodes(cached, this._bucketScopeGrouping.get(bucket.bucketId) ?? false)
            );
        }

        const inFlight = this._loadingPromises.get(bucket.bucketId);
        if (inFlight) {
            return inFlight;
        }

        const promise = this.doLoadBucketChildren(bucket).finally(() => {
            this._loadingPromises.delete(bucket.bucketId);
        });
        this._loadingPromises.set(bucket.bucketId, promise);
        return promise;
    }

    private async doLoadBucketChildren(bucket: PullRequestBucketNode): Promise<PullRequestTreeNode[]> {
        try {
            const scopes = await resolveProjectScopes(this.client, this.config);
            if (scopes.length === 0) {
                return [this.createConfigureNode()];
            }

            const prs = await this.loadPullRequests(scopes, bucket.filter);
            this._prCache.set(bucket.bucketId, prs);
            const forceScopeGrouping = scopes.length > 1;
            this._bucketScopeGrouping.set(bucket.bucketId, forceScopeGrouping);
            return this.buildBucketNodes(prs, forceScopeGrouping);
        } catch (err) {
            return handleProviderError(err, `pullRequests:${bucket.bucketId}`, this.onAuthError);
        }
    }

    private buildBucketNodes(prs: ScopedPullRequest[], forceScopeGrouping: boolean): PullRequestTreeNode[] {
        // Apply filtering and sorting
        const filtered = this.filterPullRequests(prs);
        const sorted = this.sortPullRequests(filtered);

        if (sorted.length === 0) {
            const node = new vscode.TreeItem('No pull requests found', vscode.TreeItemCollapsibleState.None);
            node.iconPath = new vscode.ThemeIcon('info');
            return [node];
        }

        if (!forceScopeGrouping) {
            return [new PullRequestGroup(`Pull Requests (${sorted.length})`, sorted)];
        }

        const byScope = new Map<string, ScopedPullRequest[]>();
        const scopeByKey = new Map<string, ProjectScope>();
        for (const item of sorted) {
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
    }

    private filterPullRequests(prs: ScopedPullRequest[]): ScopedPullRequest[] {
        const pattern = this.config.pullRequestFilterRegex;
        if (!pattern.trim()) {
            return prs;
        }

        try {
            const regex = new RegExp(pattern, 'i');
            return prs.filter(item => {
                const id = item.pr.pullRequestId ?? 0;
                const title = item.pr.title ?? '';
                const searchText = `#${id} ${title}`;
                return regex.test(searchText);
            });
        } catch {
            // Invalid regex; return all items
            return prs;
        }
    }

    private sortPullRequests(prs: ScopedPullRequest[]): ScopedPullRequest[] {
        const order = this.config.pullRequestSortOrder;
        if (order === 'date') {
            return [...prs].sort((a, b) => {
                const dateA = a.pr.creationDate?.getTime() ?? 0;
                const dateB = b.pr.creationDate?.getTime() ?? 0;
                return dateB - dateA; // Newest first
            });
        }

        // Default: sort by title
        return [...prs].sort((a, b) => {
            const titleA = (a.pr.title ?? '').toLowerCase();
            const titleB = (b.pr.title ?? '').toLowerCase();
            return titleA.localeCompare(titleB);
        });
    }

    private async loadPullRequests(
        scopes: ProjectScope[],
        filter: 'mine' | 'created' | 'assigned' | 'all'
    ): Promise<ScopedPullRequest[]> {
        const results = await mapWithConcurrencyLimit(scopes, MAX_CONCURRENT_SCOPE_REQUESTS, async scope => {
            const prs = await this.client.getPullRequests(
                scope.project,
                filter,
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

        const [latestPr, checksNode, threadNodes] = await Promise.all([
            this.client.getPullRequest(project, repoId, prId, organization).catch(() => undefined),
            this.loadChecks(pr, project, organization, repoId, prId, scope),
            this.loadThreads(pr, scope)
        ]);

        return [new PullRequestBranchStatusNode(latestPr ?? pr, scope), checksNode, ...threadNodes];
    }

    private async loadChecks(
        pr: GitPullRequest,
        project: string,
        organization: string | undefined,
        repoId: string,
        prId: number,
        scope?: ProjectScope
    ): Promise<PullRequestChecksNode> {
        const projectId = pr.repository?.project?.id;

        const [statusesResult, policiesResult] = await Promise.allSettled([
            this.client.getPullRequestStatuses(project, repoId, prId, organization),
            projectId
                ? this.client.getPullRequestPolicyEvaluations(project, prId, projectId, organization)
                : Promise.resolve([] as PolicyEvaluationRecord[])
        ]);

        const statuses = statusesResult.status === 'fulfilled' ? statusesResult.value : [];
        const policies = policiesResult.status === 'fulfilled' ? policiesResult.value : [];

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
            const withoutSystem = this.config.hideSystemPullRequestThreads
                ? meaningful.filter(thread => !isSystemThread(thread))
                : meaningful;
            const visible = this.config.showResolvedPullRequestThreads
                ? withoutSystem
                : withoutSystem.filter(thread => thread.status !== 2 && thread.status !== 4);
            if (visible.length === 0) {
                const label = this.config.showResolvedPullRequestThreads
                    ? 'No comments'
                    : 'No active comments';
                const node = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
                node.iconPath = new vscode.ThemeIcon('comment');
                return [node];
            }
            return visible.map(thread => new PullRequestThreadNode(thread, pr, scope));
        } catch (err) {
            return handleProviderError(err, 'pullRequestComments', this.onAuthError, 'Error loading comments');
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
