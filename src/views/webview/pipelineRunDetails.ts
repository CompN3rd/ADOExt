import { LitElement, css, html, nothing, type PropertyDeclarations } from 'lit';
import type { PipelineRunDetailsMessage, PipelineRunDetailsViewModel, PipelineTimelineNodeViewModel } from '../webviewTypes';
import { postMessage, readInitialData } from './vscodeApi';

class AdoPipelineRunDetailsApp extends LitElement {
    static properties: PropertyDeclarations = {
        data: { state: true }
    };

    static styles = css`
        :host { display: block; }
        * { box-sizing: border-box; }
        .shell { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; min-height: 100vh; }
        h1 { font-size: 1.3em; margin: 0 0 4px; line-height: 1.35; }
        .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 12px; }
        .toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
        button { padding: 4px 10px; border-radius: 3px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; font-family: inherit; font-size: 0.85em; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-link { background: transparent; color: var(--vscode-textLink-foreground); border: none; padding: 0 2px; text-decoration: underline; }
        .btn-link:hover { color: var(--vscode-textLink-activeForeground); }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .btn-danger { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-inputValidation-errorForeground, #f48771); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); }
        .btn-danger:hover { opacity: 0.9; }
        .section { margin-bottom: 20px; }
        .section h2 { font-size: 1em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; margin-bottom: 8px; }
        .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
        .artifacts { display: flex; flex-direction: column; gap: 8px; }
        .artifact { display: flex; gap: 8px; align-items: center; }
        .artifact-name { flex: 1; min-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .timeline { margin: 0; padding-left: 18px; }
        .timeline li { margin: 4px 0; }
        .node { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
        .badge-succeeded { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
        .badge-failed { color: var(--vscode-charts-red); border-color: var(--vscode-charts-red); }
        .badge-running { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
        .badge-canceled { color: var(--vscode-descriptionForeground); border-color: var(--vscode-descriptionForeground); }
        code { font-family: var(--vscode-editor-font-family); }
    `;

    data: PipelineRunDetailsViewModel = readInitialData<PipelineRunDetailsViewModel>();

    render() {
        const subtitleParts = [
            this.data.statusLabel,
            this.data.branch ? `Branch: ${this.data.branch}` : '',
            this.data.requestedBy ? `Requested by: ${this.data.requestedBy}` : '',
            this.data.reason ? `Reason: ${this.data.reason}` : '',
            this.data.duration ? `Duration: ${this.data.duration}` : ''
        ].filter(Boolean);

        return html`<main class="shell">
            <div class="toolbar">
                <button class="btn-secondary" @click=${() => this.send({ type: 'refresh' })}>Refresh</button>
                <button class="btn-primary" @click=${() => this.send({ type: 'openInBrowser' })}>Open in Browser</button>
                <button class="btn-secondary" @click=${() => this.send({ type: 'openLogs' })}>Open Logs</button>
                <button class="btn-secondary" ?disabled=${!this.data.canRerun} @click=${() => this.send({ type: 'rerun' })}>Re-run</button>
                <button class="btn-danger" ?disabled=${!this.data.canCancel} @click=${() => this.send({ type: 'cancel' })}>Cancel</button>
            </div>

            <h1>${this.data.pipelineName} #${this.data.runNumber}</h1>
            <div class="meta">
                ${subtitleParts.join(' · ')}
                ${this.data.repository ? html`<div>Repo: <code>${this.data.repository}</code></div>` : nothing}
                ${this.data.commit ? html`<div>Commit: <code>${this.data.commit}</code></div>` : nothing}
                ${this.data.yamlFile ? html`<div>YAML: <code>${this.data.yamlFile}</code></div>` : nothing}
                ${this.data.startTime ? html`<div>Started: ${this.data.startTime}${this.data.finishTime ? html` · Finished: ${this.data.finishTime}` : nothing}</div>` : nothing}
            </div>

            <section class="section">
                <h2>Timeline</h2>
                ${this.data.timeline.length === 0
                    ? html`<p class="empty">No stage/job timeline available.</p>`
                    : html`${this.renderTimeline(this.data.timeline)}`}
            </section>

            ${this.renderAgentDiagnostics()}

            <section class="section">
                <h2>Artifacts</h2>
                ${this.data.artifacts.length === 0
                    ? html`<p class="empty">No artifacts found.</p>`
                    : html`<div class="artifacts">
                        ${this.data.artifacts.map(artifact => html`<div class="artifact">
                            <span class="artifact-name" title=${artifact.name}>${artifact.name}</span>
                            ${artifact.downloadUrl
                                ? html`<button class="btn-secondary" @click=${() => this.send({ type: 'openArtifact', url: artifact.downloadUrl })}>Open</button>`
                                : html`<button class="btn-secondary" disabled>Open</button>`}
                        </div>`)}
                    </div>`}
            </section>
        </main>`;
    }

