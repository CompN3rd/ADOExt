import * as vscode from 'vscode';
import type { AdoClient, GitPullRequest, GitPullRequestCommentThread, Comment } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';

// ---------------------------------------------------------------------------
// Tree node types
// ---------------------------------------------------------------------------

export class PullRequestGroup extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly prs: GitPullRequest[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.description = `${prs.length} PR${prs.length !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon('git-pull-request');
        this.contextValue = 'pullRequestGroup';
    }
}

export class PullRequestNode extends vscode.TreeItem {
    constructor(public readonly pr: GitPullRequest) {
        const id = pr.pullRequestId ?? 0;
        const title = pr.title ?? '(no title)';
        super(`#${id} ${title}`, vscode.TreeItemCollapsibleState.Collapsed);

        const repo = pr.repository?.name ?? '';
        const sourceBranch = pr.sourceRefName?.replace('refs/heads/', '') ?? '';
        const targetBranch = pr.targetRefName?.replace('refs/heads/', '') ?? '';
        this.description = `${repo}: ${sourceBranch} → ${targetBranch}`;
        this.tooltip = `PR #${id}: ${title}\n${sourceBranch} → ${targetBranch}`;
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
    constructor(
        public readonly thread: GitPullRequestCommentThread,
        public readonly pr: GitPullRequest
    ) {
        const firstComment = thread.comments?.[0];
        const content = firstComment?.content ?? '(empty comment)';
        const truncated =
            content.length > 80 ? content.slice(0, 77) + '…' : content;
        super(truncated, vscode.TreeItemCollapsibleState.Collapsed);

        const isResolved = thread.status === 2 /* Fixed */ || thread.status === 4; /* ByDesign */
        this.description = isResolved ? 'Resolved' : 'Active';
        this.contextValue = isResolved
            ? 'prCommentThreadResolved'
            : 'prCommentThreadActive';
        this.iconPath = isResolved
            ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'))
            : new vscode.ThemeIcon('comment');
        this.tooltip = content;
    }
}

export class PullRequestCommentNode extends vscode.TreeItem {
    constructor(
        public readonly comment: Comment,
        public readonly thread: GitPullRequestCommentThread,
        public readonly pr: GitPullRequest
    ) {
        const author = comment?.author?.displayName ?? 'Unknown';
        const content = comment?.content ?? '';
        const truncated =
            content.length > 72 ? content.slice(0, 69) + '…' : content;
        super(truncated, vscode.TreeItemCollapsibleState.None);

        this.description = author;
        this.tooltip = `${author}: ${content}`;
        this.contextValue = 'prComment';
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
    }
}

function prIcon(pr: GitPullRequest): vscode.ThemeIcon {
    if (pr.isDraft) {
        return new vscode.ThemeIcon(
            'git-pull-request-draft',
            new vscode.ThemeColor('charts.gray')
        );
    }
    return new vscode.ThemeIcon(
        'git-pull-request',
        new vscode.ThemeColor('charts.blue')
    );
}

// ---------------------------------------------------------------------------
// Tree Data Provider
// ---------------------------------------------------------------------------

type PullRequestTreeNode =
    | PullRequestGroup
    | PullRequestNode
    | PullRequestThreadNode
    | PullRequestCommentNode
    | vscode.TreeItem;

export class PullRequestProvider
    implements vscode.TreeDataProvider<PullRequestTreeNode>
{
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

    async getChildren(
        element?: PullRequestTreeNode
    ): Promise<PullRequestTreeNode[]> {
        if (element instanceof PullRequestGroup) {
            return element.prs.map(pr => new PullRequestNode(pr));
        }

        if (element instanceof PullRequestNode) {
            // Load threads for this PR
            return this._loadThreads(element.pr);
        }

        if (element instanceof PullRequestThreadNode) {
            // Show individual comments within the thread
            return (element.thread.comments ?? []).map(
                c => new PullRequestCommentNode(c, element.thread, element.pr)
            );
        }

        // Root: load pull requests
        if (this._loading) {
            return [];
        }
        this._loading = true;

        try {
            if (!this.client.isConnected) {
                const node = new vscode.TreeItem(
                    'Sign in to Azure DevOps…',
                    vscode.TreeItemCollapsibleState.None
                );
                node.command = {
                    command: 'adoext.signIn',
                    title: 'Sign In'
                };
                node.iconPath = new vscode.ThemeIcon('sign-in');
                return [node];
            }

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

            const prs = await this.client.getPullRequests(
                this.config.project,
                this.config.pullRequestFilter
            );

            if (prs.length === 0) {
                const node = new vscode.TreeItem(
                    'No pull requests found',
                    vscode.TreeItemCollapsibleState.None
                );
                node.iconPath = new vscode.ThemeIcon('info');
                return [node];
            }

            const group = new PullRequestGroup(`Pull Requests (${prs.length})`, prs);
            return [group];
        } catch (err) {
            const node = new vscode.TreeItem(
                `Error: ${err}`,
                vscode.TreeItemCollapsibleState.None
            );
            node.iconPath = new vscode.ThemeIcon('error');
            return [node];
        } finally {
            this._loading = false;
        }
    }

    private async _loadThreads(
        pr: GitPullRequest
    ): Promise<PullRequestTreeNode[]> {
        try {
            const repoId = pr.repository?.id ?? '';
            const prId = pr.pullRequestId ?? 0;
            const project = this.config.project;
            const threads = await this.client.getPullRequestThreads(
                project,
                repoId,
                prId
            );
            // Filter out system threads (no comments or system-only)
            const meaningful = threads.filter(
                t => t.comments && t.comments.length > 0 && !t.isDeleted
            );
            if (meaningful.length === 0) {
                const node = new vscode.TreeItem(
                    'No comments',
                    vscode.TreeItemCollapsibleState.None
                );
                node.iconPath = new vscode.ThemeIcon('comment');
                return [node];
            }
            return meaningful.map(t => new PullRequestThreadNode(t, pr));
        } catch (err) {
            const node = new vscode.TreeItem(
                `Error loading comments: ${err}`,
                vscode.TreeItemCollapsibleState.None
            );
            node.iconPath = new vscode.ThemeIcon('error');
            return [node];
        }
    }
}
