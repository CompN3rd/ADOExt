import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import type { PipelineRunNode } from '../providers/pipelinesProvider';
import { PipelineRunDetailsPanel } from '../views/pipelineRunDetailsPanel';
import { showErrorMessage, showInformationMessage } from '../utils/notifications';

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
    if (!node?.build?.id) {
        showInformationMessage('Select a pipeline run first.');
        return;
    }

    const organization = node.organization ?? client.organization ?? config.organization;
    const project = node.project ?? config.project;
    const buildId = node.build.id;

    try {
        await vscode.env.openExternal(vscode.Uri.parse(buildResultsUrl(organization, project, buildId, 'results')));
    } catch (err) {
        showErrorMessage(`Failed to open pipeline run: ${err}`);
    }
}

export async function openPipelineRunLogsInBrowser(
    node: PipelineRunNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    if (!node?.build?.id) {
        showInformationMessage('Select a pipeline run first.');
        return;
    }

    const organization = node.organization ?? client.organization ?? config.organization;
    const project = node.project ?? config.project;
    const buildId = node.build.id;

    try {
        await vscode.env.openExternal(vscode.Uri.parse(buildResultsUrl(organization, project, buildId, 'logs')));
    } catch (err) {
        showErrorMessage(`Failed to open pipeline logs: ${err}`);
    }
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

    try {
        await client.cancelPipelineRun(project, buildId, organization);
        showInformationMessage('Cancel requested.');
        return true;
    } catch (err) {
        showErrorMessage(`Failed to cancel pipeline run: ${err}`);
        return false;
    }
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
