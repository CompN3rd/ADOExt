import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { ClassicReleaseEnvironmentNode, type ClassicReleaseNode } from '../providers/deploymentsProvider';
import { ReleaseDetailsPanel } from '../views/releaseDetailsPanel';
import { showErrorMessage, showInformationMessage } from '../utils/notifications';
import { classicReleaseUrl } from '../utils/releaseUrls';

export async function viewReleaseDetails(
    context: vscode.ExtensionContext,
    node: ClassicReleaseNode | ClassicReleaseEnvironmentNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    const releaseId = node instanceof ClassicReleaseEnvironmentNode ? node.releaseId : node?.releaseId;
    if (!releaseId) {
        showInformationMessage('Select a release first.');
        return;
    }
    if (!node) {
        return;
    }

    await ReleaseDetailsPanel.show(context, client, config, releaseId, {
        organization: node.organization,
        project: node.project
    });
}

export async function openClassicReleaseInBrowser(
    node: ClassicReleaseNode | ClassicReleaseEnvironmentNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    const organization = node?.organization ?? client.organization ?? config.organization;
    const project = node?.project ?? config.project;
    const releaseId = node instanceof ClassicReleaseEnvironmentNode ? node.releaseId : node?.releaseId;
    if (!organization || !project || !releaseId) {
        showInformationMessage('Select an organization, project, and release first.');
        return;
    }

    try {
        await vscode.env.openExternal(vscode.Uri.parse(classicReleaseUrl(organization, project, releaseId)));
    } catch (err) {
        showErrorMessage(`Failed to open release: ${err}`);
    }
}

export async function openClassicReleaseEnvironmentInBrowser(
    node: ClassicReleaseEnvironmentNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    if (!node) {
        showInformationMessage('Select a release environment first.');
        return;
    }

    const organization = node.organization ?? client.organization ?? config.organization;
    const project = node.project ?? config.project;
    const releaseId = node.releaseId;
    const environmentId = node.environmentId;
    if (!organization || !project || !releaseId || !environmentId) {
        showInformationMessage('Select an organization and project first.');
        return;
    }

    try {
        await vscode.env.openExternal(vscode.Uri.parse(classicReleaseUrl(organization, project, releaseId, { environmentId })));
    } catch (err) {
        showErrorMessage(`Failed to open release environment: ${err}`);
    }
}
