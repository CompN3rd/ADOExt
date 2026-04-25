import * as vscode from 'vscode';
import type { WorkItemNode } from '../providers/workItemProvider';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';

/**
 * Open a work item in the browser.
 */
export function openWorkItem(
    node: WorkItemNode,
    client: AdoClient,
    config: ConfigManager
): void {
    const id = node.workItem.id ?? 0;
    const org = client.organization ?? config.organization;
    const project = config.project;
    if (!org || !project) {
        vscode.window.showWarningMessage(
            'Please configure your organization and project first.'
        );
        return;
    }
    const url = `https://dev.azure.com/${org}/${project}/_workitems/edit/${id}`;
    void vscode.env.openExternal(vscode.Uri.parse(url));
}
