import * as vscode from 'vscode';
import type { AdoClient, AgentPoolDiagnostics, Build, BuildArtifact, Timeline } from '../api/adoClient';
import { BuildReason, BuildResult, BuildStatus } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { showErrorMessage, showInformationMessage } from '../utils/notifications';
import { agentPoolUrl, agentQueueUrl, pipelineRunUrl } from '../utils/pipelineUrls';
import { createPipelineLogUri } from './pipelineLogContentProvider';
import { buildMessageDocument, buildWebviewDocument, webviewAssetRoots } from './webviewHtml';
import type {
    AgentPoolDiagnosticsViewModel,
    PipelineArtifactViewModel,
    PipelineRunDetailsMessage,
    PipelineRunDetailsViewModel,
    PipelineTimelineNodeViewModel,
    PipelineTimelineStatusKind
} from './webviewTypes';

interface PipelinePanelScope {
    organization?: string;
    project?: string;
}

interface TimelineRecordLike {
    id?: string;
    parentId?: string;
    name?: string;
    type?: string;
    state?: unknown;
    result?: unknown;
    startTime?: Date;
    finishTime?: Date;
    order?: number;
    log?: { id?: number; url?: string };
}

export class PipelineRunDetailsPanel {
    private static _panels = new Map<string, PipelineRunDetailsPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _panelKey: string;
    private readonly _organization?: string;
    private readonly _project?: string;
    private _buildId: number;
    private _agentDiagnosticsSummary = '';
    private _agentDiagnosticsUrls: { poolUrl: string; queueUrl: string } | undefined;
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

        let agentDiagnostics: AgentPoolDiagnostics | undefined;
        if (build.status === BuildStatus.NotStarted) {
            try {
                agentDiagnostics = await client.getAgentPoolDiagnosticsForQueue(project, build.queue?.id, organization);
            } catch {
                agentDiagnostics = undefined;
            }
        }

