import * as vscode from 'vscode';

export const ALL_PROJECTS = '*';

export type ProjectSelectionsByOrganization = Record<string, string[]>;

export interface WorkItemQueryDescriptor {
    id: string;
    name: string;
    filter: 'assigned' | 'created' | 'mentioned' | 'all';
}

export interface PullRequestQueryDescriptor {
    id: string;
    name: string;
    filter: 'mine' | 'created' | 'assigned' | 'all';
}

export const DEFAULT_WORK_ITEM_QUERIES: readonly WorkItemQueryDescriptor[] = [
    { id: 'assigned', name: 'Assigned to Me', filter: 'assigned' },
    { id: 'created', name: 'Created by Me', filter: 'created' },
    { id: 'mentioned', name: 'Mentioned in', filter: 'mentioned' },
    { id: 'all', name: 'All Active', filter: 'all' },
];

export const DEFAULT_PR_QUERIES: readonly PullRequestQueryDescriptor[] = [
    { id: 'mine', name: 'Mine (Created or Reviewing)', filter: 'mine' },
    { id: 'created', name: 'Created by Me', filter: 'created' },
    { id: 'assigned', name: 'Assigned to Me for Review', filter: 'assigned' },
    { id: 'all', name: 'All Active', filter: 'all' },
];

/**
 * Centralises all reads and writes to the extension's VS Code configuration.
 * Settings are stored under the "adoext" namespace in workspace/user settings.
 */
export class ConfigManager {
    private get config(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('adoext');
    }

    get organization(): string {
        return this.config.get<string>('organization', '');
    }

    async setOrganization(value: string): Promise<void> {
        await this.config.update('organization', value, vscode.ConfigurationTarget.Global);
    }

    get selectedOrganizations(): string[] {
        const organizations = this.config.get<string[]>('organizations', []);
        const normalized = this.normalizeList(organizations);
        if (normalized.length > 0) {
            return normalized;
        }

        return this.organization.trim() ? [this.organization.trim()] : [];
    }

    async setSelectedOrganizations(values: string[]): Promise<void> {
        const organizations = this.normalizeList(values);
        await this.config.update('organizations', organizations, vscode.ConfigurationTarget.Global);
        await this.config.update('organization', organizations[0] ?? '', vscode.ConfigurationTarget.Global);
    }

    get project(): string {
        return this.config.get<string>('project', '');
    }

    async setProject(value: string): Promise<void> {
        await this.config.update('project', value, vscode.ConfigurationTarget.Global);
    }

    get projectsByOrganization(): ProjectSelectionsByOrganization {
        return this.config.get<ProjectSelectionsByOrganization>('projectsByOrganization', {});
    }

    getProjectSelection(organization: string): string[] {
        const selections = this.projectsByOrganization;
        const configured = this.normalizeList(selections[organization] ?? []);
        if (configured.length > 0) {
            return configured;
        }

        if (organization === this.organization && this.project.trim()) {
            return [this.project.trim()];
        }

        return [];
    }

    async setProjectSelections(selections: ProjectSelectionsByOrganization): Promise<void> {
        const normalized: ProjectSelectionsByOrganization = {};
        let firstProject = '';

        for (const [organization, projects] of Object.entries(selections)) {
            const organizationName = organization.trim();
            const normalizedProjects = this.normalizeList(projects);
            if (!organizationName || normalizedProjects.length === 0) {
                continue;
            }

            normalized[organizationName] = normalizedProjects;
            const concreteProject = normalizedProjects.find(project => project !== ALL_PROJECTS);
            if (!firstProject && concreteProject) {
                firstProject = concreteProject;
            }
        }

        await this.config.update('projectsByOrganization', normalized, vscode.ConfigurationTarget.Global);
        await this.config.update('project', firstProject, vscode.ConfigurationTarget.Global);
    }

    get workItemQuery(): 'assigned' | 'created' | 'mentioned' | 'all' {
        return this.config.get<'assigned' | 'created' | 'mentioned' | 'all'>(
            'workItemQuery',
            'assigned'
        );
    }

    get pullRequestFilter(): 'mine' | 'created' | 'assigned' | 'all' {
        return this.config.get<'mine' | 'created' | 'assigned' | 'all'>(
            'pullRequestFilter',
            'mine'
        );
    }

