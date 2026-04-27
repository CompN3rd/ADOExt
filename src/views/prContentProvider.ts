import * as vscode from 'vscode';
import type { AdoClient, PullRequestDiffModel, PullRequestFileDiff } from '../api/adoClient';

export const PR_DIFF_SCHEME = 'adoext-pr';

/**
 * Identifies a single side of a PR diff for one file.
 *
 * Encoded into URIs of the form
 *   adoext-pr://{organization}/{project}/{repositoryId}/{pullRequestId}/{side}/{path}
 * with the iteration ids passed as query parameters so each iteration produces
 * a distinct URI (ensuring VS Code refreshes the document when the diff is
 * reloaded).
 */
export interface PrDiffUriParts {
    organization: string;
    project: string;
    repositoryId: string;
    pullRequestId: number;
    side: 'base' | 'target';
    path: string;
    iterationId: number;
    baseIterationId: number;
}

export function buildPrDiffUri(parts: PrDiffUriParts): vscode.Uri {
    const segments = parts.path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return vscode.Uri.from({
        scheme: PR_DIFF_SCHEME,
        authority: encodeURIComponent(parts.organization),
        path: `/${encodeURIComponent(parts.project)}/${encodeURIComponent(parts.repositoryId)}/${parts.pullRequestId}/${parts.side}/${segments}`,
        query: `iter=${parts.iterationId}&base=${parts.baseIterationId}`
    });
}

export function parsePrDiffUri(uri: vscode.Uri): PrDiffUriParts | undefined {
    if (uri.scheme !== PR_DIFF_SCHEME) { return undefined; }
    const segments = uri.path.split('/').filter(Boolean);
    if (segments.length < 5) { return undefined; }
    const [project, repositoryId, prIdRaw, side, ...pathParts] = segments;
    const pullRequestId = Number(prIdRaw);
    if (!Number.isFinite(pullRequestId) || (side !== 'base' && side !== 'target')) {
        return undefined;
    }

    const query = new URLSearchParams(uri.query);
    const iterationId = Number(query.get('iter') ?? '0');
    const baseIterationId = Number(query.get('base') ?? '0');

    return {
        organization: decodeURIComponent(uri.authority),
        project: decodeURIComponent(project),
        repositoryId: decodeURIComponent(repositoryId),
        pullRequestId,
        side,
        path: '/' + pathParts.map(decodeURIComponent).join('/'),
        iterationId,
        baseIterationId
    };
}

/**
 * Cache of file diffs keyed by `${org}|${project}|${prId}|${iterationId}` so
 * that the content provider does not need to refetch the whole iteration when
 * a user opens many files from the same diff.
 */
export class PrDiffCache {
    private readonly _entries = new Map<string, PullRequestDiffModel>();

    set(org: string, project: string, prId: number, model: PullRequestDiffModel): void {
        this._entries.set(this.cacheKey(org, project, prId, model.iterationId), model);
    }

    get(org: string, project: string, prId: number, iterationId: number): PullRequestDiffModel | undefined {
        return this._entries.get(this.cacheKey(org, project, prId, iterationId));
    }

    findFile(org: string, project: string, prId: number, iterationId: number, path: string): PullRequestFileDiff | undefined {
        const model = this.get(org, project, prId, iterationId);
        if (!model) { return undefined; }
        return model.files.find(file => file.path === path || file.originalPath === path);
    }

    private cacheKey(org: string, project: string, prId: number, iterationId: number): string {
        return `${org}\u0000${project}\u0000${prId}\u0000${iterationId}`;
    }
}

/**
 * Serves PR file contents for the native VS Code diff editor.
 *
 * When the requested file is not yet cached (e.g. the user followed a deep
 * link), the provider falls back to fetching the iteration on demand.
 */
export class PrDiffContentProvider implements vscode.TextDocumentContentProvider {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    constructor(
        private readonly _client: AdoClient,
        private readonly _cache: PrDiffCache
    ) {}

    notifyChanged(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const parts = parsePrDiffUri(uri);
        if (!parts) { return ''; }

        let file = this._cache.findFile(
            parts.organization,
            parts.project,
            parts.pullRequestId,
            parts.iterationId,
            parts.path
        );

        if (!file) {
            try {
                const pr = await this._client.getPullRequest(
                    parts.project,
                    parts.repositoryId,
                    parts.pullRequestId,
                    parts.organization
                );
                if (!pr) { return ''; }
                const model = await this._client.getPullRequestDiff(
                    parts.project,
                    parts.repositoryId,
                    pr,
                    parts.organization
                );
                this._cache.set(parts.organization, parts.project, parts.pullRequestId, model);
                file = this._cache.findFile(
                    parts.organization,
                    parts.project,
                    parts.pullRequestId,
                    model.iterationId,
                    parts.path
                );
            } catch {
                return '';
            }
        }

        if (!file) { return ''; }
        return parts.side === 'base' ? file.originalContent : file.modifiedContent;
    }
}
