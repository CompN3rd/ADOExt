import * as vscode from 'vscode';
import type { WorkItemNode } from '../providers/workItemProvider';
import type { AdoClient, WorkItem, SavedQuery, ClassificationPath } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { WorkItemDetailsPanel } from '../views/workItemDetailsPanel';
import { parseAdoRemoteUrl } from '../utils/repoContext';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';
import { resolveProjectScopes } from '../providers/projectScopes';
import { TODO_COMMENT_PATTERN } from '../utils/todoPattern';

function formatUnknownError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

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
 * Helper: ask the user to pick a work item type from the project, falling back
 * to a short static list when the API call fails.
 */
async function pickWorkItemType(
    client: AdoClient,
    project: string,
    organization: string
): Promise<string | undefined> {
    let types: string[] = [];
    try {
        types = (await client.getWorkItemTypes(project, organization))
            .map(type => type.name ?? '')
            .filter((name): name is string => name.trim().length > 0);
    } catch {
        // fall back to common defaults
        types = ['Task', 'Bug', 'User Story', 'Feature', 'Epic'];
    }

    return vscode.window.showQuickPick(types, {
        placeHolder: 'Select work item type'
    });
}

/**
 * Build an HTML description that links back to the source file location.
 */
function buildFileContextDescription(
    fileUri: vscode.Uri,
    lineNumber: number,
    contextText?: string
): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let displayPath = fileUri.fsPath;
    if (workspaceFolders?.length) {
        const root = workspaceFolders[0].uri.fsPath;
        if (displayPath.startsWith(root)) {
            displayPath = displayPath.slice(root.length).replace(/^[\\/]/, '');
        }
    }
    // Normalize to forward slashes for display
    displayPath = displayPath.replace(/\\/g, '/');

    const sourceRef = `${displayPath}:${lineNumber + 1}`;
    const escapedRef = sourceRef.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let html = `<p><strong>Source:</strong> <code>${escapedRef}</code></p>`;
    if (contextText) {
        const escapedContext = contextText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        html += `<pre>${escapedContext}</pre>`;
    }
    return html;
}

/**
 * Create a work item from the currently selected text (or a prompted title
 * when there is no selection).
 */
export async function createWorkItemFromSelection(
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    const organization = client.organization ?? config.organization;
    const project = config.project;

    if (!organization || !project) {
        showWarningMessage('Please configure your organization and project first.');
        return;
    }

    const editor = vscode.window.activeTextEditor;
    const selectedText = editor && !editor.selection.isEmpty
        ? editor.document.getText(editor.selection).trim()
        : '';
    const firstLine = editor?.selection.start.line ?? 0;

    const title = await vscode.window.showInputBox({
        prompt: 'Work item title',
        value: selectedText.split('\n')[0].slice(0, 255),
        placeHolder: 'Enter a title for the new work item'
    });
    if (!title?.trim()) {
        return;
    }

    const workItemType = await pickWorkItemType(client, project, organization);
    if (!workItemType) {
        return;
    }

    const description = editor
        ? buildFileContextDescription(editor.document.uri, firstLine, selectedText || undefined)
        : undefined;

    try {
        const workItem = await client.createWorkItem(
            project,
            title.trim(),
            workItemType,
            description ? { 'System.Description': description } : undefined,
            organization
        );
        showInformationMessage(`Work item #${workItem.id} created.`);
        await WorkItemDetailsPanel.show(client, config, workItem, { organization, project });
    } catch (err) {
        showErrorMessage(`Failed to create work item: ${formatUnknownError(err)}`);
    }
}

/**
 * Create a work item from a TODO comment in the active editor.
 *
 * When `todoText` and `lineNumber` are supplied (e.g. from a code action) the
 * function skips the scanning/selection step and goes straight to prompting for
 * the work item type.  When called from the command palette without arguments
 * it scans the current file for TODO comments and presents a quick-pick.
 */
