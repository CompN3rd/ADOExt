import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import {
    resolveProjectScopes,
    scopeKey,
    scopeLabel,
    type ProjectScope
} from './projectScopes';
import type { AuthRecoveryHandler } from '../utils/authRecovery';
import { handleProviderError } from './providerErrors';

interface WikiSummary {
    id: string;
    name: string;
    remoteUrl?: string;
}

interface WikiPageSummary {
    id?: number;
    path: string;
}

interface WikiTreeEntry {
    segment: string;
    path: string;
    isPage: boolean;
    children: Map<string, WikiTreeEntry>;
}

interface WikiTreeCache {
    wiki: WikiSummary;
    root: WikiTreeEntry;
    entryByPath: Map<string, WikiTreeEntry>;
    fetchedAt: number;
}

export class WikiScopeNode extends vscode.TreeItem {
    constructor(public readonly scope: ProjectScope) {
        super(scopeLabel(scope), vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('project');
        this.contextValue = 'wikiScope';
    }
}

export class WikiNode extends vscode.TreeItem {
    constructor(
        public readonly scope: ProjectScope,
        public readonly wiki: WikiSummary
    ) {
        super(wiki.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('book');
        this.contextValue = 'wiki';
        this.tooltip = [
            `Wiki: ${wiki.name}`,
            `Project: ${scopeLabel(scope)}`
        ].join('\n');
    }
}

export class WikiPageNode extends vscode.TreeItem {
    constructor(
        public readonly scope: ProjectScope,
        public readonly wiki: WikiSummary,
        public readonly path: string,
        public readonly isPage: boolean,
        hasChildren: boolean
    ) {
        super(
            path === '/' ? 'Home' : path.split('/').filter(Boolean).slice(-1)[0] ?? path,
            hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        this.description = path === '/' ? '/' : undefined;
        this.iconPath = path === '/'
            ? new vscode.ThemeIcon('home')
            : isPage
                ? new vscode.ThemeIcon('file-text')
                : new vscode.ThemeIcon('folder');

        this.contextValue = isPage ? 'wikiPage' : 'wikiFolder';
        this.tooltip = [
            `${isPage ? 'Page' : 'Folder'}: ${path}`,
            `Wiki: ${wiki.name}`,
            `Project: ${scopeLabel(scope)}`
        ].join('\n');

        if (isPage) {
            this.command = {
                command: 'adoext.viewWikiPage',
                title: 'View Wiki Page',
                arguments: [this]
            };
        }
    }
}

type WikiTreeNode =
    | WikiScopeNode
    | WikiNode
    | WikiPageNode
    | vscode.TreeItem;

export class WikiProvider implements vscode.TreeDataProvider<WikiTreeNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<WikiTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _loading = false;
    private _searchQuery = '';
    private readonly _wikiCache = new Map<string, { wikis: WikiSummary[]; fetchedAt: number }>();
    private readonly _wikiTreeCache = new Map<string, WikiTreeCache>();

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager,
        private readonly onAuthError?: AuthRecoveryHandler
    ) {}

    refresh(): void {
        this._wikiCache.clear();
        this._wikiTreeCache.clear();
        this._onDidChangeTreeData.fire();
    }

    setSearchQuery(query: string): void {
        this._searchQuery = query.trim();
        void vscode.commands.executeCommand('setContext', 'adoext.wikiHasSearch', Boolean(this._searchQuery));
        this._onDidChangeTreeData.fire();
    }

    clearSearchQuery(): void {
        this.setSearchQuery('');
    }

    getTreeItem(element: WikiTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WikiTreeNode): Promise<WikiTreeNode[]> {
        if (element instanceof WikiScopeNode) {
            return this.getScopeChildren(element.scope);
        }

        if (element instanceof WikiNode) {
            return this.getWikiChildren(element.scope, element.wiki);
        }

        if (element instanceof WikiPageNode) {
            return this.getWikiPageChildren(element);
        }

        if (this._loading) {
            return [];
        }
        this._loading = true;

        try {
            const setupNode = this.getSetupNode();
            if (setupNode) {
                return [setupNode];
            }

            const scopes = await resolveProjectScopes(this.client, this.config);
            if (scopes.length === 0) {
                return [this.createConfigureNode()];
            }

            const nodes: WikiTreeNode[] = scopes
                .map(scope => new WikiScopeNode(scope))
                .sort((left, right) => `${left.label}`.localeCompare(`${right.label}`));

            if (this._searchQuery) {
                const filterNode = new vscode.TreeItem(`Filter: ${this._searchQuery}`, vscode.TreeItemCollapsibleState.None);
                filterNode.iconPath = new vscode.ThemeIcon('filter');
                filterNode.command = { command: 'adoext.clearWikiSearch', title: 'Clear Wiki Search' };
                nodes.unshift(filterNode);
            }

            return nodes;
        } catch (err) {
            return handleProviderError(err, 'wiki', this.onAuthError);
        } finally {
            this._loading = false;
        }
    }

