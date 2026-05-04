import * as vscode from 'vscode';
import type { AdoClient, GitPullRequest } from '../../api/adoClient';
import type { ConfigManager } from '../../config/configManager';
import type { ProjectScope } from '../../providers/projectScopes';
import { showInformationMessage } from '../../utils/notifications';
import type { INotificationHandler, PrWithScope } from '../iNotificationHandler';

const STATE_KEY = 'adoext.lastSeenPrVotes';

/** Maps reviewer id → vote value. */
type VoteSnapshot = Record<string, number>;

function votesEqual(a: VoteSnapshot, b: VoteSnapshot): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) { return false; }
    for (const key of keysA) {
        if (!(key in b) || a[key] !== b[key]) { return false; }
    }
    return true;
}

function voteLabel(vote: number): string {
    switch (vote) {
        case 10:  return 'approved';
        case 5:   return 'approved with suggestions';
        case -5:  return 'is waiting for the author';
        case -10: return 'rejected';
        default:  return `voted (${vote})`;
    }
}

/**
 * Notification handler for pull request vote / status changes.
 *
 * Notifies the PR author when a reviewer casts or changes their vote on one
 * of the author's active pull requests.  The last-known vote snapshot per PR
 * is persisted to `globalState` so restarts don't replay historical votes.
 *
 * Controlled by the `adoext.notifyOnPullRequestStatusChanges` setting.
 */
export class PrStatusChangeHandler implements INotificationHandler {
    /** prKey → { reviewerId → vote } */
    private _lastVotes: Record<string, VoteSnapshot>;
    private _disposed = false;

    constructor(
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private readonly _state: vscode.Memento
    ) {
        this._lastVotes = _state.get<Record<string, VoteSnapshot>>(STATE_KEY, {});
    }

    get isEnabled(): boolean {
        return this._config.notifyOnPullRequestStatusChanges;
    }

    get requiredPullRequestFilters() {
        return ['created'] as const;
    }

    async poll(prs: PrWithScope[]): Promise<void> {
        if (this._disposed) { return; }

        // Resolve current user ID per organisation (cached per poll cycle).
        const currentUserByOrg = new Map<string, string | undefined>();
        for (const { scope } of prs) {
            if (!currentUserByOrg.has(scope.organization)) {
                currentUserByOrg.set(
                    scope.organization,
                    await this._client.getCurrentUserIdFor(scope.organization).catch(() => undefined)
                );
            }
        }

        let stateChanged = false;

        for (const { pr, scope } of prs) {
            const pullRequestId = pr.pullRequestId;
            if (typeof pullRequestId !== 'number') { continue; }

            const currentUserId = currentUserByOrg.get(scope.organization);
            if (!currentUserId) { continue; }

            // Only track PRs created by the current user.
            if (pr.createdBy?.id !== currentUserId) { continue; }

            const prKey = `${scope.organization}\u0000${scope.project}\u0000${pullRequestId}`;

            const currentVotes: VoteSnapshot = {};
            const reviewerNames: Record<string, string> = {};
            for (const reviewer of pr.reviewers ?? []) {
                if (reviewer.id && typeof reviewer.vote === 'number') {
                    currentVotes[reviewer.id] = reviewer.vote;
                    if (reviewer.displayName) {
                        reviewerNames[reviewer.id] = reviewer.displayName;
                    }
                }
            }

            const hasPrBaseline = prKey in this._lastVotes;
            const previousVotes = this._lastVotes[prKey] ?? {};

            if (!hasPrBaseline) {
                // First time seeing this PR — record the current snapshot as a
                // baseline without sending any notification, regardless of the
                // current vote values.  This avoids replaying pre-existing votes
                // when the extension starts for the first time.
                this._lastVotes[prKey] = currentVotes;
                stateChanged = true;
            } else if (!votesEqual(previousVotes, currentVotes)) {
                // Votes have changed since the last poll — notify and persist.
                for (const [reviewerId, currentVote] of Object.entries(currentVotes)) {
                    const previousVote = previousVotes[reviewerId] ?? 0;
                    // Only notify when the vote is non-zero and has changed.
                    if (currentVote !== 0 && currentVote !== previousVote) {
                        this.showNotification(pr, scope, reviewerNames[reviewerId], currentVote);
                    }
                }
                this._lastVotes[prKey] = currentVotes;
                stateChanged = true;
            }
        }

        if (stateChanged) {
            await this._state.update(STATE_KEY, this._lastVotes);
        }
    }

    dispose(): void {
        this._disposed = true;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private showNotification(
        pr: GitPullRequest,
        scope: ProjectScope,
        reviewerName: string | undefined,
        vote: number
    ): void {
        const pullRequestId = pr.pullRequestId ?? '?';
        const rawTitle = pr.title ?? `#${pullRequestId}`;
        const shortTitle = rawTitle.length > 60 ? rawTitle.slice(0, 57) + '…' : rawTitle;
        const reviewer = reviewerName ?? 'A reviewer';
        const action = voteLabel(vote);
        const message = `${reviewer} ${action} PR #${pullRequestId} "${shortTitle}".`;
        const openAction = 'Open Pull Request';
        const muteAction = 'Mute Status Changes';
        void showInformationMessage(message, openAction, muteAction).then(choice => {
            if (choice === openAction) {
                void vscode.commands.executeCommand('adoext.viewPullRequestDetails', {
                    pr,
                    organization: scope.organization,
                    project: scope.project
                });
            } else if (choice === muteAction) {
                void vscode.workspace.getConfiguration('adoext')
                    .update('notifyOnPullRequestStatusChanges', false, vscode.ConfigurationTarget.Global);
            }
        });
    }
}
