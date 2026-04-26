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