import * as vscode from 'vscode';
import type { WorkItem, WorkItemComment, Build } from '../api/adoClient';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';
import { buildSummaryData } from './buildSummaryHtml';
import { buildWebviewDocument, webviewAssetRoots } from './webviewHtml';
import type { WorkItemDetailsMessage, WorkItemDetailsViewModel } from './webviewTypes';

export interface WorkItemPanelScope {
    organization?: string;
    project?: string;
}

export function showWorkItemDetailsPanel(
    context: vscode.ExtensionContext,
    client: AdoClient,
    config: ConfigManager,
    workItem: WorkItem,
    scope: WorkItemPanelScope = {}
): Promise<void> {
    return WorkItemDetailsPanel.show(context, client, config, workItem, scope);
}

/** Parsed Azure DevOps artifact link extracted from a work item relation. */
interface LinkedItem {
    type: 'pr' | 'branch' | 'commit';
    label: string;
    /** https://dev.azure.com/… URL for opening in the browser. */
    webUrl: string;
}

/**
 * Renders a work item's details (title, description, fields, comment
 * discussion) in a VS Code webview panel.  The user can add comments
 * without leaving VS Code.
 */
export class WorkItemDetailsPanel {
    private static _panels = new Map<string, WorkItemDetailsPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _workItemId: number;
    private readonly _panelKey: string;
    private readonly _organization?: string;
    private readonly _project?: string;
    private _disposables: vscode.Disposable[] = [];
    private _allowedStates: string[] = [];
    private _linkedItems: LinkedItem[] = [];
    private _workItemTypeIconUrl: string | undefined;