    // -------------------------------------------------------------------------
    // Saved query presets
    // -------------------------------------------------------------------------

    get workItemQueries(): WorkItemQueryDescriptor[] {
        return this.config.get<WorkItemQueryDescriptor[]>('workItemQueries', []);
    }

    async setWorkItemQueries(queries: WorkItemQueryDescriptor[]): Promise<void> {
        await this.config.update('workItemQueries', queries, vscode.ConfigurationTarget.Global);
    }

    get pullRequestQueries(): PullRequestQueryDescriptor[] {
        return this.config.get<PullRequestQueryDescriptor[]>('pullRequestQueries', []);
    }

    async setPullRequestQueries(queries: PullRequestQueryDescriptor[]): Promise<void> {
        await this.config.update('pullRequestQueries', queries, vscode.ConfigurationTarget.Global);
    }

    get activeWorkItemQueryId(): string {
        return this.config.get<string>('activeWorkItemQueryId', '');
    }

    async setActiveWorkItemQueryId(id: string): Promise<void> {
        await this.config.update('activeWorkItemQueryId', id, vscode.ConfigurationTarget.Global);
    }

    get activePullRequestQueryId(): string {
        return this.config.get<string>('activePullRequestQueryId', '');
    }

    async setActivePullRequestQueryId(id: string): Promise<void> {
        await this.config.update('activePullRequestQueryId', id, vscode.ConfigurationTarget.Global);
    }

    /**
     * Returns the active work item query descriptor, falling back to the legacy
     * `adoext.workItemQuery` setting when no saved preset is selected.
     */
    get activeWorkItemQuery(): WorkItemQueryDescriptor {
        const activeId = this.activeWorkItemQueryId;
        if (activeId) {
            const saved = this.workItemQueries.find(q => q.id === activeId);
            if (saved) { return saved; }
            const builtIn = DEFAULT_WORK_ITEM_QUERIES.find(q => q.id === activeId);
            if (builtIn) { return { ...builtIn }; }
        }
        // Legacy fallback: honour the plain workItemQuery setting
        const legacyFilter = this.workItemQuery;
        return { ...(DEFAULT_WORK_ITEM_QUERIES.find(q => q.filter === legacyFilter) ?? DEFAULT_WORK_ITEM_QUERIES[0]) };
    }

    /**
     * Returns the active pull request query descriptor, falling back to the
     * legacy `adoext.pullRequestFilter` setting when no saved preset is selected.
     */
    get activePullRequestQuery(): PullRequestQueryDescriptor {
        const activeId = this.activePullRequestQueryId;
        if (activeId) {
            const saved = this.pullRequestQueries.find(q => q.id === activeId);
            if (saved) { return saved; }
            const builtIn = DEFAULT_PR_QUERIES.find(q => q.id === activeId);
            if (builtIn) { return { ...builtIn }; }
        }
        // Legacy fallback: honour the plain pullRequestFilter setting
        const legacyFilter = this.pullRequestFilter;
        return { ...(DEFAULT_PR_QUERIES.find(q => q.filter === legacyFilter) ?? DEFAULT_PR_QUERIES[0]) };
    }

    /** Whether to show a small toast when new comments appear on tracked PRs. */
    get notifyOnNewPullRequestComments(): boolean {
        return this.config.get<boolean>('notifyOnNewPullRequestComments', true);
    }

    /** Poll interval for the new-comment notifier, in seconds (minimum 60). */
    get pullRequestCommentPollIntervalSeconds(): number {
        const raw = this.config.get<number>('pullRequestCommentPollIntervalSeconds', 300);
        return Math.max(60, Math.floor(raw));
    }

    /** Returns true if both organization and project are configured. */
    get isConfigured(): boolean {
        const organizations = this.selectedOrganizations;
        return organizations.length > 0 && organizations.some(org => this.getProjectSelection(org).length > 0);
    }

    private normalizeList(values: readonly string[]): string[] {
        const seen = new Set<string>();
        const normalized: string[] = [];
        for (const raw of values) {
            const value = raw.trim();
            if (!value || seen.has(value)) {
                continue;
            }
            seen.add(value);
            normalized.push(value);
        }
        return normalized;
    }
}
