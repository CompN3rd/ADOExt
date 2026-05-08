import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { AdoClient, Release, ReleaseEnvironment } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { classicReleaseUrl } from '../utils/releaseUrls';
import { buildMessageDocument, webviewAssetRoots } from './webviewHtml';

interface ReleasePanelScope {
    organization?: string;
    project?: string;
}

type ReleaseDetailsMessage =
    | { type: 'openInBrowser' }
    | { type: 'openEnvironment'; environmentId: number }
    | { type: 'refresh' };

export class ReleaseDetailsPanel {
    private static _panels = new Map<string, ReleaseDetailsPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _panelKey: string;
    private readonly _organization?: string;
    private readonly _project?: string;
    private _releaseId: number;
    private _disposables: vscode.Disposable[] = [];

    static async show(
        context: vscode.ExtensionContext,
        client: AdoClient,
        config: ConfigManager,
        releaseId: number,
        scope: ReleasePanelScope = {}
    ): Promise<void> {
        const key = ReleaseDetailsPanel.panelKey(
            releaseId,
            scope.organization ?? client.organization ?? config.organization,
            scope.project ?? config.project
        );
        const existing = ReleaseDetailsPanel._panels.get(key);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            await existing._refresh(client, config);
            return;
        }
        new ReleaseDetailsPanel(context, client, config, releaseId, key, scope);
    }

    private constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        releaseId: number,
        panelKey: string,
        scope: ReleasePanelScope
    ) {
        this._releaseId = releaseId;
        this._panelKey = panelKey;
        this._organization = scope.organization;
        this._project = scope.project;
        this._panel = vscode.window.createWebviewPanel(
            'adoext.releaseDetails',
            `Release #${releaseId}`,
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

        ReleaseDetailsPanel._panels.set(panelKey, this);
        void this._refresh(_client, _config);
    }

    private async _refresh(client: AdoClient, config: ConfigManager): Promise<void> {
        const project = this._project ?? config.project;
        const organization = this._organization ?? client.organization ?? config.organization;
        if (!project || !organization) {
            this._panel.webview.html = buildMessageDocument(this._panel.webview, 'Select an organization and project to view releases.');
            return;
        }

        let release: Release | undefined;
        try {
            release = await client.getClassicRelease(project, this._releaseId, organization);
        } catch {
            this._panel.webview.html = buildMessageDocument(this._panel.webview, `Failed to load release #${this._releaseId}.`);
            return;
        }

        if (!release) {
            this._panel.webview.html = buildMessageDocument(this._panel.webview, `Release #${this._releaseId} not found.`);
            return;
        }

        const definitionName = release.releaseDefinition?.name ?? 'Release';
        const releaseName = release.name ?? `#${this._releaseId}`;
        this._panel.title = `${definitionName} ${releaseName}`;
        this._panel.webview.html = buildReleaseDetailsHtml(this._panel.webview, release, organization, project);
    }

    private async _handleMessage(msg: ReleaseDetailsMessage): Promise<void> {
        const project = this._project ?? this._config.project;
        const organization = this._organization ?? this._client.organization ?? this._config.organization;
        if (!project || !organization) {
            return;
        }

        switch (msg.type) {
            case 'openInBrowser':
                await vscode.env.openExternal(vscode.Uri.parse(classicReleaseUrl(organization, project, this._releaseId)));
                return;
            case 'openEnvironment':
                if (msg.environmentId > 0) {
                    await vscode.env.openExternal(
                        vscode.Uri.parse(classicReleaseUrl(organization, project, this._releaseId, { environmentId: msg.environmentId }))
                    );
                }
                return;
            case 'refresh':
                await this._refresh(this._client, this._config);
                return;
        }
    }

    private _dispose(): void {
        ReleaseDetailsPanel._panels.delete(this._panelKey);
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }

    private static panelKey(releaseId: number, organization?: string, project?: string): string {
        return `${organization ?? ''}\u0000${project ?? ''}\u0000${releaseId}`;
    }
}

