interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

export class TtlCache<T> {
    private _map = new Map<string, CacheEntry<T>>();

    constructor(private _ttlMs: number) {}

    get(key: string): T | undefined {
        const entry = this._map.get(key);
        if (entry && entry.expiresAt > Date.now()) {
            return entry.value;
        }
        if (entry) {
            this._map.delete(key);
        }
        return undefined;
    }

    set(key: string, value: T): void {
        this._map.set(key, { value, expiresAt: Date.now() + this._ttlMs });
    }

    clear(): void {
        this._map.clear();
    }

    has(key: string): boolean {
        return this.get(key) !== undefined;
    }
}
