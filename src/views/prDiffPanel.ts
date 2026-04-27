import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type {
    AdoClient,
    GitPullRequest,
    PullRequestDiffModel,
    PullRequestFileDiff
} from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';

interface PrDiffPanelScope {
    organization?: string;
    project?: string;
}

interface DiffMessage {
    type: string;
    filePath?: string;
    line?: number;
    changeTrackingId?: number;
}

interface DiffRow {
    kind: 'context' | 'add' | 'delete' | 'edit';
    leftLine?: number;
    rightLine?: number;
    leftText?: string;
    rightText?: string;
}

export class PrDiffPanel {
    private static readonly _panels = new Map<string, PrDiffPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _panelKey: string;
    private readonly _organization?: string;
    private readonly _project?: string;
    private _diff?: PullRequestDiffModel;
    private _disposables: vscode.Disposable[] = [];

    static async show(
        client: AdoClient,
        config: ConfigManager,
        pr: GitPullRequest,
        scope: PrDiffPanelScope = {}
    ): Promise<void> {
        const prId = pr.pullRequestId;
        if (typeof prId !== 'number') {
            vscode.window.showErrorMessage('Unable to show diff because the pull request ID is missing.');
            return;
        }

        const key = PrDiffPanel.panelKey(
            prId,
            scope.organization ?? client.organization ?? config.organization,
            scope.project ?? config.project
        );
        const existing = PrDiffPanel._panels.get(key);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            await existing.refresh();
            return;
        }

