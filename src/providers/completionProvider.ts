import * as vscode from 'vscode';
import { AdoClient } from '../api/adoClient';
import { ConfigManager } from '../config/configManager';
import { resolveProjectScopes } from './projectScopes';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
    items: vscode.CompletionItem[];
    timestamp: number;
}

/**
 * Provides Azure DevOps-aware completions in text documents:
 *
 * - Work item references triggered by `#` (supports both `#123` and `AB#123`).
 * - User @-mentions triggered by `@`, populated from project team members.
 *
 * Completions are scoped to the active org/project selection and degrade
 * safely when the extension is not connected or configured.
 */
export class AdoCompletionProvider implements vscode.CompletionItemProvider, vscode.Disposable {
    private readonly _workItemCache = new Map<string, CacheEntry>();
    private readonly _userCache = new Map<string, CacheEntry>();
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager
    ) {}

    /**
     * Register completion item providers for the document types where ADO
     * references are most commonly written.
     */
    register(): void {
        this._disposables.push(
            vscode.languages.registerCompletionItemProvider(
                [
                    { language: 'markdown' },
                    { language: 'plaintext' },
                    { language: 'git-commit' }
                ],
                this,
                '#',
                '@'
            )
        );
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | undefined> {
        if (!this._client.isConnected || !this._config.isConfigured) {
            return undefined;
        }

        const lineText = document.lineAt(position).text;
        const textBeforeCursor = lineText.substring(0, position.character);

        // Work item reference: AB#123 or #123
        if (/(?:AB)?#\d*$/.test(textBeforeCursor)) {
            return this._getWorkItemCompletions(token);
        }

        // User mention: @word
        if (/@\w*$/.test(textBeforeCursor)) {
            return this._getUserCompletions(token);
        }

        return undefined;
    }

    private async _getWorkItemCompletions(
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[]> {
        let scopes: { organization: string; project: string }[];
        try {
            scopes = await resolveProjectScopes(this._client, this._config);
        } catch {
            return [];
        }

        if (token.isCancellationRequested) { return []; }

        const allItems: vscode.CompletionItem[] = [];

        for (const scope of scopes) {
            const cacheKey = `${scope.organization}\0${scope.project}`;
            const cached = this._workItemCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                allItems.push(...cached.items);
                continue;
            }

            try {
                const workItems = await this._client.getWorkItems(scope.project, 'all', scope.organization);
                if (token.isCancellationRequested) { return []; }

                const items: vscode.CompletionItem[] = [];
                for (const wi of workItems) {
                    if (wi.id === undefined) { continue; }

                    const id = wi.id;
                    const title = (wi.fields?.['System.Title'] as string) ?? '';
                    const type = (wi.fields?.['System.WorkItemType'] as string) ?? '';
                    const state = (wi.fields?.['System.State'] as string) ?? '';

                    const item = new vscode.CompletionItem(
                        { label: `#${id}`, description: title },
                        vscode.CompletionItemKind.Reference
                    );
                    item.detail = type && state ? `${type} · ${state}` : undefined;
                    item.insertText = `#${id}`;
                    // filterText lets VS Code narrow the list as the user types digits or title words
                    item.filterText = `#${id} ${title}`;
                    item.documentation = new vscode.MarkdownString(`**#${id}** — ${title}\n\n*${type}* | ${state}`);
                    // Sort numerically so lower IDs appear first
                    item.sortText = String(id).padStart(10, '0');
                    items.push(item);
                }

                this._workItemCache.set(cacheKey, { items, timestamp: Date.now() });
                allItems.push(...items);
            } catch {
                // Degrade gracefully on API errors (e.g. not configured, network error)
            }
        }

        return allItems;
    }

    private async _getUserCompletions(
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[]> {
        let scopes: { organization: string; project: string }[];
        try {
            scopes = await resolveProjectScopes(this._client, this._config);
        } catch {
            return [];
        }

        if (token.isCancellationRequested) { return []; }

        const allItems: vscode.CompletionItem[] = [];
        // Track which (org, project) combinations we've already fetched to avoid
        // duplicate API calls when the same project appears under multiple orgs.
        const fetchedKeys = new Set<string>();

        for (const scope of scopes) {
            const cacheKey = `${scope.organization}\0${scope.project}`;
            if (fetchedKeys.has(cacheKey)) { continue; }
            fetchedKeys.add(cacheKey);

            const cached = this._userCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                allItems.push(...cached.items);
                continue;
            }

            try {
                const members = await this._client.listProjectTeamMembers(scope.project, scope.organization);
                if (token.isCancellationRequested) { return []; }

                const items: vscode.CompletionItem[] = [];
                for (const member of members) {
                    const displayName = member.displayName ?? '';
                    const uniqueName = member.uniqueName ?? '';
                    if (!displayName) { continue; }

                    const item = new vscode.CompletionItem(
                        { label: `@${displayName}`, description: uniqueName },
                        vscode.CompletionItemKind.User
                    );
                    item.insertText = `@${displayName}`;
                    // filterText enables matching by display name or email prefix
                    item.filterText = `@${displayName} ${uniqueName}`;
                    item.documentation = new vscode.MarkdownString(`**${displayName}**\n\n${uniqueName}`);
                    items.push(item);
                }

                this._userCache.set(cacheKey, { items, timestamp: Date.now() });
                allItems.push(...items);
            } catch {
                // Degrade gracefully on API errors
            }
        }

        return allItems;
    }

    dispose(): void {
        vscode.Disposable.from(...this._disposables).dispose();
        this._disposables.length = 0;
    }
}