export async function createWorkItemFromTodo(
    client: AdoClient,
    config: ConfigManager,
    todoText?: string,
    lineNumber?: number
): Promise<void> {
    const organization = client.organization ?? config.organization;
    const project = config.project;

    if (!organization || !project) {
        showWarningMessage('Please configure your organization and project first.');
        return;
    }

    const editor = vscode.window.activeTextEditor;

    let resolvedTitle = todoText;
    let resolvedLine = lineNumber ?? 0;

    if (!resolvedTitle) {
        // Scan the active file for TODO comments
        if (!editor) {
            showWarningMessage('Open a file in the editor to scan for TODO comments.');
            return;
        }

        interface TodoItem {
            label: string;
            description: string;
            line: number;
            text: string;
        }
        const todos: TodoItem[] = [];
        const doc = editor.document;
        for (let i = 0; i < doc.lineCount; i++) {
            const lineText = doc.lineAt(i).text;
            const match = TODO_COMMENT_PATTERN.exec(lineText);
            if (match) {
                todos.push({
                    label: match[1].trim(),
                    description: `Line ${i + 1}`,
                    line: i,
                    text: match[1].trim()
                });
            }
        }

        if (todos.length === 0) {
            showInformationMessage('No TODO comments found in the active file.');
            return;
        }

        const picked = await vscode.window.showQuickPick(todos, {
            placeHolder: 'Select a TODO comment to create a work item from'
        });
        if (!picked) {
            return;
        }
        resolvedTitle = picked.text;
        resolvedLine = picked.line;
    }

    const title = await vscode.window.showInputBox({
        prompt: 'Work item title',
        value: resolvedTitle,
        placeHolder: 'Enter a title for the new work item'
    });
    if (!title?.trim()) {
        return;
    }

    const workItemType = await pickWorkItemType(client, project, organization);
    if (!workItemType) {
        return;
    }

    const lineContext = editor && resolvedLine < editor.document.lineCount
        ? editor.document.lineAt(resolvedLine).text.trim()
        : resolvedTitle;
    const description = editor
        ? buildFileContextDescription(editor.document.uri, resolvedLine, lineContext)
        : undefined;

    try {
        const workItem = await client.createWorkItem(
            project,
            title.trim(),
            workItemType,
            description ? { 'System.Description': description } : undefined,
            organization
        );
        showInformationMessage(`Work item #${workItem.id} created.`);
        await WorkItemDetailsPanel.show(client, config, workItem, { organization, project });
    } catch (err) {
        showErrorMessage(`Failed to create work item: ${formatUnknownError(err)}`);
    }
}

/**
 * Let the user browse saved ADO queries and open the results in the
 * Work Items tree (by displaying a quick-pick list of the work items).
 */
export async function openSavedQuery(
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    const scopes = await resolveProjectScopes(client, config);
    if (scopes.length === 0) {
        showWarningMessage('Please configure your organization and project first.');
        return;
    }

    let scope = scopes[0];
    if (scopes.length > 1) {
        const scopeItems = scopes.map(s => ({
            label: s.project,
            description: s.organization,
            scope: s
        }));
        const picked = await vscode.window.showQuickPick(scopeItems, {
            placeHolder: 'Select a project to browse saved queries'
        });
        if (!picked) {
            return;
        }
        scope = picked.scope;
    }

    const { project, organization } = scope;

    let queries: SavedQuery[];
    try {
        queries = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Loading saved queries…', cancellable: false },
            () => client.getSavedQueries(project, organization)
        );
    } catch (err) {
        showErrorMessage(`Failed to load saved queries: ${formatUnknownError(err)}`);
        return;
    }

    if (queries.length === 0) {
        showInformationMessage('No saved queries found for this project.');
        return;
    }

    const queryItems = queries.map(query => ({
        label: query.name,
        description: query.path.replace(/\\/g, ' › '),
        query
    }));

    const selectedQuery = await vscode.window.showQuickPick(queryItems, {
        placeHolder: 'Select a saved query to run',
        matchOnDescription: true
    });
    if (!selectedQuery) {
        return;
    }

    let workItems: WorkItem[];
    try {
        workItems = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Running "${selectedQuery.query.name}"…`, cancellable: false },
            () => client.getWorkItemsBySavedQuery(project, selectedQuery.query.id, organization)
        );
    } catch (err) {
        showErrorMessage(`Failed to run query: ${formatUnknownError(err)}`);
        return;
    }

    if (workItems.length === 0) {
        showInformationMessage(`Query "${selectedQuery.query.name}" returned no results.`);
        return;
    }

    const validWorkItems = workItems.filter(
        (workItem): workItem is WorkItem & { id: number } => typeof workItem.id === 'number' && Number.isFinite(workItem.id)
    );
    if (validWorkItems.length === 0) {
        showInformationMessage(`Query "${selectedQuery.query.name}" returned no openable work items.`);
        return;
    }

    const resultItems = validWorkItems.map(workItem => {
        const id = workItem.id;
        const title = (workItem.fields?.['System.Title'] as string | undefined) ?? '(no title)';
        const workItemType = (workItem.fields?.['System.WorkItemType'] as string | undefined) ?? 'Work Item';
        const state = (workItem.fields?.['System.State'] as string | undefined) ?? '';
        return {
            label: `#${id} ${title}`,
            description: `${workItemType} · ${state}`,
            workItem
        };
    });

    const resultPick = await vscode.window.showQuickPick(resultItems, {
        placeHolder: `${workItems.length} result(s) — select to open details`,
        matchOnDescription: true
    });
    if (!resultPick) {
        return;
    }

    await WorkItemDetailsPanel.show(client, config, resultPick.workItem, { organization, project });
}

