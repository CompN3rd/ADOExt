import * as vscode from 'vscode';
import type { AdoClient, Build, Timeline } from '../api/adoClient';
import { BuildStatus, BuildResult } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { showErrorMessage } from '../utils/notifications';

export interface PipelinePanelScope {
    organization?: string;
    project?: string;
}

interface TimelineRecord {
    name?: string;
    type?: string;
    state?: string;
    result?: string;
    startTime?: Date;
    finishTime?: Date;
    errorCount?: number;
    warningCount?: number;
}

export class PipelineDetailsPanel {
    private static _panels = new Map<string, PipelineDetailsPanel>();

    private _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private _run: Build,
        private readonly _scope: PipelinePanelScope,
        panel: vscode.WebviewPanel
    ) {
        this._panel = panel;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            msg => this._handleMessage(msg),
            null,
            this._disposables
        );

        void this._refresh();
    }

    public static async show(
        context: vscode.ExtensionContext,
        client: AdoClient,
        config: ConfigManager,
        run: Build,
        scope: PipelinePanelScope
    ): Promise<void> {
        const buildId = run.id ?? 0;
        const org = scope.organization ?? '';
        const proj = scope.project ?? '';
        const panelKey = `${org}\0${proj}\0${buildId}`;

        const existing = this._panels.get(panelKey);
        if (existing) {
            existing._panel.reveal();
            existing._run = run;
            await existing._refresh();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'adoext.pipelineDetails',
            `Pipeline Run #${run.buildNumber ?? buildId}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const newPanel = new PipelineDetailsPanel(context, client, config, run, scope, panel);
        this._panels.set(panelKey, newPanel);
    }

    public static async refreshAllOpenPanels(): Promise<void> {
        for (const panel of this._panels.values()) {
            await panel._refresh();
        }
    }

    private async _refresh(): Promise<void> {
        const buildId = this._run.id ?? 0;
        const project = this._scope.project ?? '';
        const organization = this._scope.organization;

        // Load run details and timeline in parallel
        const [runResult, timelineResult] = await Promise.allSettled([
            this._client.getPipelineRun(project, buildId, organization),
            this._client.getPipelineTimeline(project, buildId, organization)
        ]);

        const run = runResult.status === 'fulfilled' ? runResult.value : this._run;
        const timeline = timelineResult.status === 'fulfilled' ? timelineResult.value : undefined;

        if (run) {
            this._run = run;
        }

        this._panel.webview.html = this._getHtml(run ?? this._run, timeline);
    }

    private _getHtml(run: Build, timeline?: Timeline): string {
        const buildNumber = run.buildNumber ?? `#${run.id ?? 0}`;
        const pipelineName = run.definition?.name ?? 'Unknown Pipeline';
        const status = this._getStatusLabel(run);
        const statusClass = this._getStatusClass(run);
        const requestedBy = run.requestedFor?.displayName ?? 'Unknown';
        const sourceBranch = run.sourceBranch?.replace('refs/heads/', '') ?? 'N/A';
        const startTime = run.startTime ? new Date(run.startTime).toLocaleString() : 'N/A';
        const finishTime = run.finishTime ? new Date(run.finishTime).toLocaleString() : 'N/A';
        const queueTime = run.queueTime ? new Date(run.queueTime).toLocaleString() : 'N/A';

        const org = this._scope.organization ?? '';
        const project = this._scope.project ?? '';
        const buildId = run.id ?? 0;

        const canRerun = run.status === BuildStatus.Completed || run.status === BuildStatus.Cancelling;
        const canCancel = run.status === BuildStatus.InProgress || run.status === BuildStatus.NotStarted;

        // Extract stages, jobs, tasks from timeline
        const stages = this._extractStages(timeline);

        const stagesHtml = stages.length > 0
            ? stages.map(stage => this._renderStage(stage)).join('')
            : '<p style="color: var(--vscode-descriptionForeground);">No timeline information available.</p>';

        const actionsHtml = `
            <div style="display: flex; gap: 8px; margin-top: 16px;">
                <button class="btn btn-primary" data-action="open-in-browser">Open in Browser</button>
                ${canRerun ? '<button class="btn btn-secondary" data-action="rerun">Re-run</button>' : ''}
                ${canCancel ? '<button class="btn btn-secondary" data-action="cancel">Cancel</button>' : ''}
                <button class="btn btn-secondary" data-action="refresh">Refresh</button>
            </div>
        `;

        const contentHtml = `
            <div class="container">
                <h1>${this._escapeHtml(pipelineName)} ${this._escapeHtml(buildNumber)}</h1>
                <div class="badge badge-${statusClass}">${this._escapeHtml(status)}</div>

                <div class="meta-section">
                    <div class="meta-row">
                        <span class="meta-label">Requested by:</span>
                        <span class="meta-value">${this._escapeHtml(requestedBy)}</span>
                    </div>
                    <div class="meta-row">
                        <span class="meta-label">Source Branch:</span>
                        <span class="meta-value">${this._escapeHtml(sourceBranch)}</span>
                    </div>
                    <div class="meta-row">
                        <span class="meta-label">Queued:</span>
                        <span class="meta-value">${this._escapeHtml(queueTime)}</span>
                    </div>
                    ${startTime !== 'N/A' ? `
                    <div class="meta-row">
                        <span class="meta-label">Started:</span>
                        <span class="meta-value">${this._escapeHtml(startTime)}</span>
                    </div>
                    ` : ''}
                    ${finishTime !== 'N/A' && run.status === BuildStatus.Completed ? `
                    <div class="meta-row">
                        <span class="meta-label">Finished:</span>
                        <span class="meta-value">${this._escapeHtml(finishTime)}</span>
                    </div>
                    ` : ''}
                </div>

                ${actionsHtml}

                <h2 style="margin-top: 24px;">Pipeline Stages</h2>
                ${stagesHtml}
            </div>
        `;

        return this._buildHtmlDocument(pipelineName + ' ' + buildNumber, contentHtml);
    }

    private _buildHtmlDocument(title: string, content: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>${this._escapeHtml(title)}</title>
    <style>
        ${this._getCustomCss()}
    </style>
</head>
<body>
    ${content}
    <script>
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (target.tagName === 'BUTTON' && target.dataset.action) {
                vscode.postMessage({ type: target.dataset.action });
            }
        });
    </script>
