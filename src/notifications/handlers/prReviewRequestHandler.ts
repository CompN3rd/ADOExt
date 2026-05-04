import * as vscode from 'vscode';
import type { AdoClient, GitPullRequest } from '../../api/adoClient';
import type { ConfigManager } from '../../config/configManager';
import type { ProjectScope } from '../../providers/projectScopes';
import { showInformationMessage } from '../../utils/notifications';
import type { INotificationHandler, PrWithScope } from '../iNotificationHandler';

const STATE_KEY = 'adoext.seenReviewerPrKeys';

/**
 * Notification handler for pull request review requests.
 *
 * Notifies the user when they are added as a reviewer on a PR they have not
 * been notified about before.  The seen-PR set is persisted to
 * `globalState` so the notification fires at most once per PR across
 * sessions.
 *
 * Controlled by the `adoext.notifyOnPullRequestReviewRequests` setting.
 */
export class PrReviewRequestHandler implements INotificationHandler {
    /** Keys of PRs where the current user is already known to be a reviewer. */
    private _seenPrKeys: Set<string>;
    private _disposed = false;

    constructor(
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private readonly _state: vscode.Memento
    ) {
        const stored = _state.get<string[]>(STATE_KEY, []);
        this._seenPrKeys = new Set(stored);
    }

    get isEnabled(): boolean {
        return this._config.notifyOnPullRequestReviewRequests;
    }

    async poll(prs: PrWithScope[]): Promise<void> {
        if (this._disposed) { return; }
        const baselineOnly = !this.hasBaseline();

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

            // Only react when the current user appears in the reviewer list.
            const isReviewer = (pr.reviewers ?? []).some(r => r.id === currentUserId);
            if (!isReviewer) { continue; }

            const prKey = `${scope.organization}\u0000${scope.project}\u0000${pullRequestId}`;
            if (this._seenPrKeys.has(prKey)) { continue; }

            this._seenPrKeys.add(prKey);
            stateChanged = true;

            if (!baselineOnly) {
                this.showNotification(pr, scope);
            }
        }

        if (stateChanged) {
            await this._state.update(STATE_KEY, [...this._seenPrKeys]);
        }
    }

    dispose(): void {
        this._disposed = true;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private hasBaseline(): boolean {
        return this._seenPrKeys.size > 0;
    }

    private showNotification(pr: GitPullRequest, scope: ProjectScope): void {
        const pullRequestId = pr.pullRequestId ?? '?';
        const rawTitle = pr.title ?? `#${pullRequestId}`;
        const shortTitle = rawTitle.length > 60 ? rawTitle.slice(0, 57) + '…' : rawTitle;
        const message = `You have been added as a reviewer on PR #${pullRequestId} "${shortTitle}".`;
        const openAction = 'Open Pull Request';
        const muteAction = 'Mute Review Requests';
        void showInformationMessage(message, openAction, muteAction).then(choice => {
            if (choice === openAction) {
                void vscode.commands.executeCommand('adoext.viewPullRequestDetails', {
                    pr,
                    organization: scope.organization,
                    project: scope.project
                });
            } else if (choice === muteAction) {
                void vscode.workspace.getConfiguration('adoext')
                    .update('notifyOnPullRequestReviewRequests', false, vscode.ConfigurationTarget.Global);
            }
        });
    }
}
