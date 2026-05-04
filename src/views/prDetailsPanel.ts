import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { GitPullRequest, GitPullRequestCommentThread, Comment, PullRequestReviewVote, GitPullRequestStatus, PolicyEvaluationRecord } from '../api/adoClient';
import { PullRequestReviewVotes, GitStatusState, PolicyEvaluationStatus, PullRequestAsyncStatus, PullRequestMergeFailureType } from '../api/adoClient';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';
// Note: the diff is now opened via VS Code's native diff editor, dispatched
// through the `adoext.viewPullRequestDiff` command so that the inline
// comment controller is wired up consistently.

interface PrPanelScope {
    organization?: string;
    project?: string;
}

/**
 * Renders a pull request's details (title, description, reviewers, comment
 * threads) in a VS Code webview panel.  The user can reply to threads and
 * resolve/reopen them without leaving VS Code.
 */
export class PrDetailsPanel {
    private static _panels = new Map<string, PrDetailsPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _panelKey: string;
    private readonly _organization?: string;
    private readonly _project?: string;
    private _disposables: vscode.Disposable[] = [];

    static async show(
        context: vscode.ExtensionContext,
        client: AdoClient,
        config: ConfigManager,
        pr: GitPullRequest,
        scope: PrPanelScope = {}
    ): Promise<void> {
        const prId = pr.pullRequestId!;
        const key = PrDetailsPanel.panelKey(
            prId,
            scope.organization ?? client.organization ?? config.organization,
            scope.project ?? config.project
        );
        const existing = PrDetailsPanel._panels.get(key);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            await existing._refresh(client, config, pr);
            return;
        }
        new PrDetailsPanel(context, client, config, pr, key, scope);
    }

    private constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private _pr: GitPullRequest,
        panelKey: string,
        scope: PrPanelScope
    ) {
        this._panelKey = panelKey;
        this._organization = scope.organization;
        this._project = scope.project;
        const prId = _pr.pullRequestId!;
        this._panel = vscode.window.createWebviewPanel(
            'adoext.prDetails',
            `PR #${prId}: ${_pr.title ?? ''}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (msg) => this._handleMessage(msg),
            null,
            this._disposables
        );

        PrDetailsPanel._panels.set(panelKey, this);
        void this._refresh(_client, _config, _pr);
    }

    private async _refresh(
        client: AdoClient,
        config: ConfigManager,
        pr: GitPullRequest
    ): Promise<void> {
        this._pr = pr;
        const repoId = pr.repository?.id ?? '';
        const prId = pr.pullRequestId!;
        const project = this._project ?? config.project;
        const organization = this._organization ?? client.organization ?? config.organization;
        const projectId = pr.repository?.project?.id;

        const [threadsResult, statusesResult, policiesResult] = await Promise.allSettled([
            client.getPullRequestThreads(project, repoId, prId, organization),
            client.getPullRequestStatuses(project, repoId, prId, organization),
            projectId
                ? client.getPullRequestPolicyEvaluations(project, prId, projectId, organization)
                : Promise.resolve([] as PolicyEvaluationRecord[])
        ]);

        const threads = threadsResult.status === 'fulfilled' ? threadsResult.value : [];
        const statuses = statusesResult.status === 'fulfilled' ? statusesResult.value : [];
        const policies = policiesResult.status === 'fulfilled' ? policiesResult.value : [];

        this._panel.webview.html = this._buildHtml(pr, threads, statuses, policies);
    }

    private async _handleMessage(msg: {
        type: string;
        threadId?: number;
        content?: string;
        status?: number;
        vote?: number;
    }): Promise<void> {
        const repoId = this._pr.repository?.id ?? '';
        const prId = this._pr.pullRequestId!;
        const project = this._project ?? this._config.project;
        const organization = this._organization ?? this._client.organization ?? this._config.organization;

        try {
            if (msg.type === 'reply' && msg.threadId !== undefined && msg.content) {
                await this._client.replyToThread(
                    project,
                    repoId,
                    prId,
                    msg.threadId,
                    msg.content,
                    organization
                );
                showInformationMessage('Reply posted.');
                await this._refresh(this._client, this._config, this._pr);
            } else if (msg.type === 'setStatus' && msg.threadId !== undefined && msg.status !== undefined) {
                await this._client.updateThreadStatus(
                    project,
                    repoId,
                    prId,
                    msg.threadId,
                    msg.status,
                    organization
                );
                const label = msg.status === 2 ? 'resolved' : 'reopened';
                showInformationMessage(`Thread ${label}.`);
                await this._refresh(this._client, this._config, this._pr);
            } else if (msg.type === 'addComment' && msg.content) {
                await this._client.addPullRequestComment(
                    project,
                    repoId,
                    prId,
                    msg.content,
                    organization
                );
                showInformationMessage('Comment added.');
                await this._refresh(this._client, this._config, this._pr);
            } else if (msg.type === 'openInBrowser') {
                const org = organization;
                const projectName = project;
                const repoName = this._pr.repository?.name;

                if (!org || !projectName || !repoName) {
                    showWarningMessage(
                        'Unable to open pull request in browser because organization, project, or repository name is missing.'
                    );
                    return;
                }

                const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(repoName)}/pullrequest/${prId}`;
                void vscode.env.openExternal(vscode.Uri.parse(url));
            } else if (msg.type === 'openDiff') {
                await vscode.commands.executeCommand('adoext.viewPullRequestDiff', {
                    pr: this._pr,
                    organization,
                    project
                });
            } else if (msg.type === 'setVote' && this._isReviewVote(msg.vote)) {
                if (!organization || !project || !repoId) {
                    showWarningMessage(
                        'Unable to set review vote because organization, project, or repository is missing.'
                    );
                    return;
                }

                await this._client.setPullRequestReviewVote(
                    project,
                    repoId,
                    prId,
                    msg.vote,
                    organization
                );
                showInformationMessage(`Review vote set to ${this._reviewVoteLabel(msg.vote)}.`);

                try {
                    const refreshedPr = await this._client.getPullRequest(project, repoId, prId, organization);
                    if (refreshedPr) {
                        this._pr = refreshedPr;
                    }
                } catch {
                    // The vote has already been saved; keep the existing PR model if reloading it fails.
                }

                await this._refresh(this._client, this._config, this._pr);
                void vscode.commands.executeCommand('adoext.refreshPullRequests');
            }
        } catch (err) {
            showErrorMessage(`Error: ${err}`);
        }
    }

    private _buildHtml(
        pr: GitPullRequest,
        threads: GitPullRequestCommentThread[],
        statuses: GitPullRequestStatus[] = [],
        policies: PolicyEvaluationRecord[] = []
    ): string {
        const webview = this._panel.webview;
        const nonce = this._createNonce();
        const prId = pr.pullRequestId ?? 0;
        const title = this._esc(pr.title ?? '');
        const description = this._esc(pr.description ?? '*(no description)*');
        const sourceBranch = (pr.sourceRefName ?? '').replace('refs/heads/', '');
        const targetBranch = (pr.targetRefName ?? '').replace('refs/heads/', '');
        const author = this._esc(pr.createdBy?.displayName ?? 'Unknown');
        const isDraft = pr.isDraft ? ' <span class="badge draft">Draft</span>' : '';
        const createdDate = pr.creationDate
            ? new Date(pr.creationDate).toLocaleDateString()
            : '';

        const reviewersHtml = (pr.reviewers ?? [])
            .map(r => {
                const vote = r.vote ?? 0;
                const voteLabel = this._reviewVoteLabel(vote);
                const voteClass = this._reviewVoteClass(vote);
                return `<li><span class="vote ${voteClass}">${this._esc(voteLabel)}</span>${this._esc(r.displayName ?? '')}</li>`;
            })
            .join('');

        const meaningfulThreads = (threads ?? []).filter(
            t => (t.comments ?? []).some(comment => !!comment.content) && !t.isDeleted
        );

        const threadsHtml = meaningfulThreads.length === 0
            ? '<p class="empty">No comment threads.</p>'
            : meaningfulThreads.map(t => this._buildThreadHtml(t)).join('');

        const branchStatusHtml = this._buildBranchStatusHtml(pr);
        const checksHtml = this._buildChecksHtml(statuses, policies);

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>PR #${prId}</title>
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; margin: 0; }
  h1 { font-size: 1.3em; margin-bottom: 4px; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 12px; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; margin-left: 6px; }
  .draft { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .section { margin-bottom: 20px; }
  .section h2 { font-size: 1em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; margin-bottom: 8px; }
  .reviewers { list-style: none; padding: 0; margin: 0; }
    .reviewers li { margin: 4px 0; display: flex; gap: 8px; align-items: center; }
    .vote { min-width: 112px; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; text-align: center; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
    .vote-positive { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
    .vote-waiting { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
    .vote-negative { color: var(--vscode-charts-red); border-color: var(--vscode-charts-red); }
  .checks-list { list-style: none; padding: 0; margin: 0; }
  .checks-list li { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .checks-list li:last-child { border-bottom: none; }
  .check-state { font-size: 0.8em; min-width: 80px; padding: 2px 6px; border-radius: 3px; text-align: center; border: 1px solid; }
  .check-success { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
  .check-failure { color: var(--vscode-charts-red); border-color: var(--vscode-charts-red); }
  .check-pending { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
  .check-neutral { color: var(--vscode-descriptionForeground); border-color: var(--vscode-panel-border); }
  .check-name { flex: 1; }
  .check-desc { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .thread { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 10px; }
  .thread-header { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--vscode-sideBarSectionHeader-background); border-radius: 4px 4px 0 0; }
  .thread-status { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
  .resolved .thread-header { opacity: 0.7; }
  .comment { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  .comment:last-child { border-bottom: none; }
  .comment-author { font-weight: bold; font-size: 0.85em; margin-bottom: 2px; }
  .comment-content { white-space: pre-wrap; word-break: break-word; }
  .reply-form { padding: 8px 10px; display: flex; gap: 6px; }
  .reply-input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 4px 6px; font-family: inherit; font-size: inherit; resize: vertical; min-height: 32px; }
  .btn { padding: 4px 10px; border-radius: 3px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; font-size: 0.85em; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .new-comment-form { display: flex; flex-direction: column; gap: 6px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
    .review-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
</style>
</head>
<body>
<div class="toolbar">
    <button class="btn btn-primary" data-action="open-diff">View Diff</button>
        <div class="review-actions" role="group" aria-label="Review actions">
                <button class="btn btn-secondary" data-action="set-vote" data-vote="${PullRequestReviewVotes.approved}">Approve</button>
                <button class="btn btn-secondary" data-action="set-vote" data-vote="${PullRequestReviewVotes.approvedWithSuggestions}">Approve with Suggestions</button>
                <button class="btn btn-secondary" data-action="set-vote" data-vote="${PullRequestReviewVotes.waitingForAuthor}">Wait for Author</button>
                <button class="btn btn-secondary" data-action="set-vote" data-vote="${PullRequestReviewVotes.rejected}">Reject</button>
                <button class="btn btn-secondary" data-action="set-vote" data-vote="${PullRequestReviewVotes.noVote}">Reset Vote</button>
        </div>
    <button class="btn btn-secondary" data-action="open-browser">Open in Browser</button>
</div>
<h1>PR #${prId}: ${title}${isDraft}</h1>
<div class="meta">
  <strong>${author}</strong> opened on ${createdDate} &nbsp;·&nbsp;
  <code>${this._esc(sourceBranch)}</code> → <code>${this._esc(targetBranch)}</code>
</div>

<div class="section">
  <h2>Description</h2>
  <pre class="comment-content">${description}</pre>
</div>

${reviewersHtml ? `<div class="section"><h2>Reviewers</h2><ul class="reviewers">${reviewersHtml}</ul></div>` : ''}

${branchStatusHtml}

${checksHtml}

<div class="section">
  <h2>Comment Threads</h2>
  ${threadsHtml}
</div>

<div class="section">
  <h2>Add Comment</h2>
  <div class="new-comment-form">
    <textarea id="newCommentInput" class="reply-input" rows="3" placeholder="Write a comment…"></textarea>
        <div><button class="btn btn-primary" data-action="add-comment">Add Comment</button></div>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

document.querySelector('[data-action="open-browser"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openInBrowser' });
});

document.querySelector('[data-action="open-diff"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openDiff' });
});

document.querySelectorAll('[data-action="set-vote"]').forEach(button => {
    button.addEventListener('click', () => {
        const vote = Number(button.getAttribute('data-vote'));
        vscode.postMessage({ type: 'setVote', vote });
    });
});

document.querySelector('[data-action="add-comment"]')?.addEventListener('click', () => {
    const input = document.getElementById('newCommentInput');
    const content = input.value.trim();
    if (!content) {
        return;
    }

    vscode.postMessage({ type: 'addComment', content });
    input.value = '';
});

document.querySelectorAll('[data-action="reply"]').forEach(button => {
    button.addEventListener('click', () => {
        const threadId = Number(button.getAttribute('data-thread-id'));
        const input = document.getElementById('reply_' + threadId);
        const content = input.value.trim();
        if (!content) {
            return;
        }

        vscode.postMessage({ type: 'reply', threadId, content });
        input.value = '';
    });
});

document.querySelectorAll('[data-action="set-status"]').forEach(button => {
    button.addEventListener('click', () => {
        const threadId = Number(button.getAttribute('data-thread-id'));
        const status = Number(button.getAttribute('data-status'));
        vscode.postMessage({ type: 'setStatus', threadId, status });
    });
});
</script>
</body>
</html>`;
    }

    private _buildChecksHtml(
        statuses: GitPullRequestStatus[],
        policies: PolicyEvaluationRecord[]
    ): string {
        const totalChecks = statuses.length + policies.length;
        if (totalChecks === 0) {
            return '';
        }

        const items: string[] = [];

        for (const status of statuses) {
            const name = this._esc(
                [status.context?.genre, status.context?.name].filter(Boolean).join('/') || 'Check'
            );
            const desc = this._esc(status.description ?? '');
            const { cls, label } = this._statusStateBadge(status.state);
            items.push(
                `<li><span class="check-state ${cls}">${label}</span><span class="check-name">${name}</span>${desc ? `<span class="check-desc">${desc}</span>` : ''}</li>`
            );
        }

        for (const policy of policies) {
            const name = this._esc(policy.configuration?.type?.displayName ?? 'Policy');
            const { cls, label } = this._policyStatusBadge(policy.status);
            items.push(
                `<li><span class="check-state ${cls}">${label}</span><span class="check-name">${name}</span></li>`
            );
        }

        return `<div class="section"><h2>Build &amp; Policy Status</h2><ul class="checks-list">${items.join('')}</ul></div>`;
    }

    private _buildBranchStatusHtml(pr: GitPullRequest): string {
        const rows: string[] = [];
        rows.push(this._buildStatusRow('Merge state', this._branchStatusBadge(pr.mergeStatus)));

        if (pr.hasMultipleMergeBases) {
            rows.push(this._buildStatusRow('Merge bases', { cls: 'check-pending', label: 'Multiple detected' }));
        }

        if ((pr.mergeFailureType !== undefined && pr.mergeFailureType !== PullRequestMergeFailureType.None) || pr.mergeFailureMessage) {
            rows.push(this._buildStatusRow(
                'Failure reason',
                { cls: 'check-failure', label: this._mergeFailureLabel(pr.mergeFailureType, pr.mergeFailureMessage) }
            ));
        }

        if (pr.completionQueueTime) {
            rows.push(this._buildStatusRow(
                'Last merge queue time',
                { cls: 'check-neutral', label: new Date(pr.completionQueueTime).toLocaleString() }
            ));
        }

        return `<div class="section"><h2>Branch Status</h2><ul class="checks-list">${rows.join('')}</ul></div>`;
    }

    private _buildStatusRow(name: string, badge: { cls: string; label: string }): string {
        return `<li><span class="check-state ${badge.cls}">${this._esc(badge.label)}</span><span class="check-name">${this._esc(name)}</span></li>`;
    }

    private _statusStateBadge(state?: GitStatusState): { cls: string; label: string } {
        switch (state) {
            case GitStatusState.Succeeded:
                return { cls: 'check-success', label: 'Succeeded' };
            case GitStatusState.Failed:
                return { cls: 'check-failure', label: 'Failed' };
            case GitStatusState.Error:
                return { cls: 'check-failure', label: 'Error' };
            case GitStatusState.Pending:
                return { cls: 'check-pending', label: 'Pending' };
            case GitStatusState.NotApplicable:
                return { cls: 'check-neutral', label: 'N/A' };
            default:
                return { cls: 'check-neutral', label: 'Unknown' };
        }
    }

    private _policyStatusBadge(status?: PolicyEvaluationStatus): { cls: string; label: string } {
        switch (status) {
            case PolicyEvaluationStatus.Approved:
                return { cls: 'check-success', label: 'Approved' };
            case PolicyEvaluationStatus.Rejected:
                return { cls: 'check-failure', label: 'Rejected' };
            case PolicyEvaluationStatus.Broken:
                return { cls: 'check-failure', label: 'Broken' };
            case PolicyEvaluationStatus.Running:
                return { cls: 'check-pending', label: 'Running' };
            case PolicyEvaluationStatus.Queued:
                return { cls: 'check-pending', label: 'Queued' };
            case PolicyEvaluationStatus.NotApplicable:
                return { cls: 'check-neutral', label: 'N/A' };
            default:
                return { cls: 'check-neutral', label: 'Unknown' };
        }
    }

    private _branchStatusBadge(status?: PullRequestAsyncStatus): { cls: string; label: string } {
        switch (status) {
            case PullRequestAsyncStatus.Succeeded:
                return { cls: 'check-success', label: 'Up to date' };
            case PullRequestAsyncStatus.Conflicts:
                return { cls: 'check-failure', label: 'Conflicts' };
            case PullRequestAsyncStatus.Failure:
                return { cls: 'check-failure', label: 'Merge failed' };
            case PullRequestAsyncStatus.RejectedByPolicy:
                return { cls: 'check-failure', label: 'Rejected by policy' };
            case PullRequestAsyncStatus.Queued:
                return { cls: 'check-pending', label: 'Queued' };
            case PullRequestAsyncStatus.NotSet:
                return { cls: 'check-neutral', label: 'Not computed' };
            default:
                return { cls: 'check-neutral', label: 'Unknown' };
        }
    }

    private _mergeFailureLabel(type?: PullRequestMergeFailureType, message?: string): string {
        if (message) {
            return message;
        }

        switch (type) {
            case PullRequestMergeFailureType.None:
                return 'None';
            case PullRequestMergeFailureType.Unknown:
                return 'Unknown merge failure';
            case PullRequestMergeFailureType.CaseSensitive:
                return 'Case-sensitive file conflict';
            case PullRequestMergeFailureType.ObjectTooLarge:
                return 'Merge object too large';
            default:
                return 'Unknown';
        }
    }

    private _buildThreadHtml(thread: GitPullRequestCommentThread): string {
        const threadId = thread.id ?? 0;
        const isResolved =
            thread.status === 2 /* Fixed */ || thread.status === 4; /* ByDesign */
        const statusLabel = isResolved ? 'Resolved' : 'Active';

        const commentsHtml = (thread.comments ?? [])
            .map((c: Comment) => {
                const author = this._esc(c.author?.displayName ?? 'Unknown');
                const content = this._esc(c.content ?? '');
                return `<div class="comment"><div class="comment-author">${author}</div><div class="comment-content">${content}</div></div>`;
            })
            .join('');

        const statusBtn = isResolved
            ? `<button class="btn btn-secondary" data-action="set-status" data-thread-id="${threadId}" data-status="1">Reopen</button>`
            : `<button class="btn btn-secondary" data-action="set-status" data-thread-id="${threadId}" data-status="2">Resolve</button>`;

        return `
<div class="thread ${isResolved ? 'resolved' : ''}">
  <div class="thread-header">
    <span class="thread-status">${statusLabel}</span>
    ${statusBtn}
  </div>
  ${commentsHtml}
  <div class="reply-form">
    <textarea id="reply_${threadId}" class="reply-input" rows="2" placeholder="Reply…"></textarea>
        <button class="btn btn-primary" data-action="reply" data-thread-id="${threadId}">Reply</button>
  </div>
</div>`;
    }

    private _esc(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private _reviewVoteLabel(vote: number): string {
        switch (vote) {
            case PullRequestReviewVotes.approved:
                return 'Approved';
            case PullRequestReviewVotes.approvedWithSuggestions:
                return 'Suggestions';
            case PullRequestReviewVotes.waitingForAuthor:
                return 'Waiting';
            case PullRequestReviewVotes.rejected:
                return 'Rejected';
            default:
                return 'No vote';
        }
    }

    private _reviewVoteClass(vote: number): string {
        switch (vote) {
            case PullRequestReviewVotes.approved:
            case PullRequestReviewVotes.approvedWithSuggestions:
                return 'vote-positive';
            case PullRequestReviewVotes.waitingForAuthor:
                return 'vote-waiting';
            case PullRequestReviewVotes.rejected:
                return 'vote-negative';
            default:
                return '';
        }
    }

    private _isReviewVote(vote: number | undefined): vote is PullRequestReviewVote {
        return vote === PullRequestReviewVotes.approved ||
            vote === PullRequestReviewVotes.approvedWithSuggestions ||
            vote === PullRequestReviewVotes.noVote ||
            vote === PullRequestReviewVotes.waitingForAuthor ||
            vote === PullRequestReviewVotes.rejected;
    }

    private _dispose(): void {
        PrDetailsPanel._panels.delete(this._panelKey);
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }

    private _createNonce(): string {
        return crypto.randomBytes(16).toString('hex');
    }

    private static panelKey(prId: number, organization?: string, project?: string): string {
        return JSON.stringify([organization ?? null, project ?? null, prId]);
    }
}
