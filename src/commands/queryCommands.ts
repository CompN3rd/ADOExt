import * as vscode from 'vscode';
import type { ConfigManager, WorkItemQueryDescriptor, PullRequestQueryDescriptor } from '../config/configManager';
import { DEFAULT_WORK_ITEM_QUERIES, DEFAULT_PR_QUERIES } from '../config/configManager';

/**
 * Show a quick-pick list of all available work item queries (built-in defaults
 * plus any user-saved presets) and set the selected one as the active query.
 * Returns true if a query was selected.
 */
export async function selectWorkItemQuery(config: ConfigManager): Promise<boolean> {
    const saved = config.workItemQueries;
    const allQueries: WorkItemQueryDescriptor[] = [
        ...DEFAULT_WORK_ITEM_QUERIES,
        ...saved.filter(q => !DEFAULT_WORK_ITEM_QUERIES.some(d => d.id === q.id))
    ];

    const activeQuery = config.activeWorkItemQuery;

    const items = allQueries.map(q => ({
        label: q.name,
        description: q.filter,
        picked: q.id === activeQuery.id,
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
 * Show a quick-pick list of all available pull request queries (built-in
 * defaults plus any user-saved presets) and set the selected one as active.
 * Returns true if a query was selected.
 */
export async function selectPullRequestQuery(config: ConfigManager): Promise<boolean> {
    const saved = config.pullRequestQueries;
    const allQueries: PullRequestQueryDescriptor[] = [
        ...DEFAULT_PR_QUERIES,
        ...saved.filter(q => !DEFAULT_PR_QUERIES.some(d => d.id === q.id))
    ];

    const activeQuery = config.activePullRequestQuery;

    const items = allQueries.map(q => ({
        label: q.name,
        description: q.filter,
        picked: q.id === activeQuery.id,
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
 * Guide the user through creating and saving a named work item query preset,
 * then set it as the active query.  Returns true when a preset was saved.
 */
export async function saveWorkItemQuery(config: ConfigManager): Promise<boolean> {
    const active = config.activeWorkItemQuery;

    const filterItems: Array<{ label: string; description: string; filter: WorkItemQueryDescriptor['filter'] }> = [
        { label: 'Assigned to Me', description: 'assigned', filter: 'assigned' },
        { label: 'Created by Me', description: 'created', filter: 'created' },
        { label: 'Mentioned in', description: 'mentioned', filter: 'mentioned' },
        { label: 'All Active', description: 'all', filter: 'all' },
    ];

    const selectedFilter = await vscode.window.showQuickPick(
        filterItems.map(item => ({ ...item, picked: item.filter === active.filter })),
        {
            title: 'Save Work Item Query Preset – Step 1: Choose Filter',
            placeHolder: 'Select the filter for this preset',
        }
    );
    if (!selectedFilter) { return false; }

    const name = await vscode.window.showInputBox({
        title: 'Save Work Item Query Preset – Step 2: Name',
        prompt: 'Enter a name for this query preset',
        placeHolder: 'My Custom Query',
        value: selectedFilter.label,
    });
    if (!name) { return false; }

    const id = `custom-wi-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const newQuery: WorkItemQueryDescriptor = { id, name: name.trim(), filter: selectedFilter.filter };
    const existing = config.workItemQueries;
    await config.setWorkItemQueries([...existing, newQuery]);
    await config.setActiveWorkItemQueryId(id);
    return true;
}

/**
 * Guide the user through creating and saving a named pull request query preset,
 * then set it as the active query.  Returns true when a preset was saved.
 */
export async function savePullRequestQuery(config: ConfigManager): Promise<boolean> {
    const active = config.activePullRequestQuery;

    const filterItems: Array<{ label: string; description: string; filter: PullRequestQueryDescriptor['filter'] }> = [
        { label: 'Mine (Created or Reviewing)', description: 'mine', filter: 'mine' },
        { label: 'Created by Me', description: 'created', filter: 'created' },
        { label: 'Assigned to Me for Review', description: 'assigned', filter: 'assigned' },
        { label: 'All Active', description: 'all', filter: 'all' },
    ];

    const selectedFilter = await vscode.window.showQuickPick(
        filterItems.map(item => ({ ...item, picked: item.filter === active.filter })),
        {
            title: 'Save Pull Request Query Preset – Step 1: Choose Filter',
            placeHolder: 'Select the filter for this preset',
        }
    );
    if (!selectedFilter) { return false; }

    const name = await vscode.window.showInputBox({
        title: 'Save Pull Request Query Preset – Step 2: Name',
        prompt: 'Enter a name for this query preset',
        placeHolder: 'My Custom PR Filter',
        value: selectedFilter.label,
    });
    if (!name) { return false; }

    const id = `custom-pr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const newQuery: PullRequestQueryDescriptor = { id, name: name.trim(), filter: selectedFilter.filter };
    const existing = config.pullRequestQueries;
    await config.setPullRequestQueries([...existing, newQuery]);
    await config.setActivePullRequestQueryId(id);
    return true;
}
