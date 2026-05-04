import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { WorkItem, WorkItemComment } from '../api/adoClient';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';

interface WorkItemPanelScope {
    organization?: string;
    project?: string;
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

    static async show(
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
        new WorkItemDetailsPanel(client, config, workItem, id, key, scope);
    }

    private constructor(
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
                retainContextWhenHidden: true
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

        this._panel.webview.html = this._buildHtml(fullItem, comments);
    }

    private async _handleMessage(msg: {
        type: string;
        content?: string;
        state?: string;
    }): Promise<void> {
        const id = this._workItemId;
        const project = this._project ?? this._config.project;
        const org = this._organization ?? this._client.organization ?? this._config.organization;
        const action = msg.type === 'addComment'
            ? 'Failed to add work item comment'
            : msg.type === 'setState'
                ? 'Failed to update work item state'
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
            }
        } catch (err) {
            showErrorMessage(`${action}: ${this._formatError(err)}`);
        }
    }

    private _buildHtml(item: WorkItem, comments: WorkItemComment[]): string {
        const webview = this._panel.webview;
        const nonce = this._createNonce();
        const id = item.id ?? 0;
        const f = item.fields ?? {};

        const title = this._esc((f['System.Title'] as string | undefined) ?? '');
        const wiType = this._esc((f['System.WorkItemType'] as string | undefined) ?? 'Work Item');
        const rawState = (f['System.State'] as string | undefined) ?? '';
        const state = this._esc(rawState);
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
        const stateOptions = this._stateOptions(rawState);
        const priorityHtml = priority !== undefined
            ? `<span class="badge priority-${priority}">P${priority}</span>`
            : '';

        // Description is rendered client-side via the nonce-protected script to
        // preserve ADO HTML formatting while safely stripping dangerous content.
        const descriptionPlaceholder = description
            ? '<div id="description-content"></div>'
            : '<em class="empty">No description provided.</em>';

        const commentsHtml = comments.length === 0
            ? '<p class="empty">No comments yet.</p>'
            : comments.map((c, index) => this._buildCommentHtml(c, index)).join('');

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

        // Embed raw description as JSON so the nonce-protected script can
        // sanitize and render it without any server-side regex manipulation.
        const descriptionJson = JSON.stringify(description);
        const commentBodiesJson = JSON.stringify(comments.map(comment => comment.renderedText ?? comment.text ?? ''));

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src https: data:;">
<title>${wiType} #${id}</title>
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; margin: 0; }
  h1 { font-size: 1.3em; margin-bottom: 4px; }
  h2 { font-size: 1em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; margin-bottom: 8px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
    .state-edit { display: flex; gap: 6px; align-items: center; }
    select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); border-radius: 3px; padding: 3px 22px 3px 6px; }
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
  #description-content { word-break: break-word; }
  #description-content p { margin: 0 0 8px; }
  #description-content ul, #description-content ol { padding-left: 24px; margin: 0 0 8px; }
  #description-content table { border-collapse: collapse; margin-bottom: 8px; }
  #description-content td, #description-content th { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; }
  #description-content a { color: var(--vscode-textLink-foreground); }
  #description-content a:hover { color: var(--vscode-textLink-activeForeground); }
  #description-content img { max-width: 100%; }
  #description-content pre, #description-content code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); }
  #description-content pre { padding: 8px; overflow-x: auto; }
  .comment { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 10px; padding: 10px; }
  .comment-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .comment-author { font-weight: bold; font-size: 0.9em; }
  .comment-date { color: var(--vscode-descriptionForeground); font-size: 0.8em; }
    .comment-text { word-break: break-word; line-height: 1.5; }
    .comment-text p { margin: 0 0 8px; }
    .comment-text ul, .comment-text ol { padding-left: 24px; margin: 0 0 8px; }
    .comment-text table { border-collapse: collapse; margin-bottom: 8px; }
    .comment-text td, .comment-text th { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; }
    .comment-text a { color: var(--vscode-textLink-foreground); }
    .comment-text a:hover { color: var(--vscode-textLink-activeForeground); }
    .comment-text img { max-width: 100%; }
    .comment-text pre, .comment-text code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); }
    .comment-text pre { padding: 8px; overflow-x: auto; }
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
    <div class="state-edit">
        <select id="stateSelect" aria-label="Work item state">${stateOptions}</select>
        <button class="btn btn-primary" data-action="set-state">Update State</button>
    </div>
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
  <div class="description">${descriptionPlaceholder}</div>
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

document.querySelector('[data-action="set-state"]')?.addEventListener('click', () => {
    const select = /** @type {HTMLSelectElement} */ (document.getElementById('stateSelect'));
    if (!select.value) { return; }
    vscode.postMessage({ type: 'setState', state: select.value });
});

