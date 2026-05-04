import type { Build } from '../api/adoClient';
import { BuildStatus, BuildResult } from 'azure-devops-node-api/interfaces/BuildInterfaces';

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

/**
 * Renders a single build as an HTML row with a status badge, build number,
 * pipeline name, requester, start time, and an "Open" button.
 */
export function buildSummaryHtml(build: Build): string {
    const buildId = build.id ?? 0;
    const buildNumber = esc(build.buildNumber ?? `#${buildId}`);
    const definitionName = esc(build.definition?.name ?? 'Unknown pipeline');
    const requestedFor = esc(build.requestedFor?.displayName ?? '');
    const startTime = build.startTime ? new Date(build.startTime).toLocaleString() : '';

    // Determine label and CSS class from build status/result
    let statusLabel: string;
    let statusClass: string;
    const status = build.status;
    const result = build.result;
    if (status === BuildStatus.Completed) {
        if (result === BuildResult.Succeeded) {
            statusLabel = 'Succeeded';
            statusClass = 'build-status-succeeded';
        } else if (result === BuildResult.PartiallySucceeded) {
            statusLabel = 'Partially Succeeded';
            statusClass = 'build-status-other';
        } else if (result === BuildResult.Failed) {
            statusLabel = 'Failed';
            statusClass = 'build-status-failed';
        } else {
            statusLabel = 'Canceled';
            statusClass = 'build-status-other';
        }
    } else if (status === BuildStatus.InProgress) {
        statusLabel = 'In Progress';
        statusClass = 'build-status-inprogress';
    } else if (status === BuildStatus.NotStarted) {
        statusLabel = 'Queued';
        statusClass = 'build-status-other';
    } else {
        statusLabel = 'Unknown';
        statusClass = 'build-status-other';
    }

    const openBtn = buildId
        ? `<button class="btn btn-secondary" data-action="open-build" data-build-id="${buildId}">Open</button>`
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