    private async getScopeChildren(scope: ProjectScope): Promise<WikiTreeNode[]> {
        const key = scopeKey(scope);
        const cached = this._wikiCache.get(key);
        if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
            return cached.wikis.length > 0
                ? cached.wikis.map(wiki => new WikiNode(scope, wiki))
                : [this.infoNode('No wikis found')];
        }

        try {
            const wikis = await this.client.listWikis(scope.project, scope.organization);
            const normalized = (wikis ?? [])
                .filter(wiki => wiki.id && wiki.name && !wiki.isDisabled)
                .map(wiki => ({
                    id: wiki.id!,
                    name: wiki.name!,
                    ...(wiki.remoteUrl ? { remoteUrl: wiki.remoteUrl } : {})
                }))
                .sort((left, right) => left.name.localeCompare(right.name));

            this._wikiCache.set(key, { wikis: normalized, fetchedAt: Date.now() });

            if (normalized.length === 0) {
                return [this.infoNode('No wikis found')];
            }
            return normalized.map(wiki => new WikiNode(scope, wiki));
        } catch (err) {
            return handleProviderError(err, `wiki.scope.${key}`, this.onAuthError);
        }
    }

    private async getWikiChildren(scope: ProjectScope, wiki: WikiSummary): Promise<WikiTreeNode[]> {
        let cache: WikiTreeCache | undefined;
        try {
            cache = await this.getWikiTree(scope, wiki);
        } catch (err) {
            return handleProviderError(err, `wiki.pages.${this.wikiTreeCacheKey(scope, wiki.id)}`, this.onAuthError);
        }

        if (!cache) {
            return [this.infoNode('No pages found')];
        }
        const query = this._searchQuery.toLowerCase();
        const children: WikiTreeNode[] = [];

        const root = cache.root;
        if (root.isPage && this.matchesFilter('/', query)) {
            children.push(new WikiPageNode(scope, wiki, '/', true, root.children.size > 0));
        } else if (root.isPage && query) {
            // Root page exists but doesn't match query; only include if any child matches.
            const hasMatchingChild = [...root.children.values()].some(entry => this.entryMatches(entry, query));
            if (hasMatchingChild) {
                children.push(new WikiPageNode(scope, wiki, '/', true, root.children.size > 0));
            }
        } else if (root.isPage) {
            children.push(new WikiPageNode(scope, wiki, '/', true, root.children.size > 0));
        }

        for (const entry of [...root.children.values()].sort((a, b) => a.segment.localeCompare(b.segment))) {
            if (query && !this.entryMatches(entry, query)) {
                continue;
            }
            children.push(new WikiPageNode(scope, wiki, entry.path, entry.isPage, entry.children.size > 0));
        }

        return children.length > 0 ? children : [this.infoNode('No pages found')];
    }

    private async getWikiPageChildren(node: WikiPageNode): Promise<WikiTreeNode[]> {
        const cacheKey = this.wikiTreeCacheKey(node.scope, node.wiki.id);
        const cache = this._wikiTreeCache.get(cacheKey);
        if (!cache) {
            return [];
        }

        const entry = cache.entryByPath.get(node.path);
        if (!entry || entry.children.size === 0) {
            return [];
        }

        const query = this._searchQuery.toLowerCase();
        return [...entry.children.values()]
            .sort((a, b) => a.segment.localeCompare(b.segment))
            .filter(child => !query || this.entryMatches(child, query))
            .map(child => new WikiPageNode(node.scope, node.wiki, child.path, child.isPage, child.children.size > 0));
    }

    private async getWikiTree(scope: ProjectScope, wiki: WikiSummary): Promise<WikiTreeCache | undefined> {
        const key = this.wikiTreeCacheKey(scope, wiki.id);
        const cached = this._wikiTreeCache.get(key);
        if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
            return cached;
        }

        const pages = await this.loadWikiPages(scope, wiki.id);
        if (pages.length === 0) {
            return undefined;
        }