        const panel = new PrDiffPanel(client, config, pr, key, scope);
        PrDiffPanel._panels.set(key, panel);
        await panel.refresh();
    }

    private constructor(
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private readonly _pr: GitPullRequest,
        panelKey: string,
        scope: PrDiffPanelScope
    ) {
        this._panelKey = panelKey;
        this._organization = scope.organization;
        this._project = scope.project;
        this._panel = vscode.window.createWebviewPanel(
            'adoext.prDiff',
            `PR #${_pr.pullRequestId ?? ''} Diff`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message as DiffMessage),
            null,
            this._disposables
        );
    }

    private async refresh(): Promise<void> {
        this._panel.webview.html = this.buildMessageHtml('Loading pull request diff...');

        const repoId = this._pr.repository?.id ?? '';
        const project = this._project ?? this._config.project;
        const organization = this._organization ?? this._client.organization ?? this._config.organization;

        if (!repoId || !project || !organization) {
            this._panel.webview.html = this.buildMessageHtml('Unable to load diff because organization, project, or repository is missing.');
            return;
        }

        try {
            this._diff = await this._client.getPullRequestDiff(project, repoId, this._pr, organization);
            this._panel.webview.html = this.buildHtml(this._diff);
        } catch (err) {
            this._panel.webview.html = this.buildMessageHtml(`Failed to load pull request diff: ${this.formatError(err)}`);
        }
    }

    private async handleMessage(message: DiffMessage): Promise<void> {
        if (message.type !== 'lineComment' || !message.filePath || typeof message.line !== 'number') {
            return;
        }

        const diff = this._diff;
        const repoId = this._pr.repository?.id ?? '';
        const prId = this._pr.pullRequestId ?? 0;
        const project = this._project ?? this._config.project;
        const organization = this._organization ?? this._client.organization ?? this._config.organization;
        if (!diff || !repoId || !project || !organization) {
            vscode.window.showWarningMessage('Unable to add a line comment because pull request context is missing.');
            return;
        }

        const content = await vscode.window.showInputBox({
            prompt: `${message.filePath}:${message.line}`,
            placeHolder: 'Write a line comment'
        });
        if (!content) {
            return;
        }

        try {
            await this._client.addPullRequestLineComment(
                project,
                repoId,
                prId,
                message.filePath,
                message.line,
                content,
                diff.iterationId,
                diff.baseIterationId,
                message.changeTrackingId,
                organization
            );
            vscode.window.showInformationMessage('Line comment added.');
            await this.refresh();
            void vscode.commands.executeCommand('adoext.refreshPullRequests');
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to add line comment: ${this.formatError(err)}`);
        }
    }

    private buildHtml(diff: PullRequestDiffModel): string {
        const webview = this._panel.webview;
        const nonce = crypto.randomBytes(16).toString('hex');
        const prId = this._pr.pullRequestId ?? 0;
        const title = this.esc(this._pr.title ?? '');
        const sourceBranch = this.esc((this._pr.sourceRefName ?? '').replace('refs/heads/', ''));
        const targetBranch = this.esc((this._pr.targetRefName ?? '').replace('refs/heads/', ''));
        const filesHtml = diff.files.length === 0
            ? '<p class="empty">No changed files found.</p>'
            : diff.files.map(file => this.buildFileHtml(file)).join('');

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>PR #${prId} Diff</title>
<style>
  body { margin: 0; padding: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .shell { padding: 16px; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  .meta { color: var(--vscode-descriptionForeground); margin-bottom: 14px; }
  .file { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 16px; overflow: hidden; }
  .file-header { display: flex; justify-content: space-between; gap: 12px; padding: 8px 10px; background: var(--vscode-sideBarSectionHeader-background); border-bottom: 1px solid var(--vscode-panel-border); }
  .file-path { font-family: var(--vscode-editor-font-family); overflow-wrap: anywhere; }
  .pill { font-size: 0.78em; padding: 1px 6px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; color: var(--vscode-descriptionForeground); }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
  td { vertical-align: top; border-bottom: 1px solid var(--vscode-panel-border); }
  tr:last-child td { border-bottom: none; }
  .line-no { width: 50px; padding: 2px 6px; text-align: right; color: var(--vscode-editorLineNumber-foreground); background: var(--vscode-editorGutter-background); user-select: none; }
  .code { white-space: pre-wrap; overflow-wrap: anywhere; padding: 2px 8px; }
  .action { width: 38px; padding: 1px 4px; text-align: center; background: var(--vscode-editorGutter-background); }
  .add .code.right { background: rgba(46, 160, 67, 0.18); }
  .delete .code.left { background: rgba(248, 81, 73, 0.18); }
  .edit .code { background: rgba(187, 128, 9, 0.18); }
  .comment-btn { width: 24px; height: 22px; border: 1px solid transparent; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); cursor: pointer; }
  .comment-btn:hover { border-color: var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
</style>
</head>
<body>
<main class="shell">
  <h1>PR #${prId}: ${title}</h1>
  <div class="meta"><code>${sourceBranch}</code> into <code>${targetBranch}</code></div>
  ${filesHtml}
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

document.addEventListener('click', event => {
    const target = /** @type {HTMLElement} */ (event.target);
    const button = target.closest('[data-action="line-comment"]');
    if (!button) { return; }
    vscode.postMessage({
        type: 'lineComment',
        filePath: button.getAttribute('data-file') || undefined,
        line: Number(button.getAttribute('data-line')),
        changeTrackingId: button.hasAttribute('data-change-tracking-id')
            ? Number(button.getAttribute('data-change-tracking-id'))
            : undefined
    });
});
</script>
</body>
</html>`;
    }

    private buildFileHtml(file: PullRequestFileDiff): string {
        const rows = this.buildRows(file);
        const visibleRows = rows.slice(0, 600);
        const rowsHtml = visibleRows.map(row => this.buildRowHtml(file, row)).join('');
        const truncated = rows.length > visibleRows.length
            ? `<tr><td colspan="5" class="code empty">${rows.length - visibleRows.length} more lines hidden in this preview.</td></tr>`
            : '';
        const original = file.originalPath ? `<span class="pill">from ${this.esc(file.originalPath)}</span>` : '';
        return `<section class="file">
  <div class="file-header"><span class="file-path">${this.esc(file.path)}</span><span>${original}<span class="pill">${this.esc(file.changeType)}</span></span></div>
  <table aria-label="Diff for ${this.escAttr(file.path)}"><tbody>${rowsHtml}${truncated}</tbody></table>
</section>`;
    }

    private buildRowHtml(file: PullRequestFileDiff, row: DiffRow): string {
        const commentButton = row.rightLine
            ? `<button class="comment-btn" title="Add line comment" data-action="line-comment" data-file="${this.escAttr(file.path)}" data-line="${row.rightLine}"${file.changeTrackingId !== undefined ? ` data-change-tracking-id="${file.changeTrackingId}"` : ''}>+</button>`
            : '';
        return `<tr class="${row.kind}">
  <td class="line-no">${row.leftLine ?? ''}</td>
  <td class="code left">${this.esc(row.leftText ?? '')}</td>
  <td class="line-no">${row.rightLine ?? ''}</td>
  <td class="code right">${this.esc(row.rightText ?? '')}</td>
  <td class="action">${commentButton}</td>
</tr>`;
    }

    private buildRows(file: PullRequestFileDiff): DiffRow[] {
        const originalLines = splitLines(file.originalContent);
        const modifiedLines = splitLines(file.modifiedContent);
        const blocks = [...(file.lineDiffBlocks ?? [])]
            .sort((left, right) => (left.modifiedLineNumberStart ?? left.originalLineNumberStart ?? 0) - (right.modifiedLineNumberStart ?? right.originalLineNumberStart ?? 0));

        if (blocks.length === 0) {
            const source = modifiedLines.length > 0 ? modifiedLines : originalLines;
            return source.map((text, index) => ({
                kind: file.changeType === 'add' ? 'add' : file.changeType === 'delete' ? 'delete' : 'context',
                leftLine: file.changeType === 'add' ? undefined : index + 1,
                rightLine: file.changeType === 'delete' ? undefined : index + 1,
                leftText: file.changeType === 'add' ? undefined : text,
                rightText: file.changeType === 'delete' ? undefined : text
            }));
        }

        const rows: DiffRow[] = [];
        let originalCursor = 1;
        let modifiedCursor = 1;

        for (const block of blocks) {
            const originalStart = block.originalLineNumberStart ?? originalCursor;
            const modifiedStart = block.modifiedLineNumberStart ?? modifiedCursor;
            const contextCount = Math.max(0, Math.min(originalStart - originalCursor, modifiedStart - modifiedCursor));
            for (let offset = 0; offset < contextCount; offset++) {
                rows.push({
                    kind: 'context',
                    leftLine: originalCursor,
                    rightLine: modifiedCursor,
                    leftText: originalLines[originalCursor - 1] ?? '',
                    rightText: modifiedLines[modifiedCursor - 1] ?? ''
                });
                originalCursor++;
                modifiedCursor++;
            }

            const originalCount = block.originalLinesCount ?? 0;
            const modifiedCount = block.modifiedLinesCount ?? 0;
            const count = Math.max(originalCount, modifiedCount);
            for (let offset = 0; offset < count; offset++) {
                const leftLine = offset < originalCount ? originalStart + offset : undefined;
                const rightLine = offset < modifiedCount ? modifiedStart + offset : undefined;
                rows.push({
                    kind: originalCount === 0 ? 'add' : modifiedCount === 0 ? 'delete' : 'edit',
                    leftLine,
                    rightLine,
                    leftText: leftLine ? originalLines[leftLine - 1] ?? '' : undefined,
                    rightText: rightLine ? modifiedLines[rightLine - 1] ?? '' : undefined
                });
            }

            originalCursor = Math.max(originalCursor, originalStart + originalCount);
            modifiedCursor = Math.max(modifiedCursor, modifiedStart + modifiedCount);
        }

        const tailCount = Math.max(originalLines.length - originalCursor + 1, modifiedLines.length - modifiedCursor + 1);
        for (let offset = 0; offset < tailCount; offset++) {
            const leftLine = originalCursor + offset <= originalLines.length ? originalCursor + offset : undefined;
            const rightLine = modifiedCursor + offset <= modifiedLines.length ? modifiedCursor + offset : undefined;
            rows.push({
                kind: 'context',
                leftLine,
                rightLine,
                leftText: leftLine ? originalLines[leftLine - 1] ?? '' : undefined,
                rightText: rightLine ? modifiedLines[rightLine - 1] ?? '' : undefined
            });
        }

        return rows;
    }

    private buildMessageHtml(message: string): string {
        const webview = this._panel.webview;
        return /* html */`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';"><style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px}.empty{color:var(--vscode-descriptionForeground)}</style></head><body><p class="empty">${this.esc(message)}</p></body></html>`;
    }

    private dispose(): void {
        PrDiffPanel._panels.delete(this._panelKey);
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables = [];
    }

    private esc(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private escAttr(text: string): string {
        return this.esc(text).replace(/'/g, '&#39;');
    }

    private formatError(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }

    private static panelKey(prId: number, organization?: string, project?: string): string {
        return JSON.stringify([organization ?? null, project ?? null, prId]);
    }
}

function splitLines(content: string): string[] {
    if (!content) {
        return [];
    }
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}