// ---------------------------------------------------------------------------
// Render the work item description.
// The raw HTML from ADO is sanitized using an allowlist-based DOM walker so
// that formatting is preserved while scripts and event handlers are removed.
// The CSP (script-src 'nonce-...') provides an additional layer: even if a
// script tag somehow survived sanitization it would be blocked by the CSP.
// ---------------------------------------------------------------------------
(function renderRichText() {
    const rawDescriptionHtml = ${descriptionJson};
    const rawCommentHtml = ${commentBodiesJson};

    const ALLOWED_TAGS = new Set([
        'p', 'br', 'div', 'span',
        'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup',
        'ul', 'ol', 'li',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'a', 'code', 'pre', 'blockquote',
        'table', 'thead', 'tbody', 'tr', 'td', 'th',
        'img', 'figure', 'figcaption'
    ]);

    /** Attributes allowed on any element. Keep this small for untrusted HTML. */
    const GLOBAL_ATTRS = new Set(['class']);

    /** Extra per-tag allowed attributes. */
    const TAG_ATTRS = {
        a:   new Set(['href', 'title', 'target', 'rel']),
        img: new Set(['src', 'alt', 'width', 'height']),
        td:  new Set(['colspan', 'rowspan', 'align']),
        th:  new Set(['colspan', 'rowspan', 'scope', 'align']),
        ol:  new Set(['type', 'start']),
    };

    /** Returns true if the URL scheme is safe for href / src attributes. */
    function isSafeUrl(url) {
        const lower = url.trim().toLowerCase();
        if (lower.startsWith('https://') ||
            lower.startsWith('http://')  ||
            lower.startsWith('#')         ||
            lower.startsWith('/')) {
            return true;
        }
        // Allow raster image data URIs only; exclude SVG which can embed JS.
        if (lower.startsWith('data:image/')) {
            const mimeEnd = lower.search(/[;,]/);
            const mime = mimeEnd > 0 ? lower.slice(0, mimeEnd) : lower;
            return mime !== 'data:image/svg+xml';
        }
        return false;
    }

    /**
     * Recursively clean a DOM node.
     * Returns a safe clone of the node, a DocumentFragment (when an
     * unsupported element is unwrapped), or null to discard the node.
     */
    function cleanNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return document.createTextNode(node.textContent || '');
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }

        const tag = node.tagName.toLowerCase();

        if (!ALLOWED_TAGS.has(tag)) {
            // Unwrap: keep children, drop the element itself
            const frag = document.createDocumentFragment();
            Array.from(node.childNodes).forEach(child => {
                const cleaned = cleanNode(child);
                if (cleaned) { frag.appendChild(cleaned); }
            });
            return frag;
        }

        const el = document.createElement(tag);

        // Copy only allowed attributes
        Array.from(node.attributes).forEach(attr => {
            const name = attr.name.toLowerCase();
            const tagAttrs = TAG_ATTRS[tag];
            if (!GLOBAL_ATTRS.has(name) && !(tagAttrs && tagAttrs.has(name))) {
                return; // strip disallowed attribute
            }
            if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value)) {
                return; // strip unsafe URL
            }
            el.setAttribute(attr.name, attr.value);
        });

        // Force external links to open in the browser
        if (tag === 'a') {
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
        }

        Array.from(node.childNodes).forEach(child => {
            const cleaned = cleanNode(child);
            if (cleaned) { el.appendChild(cleaned); }
        });

        return el;
    }

    function renderInto(rawHtml, container) {
        if (!rawHtml || !container) {
            return;
        }
        const parser = new DOMParser();
        const doc = parser.parseFromString(rawHtml, 'text/html');
        Array.from(doc.body.childNodes).forEach(child => {
            const cleaned = cleanNode(child);
            if (cleaned) { container.appendChild(cleaned); }
        });
    }

    renderInto(rawDescriptionHtml, document.getElementById('description-content'));
    rawCommentHtml.forEach((rawHtml, index) => {
        renderInto(rawHtml, document.getElementById('comment-content-' + index));
    });
}());
</script>
</body>
</html>`;
    }

    private _buildCommentHtml(comment: WorkItemComment, index: number): string {
        const author = this._esc(
            (comment.createdBy as { displayName?: string } | undefined)?.displayName ?? 'Unknown'
        );
        const date = this._formatDate(comment.createdDate);
        return `
<div class="comment">
  <div class="comment-header">
    <span class="comment-author">${author}</span>
    <span class="comment-date">${date}</span>
  </div>
  <div class="comment-text" id="comment-content-${index}"></div>
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

    private _esc(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private _formatError(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
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

    private _stateOptions(currentState: string): string {
        const states = this._allowedStates;
        const options = states.includes(currentState) || !currentState
            ? states
            : [currentState, ...states];
        return options
            .map(state => `<option value="${this._esc(state)}"${state === currentState ? ' selected' : ''}>${this._esc(state)}</option>`)
            .join('');
    }

    private _dispose(): void {
        WorkItemDetailsPanel._panels.delete(this._panelKey);
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }

    private _createNonce(): string {
        return crypto.randomBytes(16).toString('hex');
    }

    private static panelKey(id: number, organization?: string, project?: string): string {
        return JSON.stringify([organization ?? null, project ?? null, id]);
    }
}