function buildReleaseDetailsHtml(webview: vscode.Webview, release: Release, organization: string, project: string): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const csp = [
        "default-src 'none'",
        `img-src ${webview.cspSource} https: data:`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}' ${webview.cspSource}`
    ].join('; ');

    const definitionName = release.releaseDefinition?.name ?? 'Release';
    const releaseName = release.name ?? `#${release.id ?? ''}`;
    const createdBy = release.createdBy?.displayName ?? '';
    const createdOn = release.createdOn ? new Date(release.createdOn).toLocaleString() : '';
    const status = releaseStatusLabel(release.status);
    const artifacts = (release.artifacts ?? []).map(formatArtifact).filter(Boolean);

    const environments = release.environments ?? [];
    const environmentsHtml = environments.length === 0
        ? `<p class="empty">No environments found.</p>`
        : `<table class="table">
            <thead><tr><th>Environment</th><th>Status</th><th>Approvals</th><th>Updated</th><th></th></tr></thead>
            <tbody>
                ${environments.map(env => environmentRowHtml(env)).join('')}
            </tbody>
        </table>`;

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${escapeHtml(`${definitionName} ${releaseName}`)}</title>
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px}
*{box-sizing:border-box}
h1{font-size:1.3em;margin:0 0 6px;line-height:1.35}
.meta{color:var(--vscode-descriptionForeground);font-size:.9em;margin-bottom:12px}
.toolbar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center}
button{padding:4px 10px;border-radius:3px;border:1px solid var(--vscode-button-border,transparent);cursor:pointer;font-family:inherit;font-size:.85em}
.btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-primary:hover{background:var(--vscode-button-hoverBackground)}
.btn-secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn-secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}
.section{margin-top:18px}
.section h2{font-size:1em;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:4px;margin:0 0 8px}
.empty{color:var(--vscode-descriptionForeground);font-style:italic}
.table{width:100%;border-collapse:collapse}
.table th,.table td{padding:6px 8px;border-bottom:1px solid var(--vscode-panel-border);text-align:left;vertical-align:top}
.table th{color:var(--vscode-descriptionForeground);font-weight:600}
.badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:.8em;border:1px solid var(--vscode-panel-border);color:var(--vscode-descriptionForeground)}
.badge-succeeded{color:var(--vscode-charts-green);border-color:var(--vscode-charts-green)}
.badge-failed{color:var(--vscode-charts-red);border-color:var(--vscode-charts-red)}
.badge-running{color:var(--vscode-charts-yellow);border-color:var(--vscode-charts-yellow)}
.badge-canceled{color:var(--vscode-descriptionForeground);border-color:var(--vscode-descriptionForeground)}
.artifacts{display:flex;flex-direction:column;gap:6px}
.artifact{display:flex;gap:8px;flex-wrap:wrap}
.artifact code{font-family:var(--vscode-editor-font-family)}
</style>
</head>
<body>
<div class="toolbar">
  <button class="btn-primary" id="openRelease">Open in Browser</button>
  <button class="btn-secondary" id="refresh">Refresh</button>
</div>

<h1>${escapeHtml(`${definitionName} ${releaseName}`)}</h1>
<div class="meta">
  ${status ? `Status: ${escapeHtml(status)}` : ''}${status && createdOn ? ' · ' : ''}${createdOn ? `Created: ${escapeHtml(createdOn)}` : ''}
  ${createdBy ? `<div>Created by: ${escapeHtml(createdBy)}</div>` : ''}
  <div>Project: ${escapeHtml(project)} · Org: ${escapeHtml(organization)}</div>
</div>

<section class="section">
  <h2>Environments</h2>
  ${environmentsHtml}
</section>

<section class="section">
  <h2>Artifacts</h2>
  ${artifacts.length === 0
        ? `<p class="empty">No artifacts found.</p>`
        : `<div class="artifacts">${artifacts.map(a => `<div class="artifact">${a}</div>`).join('')}</div>`}
