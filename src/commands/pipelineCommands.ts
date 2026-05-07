import * as vscode from 'vscode';
import type { PipelineRunNode } from '../providers/pipelineProvider';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';

function getPipelineRunWebScope(
    node: PipelineRunNode,
    client: AdoClient,
    config: ConfigManager
): { org?: string; project?: string } {
    return {
        org: node.organization ?? client.organization ?? config.organization,
        project: node.project ?? config.project
    };
}

/**
 * Open a pipeline run in the Azure DevOps web UI.
 */
export function openPipelineRun(
    node: PipelineRunNode,
    client: AdoClient,
    config: ConfigManager
): void {
    const run = node.run;
    const { org, project } = getPipelineRunWebScope(node, client, config);
    const buildId = run.id ?? 0;

    if (!org || !project || !buildId) {
        showWarningMessage('Unable to determine pipeline run details.');
        return;
    }

    const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_build/results?buildId=${buildId}`;
    void vscode.env.openExternal(vscode.Uri.parse(url));
}

/**
 * View pipeline run details in a webview panel.
 */
export async function viewPipelineRunDetails(
    node: PipelineRunNode,
    context: vscode.ExtensionContext,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    const { PipelineDetailsPanel } = await import('../views/pipelineDetailsPanel');
    await PipelineDetailsPanel.show(context, client, config, node.run, {
        organization: node.organization ?? client.organization ?? config.organization,
        project: node.project ?? config.project
    });
}

/**
 * Trigger a new run of a pipeline.
 */
export async function runPipeline(
    node: PipelineRunNode,
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    const run = node.run;
    const { org, project } = getPipelineRunWebScope(node, client, config);
    const definitionId = run.definition?.id;

    if (!org || !project || !definitionId) {
        showWarningMessage('Unable to determine pipeline definition.');
        return false;
    }

    const sourceBranch = run.sourceBranch;
    const branchPrompt = sourceBranch
        ? `Re-run ${run.definition?.name ?? 'pipeline'} on ${sourceBranch.replace('refs/heads/', '')}?`
        : `Run ${run.definition?.name ?? 'pipeline'}?`;

    const choice = await vscode.window.showInformationMessage(
        branchPrompt,
        { modal: true },
        'Run'
    );

    if (choice !== 'Run') {
        return false;
    }

    try {
        const newRun = await client.queuePipelineRun(project, definitionId, sourceBranch, org);
        if (newRun) {
            showInformationMessage(`Pipeline run #${newRun.buildNumber ?? newRun.id} queued.`);
            return true;
        } else {
            showErrorMessage('Failed to queue pipeline run.');
            return false;
        }
    } catch (err) {
        showErrorMessage(`Failed to queue pipeline run: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}

/**
 * Cancel a running pipeline.
 */
export async function cancelPipelineRun(
    node: PipelineRunNode,
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    const run = node.run;
    const { org, project } = getPipelineRunWebScope(node, client, config);
    const buildId = run.id;

    if (!org || !project || !buildId) {
        showWarningMessage('Unable to determine pipeline run details.');
        return false;
    }

    const choice = await vscode.window.showWarningMessage(
        `Cancel pipeline run #${run.buildNumber ?? buildId}?`,
        { modal: true },
        'Cancel Run'
    );

    if (choice !== 'Cancel Run') {
        return false;
    }

    try {
        const canceledRun = await client.cancelPipelineRun(project, buildId, org);
        if (canceledRun) {
            showInformationMessage(`Pipeline run #${run.buildNumber ?? buildId} canceled.`);
            return true;
        } else {
            showErrorMessage('Failed to cancel pipeline run.');
            return false;
        }
    } catch (err) {
        showErrorMessage(`Failed to cancel pipeline run: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}