        const viewModel = buildViewModel(build, timeline, artifacts, organization, project, agentDiagnostics);
        this._agentDiagnosticsSummary = viewModel.agentDiagnostics ? formatAgentDiagnosticsSummary(viewModel) : '';
        this._agentDiagnosticsUrls = viewModel.agentDiagnostics
            ? { poolUrl: viewModel.agentDiagnostics.poolUrl, queueUrl: viewModel.agentDiagnostics.queueUrl }
            : undefined;
        this._panel.title = `${viewModel.pipelineName} #${viewModel.runNumber}`;
        this._panel.webview.html = buildWebviewDocument(this._context, this._panel.webview, {
            title: `Pipeline Run #${viewModel.runNumber}`,
            entry: 'pipelineRunDetails.js',
            appTag: 'ado-pipeline-run-details-app',
            data: viewModel
        });
    }

    private async _handleMessage(msg: PipelineRunDetailsMessage): Promise<void> {
        const project = this._project ?? this._config.project;
        const organization = this._organization ?? this._client.organization ?? this._config.organization;
        if (!project || !organization) {
            return;
        }

        switch (msg.type) {
            case 'refresh':
                await this._refresh(this._client, this._config);
                return;
            case 'openInBrowser':
                await vscode.env.openExternal(vscode.Uri.parse(pipelineRunUrl(organization, project, this._buildId, 'results')));
                return;
            case 'openLogs':
                await vscode.env.openExternal(vscode.Uri.parse(pipelineRunUrl(organization, project, this._buildId, 'logs')));
                return;
            case 'openStepLog': {
                const uri = createPipelineLogUri({
                    organization,
                    project,
                    buildId: this._buildId,
                    logId: msg.logId,
                    stepName: msg.stepName,
                    runLabel: this._panel.title
                });
                const document = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(document, { preview: false });
                return;
            }
            case 'openArtifact':
                if (msg.url) {
                    await vscode.env.openExternal(vscode.Uri.parse(msg.url));
                }
                return;
            case 'openAgentPool': {
                const url = this._agentDiagnosticsUrls?.poolUrl ?? agentPoolUrl(organization);
                await vscode.env.openExternal(vscode.Uri.parse(url));
                return;
            }
            case 'openAgentQueue': {
                const url = this._agentDiagnosticsUrls?.queueUrl ?? agentQueueUrl(organization, project);
                await vscode.env.openExternal(vscode.Uri.parse(url));
                return;
            }
            case 'copyAgentDiagnostics': {
                if (!this._agentDiagnosticsSummary) {
                    showInformationMessage('No agent diagnostics available for this run.');
                    return;
                }
                await vscode.env.clipboard.writeText(this._agentDiagnosticsSummary);
                showInformationMessage('Copied agent diagnostics to clipboard.');
                return;
            }
            case 'rerun': {
                const choice = await vscode.window.showInformationMessage(
                    `Re-run pipeline #${this._buildId}?`,
                    { modal: true },
                    'Re-run'
                );
                if (choice !== 'Re-run') {
                    return;
                }

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
            case 'cancel': {
                const choice = await vscode.window.showWarningMessage(
                    `Cancel pipeline run #${this._buildId}?`,
                    { modal: true },
                    'Cancel Run'
                );
                if (choice !== 'Cancel Run') {
                    return;
                }

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
    project: string,
    agentDiagnostics: AgentPoolDiagnostics | undefined
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

    const agentDiagnosticsRequested = build.status === BuildStatus.NotStarted;

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
        webUrl: pipelineRunUrl(organization, project, id, 'results'),
        logsUrl: pipelineRunUrl(organization, project, id, 'logs'),
        artifacts: artifacts.map(artifactViewModel),
        timeline: buildTimelineViewModel(timeline),
        agentDiagnosticsRequested,
        agentDiagnostics: agentDiagnostics
            ? toAgentDiagnosticsViewModel(agentDiagnostics, organization, project)
            : undefined
    };
}

function toAgentDiagnosticsViewModel(
    diagnostics: AgentPoolDiagnostics,
    organization: string,
    project: string
): AgentPoolDiagnosticsViewModel {
    let hint: string | undefined;
    if (diagnostics.onlineAgents === 0) {
        hint = 'All agents in this pool are currently offline. The run will start once an agent comes back online.';
    } else if (diagnostics.idleAgents === 0) {
        hint = 'All online agents are busy. The run is waiting for one to become available.';
    }

    return {
        poolName: diagnostics.poolName,
        poolId: diagnostics.poolId,
        queueName: diagnostics.queueName,
        queueId: diagnostics.queueId,
        onlineAgents: diagnostics.onlineAgents,
        offlineAgents: diagnostics.offlineAgents,
        busyAgents: diagnostics.busyAgents,
        idleAgents: diagnostics.idleAgents,
        pendingRequestsLabel: diagnostics.pendingRequestsLabel,
        busyAgentSummary: diagnostics.busyAgentSummary.map(agent => ({
            name: agent.name,
            currentJobName: agent.currentJobName
        })),
        poolUrl: agentPoolUrl(organization, diagnostics.poolId),
        queueUrl: agentQueueUrl(organization, project, diagnostics.queueId),
        hint
    };
}

function formatAgentDiagnosticsSummary(viewModel: PipelineRunDetailsViewModel): string {
    const d = viewModel.agentDiagnostics;
    if (!d) {
        return '';
    }

    const busyLines = d.busyAgentSummary
        .map(agent => `- ${agent.name}${agent.currentJobName ? `: ${agent.currentJobName}` : ''}`)
        .join('\n');

    return [
        `Pipeline: ${viewModel.pipelineName} #${viewModel.runNumber}`,
        `Status: ${viewModel.statusLabel}`,
        `Pool: ${d.poolName} (ID: ${d.poolId})`,
        `Queue: ${d.queueName} (ID: ${d.queueId})`,
        `Online: ${d.onlineAgents} | Offline: ${d.offlineAgents} | Busy: ${d.busyAgents} | Idle: ${d.idleAgents}`,
        `Pending requests: ${d.pendingRequestsLabel}`,
        busyLines ? `Busy agents:\n${busyLines}` : 'Busy agents: none',
        `Pool URL: ${d.poolUrl}`,
        `Queue URL: ${d.queueUrl}`
    ].join('\n');
}

function artifactViewModel(artifact: BuildArtifact): PipelineArtifactViewModel {
    return {
        name: artifact.name ?? '(unnamed artifact)',
        downloadUrl: artifact.resource?.downloadUrl ?? ''
    };
}

function buildTimelineViewModel(timeline: Timeline | undefined): PipelineTimelineNodeViewModel[] {
    const records = (timeline?.records ?? []) as TimelineRecordLike[];
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
            logId: record.log?.id,
            order: record.order,
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

    return sortTimelineTree(roots);
}

function sortTimelineTree(nodes: PipelineTimelineNodeViewModel[]): PipelineTimelineNodeViewModel[] {
    const sorted = [...nodes].sort((left, right) => {
        const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return left.name.localeCompare(right.name);
    });
    for (const node of sorted) {
        node.children = sortTimelineTree(node.children);
    }
    return sorted;
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
    return build.status === BuildStatus.InProgress ||
        build.status === BuildStatus.NotStarted ||
        build.status === BuildStatus.Cancelling;
}

function buildStatusLabel(build: Build): string {
    if (isBuildRunning(build)) {
        if (build.status === BuildStatus.NotStarted) {
            return 'Queued';
        }
        if (build.status === BuildStatus.Cancelling) {
            return 'Cancelling';
        }
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
    const stateText = timelineText(state);
    const resultText = timelineText(result);
    if (stateText) {
        return resultText ? `${stateText} (${resultText})` : stateText;
    }
    return resultText;
}

function recordStatusKind(state?: unknown, result?: unknown): PipelineTimelineStatusKind {
    const stateText = timelineText(state).toLowerCase();
    const resultText = timelineText(result).toLowerCase();
    if (stateText.includes('inprogress') || stateText.includes('in progress') || stateText.includes('running')) {
        return 'running';
    }
    if (resultText.includes('succeeded') && !resultText.includes('partial')) {
        return 'succeeded';
    }
    if (resultText.includes('failed') || resultText.includes('partial')) {
        return 'failed';
    }
    if (resultText.includes('canceled') || resultText.includes('cancelled') || stateText.includes('cancel')) {
        return 'canceled';
    }
    return 'other';
}

function timelineText(value?: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    return String(value);
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
