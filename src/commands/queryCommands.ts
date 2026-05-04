import * as vscode from 'vscode';
import type { ConfigManager, SavedWorkItemQuery, SavedPullRequestQuery } from '../config/configManager';
import type { WorkItemQueryFilter, PullRequestQueryFilter } from '../config/configManager';

/** Generates a collision-resistant unique ID for a saved query preset. */
function generateQueryId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Show a quick-pick list of all available work item queries and activate the
 * chosen one.  Returns true when a query was selected and activated.
 */
export async function selectWorkItemQuery(config: ConfigManager): Promise<boolean> {
    const queries = config.availableWorkItemQueries;
    const activeId = config.activeWorkItemQueryId;

    const items = queries.map(q => ({
        label: q.label,
        description: q.description ?? q.filter,
        picked: q.id === activeId,
        query: q,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        title: 'Select Work Item Query',
        placeHolder: 'Choose which work items to display',
    });

    if (!selected) { return false; }
    await config.setActiveWorkItemQueryId(selected.query.id);
    return true;
}

/**
 * Show a quick-pick list of all available pull request queries and activate the
 * chosen one.  Returns true when a query was selected and activated.
 */
export async function selectPullRequestQuery(config: ConfigManager): Promise<boolean> {
    const queries = config.availablePullRequestQueries;
    const activeId = config.activePullRequestQueryId;

    const items = queries.map(q => ({
        label: q.label,
        description: q.description ?? q.filter,
        picked: q.id === activeId,
        query: q,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        title: 'Select Pull Request Query',
        placeHolder: 'Choose which pull requests to display',
    });

    if (!selected) { return false; }
    await config.setActivePullRequestQueryId(selected.query.id);
    return true;
}

/**
 * Guide the user through naming and saving a new work item query preset, then
 * activate it.  Returns true when a preset was saved.
 */
export async function saveWorkItemQuery(config: ConfigManager): Promise<boolean> {
    const active = config.activeWorkItemQuery;

    const filterItems: Array<{ label: string; filter: WorkItemQueryFilter }> = [
        { label: 'Assigned to me', filter: 'assigned' },
        { label: 'Created by me', filter: 'created' },
        { label: 'Mentioning me', filter: 'mentioned' },
        { label: 'All active items', filter: 'all' },
    ];

    const selectedFilter = await vscode.window.showQuickPick(
        filterItems.map(item => ({ ...item, picked: item.filter === active.filter })),
        {
            title: 'Save Work Item Query – Step 1: Choose Filter',
            placeHolder: 'Select the filter for this preset',
        }
    );
    if (!selectedFilter) { return false; }

    const label = await vscode.window.showInputBox({
        title: 'Save Work Item Query – Step 2: Name',
        prompt: 'Enter a label for this query preset',
        placeHolder: selectedFilter.label,
        value: selectedFilter.label,
    });
    if (!label?.trim()) { return false; }

    const id = generateQueryId(`wi-${selectedFilter.filter}`);
    const newQuery: SavedWorkItemQuery = { id, label: label.trim(), filter: selectedFilter.filter };
    const existing = config.savedWorkItemQueries;
    await config.setWorkItemQueries([...existing, newQuery], id);
    return true;
}

/**
 * Guide the user through naming and saving a new pull request query preset,
 * then activate it.  Returns true when a preset was saved.
 */
export async function savePullRequestQuery(config: ConfigManager): Promise<boolean> {
    const active = config.activePullRequestQuery;

    const filterItems: Array<{ label: string; filter: PullRequestQueryFilter }> = [
        { label: 'Mine (created or reviewing)', filter: 'mine' },
        { label: 'Created by me', filter: 'created' },
        { label: 'Assigned to me', filter: 'assigned' },
        { label: 'All open pull requests', filter: 'all' },
    ];

    const selectedFilter = await vscode.window.showQuickPick(
        filterItems.map(item => ({ ...item, picked: item.filter === active.filter })),
        {
            title: 'Save Pull Request Query – Step 1: Choose Filter',
            placeHolder: 'Select the filter for this preset',
        }
    );
    if (!selectedFilter) { return false; }

    const label = await vscode.window.showInputBox({
        title: 'Save Pull Request Query – Step 2: Name',
        prompt: 'Enter a label for this query preset',
        placeHolder: selectedFilter.label,
        value: selectedFilter.label,
    });
    if (!label?.trim()) { return false; }

    const id = generateQueryId(`pr-${selectedFilter.filter}`);
    const newQuery: SavedPullRequestQuery = { id, label: label.trim(), filter: selectedFilter.filter };
    const existing = config.savedPullRequestQueries;
    await config.setPullRequestQueries([...existing, newQuery], id);
    return true;
}
