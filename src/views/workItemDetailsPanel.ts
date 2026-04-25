import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { WorkItem, WorkItemComment } from '../api/adoClient';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';

/**
 * Renders a work item's details (title, description, fields, comment
 * discussion) in a VS Code webview panel.  The user can add comments
 * without leaving VS Code.
 */
export class WorkItemDetailsPanel {
    private static _panels = new Map<number, WorkItemDetailsPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    static async show(
        context: vscode.ExtensionContext,
        client: AdoClient,
        config: ConfigManager,
        workItem: WorkItem
    ): Promise<void> {
        const id = workItem.id!;
        const existing = WorkItemDetailsPanel._panels.get(id);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            await existing._refresh(client, config, workItem);
            return;
        }
        new WorkItemDetailsPanel(context, client, config, workItem);
    }

    private constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private _workItem: WorkItem
    ) {
        const id = _workItem.id!;
        const title = (_workItem.fields?.['System.Title'] as string | undefined) ?? '';
        const wiType = (_workItem.fields?.['System.WorkItemType'] as string | undefined) ?? 'Work Item';

        this._panel = vscode.window.createWebviewPanel(
            'adoext.workItemDetails',
            `${wiType} #${id}: ${title}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (msg) => this._handleMessage(msg),
            null,
            this._disposables
        );

        WorkItemDetailsPanel._panels.set(id, this);
        void this._refresh(this._client, this._config, this._workItem);
    }

    private async _refresh(
        client: AdoClient,
        config: ConfigManager,
        workItem: WorkItem
    ): Promise<void> {
        this._workItem = workItem;
        const id = workItem.id!;

        let fullItem = workItem;
        let comments: WorkItemComment[] = [];

        try {
            const fetched = await client.getWorkItemById(config.project, id);
            if (fetched) {
                fullItem = fetched;
                this._workItem = fullItem;
            }
        } catch {
            // Use the item we already have
        }

        try {
            comments = await client.getWorkItemComments(config.project, id);
        } catch {
            // Show panel without comments
        }

        this._panel.webview.html = this._buildHtml(fullItem, comments);
    }

    private async _handleMessage(msg: {
        type: string;
        content?: string;
    }): Promise<void> {
        const id = this._workItem.id!;
        const project = this._config.project;

        try {
            if (msg.type === 'addComment' && msg.content) {
                await this._client.addWorkItemComment(project, id, msg.content);
                vscode.window.showInformationMessage('Comment added.');
                await this._refresh(this._client, this._config, this._workItem);
            } else if (msg.type === 'openInBrowser') {
                const org = this._client.organization ?? this._config.organization;
                if (!org || !project) {
                    vscode.window.showWarningMessage(
                        'Unable to open work item in browser because organization or project is missing.'
                    );
                    return;
                }
                const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
                void vscode.env.openExternal(vscode.Uri.parse(url));
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Error: ${err}`);
        }
    }

    private _buildHtml(item: WorkItem, comments: WorkItemComment[]): string {
        const webview = this._panel.webview;
        const nonce = this._createNonce();
        const id = item.id ?? 0;
        const f = item.fields ?? {};

        const title = this._esc((f['System.Title'] as string | undefined) ?? '');
        const wiType = this._esc((f['System.WorkItemType'] as string | undefined) ?? 'Work Item');
        const state = this._esc((f['System.State'] as string | undefined) ?? '');
        const assignedTo = this._esc(this._identityName(f['System.AssignedTo']) ?? 'Unassigned');
        const createdBy = this._esc(this._identityName(f['System.CreatedBy']) ?? 'Unknown');
        const createdDate = this._formatDate(f['System.CreatedDate'] as string | Date | undefined);
        const changedDate = this._formatDate(f['System.ChangedDate'] as string | Date | undefined);
        const areaPath = this._esc((f['System.AreaPath'] as string | undefined) ?? '');
        const iterationPath = this._esc((f['System.IterationPath'] as string | undefined) ?? '');
        const tags = this._esc((f['System.Tags'] as string | undefined) ?? '');
        const priority = f['Microsoft.VSTS.Common.Priority'] as number | undefined;
        const description = (f['System.Description'] as string | undefined) ?? '';

        const stateColor = this._stateColor(state);
        const priorityHtml = priority !== undefined
            ? `<span class="badge priority-${priority}">P${priority}</span>`
            : '';

        const descriptionHtml = description
            ? `<pre class="description-text">${this._htmlToText(description)}</pre>`
            : '<em class="empty">No description provided.</em>';

        const commentsHtml = comments.length === 0
            ? '<p class="empty">No comments yet.</p>'
            : comments.map(c => this._buildCommentHtml(c)).join('');

        const metaRows = [
            ['Assigned To', assignedTo],
            ['Created By', createdBy],
            ['Created', createdDate],
            ['Last Updated', changedDate],
            areaPath ? ['Area Path', areaPath] : null,
            iterationPath ? ['Iteration', iterationPath] : null,
            tags ? ['Tags', tags] : null,
        ].filter(Boolean) as [string, string][];

        const metaHtml = metaRows
            .map(([label, value]) => `<tr><td class="meta-label">${label}</td><td>${value}</td></tr>`)
            .join('');

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>${wiType} #${id}</title>
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; margin: 0; }
  h1 { font-size: 1.3em; margin-bottom: 4px; }
  h2 { font-size: 1em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; margin-bottom: 8px; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
  .meta { margin-bottom: 16px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; font-weight: 600; margin-right: 6px; }
  .badge-type { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .badge-state { background: ${stateColor}22; color: ${stateColor}; border: 1px solid ${stateColor}55; }
  .priority-1 { background: #c84b3222; color: #c84b32; border: 1px solid #c84b3255; }
  .priority-2 { background: #e8a33522; color: #e8a335; border: 1px solid #e8a33555; }
  .priority-3 { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .priority-4 { background: var(--vscode-badge-background); color: var(--vscode-descriptionForeground); }
  .meta-table { border-collapse: collapse; margin-top: 8px; }
  .meta-table td { padding: 3px 12px 3px 0; vertical-align: top; }
  .meta-label { color: var(--vscode-descriptionForeground); font-size: 0.9em; white-space: nowrap; min-width: 110px; }
  .section { margin-bottom: 20px; }
  .description { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); padding: 10px 14px; border-radius: 0 4px 4px 0; line-height: 1.6; }
  .description-text { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; font-size: inherit; }
  .comment { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 10px; padding: 10px; }
  .comment-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .comment-author { font-weight: bold; font-size: 0.9em; }
  .comment-date { color: var(--vscode-descriptionForeground); font-size: 0.8em; }
  .comment-text { white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  .new-comment-form { display: flex; flex-direction: column; gap: 6px; }
  .reply-input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 6px 8px; font-family: inherit; font-size: inherit; resize: vertical; min-height: 60px; width: 100%; box-sizing: border-box; }
  .btn { padding: 4px 12px; border-radius: 3px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; font-size: 0.85em; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
</style>
</head>
<body>
<div class="toolbar">
  <button class="btn btn-secondary" data-action="open-browser">Open in Browser</button>
</div>

<h1>
  <span class="badge badge-type">${wiType}</span>
  <span class="badge badge-state">${state}</span>
  ${priorityHtml}
  #${id}: ${title}
</h1>

<div class="section meta">
  <table class="meta-table">
    ${metaHtml}
  </table>
</div>

<div class="section">
  <h2>Description</h2>
  <div class="description">${descriptionHtml}</div>
</div>

<div class="section">
  <h2>Comments (${comments.length})</h2>
  ${commentsHtml}
</div>

<div class="section">
  <h2>Add Comment</h2>
  <div class="new-comment-form">
    <textarea id="newCommentInput" class="reply-input" rows="4" placeholder="Write a comment…"></textarea>
    <div><button class="btn btn-primary" data-action="add-comment">Add Comment</button></div>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

document.querySelector('[data-action="open-browser"]')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openInBrowser' });
});

document.querySelector('[data-action="add-comment"]')?.addEventListener('click', () => {
    const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('newCommentInput'));
    const content = input.value.trim();
    if (!content) { return; }
    vscode.postMessage({ type: 'addComment', content });
    input.value = '';
});
</script>
</body>
</html>`;
    }

    private _buildCommentHtml(comment: WorkItemComment): string {
        const author = this._esc(
            (comment.createdBy as { displayName?: string } | undefined)?.displayName ?? 'Unknown'
        );
        const date = this._formatDate(comment.createdDate);
        const text = this._esc(comment.text ?? '');
        return `
<div class="comment">
  <div class="comment-header">
    <span class="comment-author">${author}</span>
    <span class="comment-date">${date}</span>
  </div>
  <div class="comment-text">${text}</div>
</div>`;
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

    /**
     * Convert HTML (from ADO work item description) to safe text for direct
     * insertion into a webview `<pre>` element.
     *
     * The input is HTML-escaped first (the primary security boundary), then
     * escaped block-level elements are converted to newlines for basic
     * readability, and remaining escaped tags are removed.  Because `_esc()`
     * runs before any further processing, no HTML injection is possible.
     */
    private _htmlToText(html: string): string {
        // Step 1: Escape the entire input.  All '<', '>', and '&' become HTML
        // entities.  This is the security boundary — no further step can
        // reintroduce executable HTML.
        const escaped = this._esc(html);

        // Step 2: For readability, convert escaped block-level elements to
        // newlines and strip the remaining escaped tag patterns.  These are
        // plain-text patterns at this point, not executable HTML.
        return escaped
            .replace(/&lt;\/?(p|div|li|tr|h[1-6])(?:\s[^&>]*)? *&gt;/gi, '\n')
            .replace(/&lt;br\s*\/?&gt;/gi, '\n')
            .replace(/&lt;[^&>]*&gt;/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private _esc(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    private _dispose(): void {
        WorkItemDetailsPanel._panels.delete(this._workItem.id!);
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }

    private _createNonce(): string {
        return crypto.randomBytes(16).toString('hex');
    }
}
