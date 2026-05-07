export function normalizeWorkItemTypeName(value: string): string {
    return value.trim().toLowerCase();
}

export function bundledWorkItemTypeIconFile(workItemType: string): string | undefined {
    switch (normalizeWorkItemTypeName(workItemType)) {
        case 'bug':
            return 'bug.svg';
        case 'task':
            return 'task.svg';
        case 'epic':
            return 'epic.svg';
        case 'feature':
            return 'feature.svg';
        case 'user story':
            return 'user-story.svg';
        case 'product backlog item':
        case 'pbi':
            return 'product-backlog-item.svg';
        case 'issue':
            return 'issue.svg';
        default:
            return undefined;
    }
}
