import * as vscode from 'vscode';
import type { AdoClient, Build, BuildArtifact, Timeline } from '../api/adoClient';
import { BuildReason, BuildResult, BuildStatus } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { showErrorMessage, showInformationMessage } from '../utils/notifications';
import { buildMessageDocument, buildWebviewDocument, webviewAssetRoots } from './webviewHtml';
import type {
    PipelineArtifactViewModel,
    PipelineRunDetailsMessage,
    PipelineRunDetailsViewModel,
    PipelineTimelineNodeViewModel
} from './webviewTypes';

interface PipelinePanelScope {
    organization?: string;
    project?: string;
}

export class PipelineRunDetailsPanel {
    private static _panels = new Map<string, PipelineRunDetailsPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _panelKey: string;
    private readonly _organization?: string;
    private readonly _project?: string;
    private _buildId: number;
    private _disposables: vscode.Disposable[] = [];

    static async show(
        context: vscode.ExtensionContext,
        client: AdoClient,
        config: ConfigManager,
        buildId: number,
        scope: PipelinePanelScope = {}
    ): Promise<void> {
        const key = PipelineRunDetailsPanel.panelKey(
            buildId,
            scope.organization ?? client.organization ?? config.organization,
            scope.project ?? config.project
        );
        const existing = PipelineRunDetailsPanel._panels.get(key);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            await existing._refresh(client, config);
            return;
        }
        new PipelineRunDetailsPanel(context, client, config, buildId, key, scope);
    }

    private constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        buildId: number,
        panelKey: string,
        scope: PipelinePanelScope
    ) {
        this._buildId = buildId;
        this._panelKey = panelKey;
        this._organization = scope.organization;
        this._project = scope.project;
        this._panel = vscode.window.createWebviewPanel(
            'adoext.pipelineRunDetails',
            `Pipeline Run #${buildId}`,
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

        PipelineRunDetailsPanel._panels.set(panelKey, this);
        void this._refresh(_client, _config);
    }

    private async _refresh(client: AdoClient, config: ConfigManager): Promise<void> {
        const project = this._project ?? config.project;
        const organization = this._organization ?? client.organization ?? config.organization;
        if (!project || !organization) {
            this._panel.webview.html = buildMessageDocument(this._panel.webview, 'Select an organization and project to view pipeline runs.');
            return;
        }

        const [buildResult, timelineResult, artifactsResult] = await Promise.allSettled([
            client.getPipelineRun(project, this._buildId, organization),
            client.getPipelineRunTimeline(project, this._buildId, organization),
            client.getPipelineRunArtifacts(project, this._buildId, organization)
        ]);

        if (buildResult.status !== 'fulfilled') {
            this._panel.webview.html = buildMessageDocument(this._panel.webview, `Failed to load pipeline run #${this._buildId}.`);
            return;
        }

        const build = buildResult.value;
        const timeline = timelineResult.status === 'fulfilled' ? timelineResult.value : undefined;
        const artifacts = artifactsResult.status === 'fulfilled' ? artifactsResult.value : [];

        const vm = buildViewModel(build, timeline, artifacts, organization, project);
        this._panel.title = `${vm.pipelineName} #${vm.runNumber}`;
        this._panel.webview.html = buildWebviewDocument(this._context, this._panel.webview, {
            title: `Pipeline Run #${vm.runNumber}`,
            entry: 'pipelineRunDetails.js',
            appTag: 'ado-pipeline-run-details-app',
            data: vm
        });
    }

    private async _handleMessage(msg: PipelineRunDetailsMessage): Promise<void> {
        const project = this._project ?? this._config.project;
        const organization = this._organization ?? this._client.organization ?? this._config.organization;
        if (!project || !organization) {
            return;
        }

        switch (msg.type) {
            case 'openInBrowser':
                await vscode.env.openExternal(vscode.Uri.parse(buildResultsUrl(organization, project, this._buildId, 'results')));
                return;
            case 'openLogs':
                await vscode.env.openExternal(vscode.Uri.parse(buildResultsUrl(organization, project, this._buildId, 'logs')));
                return;
            case 'openArtifact':
                if (msg.url) {
                    await vscode.env.openExternal(vscode.Uri.parse(msg.url));
                }
                return;
            case 'rerun': {
                try {
                    const queued = await this._client.rerunPipelineRun(project, this._buildId, organization);
                    const newId = queued.id ?? 0;
                    if (newId > 0) {
                        showInformationMessage(`Queued pipeline run #${queued.buildNumber ?? String(newId)}.`);
                        await PipelineRunDetailsPanel.show(this._context, this._client, this._config, newId, {
                            organization,
                            project
                        });
                    } else {
                        showInformationMessage('Queued pipeline run.');
                    }
                } catch (err) {
                    showErrorMessage(`Failed to queue pipeline run: ${err}`);
                }
                return;
            }
            case 'cancel':
                try {
                    await this._client.cancelPipelineRun(project, this._buildId, organization);
                    showInformationMessage('Cancel requested.');
                    await this._refresh(this._client, this._config);
                } catch (err) {
                    showErrorMessage(`Failed to cancel pipeline run: ${err}`);
                }
                return;
        }
    }

    private _dispose(): void {
        PipelineRunDetailsPanel._panels.delete(this._panelKey);
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }

    private static panelKey(buildId: number, organization?: string, project?: string): string {
        return `${organization ?? ''}\u0000${project ?? ''}\u0000${buildId}`;
    }
}

