import * as vscode from 'vscode';
import { AdoClient } from '../api/adoClient';
import { ConfigManager } from '../config/configManager';
import { resolveProjectScopes } from './projectScopes';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Number of digits used when padding work item IDs for lexicographic sort.
 * Supports IDs up to 9,999,999,999 which exceeds any real-world ADO project.
 */
const WORK_ITEM_ID_SORT_PAD_LENGTH = 10;

interface CacheEntry<T> {
    items: T[];
    timestamp: number;
}

interface CachedWorkItem {
    id: number;
    title: string;
    type: string;
    state: string;
}

interface CachedUser {
    displayName: string;
    uniqueName: string;
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
    private readonly _workItemCache = new Map<string, CacheEntry<CachedWorkItem>>();
    private readonly _userCache = new Map<string, CacheEntry<CachedUser>>();
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

        // Work item reference: AB#123 or #123.
        // 'AB' (Azure Boards) is the standard ADO work-item prefix used in rich
        // text and commit messages; plain '#NNN' references are also widely used.
        const workItemMatch = textBeforeCursor.match(/(?:AB)?#\d*$/);
        if (workItemMatch) {
            return this._getWorkItemCompletions(document, position, workItemMatch[0], token);
        }

        // User mention: @word
        const userMentionMatch = textBeforeCursor.match(/@\w*$/);
        if (userMentionMatch) {
            return this._getUserCompletions(document, position, userMentionMatch[0], token);
        }

        return undefined;
    }

    private async _getWorkItemCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        typedReference: string,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[]> {
        let scopes: { organization: string; project: string }[];
        try {
            scopes = await resolveProjectScopes(this._client, this._config);
        } catch {
            return [];
        }

        if (token.isCancellationRequested) { return []; }

        const replacementRange = this._createReplacementRange(position, typedReference);
        const allItems: vscode.CompletionItem[] = [];

        for (const scope of scopes) {
            const cacheKey = `${scope.organization}\0${scope.project}`;
            const cached = this._workItemCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                allItems.push(...this._buildWorkItemCompletionItems(cached.items, replacementRange, typedReference));
                continue;
            }

            try {
                const workItems = await this._client.getRecentWorkItems(scope.project, scope.organization);
                if (token.isCancellationRequested) { return []; }

                const items: CachedWorkItem[] = [];
                for (const wi of workItems) {
                    if (wi.id === undefined) { continue; }

                    items.push({
                        id: wi.id,
                        title: (wi.fields?.['System.Title'] as string) ?? '',
                        type: (wi.fields?.['System.WorkItemType'] as string) ?? '',
                        state: (wi.fields?.['System.State'] as string) ?? ''
                    });
                }

                this._workItemCache.set(cacheKey, { items, timestamp: Date.now() });
                allItems.push(...this._buildWorkItemCompletionItems(items, replacementRange, typedReference));
            } catch {
                // Degrade gracefully on API errors (e.g. not configured, network error)
            }
        }

        return allItems;
    }

    private async _getUserCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        typedMention: string,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[]> {
        let scopes: { organization: string; project: string }[];
        try {
            scopes = await resolveProjectScopes(this._client, this._config);
        } catch {
            return [];
        }

        if (token.isCancellationRequested) { return []; }

        const replacementRange = this._createReplacementRange(position, typedMention);
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
                allItems.push(...this._buildUserCompletionItems(cached.items, replacementRange));
                continue;
            }

            try {
                const members = await this._client.listProjectTeamMembers(scope.project, scope.organization);
                if (token.isCancellationRequested) { return []; }

                const items: CachedUser[] = [];
                for (const member of members) {
                    const displayName = member.displayName ?? '';
                    const uniqueName = member.uniqueName ?? '';
                    if (!displayName) { continue; }

                    items.push({ displayName, uniqueName });
                }

                this._userCache.set(cacheKey, { items, timestamp: Date.now() });
                allItems.push(...this._buildUserCompletionItems(items, replacementRange));
            } catch {
                // Degrade gracefully on API errors
            }
        }

        return allItems;
    }

    private _createReplacementRange(
        position: vscode.Position,
        typedText: string
    ): vscode.Range {
        return new vscode.Range(
            new vscode.Position(position.line, position.character - typedText.length),
            position
        );
    }

    private _buildWorkItemCompletionItems(
        workItems: CachedWorkItem[],
        replacementRange: vscode.Range,
        typedReference: string
    ): vscode.CompletionItem[] {
        const insertText = typedReference.startsWith('AB#')
            ? (id: number) => `AB#${id}`
            : (id: number) => `#${id}`;

        return workItems.map(wi => {
            const item = new vscode.CompletionItem(
                { label: `#${wi.id}`, description: wi.title },
                vscode.CompletionItemKind.Reference
            );
            item.detail = wi.type && wi.state ? `${wi.type} · ${wi.state}` : undefined;
            item.insertText = insertText(wi.id);
            item.range = replacementRange;
            // Include both #id and AB#id so either typed prefix keeps items visible.
            item.filterText = `#${wi.id} AB#${wi.id} ${wi.title}`;
            item.documentation = new vscode.MarkdownString(`**#${wi.id}** — ${wi.title}\n\n*${wi.type}* | ${wi.state}`);
            item.sortText = String(wi.id).padStart(WORK_ITEM_ID_SORT_PAD_LENGTH, '0');
            return item;
        });
    }

    private _buildUserCompletionItems(users: CachedUser[], replacementRange: vscode.Range): vscode.CompletionItem[] {
        return users.map(user => {
            const item = new vscode.CompletionItem(
                { label: `@${user.displayName}`, description: user.uniqueName },
                vscode.CompletionItemKind.User
            );
            item.insertText = `@${user.displayName}`;
            item.range = replacementRange;
            item.filterText = `@${user.displayName} ${user.uniqueName}`;
            item.documentation = new vscode.MarkdownString(`**${user.displayName}**\n\n${user.uniqueName}`);
            return item;
        });
    }

    dispose(): void {
        vscode.Disposable.from(...this._disposables).dispose();
        this._disposables.length = 0;
    }
}
