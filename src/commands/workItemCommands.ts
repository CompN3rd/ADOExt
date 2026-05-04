import * as vscode from 'vscode';
import type { WorkItemNode } from '../providers/workItemProvider';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { WorkItemDetailsPanel } from '../views/workItemDetailsPanel';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';

/**
 * Show the work item details webview panel.
 */
export async function viewWorkItemDetails(
    node: WorkItemNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    if (!node) {
        showInformationMessage(
            'Select a work item first, then run "View Work Item Details".'
        );
        return;
    }

    await WorkItemDetailsPanel.show(client, config, node.workItem, {
        organization: node.organization,
        project: node.project
    });
}

/**
 * Open a work item in the browser (secondary action).
 */
export function openWorkItem(
    node: WorkItemNode,
    client: AdoClient,
    config: ConfigManager
): void {
    const id = node.workItem.id ?? 0;
    const org = node.organization ?? client.organization ?? config.organization;
    const project = node.project ?? config.project;
    if (!org || !project) {
        showWarningMessage(
            'Please configure your organization and project first.'
        );
        return;
    }
    const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
    void vscode.env.openExternal(vscode.Uri.parse(url));
}

/**
 * Change a work item's state from the tree/context menu.
 */
export async function changeWorkItemState(
    node: WorkItemNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    if (!node) {
        showInformationMessage('Select a work item first, then run "Change Work Item State".');
        return false;
    }

    const id = node.workItem.id ?? 0;
    const currentState = (node.workItem.fields?.['System.State'] as string | undefined) ?? '';
    const project = node.project ?? config.project;
    const organization = node.organization ?? client.organization ?? config.organization;

    if (!organization || !project) {
        showWarningMessage('Unable to change state because organization or project is missing.');
        return false;
    }

    const workItemType = (node.workItem.fields?.['System.WorkItemType'] as string | undefined) ?? '';
    const allowedStates = workItemType
        ? await client.getWorkItemTypeStates(project, workItemType, organization)
        : [];
    const quickPickItems = [
        ...allowedStates.map(state => ({
            label: state,
            description: state === currentState ? 'Current' : undefined
        })),
        { label: '$(edit) Enter custom state...', description: undefined }
    ];

    const picked = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: currentState ? `Current state: ${currentState}` : 'Select the new work item state'
    });
    if (!picked) {
        return false;
    }

    let nextState = picked.label;
    if (nextState.startsWith('$(edit)')) {
        const entered = await vscode.window.showInputBox({
            prompt: 'Enter the Azure DevOps state name',
            value: currentState
        });
        if (!entered) {
            return false;
        }
        nextState = entered.trim();
    }

    if (!nextState || nextState === currentState) {
        return false;
    }

    try {
        await client.updateWorkItemState(project, id, nextState, organization);
        showInformationMessage(`Work item #${id} moved to ${nextState}.`);
        return true;
    } catch (err) {
        showErrorMessage(`Failed to change work item state: ${err}`);
        return false;
    }
}