function buildViewModel(
    build: Build,
    timeline: Timeline | undefined,
    artifacts: BuildArtifact[],
    organization: string,
    project: string
): PipelineRunDetailsViewModel {
    const pipelineName = build.definition?.name ?? 'Pipeline';
    const runNumber = build.buildNumber ?? String(build.id ?? '');
    const id = build.id ?? 0;
    const branch = friendlyBranch(build.sourceBranch);
    const requestedBy = build.requestedFor?.displayName ?? '';
    const reason = reasonLabel(build.reason);
    const statusLabel = buildStatusLabel(build);
    const startTime = build.startTime ?? build.queueTime;
    const finishTime = build.finishTime;
    const duration = buildDurationLabel(build);
    const commit = build.sourceVersion ?? '';
    const repository = build.repository?.name ?? '';
    const yamlFile = (build as unknown as { yamlFilename?: string }).yamlFilename ?? '';

    return {
        id,
        pipelineName,
        runNumber,
        statusLabel,
        statusKind: statusKind(build),
        branch,
        requestedBy,
        reason,
        startTime: startTime ? new Date(startTime).toLocaleString() : '',
        finishTime: finishTime ? new Date(finishTime).toLocaleString() : '',
        duration,
        repository,
        commit,
        yamlFile,
        canRerun: !!build.definition?.id,
        canCancel: isBuildRunning(build),
        webUrl: buildResultsUrl(organization, project, id, 'results'),
        logsUrl: buildResultsUrl(organization, project, id, 'logs'),
        artifacts: artifacts.map(artifactViewModel),
        timeline: buildTimelineViewModel(timeline)
    };
}

function artifactViewModel(artifact: BuildArtifact): PipelineArtifactViewModel {
    const downloadUrl = artifact.resource?.downloadUrl ?? '';
    return {
        name: artifact.name ?? '(unnamed artifact)',
        downloadUrl
    };
}

function buildTimelineViewModel(timeline: Timeline | undefined): PipelineTimelineNodeViewModel[] {
    const records = timeline?.records ?? [];
    if (!Array.isArray(records) || records.length === 0) {
        return [];
    }

    const nodesById = new Map<string, PipelineTimelineNodeViewModel>();
    const parentById = new Map<string, string>();

    for (const record of records) {
        const id = record.id ?? '';
        if (!id) {
            continue;
        }
        parentById.set(id, record.parentId ?? '');
        nodesById.set(id, {
            id,
            name: record.name ?? '(unnamed)',
            recordType: record.type ?? '',
            statusLabel: recordStatusLabel(record.state, record.result),
            statusKind: recordStatusKind(record.state, record.result),
            startTime: record.startTime ? new Date(record.startTime).toLocaleString() : '',
            duration: recordDurationLabel(record.startTime, record.finishTime),
            children: []
        });
    }

    const roots: PipelineTimelineNodeViewModel[] = [];
    for (const [id, node] of nodesById.entries()) {
        const parentId = parentById.get(id) ?? '';
        const parent = parentId ? nodesById.get(parentId) : undefined;
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }

    const sortNode = (a: PipelineTimelineNodeViewModel, b: PipelineTimelineNodeViewModel) =>
        `${a.name}`.localeCompare(`${b.name}`);
    const sortTree = (nodes: PipelineTimelineNodeViewModel[]): PipelineTimelineNodeViewModel[] => {
        const sorted = [...nodes].sort(sortNode);
        for (const node of sorted) {
            node.children = sortTree(node.children);
        }
        return sorted;
    };

    return sortTree(roots);
}

