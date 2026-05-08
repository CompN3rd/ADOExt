import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import type { PipelineRunNode } from '../providers/pipelinesProvider';
import { PipelineRunDetailsPanel } from '../views/pipelineRunDetailsPanel';
import { showErrorMessage, showInformationMessage } from '../utils/notifications';
import { pipelineRunUrl } from '../utils/pipelineUrls';

export async function viewPipelineRunDetails(
    context: vscode.ExtensionContext,
    node: PipelineRunNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    if (!node?.build?.id) {
        showInformationMessage('Select a pipeline run first.');
        return;
    }

    await PipelineRunDetailsPanel.show(context, client, config, node.build.id, {
        organization: node.organization,
        project: node.project
    });
}

export async function openPipelineRunInBrowser(
    node: PipelineRunNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    await openPipelineRunUrl(node, client, config, 'results');
}

export async function openPipelineRunLogsInBrowser(
    node: PipelineRunNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    await openPipelineRunUrl(node, client, config, 'logs');
}

export async function rerunPipelineRun(
    node: PipelineRunNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<number | undefined> {
    if (!node?.build?.id) {
        showInformationMessage('Select a pipeline run first.');
        return undefined;
    }

    const organization = node.organization ?? client.organization ?? config.organization;
    const project = node.project ?? config.project;
    const buildId = node.build.id;
    if (!organization || !project) {
        showInformationMessage('Select an organization and project first.');
        return undefined;
    }

    const runLabel = node.build.buildNumber ?? String(buildId);
    const choice = await vscode.window.showInformationMessage(
        `Re-run pipeline #${runLabel}?`,
        { modal: true },
        'Re-run'
    );
    if (choice !== 'Re-run') {
        return undefined;
    }

    try {
        const queued = await client.rerunPipelineRun(project, buildId, organization);
        const newId = queued.id;
        showInformationMessage(`Queued pipeline run #${queued.buildNumber ?? String(newId ?? '')}.`);
        return newId;
    } catch (err) {
        showErrorMessage(`Failed to queue pipeline run: ${err}`);
        return undefined;
    }
}

export async function cancelPipelineRun(
    node: PipelineRunNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    if (!node?.build?.id) {
        showInformationMessage('Select a pipeline run first.');
        return false;
    }

    const organization = node.organization ?? client.organization ?? config.organization;
    const project = node.project ?? config.project;
    const buildId = node.build.id;
    if (!organization || !project) {
        showInformationMessage('Select an organization and project first.');
        return false;
    }

    const runLabel = node.build.buildNumber ?? String(buildId);
    const choice = await vscode.window.showWarningMessage(
        `Cancel pipeline run #${runLabel}?`,
        { modal: true },
        'Cancel Run'
    );
    if (choice !== 'Cancel Run') {
        return false;
    }

    try {
        await client.cancelPipelineRun(project, buildId, organization);
        showInformationMessage('Cancel requested.');
        return true;
    } catch (err) {
        showErrorMessage(`Failed to cancel pipeline run: ${err}`);
        return false;
    }
}

async function openPipelineRunUrl(
    node: PipelineRunNode | undefined,
    client: AdoClient,
    config: ConfigManager,
    view: 'results' | 'logs'
): Promise<void> {
    if (!node?.build?.id) {
        showInformationMessage('Select a pipeline run first.');
        return;
    }

    const organization = node.organization ?? client.organization ?? config.organization;
    const project = node.project ?? config.project;
    const buildId = node.build.id;
    if (!organization || !project) {
        showInformationMessage('Select an organization and project first.');
        return;
    }

    try {
        await vscode.env.openExternal(vscode.Uri.parse(pipelineRunUrl(organization, project, buildId, view)));
    } catch (err) {
        showErrorMessage(`Failed to open pipeline run: ${err}`);
    }
}