</section>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.getElementById('openRelease')?.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
document.getElementById('refresh')?.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
for (const button of document.querySelectorAll('button[data-env-id]')) {
  button.addEventListener('click', (e) => {
    const envId = Number(button.getAttribute('data-env-id') || 0);
    if (envId > 0) vscode.postMessage({ type: 'openEnvironment', environmentId: envId });
  });
}
</script>
</body>
</html>`;
}

function environmentRowHtml(env: ReleaseEnvironment): string {
    const name = env.name ?? '(unnamed)';
    const statusLabel = environmentStatusLabel(env.status);
    const statusKind = environmentStatusKind(env.status);
    const approvals = approvalSummaryLabel(env);
    const updatedOn = env.modifiedOn ? new Date(env.modifiedOn).toLocaleString() : '';
    const envId = env.id ?? 0;

    return `<tr>
        <td>${escapeHtml(name)}</td>
        <td>${statusLabel ? `<span class="badge ${statusKind}">${escapeHtml(statusLabel)}</span>` : ''}</td>
        <td>${escapeHtml(approvals)}</td>
        <td>${escapeHtml(updatedOn)}</td>
        <td>${envId > 0 ? `<button class="btn-secondary" data-env-id="${envId}">Open</button>` : ''}</td>
    </tr>`;
}

function formatArtifact(artifact: NonNullable<Release['artifacts']>[number] | undefined): string {
    if (!artifact) {
        return '';
    }
    const alias = artifact.alias ?? '';
    const type = artifact.type ?? '';
    const version = artifact.definitionReference?.version?.name ?? artifact.definitionReference?.version?.id ?? '';
    const defName = artifact.definitionReference?.definition?.name ?? '';
    const parts = [
        alias ? `<strong>${escapeHtml(alias)}</strong>` : '',
        defName ? `<span>${escapeHtml(defName)}</span>` : '',
        type ? `<span class="meta">${escapeHtml(type)}</span>` : '',
        version ? `<code>${escapeHtml(String(version))}</code>` : ''
    ].filter(Boolean);
    return parts.join(' ');
}

function approvalSummaryLabel(env: ReleaseEnvironment): string {
    const pre = summarizeApprovals(env.preDeployApprovals ?? []);
    const post = summarizeApprovals(env.postDeployApprovals ?? []);
    const parts = [
        pre ? `Pre: ${pre}` : '',
        post ? `Post: ${post}` : ''
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : '';
}

function summarizeApprovals(approvals: Array<{ status?: unknown }>): string {
    if (approvals.length === 0) {
        return '';
    }
    const byStatus = new Map<string, number>();
    for (const approval of approvals) {
        const key = approvalStatusLabel(approval.status) || '';
        if (!key) { continue; }
        byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
    }
    if (byStatus.size === 0) {
        return '';
    }
    return [...byStatus.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([status, count]) => count > 1 ? `${status} (${count})` : status)
        .join(', ');
}

function releaseStatusLabel(status: unknown): string {
    if (typeof status === 'string') {
        return status;
    }
    if (typeof status === 'number') {
        // Keep it simple; status enums can vary by API version.
        return String(status);
    }
    return '';
}

function environmentStatusLabel(status: unknown): string {
    if (typeof status === 'string') {
        return status;
    }
    if (typeof status !== 'number') {
        return '';
    }
    switch (status) {
        case 1:
            return 'Not started';
        case 2:
            return 'In progress';
        case 4:
            return 'Succeeded';
        case 8:
            return 'Canceled';
        case 16:
            return 'Rejected';
        case 32:
            return 'Queued';
        case 64:
            return 'Scheduled';
        case 128:
            return 'Partially succeeded';
        default:
            return String(status);
    }
}

function approvalStatusLabel(status: unknown): string {
    if (typeof status === 'string') {
        return status;
    }
    if (typeof status !== 'number') {
        return '';
    }
    switch (status) {
        case 1:
            return 'Pending';
        case 2:
            return 'Approved';
        case 4:
            return 'Rejected';
        case 6:
            return 'Reassigned';
        case 7:
            return 'Canceled';
        case 8:
            return 'Skipped';
        default:
            return String(status);
    }
}

function environmentStatusKind(status: unknown): string {
    if (typeof status !== 'number') {
        return '';
    }
    switch (status) {
        case 4:
            return 'badge-succeeded';
        case 128:
            return 'badge-running';
        case 2:
        case 1:
        case 32:
        case 64:
            return 'badge-running';
        case 8:
        case 16:
            return 'badge-canceled';
        default:
            return 'badge-failed';
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