function buildResultsUrl(
    organization: string,
    project: string,
    buildId: number,
    view: 'results' | 'logs'
): string {
    const org = encodeURIComponent(organization);
    const proj = encodeURIComponent(project);
    const base = `https://dev.azure.com/${org}/${proj}/_build/results?buildId=${encodeURIComponent(String(buildId))}`;
    return view === 'logs' ? `${base}&view=logs` : `${base}&view=results`;
}

function statusKind(build: Build): PipelineRunDetailsViewModel['statusKind'] {
    if (isBuildRunning(build)) {
        return 'running';
    }
    switch (build.result) {
        case BuildResult.Succeeded:
            return 'succeeded';
        case BuildResult.PartiallySucceeded:
        case BuildResult.Failed:
            return 'failed';
        case BuildResult.Canceled:
            return 'canceled';
        default:
            return 'other';
    }
}

function isBuildRunning(build: Build): boolean {
    return build.status === BuildStatus.InProgress || build.status === BuildStatus.NotStarted;
}

function buildStatusLabel(build: Build): string {
    if (isBuildRunning(build)) {
        return 'Running';
    }
    switch (build.result) {
        case BuildResult.Succeeded:
            return 'Succeeded';
        case BuildResult.PartiallySucceeded:
            return 'Partially succeeded';
        case BuildResult.Failed:
            return 'Failed';
        case BuildResult.Canceled:
            return 'Canceled';
        default:
            return build.status !== undefined ? String(build.status) : '';
    }
}

function buildDurationLabel(build: Build): string {
    const start = build.startTime ?? build.queueTime;
    if (!start) {
        return '';
    }
    const startMs = new Date(start).getTime();
    const endMs = build.finishTime ? new Date(build.finishTime).getTime() : Date.now();
    const durationMs = Math.max(0, endMs - startMs);
    return formatDuration(durationMs);
}

function recordDurationLabel(start?: Date, finish?: Date): string {
    if (!start) {
        return '';
    }
    const startMs = new Date(start).getTime();
    const endMs = finish ? new Date(finish).getTime() : Date.now();
    const durationMs = Math.max(0, endMs - startMs);
    return formatDuration(durationMs);
}

function formatDuration(ms: number): string {
    const secondsTotal = Math.floor(ms / 1000);
    const minutes = Math.floor(secondsTotal / 60);
    const seconds = secondsTotal % 60;
    const hours = Math.floor(minutes / 60);
    const minutesRemaining = minutes % 60;

    if (hours > 0) {
        return `${hours}h ${minutesRemaining}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

function recordStatusLabel(state?: unknown, result?: unknown): string {
    const stateText = typeof state === 'string' ? state : '';
    const resultText = typeof result === 'string' ? result : '';
    if (stateText) {
        return resultText ? `${stateText} (${resultText})` : stateText;
    }
    return resultText;
}

function recordStatusKind(state?: unknown, result?: unknown): PipelineTimelineNodeViewModel['statusKind'] {
    const stateText = typeof state === 'string' ? state.toLowerCase() : '';
    const resultText = typeof result === 'string' ? result.toLowerCase() : '';
    if (stateText.includes('inprogress') || stateText.includes('running')) {
        return 'running';
    }
    if (resultText.includes('succeeded')) {
        return 'succeeded';
    }
    if (resultText.includes('failed') || resultText.includes('canceled') || resultText.includes('cancelled')) {
        return resultText.includes('cancel') ? 'canceled' : 'failed';
    }
    return 'other';
}

function reasonLabel(reason?: BuildReason): string {
    const value = reason ?? 0;
    if (value & BuildReason.PullRequest) { return 'PR'; }
    if (value & BuildReason.Schedule) { return 'Scheduled'; }
    if (value & BuildReason.BatchedCI) { return 'Batched CI'; }
    if (value & BuildReason.IndividualCI) { return 'CI'; }
    if (value & BuildReason.Manual) { return 'Manual'; }
    return '';
}

function friendlyBranch(refName?: string): string {
    if (!refName) {
        return '';
    }
    if (refName.startsWith('refs/heads/')) {
        return refName.replace('refs/heads/', '');
    }
    if (refName.startsWith('refs/')) {
        return refName.replace('refs/', '');
    }
    return refName;
}

