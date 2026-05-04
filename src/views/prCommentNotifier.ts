import * as vscode from 'vscode';
import type { AdoClient, GitPullRequest, GitPullRequestCommentThread } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { resolveProjectScopes, type ProjectScope } from '../providers/projectScopes';
import { mapWithConcurrencyLimit } from '../utils/async';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';

const STATE_KEY = 'adoext.lastSeenPrCommentIds';
const MAX_CONCURRENT_REQUESTS = 4;

interface PrIdentity {
    organization: string;
    project: string;
    repositoryId: string;
    pullRequestId: number;
    title: string;
}

/**
 * Polls tracked pull requests for new comments and surfaces a small
 * notification when one appears. The poll interval and a master toggle are
 * controlled by the `adoext.notifyOnNewPullRequestComments` and
 * `adoext.pullRequestCommentPollIntervalSeconds` settings.
 *
 * Baseline state (the highest comment id seen per PR) is persisted to the
 * extension's `globalState` so reloads or restarts don't replay old comments.
 */
export class PrCommentNotifier implements vscode.Disposable {
    private _timer: NodeJS.Timeout | undefined;
    private _polling = false;
    private _disposed = false;
    private _lastSeen: Record<string, number>;

    constructor(
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private readonly _state: vscode.Memento
    ) {
        this._lastSeen = { ..._state.get<Record<string, number>>(STATE_KEY, {}) };
    }

    /**
     * Apply the current configuration: (re)start or stop the poll timer.
     * Safe to call repeatedly — for instance from an `onDidChangeConfiguration`
     * listener.
     */
    applyConfig(): void {
        if (this._disposed) { return; }
        this.stopTimer();
        if (!this._config.notifyOnNewPullRequestComments) { return; }
        const intervalMs = this._config.pullRequestCommentPollIntervalSeconds * 1000;
        this._timer = setInterval(() => { void this.pollOnce(); }, intervalMs);
        // Establish a baseline soon after startup so we don't notify for
        // comments that already exist when the extension activates.
        void this.pollOnce({ baselineOnly: !this.hasBaseline() });
    }

    /**
     * Force a poll (used after a code change such as enabling the feature
     * or signing in). Public so the extension can trigger it explicitly.
     */
    async refresh(): Promise<void> {
        if (this._config.notifyOnNewPullRequestComments) {
            await this.pollOnce();
        }
    }