        const tree = this.buildWikiTree(pages);
        const cache: WikiTreeCache = {
            wiki,
            root: tree.root,
            entryByPath: tree.entryByPath,
            fetchedAt: Date.now()
        };
        this._wikiTreeCache.set(key, cache);
        return cache;
    }

    private async loadWikiPages(scope: ProjectScope, wikiIdentifier: string): Promise<WikiPageSummary[]> {
        const pages = await this.client.listWikiPages(scope.project, wikiIdentifier, scope.organization);
        return dedupePages(
            (pages ?? [])
                .filter(page => typeof page.path === 'string' && page.path.trim())
                .map(page => ({
                    ...(typeof page.id === 'number' ? { id: page.id } : {}),
                    path: normalizeWikiPath(page.path!)
                }))
        );
    }

    private buildWikiTree(pages: WikiPageSummary[]): { root: WikiTreeEntry; entryByPath: Map<string, WikiTreeEntry> } {
        const root: WikiTreeEntry = { segment: '', path: '/', isPage: false, children: new Map() };
        const entryByPath = new Map<string, WikiTreeEntry>([['/', root]]);

        for (const page of pages) {
            const normalized = normalizeWikiPath(page.path);
            const segments = normalized.split('/').filter(Boolean);
            if (segments.length === 0) {
                root.isPage = true;
                continue;
            }

            let current = root;
            let currentPath = '';
            for (const segment of segments) {
                currentPath += `/${segment}`;
                let entry = current.children.get(segment);
                if (!entry) {
                    entry = { segment, path: currentPath, isPage: false, children: new Map() };
                    current.children.set(segment, entry);
                    entryByPath.set(currentPath, entry);
                }
                current = entry;
            }
            current.isPage = true;
        }

        return { root, entryByPath };
    }

    private entryMatches(entry: WikiTreeEntry, query: string): boolean {
        if (!query) {
            return true;
        }
        if (this.matchesFilter(entry.segment, query) || this.matchesFilter(entry.path, query)) {
            return true;
        }
        for (const child of entry.children.values()) {
            if (this.entryMatches(child, query)) {
                return true;
            }
        }
        return false;
    }

    private matchesFilter(text: string, queryLower: string): boolean {
        if (!queryLower) {
            return true;
        }
        return text.toLowerCase().includes(queryLower);
    }

    private getSetupNode(): vscode.TreeItem | undefined {
        if (!this.config.enableWikiView) {
            const node = new vscode.TreeItem('Enable the Wiki view in settings to browse wiki pages.', vscode.TreeItemCollapsibleState.None);
            node.iconPath = new vscode.ThemeIcon('info');
            return node;
        }

        if (!this.client.isConnected) {
            const node = new vscode.TreeItem('Sign in to Azure DevOps...', vscode.TreeItemCollapsibleState.None);
            node.command = { command: 'adoext.signIn', title: 'Sign In' };
            node.iconPath = new vscode.ThemeIcon('sign-in');
            return node;
        }

        if (!this.config.isConfigured) {
            return this.createConfigureNode();
        }

        return undefined;
    }

    private createConfigureNode(): vscode.TreeItem {
        const node = new vscode.TreeItem('Configure organizations and projects...', vscode.TreeItemCollapsibleState.None);
        node.command = { command: 'adoext.selectOrganization', title: 'Select Organizations' };
        node.iconPath = new vscode.ThemeIcon('settings-gear');
        return node;
    }

    private infoNode(label: string): vscode.TreeItem {
        const node = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        node.iconPath = new vscode.ThemeIcon('info');
        return node;
    }

    private wikiTreeCacheKey(scope: ProjectScope, wikiId: string): string {
        return `${scopeKey(scope)}\u0000${wikiId}`;
    }
}

function normalizeWikiPath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) {
        return '/';
    }
    if (trimmed === '/') {
        return '/';
    }
    return trimmed.startsWith('/') ? trimmed.replace(/\/+$/g, '') : `/${trimmed.replace(/\/+$/g, '')}`;
}

function dedupePages(pages: WikiPageSummary[]): WikiPageSummary[] {
    const seen = new Set<string>();
    const deduped: WikiPageSummary[] = [];
    for (const page of pages) {
        const path = normalizeWikiPath(page.path);
        if (seen.has(path)) {
            continue;
        }
        seen.add(path);
        deduped.push({ ...page, path });
    }
    return deduped;
}