    static async show(
        context: vscode.ExtensionContext,
        client: AdoClient,
        config: ConfigManager,
        workItem: WorkItem,
        scope: WorkItemPanelScope = {}
    ): Promise<void> {
        const id = workItem.id;
        if (typeof id !== 'number') {
            showErrorMessage(
                'Unable to show work item details because the work item ID is missing.'
            );
            return;
        }

        const key = WorkItemDetailsPanel.panelKey(
            id,
            scope.organization ?? client.organization ?? config.organization,
            scope.project ?? config.project
        );
        const existing = WorkItemDetailsPanel._panels.get(key);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            await existing._refresh(client, config, workItem);
            return;
        }
        new WorkItemDetailsPanel(context, client, config, workItem, id, key, scope);
    }

    private constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private _workItem: WorkItem,
        workItemId: number,
        panelKey: string,
        scope: WorkItemPanelScope
    ) {
        this._workItemId = workItemId;
        this._panelKey = panelKey;
        this._organization = scope.organization;
        this._project = scope.project;
        const id = this._workItemId;
        const title = (_workItem.fields?.['System.Title'] as string | undefined) ?? '';
        const wiType = (_workItem.fields?.['System.WorkItemType'] as string | undefined) ?? 'Work Item';

        this._panel = vscode.window.createWebviewPanel(
            'adoext.workItemDetails',
            `${wiType} #${id}: ${title}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: webviewAssetRoots(_context)
            }
        );

        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (msg) => this._handleMessage(msg),
            null,
            this._disposables
        );

        WorkItemDetailsPanel._panels.set(panelKey, this);
        void this._refresh(this._client, this._config, this._workItem);
    }

    private async _refresh(
        client: AdoClient,
        config: ConfigManager,
        workItem: WorkItem
    ): Promise<void> {
        this._workItem = workItem;
        const id = this._workItemId;
        const project = this._project ?? config.project;
        const organization = this._organization ?? client.organization ?? config.organization;

        if (!organization || !project) {
            showWarningMessage(
                'Unable to load work item details because the organization or project is missing.'
            );
            return;
        }

        let fullItem = workItem;
        let comments: WorkItemComment[] = [];

        try {
            const fetched = await client.getWorkItemById(project, id, organization);
            if (fetched) {
                fullItem = fetched;
                this._workItem = fullItem;
            }
        } catch (err) {
            showWarningMessage(
                `Failed to load the latest work item details: ${this._formatError(err)}`
            );
        }

        try {
            comments = await client.getWorkItemComments(project, id, organization);
        } catch (err) {
            showWarningMessage(
                `Failed to load work item comments: ${this._formatError(err)}`
            );
        }

        try {
            const workItemType = (fullItem.fields?.['System.WorkItemType'] as string | undefined) ?? '';
            this._allowedStates = workItemType
                ? await client.getWorkItemTypeStates(project, workItemType, organization)
                : [];
        } catch (err) {
            this._allowedStates = [];
            showWarningMessage(`Failed to load work item states: ${this._formatError(err)}`);
        }

        const workItemType = (fullItem.fields?.['System.WorkItemType'] as string | undefined) ?? '';
        this._workItemTypeIconUrl = this._bundledTypeIconUrl(workItemType);
        if (config.useRemoteWorkItemIcons) {
            try {
                if (workItemType) {
                    const iconUrls = await client.getWorkItemTypeIconUrls(project, organization);
                    this._workItemTypeIconUrl = this._sanitizeIconUrl(iconUrls.get(normalizeTypeName(workItemType)))
                        ?? this._workItemTypeIconUrl;
                }
            } catch {
                // Fall back to the bundled icon badge presentation in the webview.
            }
        }

        const repositoryNames = await this._resolveRepositoryNames(fullItem, project, organization);
        this._linkedItems = this._parseLinkedItems(fullItem, organization, project, repositoryNames);

        let builds: Build[] = [];
        try {
            builds = await client.getBuildsForWorkItem(project, fullItem, organization);
        } catch (err) {
            // show panel anyway, builds will just be empty
        }

        this._panel.webview.html = this._buildHtml(fullItem, comments, builds);
    }

    private async _handleMessage(msg: WorkItemDetailsMessage): Promise<void> {
        const id = this._workItemId;
        const project = this._project ?? this._config.project;
        const org = this._organization ?? this._client.organization ?? this._config.organization;
        const action = msg.type === 'addComment'
            ? 'Failed to add work item comment'
            : msg.type === 'setState'
                ? 'Failed to update work item state'
                : msg.type === 'openBuild'
                    ? 'Failed to open build'
                : msg.type === 'openLinkedItem'
                    ? 'Failed to open linked item'
                    : msg.type === 'startWorking'
                        ? 'Failed to start working on work item'
                        : 'Failed to open work item in browser';

        try {
            if (msg.type === 'addComment' && msg.content) {
                if (!org || !project) {
                    showWarningMessage(
                        'Unable to add comment because organization or project is missing.'
                    );
                    return;
                }
                await this._client.addWorkItemComment(project, id, msg.content, org);
                showInformationMessage('Comment added.');
                await this._refresh(this._client, this._config, this._workItem);
            } else if (msg.type === 'openInBrowser') {
                if (!org || !project) {
                    showWarningMessage(
                        'Unable to open work item in browser because organization or project is missing.'
                    );
                    return;
                }
                const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
                void vscode.env.openExternal(vscode.Uri.parse(url));
            } else if (msg.type === 'openBuild' && typeof msg.buildId === 'number') {
                if (!org || !project || msg.buildId <= 0) {
                    showWarningMessage(
                        'Unable to open build because organization, project, or build ID is missing.'
                    );
                    return;
                }
                const buildUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_build/results?buildId=${msg.buildId}`;
                void vscode.env.openExternal(vscode.Uri.parse(buildUrl));
            } else if (msg.type === 'setState' && msg.state) {
                if (!org || !project) {
                    showWarningMessage(
                        'Unable to update state because organization or project is missing.'
                    );
                    return;
                }
                await this._client.updateWorkItemState(project, id, msg.state, org);
                showInformationMessage(`Work item #${id} moved to ${msg.state}.`);
                void vscode.commands.executeCommand('adoext.refreshWorkItems');
                void vscode.commands.executeCommand('adoext.refreshBacklog');
                void vscode.commands.executeCommand('adoext.refreshSprints');
                void vscode.commands.executeCommand('adoext.refreshBoards');
                await this._refresh(this._client, this._config, this._workItem);
            } else if (msg.type === 'openLinkedItem' && msg.url) {
                // Only open https://dev.azure.com/ or https://*.visualstudio.com/ URLs
                const safeUrl = msg.url;
                if (
                    safeUrl.startsWith('https://dev.azure.com/') ||
                    /^https:\/\/[^/]+\.visualstudio\.com\//.test(safeUrl)
                ) {
                    void vscode.env.openExternal(vscode.Uri.parse(safeUrl));
                }
            } else if (msg.type === 'startWorking') {
                await vscode.commands.executeCommand(
                    'adoext.startWorkingOnWorkItem',
                    this._workItem,
                    org,
                    project
                );
            }
        } catch (err) {
            showErrorMessage(`${action}: ${this._formatError(err)}`);
        }
    }

    private _buildHtml(item: WorkItem, comments: WorkItemComment[], builds: Build[] = []): string {
        const data = this._buildViewModel(item, comments, builds);
        return buildWebviewDocument(this._context, this._panel.webview, {
            title: `${data.workItemType} #${data.id}`,
            entry: 'workItemDetails.js',
            appTag: 'ado-work-item-details-app',
            data,
            cspExtra: "img-src https: data: https://*.dev.azure.com https://*.visualstudio.com;"
        });
    }

    private _buildViewModel(
        item: WorkItem,
        comments: WorkItemComment[],
        builds: Build[]
    ): WorkItemDetailsViewModel {
        const id = item.id ?? 0;
        const f = item.fields ?? {};
        const title = (f['System.Title'] as string | undefined) ?? '';
        const workItemType = (f['System.WorkItemType'] as string | undefined) ?? 'Work Item';
        const state = (f['System.State'] as string | undefined) ?? '';
        const assignedTo = this._identityName(f['System.AssignedTo']) ?? 'Unassigned';
        const createdBy = this._identityName(f['System.CreatedBy']) ?? 'Unknown';
        const createdDate = this._formatDate(f['System.CreatedDate'] as string | Date | undefined);
        const changedDate = this._formatDate(f['System.ChangedDate'] as string | Date | undefined);
        const areaPath = (f['System.AreaPath'] as string | undefined) ?? '';
        const iterationPath = (f['System.IterationPath'] as string | undefined) ?? '';
        const tags = (f['System.Tags'] as string | undefined) ?? '';
        const priority = f['Microsoft.VSTS.Common.Priority'] as number | undefined;
        const descriptionHtml = (f['System.Description'] as string | undefined) ?? '';

        const metaRows = [
            ['Assigned To', assignedTo],
            ['Created By', createdBy],
            ['Created', createdDate],
            ['Last Updated', changedDate],
            areaPath ? ['Area Path', areaPath] : undefined,
            iterationPath ? ['Iteration', iterationPath] : undefined,
            tags ? ['Tags', tags] : undefined,
        ].filter((row): row is [string, string] => !!row);

        return {
            id,
            title,
            workItemType,
            workItemTypeIconUrl: this._workItemTypeIconUrl,
            state,
            stateColor: this._stateColor(state),
            priority,
            allowedStates: this._allowedStateList(state),
            metaRows: metaRows.map(([label, value]) => ({ label, value })),
            descriptionHtml,
            linkedItems: this._linkedItems.map(item => ({ ...item })),
            builds: builds.map(buildSummaryData),
            comments: comments.map(comment => ({
                author: this._identityName(comment.createdBy) ?? 'Unknown',
                date: this._formatDate(comment.createdDate),
                html: comment.renderedText ?? comment.text ?? '',
                isPlainText: !comment.renderedText
            }))
        };
    }

    private _identityName(value: unknown): string | undefined {
        if (!value) { return undefined; }
        if (typeof value === 'string') { return value; }
        if (typeof value === 'object' && value !== null) {
            const obj = value as Record<string, unknown>;
            return (obj['displayName'] as string | undefined) ?? (obj['uniqueName'] as string | undefined);
        }
        return undefined;
    }

    private _formatDate(value: string | Date | undefined): string {
        if (!value) { return ''; }
        try {
            return new Date(value).toLocaleDateString();
        } catch {
            return '';
        }
    }

    private _formatError(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }

    private _sanitizeIconUrl(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }
        try {
            const uri = vscode.Uri.parse(value);
            return uri.scheme === 'https' ? uri.toString(true) : undefined;
        } catch {
            return undefined;
        }
    }

    private _bundledTypeIconUrl(workItemType: string): string | undefined {
        const fileName = bundledTypeIconFile(workItemType);
        if (!fileName) {
            return undefined;
        }
        const uri = vscode.Uri.joinPath(this._context.extensionUri, 'media', 'icons', 'workitems', fileName);
        return this._panel.webview.asWebviewUri(uri).toString(true);
    }

    private _stateColor(state: string): string {
        switch (state.toLowerCase()) {
            case 'active':
            case 'in progress':
                return 'var(--vscode-charts-blue)';
            case 'new':
                return 'var(--vscode-charts-purple)';
            case 'resolved':
            case 'closed':
            case 'done':
                return 'var(--vscode-charts-green)';
            case 'blocked':
            case 'removed':
                return 'var(--vscode-charts-red)';
            default:
                return 'var(--vscode-foreground)';
        }
    }

    private _allowedStateList(currentState: string): string[] {
        const states = this._allowedStates.includes(currentState) || !currentState
            ? this._allowedStates
            : [currentState, ...this._allowedStates];
        return [...new Set(states.filter(Boolean))];
    }

    private _parseGitArtifactLink(
        relation: { rel?: string; url?: string }
    ): { artifactType: string; repoId: string; identifier: string } | undefined {
        if (relation.rel !== 'ArtifactLink') { return undefined; }
        const vstfsUrl = relation.url ?? '';
        if (!vstfsUrl.startsWith('vstfs:///Git/')) { return undefined; }

        const withoutPrefix = vstfsUrl.slice('vstfs:///Git/'.length);
        const slashIdx = withoutPrefix.indexOf('/');
        if (slashIdx === -1) { return undefined; }

        const artifactType = withoutPrefix.slice(0, slashIdx);
        const encodedPath = withoutPrefix.slice(slashIdx + 1);
        const parts = encodedPath.split(/%2F/i).map(part => {
            try { return decodeURIComponent(part); } catch {
                return part;
            }
        });
        if (parts.length < 3) { return undefined; }

        const [, repoId, ...rest] = parts;
        return {
            artifactType,
            repoId,
            identifier: rest.join('/')
        };
    }

    private async _resolveRepositoryNames(
        workItem: WorkItem,
        project: string,
        organization: string
    ): Promise<Map<string, string>> {
        const repositoryIds = new Set<string>();
        const relations = workItem.relations ?? [];

        for (const relation of relations) {
            const artifact = this._parseGitArtifactLink(relation as { rel?: string; url?: string });
            if (!artifact) { continue; }
            repositoryIds.add(artifact.repoId);
        }

        const names = new Map<string, string>();
        await Promise.all(
            Array.from(repositoryIds).map(async repositoryId => {
                try {
                    const repositoryName = await this._client.getRepositoryName(project, repositoryId, organization);
                    if (repositoryName) {
                        names.set(repositoryId, repositoryName);
                    }
                } catch {
                    // Fall back to the raw repo identifier when name lookup fails.
                }
            })
        );
        return names;
    }

    private _parseLinkedItems(
        workItem: WorkItem,
        organization: string,
        project: string,
        repositoryNames: Map<string, string>
    ): LinkedItem[] {
        const items: LinkedItem[] = [];
        const relations = workItem.relations ?? [];

        for (const relation of relations) {
            const artifact = this._parseGitArtifactLink(relation as { rel?: string; url?: string });
            if (!artifact) { continue; }

            const { artifactType, repoId, identifier } = artifact;
            const repository = repositoryNames.get(repoId) ?? repoId;

            if (artifactType === 'PullRequestId') {
                const prId = parseInt(identifier, 10);
                if (!isFinite(prId)) { continue; }
                const webUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repository)}/pullrequest/${prId}`;
                items.push({ type: 'pr', label: `Pull Request #${prId}`, webUrl });
            } else if (artifactType === 'Ref') {
                // Branch names carry a 'GB' prefix (GB = Git Branch)
                const branchName = identifier.startsWith('GB') ? identifier.slice(2) : identifier;
                const webUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repository)}?version=GB${encodeURIComponent(branchName)}`;
                items.push({ type: 'branch', label: `Branch: ${branchName}`, webUrl });
            } else if (artifactType === 'Commit') {
                const shortId = identifier.slice(0, 8);
                const webUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repository)}/commit/${encodeURIComponent(identifier)}`;
                items.push({ type: 'commit', label: `Commit: ${shortId}`, webUrl });
            }
        }

        return items;
    }

    private _dispose(): void {
        WorkItemDetailsPanel._panels.delete(this._panelKey);
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }

    private static panelKey(id: number, organization?: string, project?: string): string {
        return JSON.stringify([organization ?? null, project ?? null, id]);
    }
}

function normalizeTypeName(value: string): string {
    return value.trim().toLowerCase();
}

function bundledTypeIconFile(workItemType: string): string | undefined {
    switch (normalizeTypeName(workItemType)) {
        case 'bug':
            return 'bug.svg';
        case 'task':
            return 'task.svg';
        case 'epic':
            return 'epic.svg';
        case 'feature':
            return 'feature.svg';
        case 'user story':
            return 'user-story.svg';
        case 'product backlog item':
        case 'pbi':
            return 'product-backlog-item.svg';
        case 'issue':
            return 'issue.svg';
        default:
            return undefined;
    }
}
