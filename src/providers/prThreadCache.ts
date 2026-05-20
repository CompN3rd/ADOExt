import type { GitPullRequestCommentThread } from '../api/adoClient';

const DEFAULT_TTL_MS = 30_000;

type Key = string;

interface Entry {
    threads: GitPullRequestCommentThread[];
    expires: number;
}

export interface ThreadFetcher {
    (
        project: string,
        repositoryId: string,
        pullRequestId: number,
        organization: string
    ): Promise<GitPullRequestCommentThread[]>;
}

export interface PrThreadKey {
    organization: string;
    project: string;
    repositoryId: string;
    pullRequestId: number;
}

function keyOf(k: PrThreadKey): Key {
    return `${k.organization}\0${k.project}\0${k.repositoryId}\0${k.pullRequestId}`;
}

/**
 * Shared cache + concurrency dedup for PR comment threads.
 *
 * Consumers (tree provider, notification poll) hit the same instance via
 * `getOrFetch`. Within the TTL window, repeat calls return cached data;
 * concurrent calls for the same PR share a single in-flight promise so we
 * never issue duplicate ADO requests. A tree expand shortly after a poll
 * tick is served from memory.
 */
export class PrThreadCache {
    private readonly entries = new Map<Key, Entry>();
    private readonly inflight = new Map<Key, Promise<GitPullRequestCommentThread[]>>();
    private readonly ttlMs: number;

    constructor(ttlMs: number = DEFAULT_TTL_MS) {
        this.ttlMs = ttlMs;
    }

    get(k: PrThreadKey): GitPullRequestCommentThread[] | undefined {
        const entry = this.entries.get(keyOf(k));
        if (!entry) { return undefined; }
        if (entry.expires <= Date.now()) {
            this.entries.delete(keyOf(k));
            return undefined;
        }
        return entry.threads;
    }

    set(k: PrThreadKey, threads: GitPullRequestCommentThread[]): void {
        this.sweepExpired();
        this.entries.set(keyOf(k), { threads, expires: Date.now() + this.ttlMs });
    }

    private sweepExpired(): void {
        const now = Date.now();
        for (const [id, entry] of this.entries) {
            if (entry.expires <= now) {
                this.entries.delete(id);
            }
        }
    }

    async getOrFetch(
        k: PrThreadKey,
        fetch: ThreadFetcher
    ): Promise<GitPullRequestCommentThread[]> {
        const cached = this.get(k);
        if (cached) { return cached; }

        const id = keyOf(k);
        const pending = this.inflight.get(id);
        if (pending) { return pending; }

        const promise = (async () => {
            try {
                const threads = await fetch(k.project, k.repositoryId, k.pullRequestId, k.organization);
                this.set(k, threads);
                return threads;
            } finally {
                this.inflight.delete(id);
            }
        })();
        this.inflight.set(id, promise);
        return promise;
    }

    invalidate(k: PrThreadKey): void {
        this.entries.delete(keyOf(k));
    }

    clear(): void {
        this.entries.clear();
        this.inflight.clear();
    }
}