    dispose(): void {
        this._disposed = true;
        this.stopTimer();
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    private stopTimer(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
    }

    private hasBaseline(): boolean {
        return Object.keys(this._lastSeen).length > 0;
    }

    private async pollOnce(options: { baselineOnly?: boolean } = {}): Promise<void> {
        if (this._disposed || this._polling) { return; }
        if (!this._client.isConnected) { return; }
        this._polling = true;
        try {
            const scopes = await resolveProjectScopes(this._client, this._config);
            if (scopes.length === 0) { return; }

            const query = this._config.activePullRequestQuery;
            const prsByScope = await mapWithConcurrencyLimit(scopes, MAX_CONCURRENT_REQUESTS, async scope => {
                try {
                    const prs = await this._client.getPullRequests(
                        scope.project,
                        query.filter,
                        undefined,
                        scope.organization
                    );
                    return prs.map(pr => ({ pr, scope }));
                } catch {
                    return [] as Array<{ pr: GitPullRequest; scope: ProjectScope }>;
                }
            });
            const prs = prsByScope.flat();
            if (prs.length === 0) { return; }

            const stateChanged = await this.pollPullRequests(prs, options.baselineOnly === true);
            if (stateChanged) {
                await this._state.update(STATE_KEY, this._lastSeen);
            }
        } finally {
            this._polling = false;
        }
    }

    private async pollPullRequests(
        prs: Array<{ pr: GitPullRequest; scope: ProjectScope }>,
        baselineOnly: boolean
    ): Promise<boolean> {
        let changed = false;
        const currentUserByOrg = new Map<string, string | undefined>();

        await mapWithConcurrencyLimit(prs, MAX_CONCURRENT_REQUESTS, async ({ pr, scope }) => {
            const repositoryId = pr.repository?.id;
            const pullRequestId = pr.pullRequestId;
            if (!repositoryId || typeof pullRequestId !== 'number') { return; }

            let threads: GitPullRequestCommentThread[];
            try {
                threads = await this._client.getPullRequestThreads(
                    scope.project,
                    repositoryId,
                    pullRequestId,
                    scope.organization
                );
            } catch {
                return;
            }

            const identity: PrIdentity = {
                organization: scope.organization,
                project: scope.project,
                repositoryId,
                pullRequestId,
                title: pr.title ?? `#${pullRequestId}`
            };

            if (!currentUserByOrg.has(scope.organization)) {
                currentUserByOrg.set(
                    scope.organization,
                    await this._client.getCurrentUserIdFor(scope.organization).catch(() => undefined)
                );
            }
            const currentUserId = currentUserByOrg.get(scope.organization);

            const result = this.processThreads(identity, threads, currentUserId, baselineOnly);
            if (result.stateChanged) {
                changed = true;
            }
            if (!baselineOnly && result.notify) {
                this.showNotification(identity, result.newCommentCount, result.lastAuthor);
            }
        });

        return changed;
    }

    private processThreads(
        identity: PrIdentity,
        threads: GitPullRequestCommentThread[],
        currentUserId: string | undefined,
        baselineOnly: boolean
    ): { stateChanged: boolean; notify: boolean; newCommentCount: number; lastAuthor: string | undefined } {
        const stateKey = this.makeStateKey(identity);
        const previousMaxId = this._lastSeen[stateKey] ?? 0;

        let maxId = previousMaxId;
        let newCommentCount = 0;
        let lastAuthor: string | undefined;

        for (const thread of threads ?? []) {
            if (thread.isDeleted) { continue; }
            for (const comment of thread.comments ?? []) {
                const commentId = comment.id ?? 0;
                if (commentId > maxId) {
                    maxId = commentId;
                }
                if (comment.isDeleted || !comment.content) { continue; }
                if (commentId <= previousMaxId) { continue; }
                if (currentUserId && comment.author?.id === currentUserId) { continue; }
                newCommentCount++;
                lastAuthor = comment.author?.displayName ?? lastAuthor;
            }
        }

        const stateChanged = maxId !== previousMaxId;
        if (stateChanged) {
            this._lastSeen[stateKey] = maxId;
        }

        // First time we see a PR (no previous baseline) — never notify, just
        // record the baseline. This avoids replaying every existing comment
        // on first launch.
        const notify = !baselineOnly && previousMaxId > 0 && newCommentCount > 0;
        return { stateChanged, notify, newCommentCount, lastAuthor };
    }

    private showNotification(identity: PrIdentity, count: number, author: string | undefined): void {
        const plural = count === 1 ? 'comment' : 'comments';
        const authorPart = author ? ` by ${author}` : '';
        const shortTitle = identity.title.length > 60 ? identity.title.slice(0, 57) + '…' : identity.title;
        const message = `PR #${identity.pullRequestId} "${shortTitle}" — ${count} new ${plural}${authorPart}.`;
        const openAction = 'Open Pull Request';
        const muteAction = 'Mute Notifications';
        void showInformationMessage(message, openAction, muteAction).then(async choice => {
            if (choice === openAction) {
                try {
                    const pr = await this._client.getPullRequest(
                        identity.project,
                        identity.repositoryId,
                        identity.pullRequestId,
                        identity.organization
                    );
                    if (!pr) {
                        showWarningMessage(`Pull request #${identity.pullRequestId} could not be loaded.`);
                        return;
                    }
                    void vscode.commands.executeCommand('adoext.viewPullRequestDetails', {
                        pr,
                        organization: identity.organization,
                        project: identity.project
                    });
                } catch (err) {
                    showErrorMessage(`Failed to open pull request: ${err instanceof Error ? err.message : String(err)}`);
                }
            } else if (choice === muteAction) {
                void vscode.workspace.getConfiguration('adoext')
                    .update('notifyOnNewPullRequestComments', false, vscode.ConfigurationTarget.Global);
            }
        });
    }

    private makeStateKey(identity: PrIdentity): string {
        return `${identity.organization}\u0000${identity.project}\u0000${identity.pullRequestId}`;
    }
}
