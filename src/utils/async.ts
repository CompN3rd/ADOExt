import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { resolveProjectScopes, type ProjectScope } from '../providers/projectScopes';

export async function forEachScope<T>(
    client: AdoClient,
    config: ConfigManager,
    fetcher: (scope: ProjectScope) => Promise<T[]>,
    concurrency = 4
): Promise<{ scopes: ProjectScope[]; items: T[] }> {
    const scopes = await resolveProjectScopes(client, config);
    if (scopes.length === 0) {
        return { scopes, items: [] };
    }
    const nested = await mapWithConcurrencyLimit(scopes, concurrency, fetcher);
    return { scopes, items: nested.flat() };
}

export async function mapWithConcurrencyLimit<TInput, TOutput>(
    items: readonly TInput[],
    concurrencyLimit: number,
    mapper: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
    if (items.length === 0) {
        return [];
    }

    const results = new Array<TOutput>(items.length);
    const workerCount = Math.min(Math.max(concurrencyLimit, 1), items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: workerCount }, async () => {
        for (;;) {
            const currentIndex = nextIndex++;
            if (currentIndex >= items.length) {
                break;
            }

            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    });

    await Promise.all(workers);
    return results;
}