/**
 * Prompt the user to pick a classification path (area or iteration) using
 * a discoverable quick-pick populated from ADO.
 * Returns the selected path string, or undefined if cancelled.
 */
async function pickClassificationPath(
    paths: ClassificationPath[],
    placeHolder: string
): Promise<string | undefined> {
    if (paths.length === 0) {
        return vscode.window.showInputBox({ prompt: placeHolder });
    }

    const items = paths.map(path => ({
        label: path.label,
        description: path.path,
        path: path.path
    }));

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder,
        matchOnDescription: true
    });
    return picked?.path;
}

/**
 * Multi-step wizard to create a new work item. The user chooses:
 *  1. Work item type (from the project's types or a preset template)
 *  2. Title
 *  3. (Optional) Area path – picked from a discoverable tree
 *  4. (Optional) Iteration path – picked from a discoverable tree
 */
export async function createWorkItem(
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    const scopes = await resolveProjectScopes(client, config);
    if (scopes.length === 0) {
        showWarningMessage('Please configure your organization and project first.');
        return false;
    }

    let scope = scopes[0];
    if (scopes.length > 1) {
        const scopeItems = scopes.map(s => ({
            label: s.project,
            description: s.organization,
            scope: s
        }));
        const picked = await vscode.window.showQuickPick(scopeItems, {
            placeHolder: 'Select a project for the new work item'
        });
        if (!picked) {
            return false;
        }
        scope = picked.scope;
    }

    const { project, organization } = scope;

    let workItemTypes: string[] = [];
    try {
        const types = await client.getWorkItemTypes(project, organization);
        workItemTypes = types.map(type => type.name ?? '').filter(Boolean);
    } catch {
        // If fetching types fails, fall back to a small preset list.
    }

    const presetTemplates: Record<string, Record<string, unknown>> = {
        Bug: { 'Microsoft.VSTS.TCM.ReproSteps': '' },
        Task: { 'Microsoft.VSTS.Scheduling.RemainingWork': '' },
        'User Story': { 'Microsoft.VSTS.Common.AcceptanceCriteria': '' },
        Feature: {}
    };

    const typePickItems: vscode.QuickPickItem[] = workItemTypes.length > 0
        ? workItemTypes.map(type => ({
            label: type,
            description: type in presetTemplates ? '$(template) has preset fields' : undefined
        }))
        : Object.keys(presetTemplates).map(type => ({ label: type, description: '$(template) preset' }));

    const typePick = await vscode.window.showQuickPick(typePickItems, {
        placeHolder: 'Select work item type'
    });
    if (!typePick) {
        return false;
    }
    const workItemType = typePick.label;

    const title = await vscode.window.showInputBox({
        prompt: `Enter title for the new ${workItemType}`,
        placeHolder: 'Work item title'
    });
    if (!title?.trim()) {
        return false;
    }

    let areaPaths: ClassificationPath[] = [];
    try {
        areaPaths = await client.getAreaPaths(project, organization);
    } catch {
        // Non-fatal: fall back to free-text.
    }

    const areaPath = await pickClassificationPath(
        areaPaths,
        'Select area path (press Escape to skip)'
    );

    let iterationPaths: ClassificationPath[] = [];
    try {
        iterationPaths = await client.getIterationPaths(project, organization);
    } catch {
        // Non-fatal: fall back to free-text.
    }

    const iterationPath = await pickClassificationPath(
        iterationPaths,
        'Select iteration path (press Escape to skip)'
    );

    const fields: Record<string, unknown> = {};

    const presetFields = presetTemplates[workItemType] ?? {};
    for (const [fieldRef, defaultValue] of Object.entries(presetFields)) {
        if (defaultValue !== undefined) {
            fields[fieldRef] = defaultValue;
        }
    }

    if (areaPath) {
        fields['System.AreaPath'] = areaPath;
    }
    if (iterationPath) {
        fields['System.IterationPath'] = iterationPath;
    }

    try {
        const newItem = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Creating ${workItemType}…`, cancellable: false },
            () => client.createWorkItem(project, title.trim(), workItemType, fields, organization)
        );
        const newId = newItem.id ?? 0;
        showInformationMessage(`Created ${workItemType} #${newId}: ${title.trim()}`);
        return true;
    } catch (err) {
        showErrorMessage(`Failed to create work item: ${formatUnknownError(err)}`);
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
 * name is derived from the work item ID and title. Reuses the VS Code
 * built-in Git extension API so that all repository management stays inside
 * the standard Git tooling.
 *
 * @param workItem The ADO work item to start working on.
 * @param organization Optional ADO organization used to narrow candidate
 * repositories to those whose remotes match the work item's scope.
 * @param project Optional ADO project used alongside organization when
 * selecting the most likely repository in a multi-repo workspace.
 */
export async function startWorkingOnWorkItem(
    workItem: WorkItem,
    organization?: string,
    project?: string
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

    let candidateRepos = repos;
    if (organization && project) {
        const matchingRepos = repos.filter(repo => repositoryMatchesContext(repo, organization, project));
        if (matchingRepos.length > 0) {
            candidateRepos = matchingRepos;
        }
    }

    let repo = candidateRepos[0];
    if (candidateRepos.length > 1) {
        const picked = await vscode.window.showQuickPick(
            candidateRepos.map(r => ({ label: r.rootUri.fsPath, repo: r })),
            { placeHolder: 'Select the repository to create the branch in' }
        );
        if (!picked) { return; }
        repo = picked.repo;
    }

    const confirmedName = await vscode.window.showInputBox({
        prompt: `Branch name for work item #${id}`,
        value: suggestedName,
        validateInput: value => (value.trim() ? undefined : 'Branch name must not be empty')
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
                await repo.createBranch(branchName, true);
                showInformationMessage(`Created and checked out branch: ${branchName}`);
            } catch (createBranchError) {
                try {
                    await repo.checkout(branchName);
                    showInformationMessage(`Checked out existing branch: ${branchName}`);
                } catch (err2) {
                    showErrorMessage(
                        `Failed to create branch "${branchName}" (${String(createBranchError)}) or checkout an existing branch (${String(err2)}).`
                    );
                }
            }
        }
    );
}

interface GitExtension {
    getAPI(version: 1): GitAPI;
}

interface GitAPI {
    repositories: Repository[];
}

interface GitRemote {
    fetchUrl?: string;
    pushUrl?: string;
}

interface Repository {
    rootUri: vscode.Uri;
    state: { remotes: GitRemote[] };
    checkout(treeish: string): Promise<void>;
    createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
}

function repositoryMatchesContext(
    repository: Repository,
    organization: string,
    project: string
): boolean {
    return repository.state.remotes.some(remote => {
        const context = parseAdoRemoteUrl(remote.fetchUrl ?? remote.pushUrl ?? '');
        return !!context && context.organization === organization && context.project === project;
    });
}
