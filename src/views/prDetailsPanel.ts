import * as vscode from 'vscode';
import type { GitPullRequest, GitPullRequestCommentThread, Comment, PullRequestReviewVote, GitPullRequestStatus, PolicyEvaluationRecord } from '../api/adoClient';
import type { Build } from '../api/adoClient';
import { PullRequestReviewVotes, GitStatusState, PolicyEvaluationStatus, PullRequestAsyncStatus, PullRequestMergeFailureType, PullRequestStatus } from '../api/adoClient';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';
import { isToolIdentity, isSystemThread } from '../utils/prCommentIdentity';
import { buildSummaryData } from './buildSummaryHtml';
import { buildWebviewDocument, webviewAssetRoots } from './webviewHtml';
import { mapWithConcurrencyLimit } from '../utils/async';
import type { NamedBadgeRowViewModel, PrDetailsMessage, PrDetailsViewModel, PrTestResultsViewModel, PrWorkItemRefViewModel } from './webviewTypes';
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

    static async refreshAllOpenPanels(): Promise<void> {
        await Promise.allSettled(
            [...PrDetailsPanel._panels.values()].map(panel =>
                panel._refresh(panel._client, panel._config, panel._pr)
            )
        );
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
                retainContextWhenHidden: true,
                localResourceRoots: webviewAssetRoots(_context)
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

        const buildsPromise = project && repoId && pr.sourceRefName
            ? client.getBuildsForPullRequest(project, repoId, pr.sourceRefName, organization)
            : Promise.resolve([] as Build[]);
        const testResultsPromise = buildsPromise.then(builds =>
            project
                ? this._buildTestResultsViewModel(project, organization, builds)
                : undefined
        );

        const [latestPrResult, threadsResult, statusesResult, policiesResult, buildsResult, workItemRefsResult, testResultsResult] = await Promise.allSettled([
            client.getPullRequest(project, repoId, prId, organization),
            client.getPullRequestThreads(project, repoId, prId, organization),
            client.getPullRequestStatuses(project, repoId, prId, organization),
            projectId
                ? client.getPullRequestPolicyEvaluations(project, prId, projectId, organization)
                : Promise.resolve([] as PolicyEvaluationRecord[]),
            buildsPromise,
            client.getPullRequestWorkItemRefs(project, repoId, prId, organization),
            testResultsPromise
        ]);

        const latestPr = latestPrResult.status === 'fulfilled' && latestPrResult.value ? latestPrResult.value : pr;
        const threads = threadsResult.status === 'fulfilled' ? threadsResult.value : [];
        const statuses = statusesResult.status === 'fulfilled' ? statusesResult.value : [];
        const policies = policiesResult.status === 'fulfilled' ? policiesResult.value : [];
        const builds = buildsResult.status === 'fulfilled' ? buildsResult.value : [];
        const workItemRefs = workItemRefsResult.status === 'fulfilled' ? workItemRefsResult.value : [];
        const testResults = testResultsResult.status === 'fulfilled' ? testResultsResult.value : undefined;

        this._pr = latestPr;
        this._panel.webview.html = this._buildHtml(latestPr, threads, statuses, policies, builds, workItemRefs, testResults);
    }

    private async _handleMessage(msg: PrDetailsMessage): Promise<void> {
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
            } else if (msg.type === 'setShowResolvedThreads') {
                await this._config.setShowResolvedPullRequestThreads(msg.showResolved);
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
            } else if (msg.type === 'openBuild' && typeof msg.buildId === 'number') {
                if (!organization || !project || msg.buildId <= 0) {
                    showWarningMessage(
                        'Unable to open build because organization, project, or build ID is missing.'
                    );
                    return;
                }
                const buildUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_build/results?buildId=${msg.buildId}`;
                void vscode.env.openExternal(vscode.Uri.parse(buildUrl));
            } else if (msg.type === 'openTestRun' && typeof msg.runId === 'number') {
                if (!organization || !project || msg.runId <= 0) {
                    showWarningMessage(
                        'Unable to open test run because organization, project, or run ID is missing.'
                    );
                    return;
                }
                const runUrl = this._testRunUrl(organization, project, msg.runId);
                void vscode.env.openExternal(vscode.Uri.parse(runUrl));
            } else if (msg.type === 'copyText' && typeof msg.text === 'string') {
                await vscode.env.clipboard.writeText(msg.text);
                showInformationMessage('Copied to clipboard.');
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
            } else if (msg.type === 'completePr') {
                if (!organization || !project || !repoId) {
                    showWarningMessage('Unable to complete PR: missing organization, project, or repository.');
                    return;
                }
                const lastCommitId = this._pr.lastMergeSourceCommit?.commitId;
                if (!lastCommitId) {
                    showWarningMessage('Unable to complete PR: merge source commit is unknown. Try refreshing.');
                    return;
                }
                await this._client.completePullRequest(
                    project,
                    repoId,
                    prId,
                    lastCommitId,
                    {
                        mergeStrategy: msg.mergeStrategy,
                        deleteSourceBranch: msg.deleteSourceBranch,
                        transitionWorkItems: msg.transitionWorkItems,
                        mergeCommitMessage: msg.mergeCommitMessage
                    },
                    organization
                );
                showInformationMessage('Pull request completed.');
                await this._refresh(this._client, this._config, this._pr);
                void vscode.commands.executeCommand('adoext.refreshPullRequests');
            } else if (msg.type === 'setAutoComplete') {
                if (!organization || !project || !repoId) {
                    showWarningMessage('Unable to set auto-complete: missing organization, project, or repository.');
                    return;
                }
                await this._client.setAutoComplete(
                    project,
                    repoId,
                    prId,
                    true,
                    {
                        mergeStrategy: msg.mergeStrategy,
                        deleteSourceBranch: msg.deleteSourceBranch,
                        transitionWorkItems: msg.transitionWorkItems,
                        mergeCommitMessage: msg.mergeCommitMessage
                    },
                    organization
                );
                showInformationMessage('Auto-complete enabled.');
                await this._refresh(this._client, this._config, this._pr);
                void vscode.commands.executeCommand('adoext.refreshPullRequests');
            } else if (msg.type === 'cancelAutoComplete') {
                if (!organization || !project || !repoId) {
                    showWarningMessage('Unable to cancel auto-complete: missing organization, project, or repository.');
                    return;
                }
                await this._client.setAutoComplete(
                    project,
                    repoId,
                    prId,
                    false,
                    undefined,
                    organization
                );
                showInformationMessage('Auto-complete cancelled.');
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
        policies: PolicyEvaluationRecord[] = [],
        builds: Build[] = [],
        workItemRefs: { id?: string; url?: string }[] = [],
        testResults?: PrTestResultsViewModel
    ): string {
        const webview = this._panel.webview;
        const data = this._buildViewModel(pr, threads, statuses, policies, builds, workItemRefs, testResults);
        return buildWebviewDocument(this._context, webview, {
            title: `PR #${data.prId}`,
            entry: 'prDetails.js',
            appTag: 'ado-pr-details-app',
            data
        });
    }

    private _buildViewModel(
        pr: GitPullRequest,
        threads: GitPullRequestCommentThread[],
        statuses: GitPullRequestStatus[],
        policies: PolicyEvaluationRecord[],
        builds: Build[],
        workItemRefs: { id?: string; url?: string }[] = [],
        testResults?: PrTestResultsViewModel
    ): PrDetailsViewModel {
        const prId = pr.pullRequestId ?? 0;
        const title = pr.title ?? '';
        const description = pr.description ?? '*(no description)*';
        const sourceBranch = (pr.sourceRefName ?? '').replace('refs/heads/', '');
        const targetBranch = (pr.targetRefName ?? '').replace('refs/heads/', '');
        const author = pr.createdBy?.displayName ?? 'Unknown';
        const createdDate = pr.creationDate
            ? new Date(pr.creationDate).toLocaleDateString()
            : '';

        const reviewers = (pr.reviewers ?? [])
            .map(reviewer => {
                const vote = reviewer.vote ?? 0;
                return {
                    displayName: reviewer.displayName ?? '',
                    voteLabel: this._reviewVoteLabel(vote),
                    voteClass: this._reviewVoteClass(vote)
                };
            });

        const meaningfulThreads = (threads ?? []).filter(
            thread => (thread.comments ?? []).some(comment => !!comment.content) && !thread.isDeleted
        );
        const visibleThreads = this._config.hideSystemPullRequestThreads
            ? meaningfulThreads.filter(thread => !isSystemThread(thread))
            : meaningfulThreads;

        const prStatus = pr.status ?? PullRequestStatus.Active;
        const hasConflicts = pr.mergeStatus === PullRequestAsyncStatus.Conflicts;
        const autoCompleteSetBy = pr.autoCompleteSetBy?.displayName ?? null;
        const lastMergeSourceCommitId = pr.lastMergeSourceCommit?.commitId ?? '';
        const canComplete = prStatus === PullRequestStatus.Active;
        const associatedWorkItems: PrWorkItemRefViewModel[] = workItemRefs
            .filter(ref => ref.id)
            .map(ref => ({ id: Number(ref.id), title: `Work Item ${ref.id}` }));

        return {
            prId,
            title,
            description,
            sourceBranch,
            targetBranch,
            author,
            isDraft: !!pr.isDraft,
            createdDate,
            status: prStatus,
            mergeStatus: this._branchStatusBadge(pr.mergeStatus).label,
            hasConflicts,
            autoCompleteSetBy,
            lastMergeSourceCommitId,
            associatedWorkItems,
            canComplete,
            reviewers,
            reviewActions: [
                { label: 'Approve', vote: PullRequestReviewVotes.approved },
                { label: 'Approve with Suggestions', vote: PullRequestReviewVotes.approvedWithSuggestions },
                { label: 'Wait for Author', vote: PullRequestReviewVotes.waitingForAuthor },
                { label: 'Reject', vote: PullRequestReviewVotes.rejected },
                { label: 'Reset Vote', vote: PullRequestReviewVotes.noVote }
            ],
            branchStatuses: this._buildBranchStatusRows(pr),
            checks: this._buildCheckRows(statuses, policies),
            testResults,
            showResolvedThreads: this._config.showResolvedPullRequestThreads,
            threads: visibleThreads.map(thread => {
                const isResolved = thread.status === 2 || thread.status === 4;
                const firstComment = thread.comments?.[0];
                return {
                    id: thread.id ?? 0,
                    isResolved,
                    isToolThread: isToolIdentity(firstComment?.author),
                    statusLabel: isResolved ? 'Resolved' : 'Active',
                    comments: (thread.comments ?? []).map((comment: Comment) => ({
                        author: comment.author?.displayName ?? 'Unknown',
                        content: comment.content ?? '',
                        isTool: isToolIdentity(comment.author)
                    }))
                };
            }),
            builds: builds.map(buildSummaryData)
        };
    }

    private _testRunUrl(organization: string, project: string, runId: number): string {
        return `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_testManagement/runs?_a=runCharts&runId=${runId}`;
    }

    private _formatDuration(ms: number): string {
        if (!Number.isFinite(ms) || ms <= 0) {
            return '';
        }

        const totalSeconds = Math.floor(ms / 1000);
        const seconds = totalSeconds % 60;
        const totalMinutes = Math.floor(totalSeconds / 60);
        const minutes = totalMinutes % 60;
        const hours = Math.floor(totalMinutes / 60);

        const pad = (n: number) => n.toString().padStart(2, '0');
        return hours > 0
            ? `${hours}:${pad(minutes)}:${pad(seconds)}`
            : `${minutes}:${pad(seconds)}`;
    }

    private _snippet(text: string | undefined, maxChars: number): string {
        const value = (text ?? '').trim();
        if (!value) {
            return '';
        }
        if (value.length <= maxChars) {
            return value;
        }
        return `${value.slice(0, maxChars - 1)}…`;
    }

    private async _buildTestResultsViewModel(
        project: string,
        organization: string | undefined,
        builds: Build[]
    ): Promise<PrTestResultsViewModel | undefined> {
        const buildInfos = (builds ?? [])
            .map(build => ({
                id: build.id ?? 0,
                label: build.buildNumber ?? (build.id ? `#${build.id}` : '')
            }))
            .filter(info => info.id > 0);

        if (buildInfos.length === 0) {
            return undefined;
        }

        const runsByBuild = await mapWithConcurrencyLimit(buildInfos, 4, async (buildInfo) => {
            try {
                const runs = await this._client.getTestRunsForBuild(project, buildInfo.id, organization);
                return runs.map(run => ({ run, buildInfo }));
            } catch {
                return [];
            }
        });

        const runsWithBuild = runsByBuild.flat();
        if (runsWithBuild.length === 0) {
            return undefined;
        }

        runsWithBuild.sort((a, b) => {
            const aTime = a.run.completedDate ? new Date(a.run.completedDate).getTime() : 0;
            const bTime = b.run.completedDate ? new Date(b.run.completedDate).getTime() : 0;
            return bTime - aTime;
        });

        const runViewModels = runsWithBuild.map(({ run, buildInfo }) => {
            const passedTests = run.passedTests ?? 0;
            const failedTests = run.unanalyzedTests ?? 0;
            const skippedTests = (run.notApplicableTests ?? 0) + (run.incompleteTests ?? 0);
            const totalTests = run.totalTests ?? (passedTests + failedTests + skippedTests);

            const durationMs = run.startedDate && run.completedDate
                ? new Date(run.completedDate).getTime() - new Date(run.startedDate).getTime()
                : 0;

            return {
                runId: run.id,
                runName: run.name,
                runUrl: organization ? this._testRunUrl(organization, project, run.id) : '',
                buildId: buildInfo.id,
                buildLabel: buildInfo.label,
                totalTests,
                passedTests,
                failedTests,
                skippedTests,
                durationLabel: this._formatDuration(durationMs)
            };
        });

        const failingRuns = runsWithBuild
            .filter(({ run }) => (run.unanalyzedTests ?? 0) > 0)
            .slice(0, 10);

        const failuresByRun = await mapWithConcurrencyLimit(failingRuns, 4, async ({ run, buildInfo }) => {
            try {
                const results = await this._client.getFailedTestResultsForRun(project, run.id, organization, 25);
                return results.map(result => ({
                    testName: result.automatedTestName ?? result.testCaseTitle ?? `Test #${result.id ?? 0}`,
                    errorMessageSnippet: this._snippet(result.errorMessage, 300),
                    stackTraceSnippet: this._snippet(result.stackTrace, 600),
                    runId: run.id,
                    runName: run.name,
                    runUrl: organization ? this._testRunUrl(organization, project, run.id) : '',
                    buildId: buildInfo.id,
                    buildLabel: buildInfo.label
                }));
            } catch {
                return [];
            }
        });

        const failures = failuresByRun.flat();

        const summary = runViewModels.reduce(
            (acc, run) => {
                acc.totalTests += run.totalTests;
                acc.passedTests += run.passedTests;
                acc.failedTests += run.failedTests;
                acc.skippedTests += run.skippedTests;
                return acc;
            },
            { totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0 }
        );

        const totalDurationMs = runsWithBuild.reduce((acc, { run }) => {
            if (!run.startedDate || !run.completedDate) {
                return acc;
            }
            const duration = new Date(run.completedDate).getTime() - new Date(run.startedDate).getTime();
            return duration > 0 ? acc + duration : acc;
        }, 0);

        return {
            ...summary,
            durationLabel: this._formatDuration(totalDurationMs),
            runs: runViewModels,
            failures
        };
    }

    private _buildCheckRows(
        statuses: GitPullRequestStatus[],
        policies: PolicyEvaluationRecord[]
    ): NamedBadgeRowViewModel[] {
        const rows: NamedBadgeRowViewModel[] = [];

        for (const status of statuses) {
            const name = [status.context?.genre, status.context?.name].filter(Boolean).join('/') || 'Check';
            const badge = this._statusStateBadge(status.state);
            rows.push({
                name,
                description: status.description ?? '',
                badge: { label: badge.label, className: badge.cls }
            });
        }

        for (const policy of policies) {
            const name = policy.configuration?.settings?.displayName
                ?? policy.configuration?.type?.displayName
                ?? policy.configuration?.type?.id
                ?? 'Policy';
            const badge = this._policyStatusBadge(policy.status);
            rows.push({
                name,
                description: policy.context?.statusReason ?? '',
                badge: { label: badge.label, className: badge.cls }
            });
        }

        return rows;
    }

    private _buildBranchStatusRows(pr: GitPullRequest): NamedBadgeRowViewModel[] {
        const rows: NamedBadgeRowViewModel[] = [];

        if (pr.mergeStatus !== undefined) {
            const badge = this._branchStatusBadge(pr.mergeStatus);
            rows.push({
                name: 'Merge Status',
                description: pr.mergeFailureMessage ?? '',
                badge: { label: badge.label, className: badge.cls }
            });
        }

        if (pr.mergeFailureType !== undefined && pr.mergeFailureType !== PullRequestMergeFailureType.None) {
            rows.push({
                name: 'Merge Failure',
                description: pr.mergeFailureMessage ?? '',
                badge: { label: this._mergeFailureLabel(pr.mergeFailureType), className: 'check-failure' }
            });
        }

        return rows;
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
            case GitStatusState.NotSet:
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

    private static panelKey(prId: number, organization?: string, project?: string): string {
        return JSON.stringify([organization ?? null, project ?? null, prId]);
    }
}
