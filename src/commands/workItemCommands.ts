import * as vscode from 'vscode';
import type { WorkItemNode } from '../providers/workItemProvider';
import type { AdoClient, WorkItem } from '../api/adoClient';
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

/**
 * Build a predictable Git branch name from a work item ID and title.
 * Pattern: `wi/{id}-{sanitized-title}` where the title is lowercased,
 * non-alphanumeric characters are replaced by `-`, and the result is
 * truncated to keep branch names reasonably short.
 */
export function buildWorkItemBranchName(id: number, title: string): string {
    const sanitized = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
    return sanitized ? `wi/${id}-${sanitized}` : `wi/${id}`;
}

/**
 * Start working on a work item by creating or checking out a branch whose
 * name is derived from the work item ID and title.  Reuses the VS Code
 * built-in Git extension API so that all repository management stays inside
 * the standard Git tooling.
 *
 * @param workItem  The ADO work item to start working on.
 * @param _organization  Unused; reserved for future use (e.g. linking back).
 * @param _project       Unused; reserved for future use.
 */
export async function startWorkingOnWorkItem(
    workItem: WorkItem,
    _organization?: string,
    _project?: string
): Promise<void> {
    const id = workItem.id;
    if (!id || id <= 0) {
        showWarningMessage('Cannot start working: work item ID is missing.');
        return;
    }

    const rawTitle = (workItem.fields?.['System.Title'] as string | undefined) ?? '';
    const suggestedName = buildWorkItemBranchName(id, rawTitle);

    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
        showWarningMessage('The built-in Git extension is not available.');
        return;
    }

    const git = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();
    const gitApi = git.getAPI(1);
    if (!gitApi) {
        showWarningMessage('Git API is not available.');
        return;
    }

    const repos = gitApi.repositories;
    if (repos.length === 0) {
        showWarningMessage(
            'No Git repositories found in the current workspace. Open a repository first.'
        );
        return;
    }

    let repo = repos[0];
    if (repos.length > 1) {
        const picked = await vscode.window.showQuickPick(
            repos.map(r => ({ label: r.rootUri.fsPath, repo: r })),
            { placeHolder: 'Select the repository to create the branch in' }
        );
        if (!picked) { return; }
        repo = picked.repo;
    }

    // Let the user confirm or adjust the branch name before creating it.
    const confirmedName = await vscode.window.showInputBox({
        prompt: `Branch name for work item #${id}`,
        value: suggestedName,
        validateInput: v => (v.trim() ? undefined : 'Branch name must not be empty')
    });
    if (!confirmedName) { return; }
    const branchName = confirmedName.trim();

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Creating/checking out branch "${branchName}"…`
        },
        async () => {
            try {
                // Attempt to create a new local branch and check it out.
                await repo.createBranch(branchName, true);
                showInformationMessage(`Created and checked out branch: ${branchName}`);
            } catch {
                // Branch likely already exists — try checking it out instead.
                try {
                    await repo.checkout(branchName);
                    showInformationMessage(`Checked out existing branch: ${branchName}`);
                } catch (err2) {
                    showErrorMessage(
                        `Failed to create or checkout branch "${branchName}": ${err2}`
                    );
                }
            }
        }
    );
}

// ---------------------------------------------------------------------------
// Minimal VS Code Git extension API types
// ---------------------------------------------------------------------------

interface GitExtension {
    getAPI(version: 1): GitAPI;
}

interface GitAPI {
    repositories: Repository[];
}

interface Repository {
    rootUri: vscode.Uri;
    checkout(treeish: string): Promise<void>;
    createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
}