</body>
</html>`;
    }

    private _extractStages(timeline?: Timeline): TimelineRecord[] {
        if (!timeline || !timeline.records) {
            return [];
        }

        // Group records by type: Stage, Job, Task
        return timeline.records.filter(r => r.type === 'Stage') as TimelineRecord[];
    }

    private _renderStage(stage: TimelineRecord): string {
        const name = stage.name ?? 'Unknown Stage';
        const state = stage.state ?? 'unknown';
        const result = stage.result ?? 'unknown';
        const stateClass = this._getRecordClass(state, result);
        const stateLabel = this._getRecordLabel(state, result);

        return `
            <div class="stage-item">
                <div class="stage-header">
                    <span class="stage-name">${this._escapeHtml(name)}</span>
                    <span class="badge badge-${stateClass}">${stateLabel}</span>
                </div>
            </div>
        `;
    }

    private _getRecordClass(state: string, result: string): string {
        if (state === 'completed') {
            if (result === 'succeeded') {
                return 'succeeded';
            } else if (result === 'failed') {
                return 'failed';
            } else if (result === 'partiallySucceeded') {
                return 'warning';
            } else {
                return 'other';
            }
        } else if (state === 'inProgress') {
            return 'inprogress';
        }
        return 'other';
    }

    private _getRecordLabel(state: string, result: string): string {
        if (state === 'completed') {
            if (result === 'succeeded') {
                return 'Succeeded';
            } else if (result === 'failed') {
                return 'Failed';
            } else if (result === 'partiallySucceeded') {
                return 'Partially Succeeded';
            } else {
                return 'Completed';
            }
        } else if (state === 'inProgress') {
            return 'In Progress';
        }
        return 'Queued';
    }

    private _getStatusLabel(run: Build): string {
        const status = run.status;
        const result = run.result;

        if (status === BuildStatus.Completed) {
            if (result === BuildResult.Succeeded) {
                return 'Succeeded';
            } else if (result === BuildResult.PartiallySucceeded) {
                return 'Partially Succeeded';
            } else if (result === BuildResult.Failed) {
                return 'Failed';
            } else if (result === BuildResult.Canceled) {
                return 'Canceled';
            } else {
                return 'Completed';
            }
        } else if (status === BuildStatus.InProgress) {
            return 'In Progress';
        } else if (status === BuildStatus.NotStarted) {
            return 'Queued';
        } else if (status === BuildStatus.Cancelling) {
            return 'Cancelling';
        } else {
            return 'Unknown';
        }
    }

    private _getStatusClass(run: Build): string {
        const status = run.status;
        const result = run.result;

        if (status === BuildStatus.Completed) {
            if (result === BuildResult.Succeeded) {
                return 'succeeded';
            } else if (result === BuildResult.Failed) {
                return 'failed';
            } else if (result === BuildResult.PartiallySucceeded) {
                return 'warning';
            }
        } else if (status === BuildStatus.InProgress) {
            return 'inprogress';
        }
        return 'other';
    }

    private _getCustomCss(): string {
        return `
            .container { padding: 20px; }
            .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 0.85em; font-weight: 600; margin: 8px 0; }
            .badge-succeeded { background: var(--vscode-charts-green); color: #fff; }
            .badge-failed { background: var(--vscode-charts-red); color: #fff; }
            .badge-inprogress { background: var(--vscode-charts-blue); color: #fff; }
            .badge-warning { background: var(--vscode-charts-yellow); color: #000; }
            .badge-other { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
            .meta-section { margin: 16px 0; }
            .meta-row { display: flex; padding: 4px 0; }
            .meta-label { font-weight: 600; width: 150px; color: var(--vscode-descriptionForeground); }
            .meta-value { flex: 1; }
            .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em; }
            .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
            .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
            .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
            .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
            .stage-item { margin: 8px 0; padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
            .stage-header { display: flex; justify-content: space-between; align-items: center; }
            .stage-name { font-weight: 600; }
        `;
    }

    private async _handleMessage(msg: { type: string }): Promise<void> {
        switch (msg.type) {
            case 'open-in-browser': {
                const org = this._scope.organization ?? '';
                const project = this._scope.project ?? '';
                const buildId = this._run.id ?? 0;
                const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_build/results?buildId=${buildId}`;
                void vscode.env.openExternal(vscode.Uri.parse(url));
                break;
            }
            case 'refresh':
                await this._refresh();
                break;
            case 'rerun': {
                const definitionId = this._run.definition?.id;
                const project = this._scope.project ?? '';
                const org = this._scope.organization;
                if (definitionId && project) {
                    try {
                        const newRun = await this._client.queuePipelineRun(
                            project,
                            definitionId,
                            this._run.sourceBranch,
                            org
                        );
                        if (newRun) {
                            void vscode.window.showInformationMessage(`Pipeline run #${newRun.buildNumber ?? newRun.id} queued.`);
                        }
                    } catch (err) {
                        showErrorMessage(`Failed to queue pipeline run: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
                break;
            }
            case 'cancel': {
                const buildId = this._run.id;
                const project = this._scope.project ?? '';
                const org = this._scope.organization;
                if (buildId && project) {
                    try {
                        await this._client.cancelPipelineRun(project, buildId, org);
                        void vscode.window.showInformationMessage(`Pipeline run canceled.`);
                        await this._refresh();
                    } catch (err) {
                        showErrorMessage(`Failed to cancel pipeline run: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
                break;
            }
        }
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    public dispose(): void {
        const buildId = this._run.id ?? 0;
        const org = this._scope.organization ?? '';
        const proj = this._scope.project ?? '';
        const panelKey = `${org}\0${proj}\0${buildId}`;
        PipelineDetailsPanel._panels.delete(panelKey);

        this._panel.dispose();
        for (const d of this._disposables) {
            d.dispose();
        }
    }
}
