import * as vscode from 'vscode';
import type { AdoClient, GitPullRequest } from '../api/adoClient';
import type { PullRequestQueryFilter } from '../config/configManager';
import type { ConfigManager } from '../config/configManager';
import { resolveProjectScopes } from '../providers/projectScopes';
import { mapWithConcurrencyLimit } from '../utils/async';
import type { INotificationHandler, PrWithScope } from './iNotificationHandler';

const MAX_CONCURRENT_REQUESTS = 4;

/**
 * Central notification service that owns the shared polling loop and
 * delegates event detection to registered {@link INotificationHandler}
 * instances.
 *
 * The poll interval is shared across all handlers via the
 * `adoext.pullRequestCommentPollIntervalSeconds` setting.  Each handler
 * is independently guarded by its own feature flag so individual event
 * types can be muted without stopping the whole service.
 *
 * Adding a new notification type requires only:
 *   1. Implementing INotificationHandler in a new file.
 *   2. Registering the handler when constructing NotificationService.
 */
export class NotificationService implements vscode.Disposable {
    private _timer: NodeJS.Timeout | undefined;
    private _polling = false;
    private _disposed = false;

    constructor(
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private readonly _handlers: readonly INotificationHandler[]
    ) {}

    /**
     * Apply the current configuration: (re)start or stop the poll timer.
     * Safe to call repeatedly — for instance from an `onDidChangeConfiguration`
     * listener.
     */
    applyConfig(): void {
        if (this._disposed) { return; }
        this.stopTimer();
        if (!this.anyHandlerEnabled) { return; }
        const intervalMs = this._config.pullRequestCommentPollIntervalSeconds * 1000;
        this._timer = setInterval(() => { void this.pollOnce(); }, intervalMs);
        // Each handler manages its own baseline; fire the first poll
        // immediately so handlers can establish baselines on startup.
        void this.pollOnce();
    }

    /**
     * Force a single poll cycle (used after sign-in or relevant config
     * change).  Public so the extension can trigger it explicitly.
     */
    async refresh(): Promise<void> {
        if (this.anyHandlerEnabled) {
            await this.pollOnce();
        }
    }

    dispose(): void {
        this._disposed = true;
        this.stopTimer();
        for (const handler of this._handlers) {
            handler.dispose();
        }
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private get anyHandlerEnabled(): boolean {
        return this._handlers.some(h => h.isEnabled);
    }

    private stopTimer(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
    }

    private async pollOnce(): Promise<void> {
        if (this._disposed || this._polling) { return; }
        if (!this._client.isConnected) { return; }
        this._polling = true;
        try {
            const scopes = await resolveProjectScopes(this._client, this._config);
            if (scopes.length === 0) { return; }

            const enabledHandlers = this._handlers.filter(h => h.isEnabled);
            if (enabledHandlers.length === 0) { return; }

            const requiredFilters = collectRequiredFilters(enabledHandlers);

            const prsByScope = await mapWithConcurrencyLimit(
                scopes,
                MAX_CONCURRENT_REQUESTS,
                async scope => {
                    const prsByFilter = await Promise.all(
                        requiredFilters.map(async filter => {
                            try {
                                return await this._client.getPullRequests(
                                    scope.project,
                                    filter,
                                    undefined,
                                    scope.organization
                                );
                            } catch {
                                return [] as GitPullRequest[];
                            }
                        })
                    );

                    const merged: PrWithScope[] = [];
                    const seen = new Set<string>();
                    for (const prs of prsByFilter) {
                        for (const pr of prs) {
                            const key = makePullRequestKey(scope.organization, scope.project, pr);
                            if (!key || seen.has(key)) {
                                continue;
                            }
                            seen.add(key);
                            merged.push({ pr, scope });
                        }
                    }
                    return merged;
                }
            );
            const prs = prsByScope.flat();
            if (prs.length === 0) { return; }

            await Promise.all(enabledHandlers.map(h => h.poll(prs)));
        } finally {
            this._polling = false;
        }
    }
}

function collectRequiredFilters(handlers: readonly INotificationHandler[]): PullRequestQueryFilter[] {
    const seen = new Set<PullRequestQueryFilter>();
    const filters: PullRequestQueryFilter[] = [];
    for (const handler of handlers) {
        for (const filter of handler.requiredPullRequestFilters) {
            if (seen.has(filter)) {
                continue;
            }
            seen.add(filter);
            filters.push(filter);
        }
    }
    return filters;
}

function makePullRequestKey(
    organization: string,
    project: string,
    pr: GitPullRequest
): string | undefined {
    const pullRequestId = pr.pullRequestId;
    if (typeof pullRequestId !== 'number') {
        return undefined;
    }

    return `${organization}\u0000${project}\u0000${pr.repository?.id ?? ''}\u0000${pullRequestId}`;
}
