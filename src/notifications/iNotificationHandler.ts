import type { GitPullRequest } from '../api/adoClient';
import type { ProjectScope } from '../providers/projectScopes';

export interface PrWithScope {
    pr: GitPullRequest;
    scope: ProjectScope;
}

/**
 * Common contract for all notification event-type handlers.
 *
 * The NotificationService owns the polling loop and the shared PR list
 * fetch; each handler is solely responsible for detecting its specific
 * event type and surfacing VS Code toast notifications.
 *
 * New event types (build results, policy gates, etc.) can be added by
 * implementing this interface and registering the handler with
 * NotificationService — no changes to the polling infrastructure are
 * needed.
 */
export interface INotificationHandler {
    /** Whether this handler is currently enabled via settings / feature flags. */
    readonly isEnabled: boolean;

    /**
     * Process the current list of active pull requests.
     *
     * On the very first run (no persisted baseline) implementations must
     * silently record the current state to avoid replaying historical events
     * as notifications on startup.
     */
    poll(prs: PrWithScope[]): Promise<void>;

    dispose(): void;
}
