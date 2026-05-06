import { BuildStatus, BuildResult } from 'azure-devops-node-api/interfaces/BuildInterfaces';
import type { Build } from '../api/adoClient';
import type { BuildSummaryStatusKind, BuildSummaryViewModel } from './webviewTypes';

/**
 * Escapes HTML special characters in a string.
 */
function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escAttr(text: string): string {
    return esc(text).replace(/'/g, '&#39;');
}

/**
 * CSS styles required to render build summary items.
 * Intended to be embedded in a webview `<style>` block.
 */
export const BUILD_SUMMARY_CSS = `
  .build-item { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 6px; }
  .build-status { font-size: 0.8em; font-weight: 600; padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
  .build-status-succeeded { background: var(--vscode-charts-green); color: #fff; }
  .build-status-failed { background: var(--vscode-charts-red); color: #fff; }
  .build-status-inprogress { background: var(--vscode-charts-blue); color: #fff; }
  .build-status-other { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .build-name { flex: 1; font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .build-meta { font-size: 0.8em; color: var(--vscode-descriptionForeground); white-space: nowrap; }`;

export function buildSummaryData(build: Build): BuildSummaryViewModel {
    const buildId = build.id ?? 0;
    const buildNumber = build.buildNumber ?? `#${buildId}`;
    const definitionName = build.definition?.name ?? 'Unknown pipeline';
    const requestedFor = build.requestedFor?.displayName ?? '';
    const startTime = build.startTime ? new Date(build.startTime).toLocaleString() : '';

    let statusLabel: string;
    let statusKind: BuildSummaryStatusKind;
    const status = build.status;
    const result = build.result;
    if (status === BuildStatus.Completed) {
        if (result === BuildResult.Succeeded) {
            statusLabel = 'Succeeded';
            statusKind = 'succeeded';
        } else if (result === BuildResult.PartiallySucceeded) {
            statusLabel = 'Partially Succeeded';
            statusKind = 'other';
        } else if (result === BuildResult.Failed) {
            statusLabel = 'Failed';
            statusKind = 'failed';
        } else {
            statusLabel = 'Canceled';
            statusKind = 'other';
        }
    } else if (status === BuildStatus.InProgress) {
        statusLabel = 'In Progress';
        statusKind = 'inprogress';
    } else if (status === BuildStatus.NotStarted) {
        statusLabel = 'Queued';
        statusKind = 'other';
    } else {
        statusLabel = 'Unknown';
        statusKind = 'other';
    }

    return {
        id: buildId,
        buildNumber,
        definitionName,
        requestedFor,
        startTime,
        statusLabel,
        statusKind
    };
}

export function buildSummaryListHtml(builds: Build[], emptyLabel: string): string {
    const buildsJson = JSON.stringify(builds.map(buildSummaryData));
    return `<ado-build-list builds-json="${escAttr(buildsJson)}" empty-label="${escAttr(emptyLabel)}"></ado-build-list>`;
}

/**
 * Renders a single build as an HTML row with a status badge, build number,
 * pipeline name, requester, start time, and an "Open" button.
 */
export function buildSummaryHtml(build: Build): string {
    const viewModel = buildSummaryData(build);
    const buildNumber = esc(viewModel.buildNumber);
    const definitionName = esc(viewModel.definitionName);
    const requestedFor = esc(viewModel.requestedFor);
    const startTime = viewModel.startTime;
    const statusLabel = viewModel.statusLabel;
    const statusClass = `build-status-${viewModel.statusKind}`;

    const openBtn = viewModel.id
        ? `<button class="btn btn-secondary" data-action="open-build" data-build-id="${viewModel.id}">Open</button>`
        : '';

    const metaParts = [definitionName, requestedFor, startTime].filter(Boolean);
    const metaHtml = metaParts.length > 0
        ? `<span class="build-meta">${metaParts.join(' · ')}</span>`
        : '';

    return `<div class="build-item">
  <span class="build-status ${statusClass}">${statusLabel}</span>
  <span class="build-name">${buildNumber}</span>
  ${metaHtml}
  ${openBtn}
</div>`;
}