    private renderAgentDiagnostics(): unknown {
        const diagnostics = this.data.agentDiagnostics;
        const isQueued = this.data.statusLabel.toLowerCase().includes('queued');
        if (!diagnostics && !isQueued) {
            return nothing;
        }

        if (!diagnostics) {
            return html`<section class="section">
                <h2>Agent Pool Diagnostics</h2>
                <p class="empty">Agent pool details are not available for this run.</p>
            </section>`;
        }

        const hint = diagnostics.hint ?? '';
        const busy = diagnostics.busyAgentSummary ?? [];

        return html`<section class="section">
            <h2>Agent Pool Diagnostics</h2>
            <div class="toolbar">
                <button class="btn-secondary" @click=${() => this.send({ type: 'openAgentPool' })}>Open Pool</button>
                <button class="btn-secondary" @click=${() => this.send({ type: 'openAgentQueue' })}>Open Queue</button>
                <button class="btn-secondary" @click=${() => this.send({ type: 'copyAgentDiagnostics' })}>Copy Summary</button>
            </div>
            ${hint ? html`<div class="meta">${hint}</div>` : nothing}
            <div class="meta">
                <div>Pool: <code>${diagnostics.poolName}</code> (ID: ${diagnostics.poolId})</div>
                <div>Queue: <code>${diagnostics.queueName}</code> (ID: ${diagnostics.queueId})</div>
                <div>Online: ${diagnostics.onlineAgents} · Offline: ${diagnostics.offlineAgents} · Busy: ${diagnostics.busyAgents} · Idle: ${diagnostics.idleAgents}</div>
                <div>Pending requests: ${diagnostics.pendingRequestsLabel}</div>
            </div>
            ${busy.length === 0
                ? html`<p class="empty">No busy agents reported.</p>`
                : html`<ul class="timeline">
                    ${busy.map(agent => html`<li>
                        <div class="node">
                            <span>${agent.name}</span>
                            ${agent.currentJobName ? html`<span class="meta">· ${agent.currentJobName}</span>` : nothing}
                        </div>
                    </li>`)}
                </ul>`}
        </section>`;
    }

    private renderTimeline(nodes: PipelineTimelineNodeViewModel[]): unknown {
        return html`<ul class="timeline">
            ${nodes.map(node => html`<li>
                <div class="node">
                    <span class="badge ${this.badgeClass(node.statusKind)}">${node.statusLabel || node.statusKind}</span>
                    <span>${node.name}</span>
                    ${node.duration ? html`<span class="meta">${node.duration}</span>` : nothing}
                    ${node.logId ? html`<button class="btn-link" title="Open step log" @click=${() => this.send({ type: 'openStepLog', logId: node.logId!, stepName: node.name })}>Log</button>` : nothing}
                </div>
                ${node.children.length > 0 ? this.renderTimeline(node.children) : nothing}
            </li>`)}
        </ul>`;
    }

    private badgeClass(kind: PipelineTimelineNodeViewModel['statusKind']): string {
        switch (kind) {
            case 'succeeded':
                return 'badge-succeeded';
            case 'failed':
                return 'badge-failed';
            case 'running':
                return 'badge-running';
            case 'canceled':
                return 'badge-canceled';
            default:
                return '';
        }
    }

    private send(message: PipelineRunDetailsMessage): void {
        postMessage(message);
    }
}

customElements.define('ado-pipeline-run-details-app', AdoPipelineRunDetailsApp);
