import * as vscode from 'vscode';

export const ALL_PROJECTS = '*';

export type ProjectSelectionsByOrganization = Record<string, string[]>;
export type WorkItemQueryFilter = 'assigned' | 'created' | 'mentioned' | 'all';
export type PullRequestQueryFilter = 'mine' | 'created' | 'assigned' | 'all';

export interface SavedQueryDefinition<TFilter extends string> {
    id: string;
    label: string;
    filter: TFilter;
    description?: string;
}

export type SavedWorkItemQuery = SavedQueryDefinition<WorkItemQueryFilter>;
export type SavedPullRequestQuery = SavedQueryDefinition<PullRequestQueryFilter>;

const WORK_ITEM_QUERY_FILTERS: ReadonlySet<WorkItemQueryFilter> = new Set([
    'assigned',
    'created',
    'mentioned',
    'all'
]);

const PULL_REQUEST_QUERY_FILTERS: ReadonlySet<PullRequestQueryFilter> = new Set([
    'mine',
    'created',
    'assigned',
    'all'
]);

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

    get workItemQueries(): SavedWorkItemQuery[] {
        const queries = this.normalizeWorkItemQueries(
            this.config.get<Partial<SavedWorkItemQuery>[]>('workItemQueries', [])
        );
        if (queries.length > 0) {
            return queries;
        }

        return [this.createLegacyWorkItemQuery(this.getLegacyWorkItemQuery())];
    }

    get activeWorkItemQueryId(): string {
        return this.resolveActiveQuery(
            this.config.get<string>('activeWorkItemQueryId', ''),
            this.workItemQueries
        ).id;
    }

    get activeWorkItemQuery(): SavedWorkItemQuery {
        return this.resolveActiveQuery(
            this.config.get<string>('activeWorkItemQueryId', ''),
            this.workItemQueries
        );
    }

    async setWorkItemQueries(queries: SavedWorkItemQuery[], activeId?: string): Promise<void> {
        const normalized = this.normalizeWorkItemQueries(queries);
        const activeQuery = normalized.length > 0
            ? this.resolveActiveQuery(activeId ?? '', normalized)
            : this.createLegacyWorkItemQuery(this.getLegacyWorkItemQuery());

        await this.config.update('workItemQueries', normalized, vscode.ConfigurationTarget.Global);
        await this.config.update(
            'activeWorkItemQueryId',
            normalized.length > 0 ? activeQuery.id : '',
            vscode.ConfigurationTarget.Global
        );
        await this.config.update('workItemQuery', activeQuery.filter, vscode.ConfigurationTarget.Global);
    }

    async setActiveWorkItemQueryId(id: string): Promise<void> {
        const activeQuery = this.resolveActiveQuery(id, this.workItemQueries);
        await this.config.update('activeWorkItemQueryId', activeQuery.id, vscode.ConfigurationTarget.Global);
        await this.config.update('workItemQuery', activeQuery.filter, vscode.ConfigurationTarget.Global);
    }

    get workItemQuery(): WorkItemQueryFilter {
        return this.activeWorkItemQuery.filter;
    }

    get pullRequestQueries(): SavedPullRequestQuery[] {
        const queries = this.normalizePullRequestQueries(
            this.config.get<Partial<SavedPullRequestQuery>[]>('pullRequestQueries', [])
        );
        if (queries.length > 0) {
            return queries;
        }

        return [this.createLegacyPullRequestQuery(this.getLegacyPullRequestFilter())];
    }

    get activePullRequestQueryId(): string {
        return this.resolveActiveQuery(
            this.config.get<string>('activePullRequestQueryId', ''),
            this.pullRequestQueries
        ).id;
    }

    get activePullRequestQuery(): SavedPullRequestQuery {
        return this.resolveActiveQuery(
            this.config.get<string>('activePullRequestQueryId', ''),
            this.pullRequestQueries
        );
    }

    async setPullRequestQueries(queries: SavedPullRequestQuery[], activeId?: string): Promise<void> {
        const normalized = this.normalizePullRequestQueries(queries);
        const activeQuery = normalized.length > 0
            ? this.resolveActiveQuery(activeId ?? '', normalized)
            : this.createLegacyPullRequestQuery(this.getLegacyPullRequestFilter());

        await this.config.update('pullRequestQueries', normalized, vscode.ConfigurationTarget.Global);
        await this.config.update(
            'activePullRequestQueryId',
            normalized.length > 0 ? activeQuery.id : '',
            vscode.ConfigurationTarget.Global
        );
        await this.config.update('pullRequestFilter', activeQuery.filter, vscode.ConfigurationTarget.Global);
    }

    async setActivePullRequestQueryId(id: string): Promise<void> {
        const activeQuery = this.resolveActiveQuery(id, this.pullRequestQueries);
        await this.config.update('activePullRequestQueryId', activeQuery.id, vscode.ConfigurationTarget.Global);
        await this.config.update('pullRequestFilter', activeQuery.filter, vscode.ConfigurationTarget.Global);
    }

    get pullRequestFilter(): PullRequestQueryFilter {
        return this.activePullRequestQuery.filter;
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

    private getLegacyWorkItemQuery(): WorkItemQueryFilter {
        return this.config.get<WorkItemQueryFilter>('workItemQuery', 'assigned');
    }

    private getLegacyPullRequestFilter(): PullRequestQueryFilter {
        return this.config.get<PullRequestQueryFilter>('pullRequestFilter', 'mine');
    }

    private createLegacyWorkItemQuery(filter: WorkItemQueryFilter): SavedWorkItemQuery {
        return {
            id: filter,
            label: defaultWorkItemQueryLabel(filter),
            filter
        };
    }

    private createLegacyPullRequestQuery(filter: PullRequestQueryFilter): SavedPullRequestQuery {
        return {
            id: filter,
            label: defaultPullRequestQueryLabel(filter),
            filter
        };
    }

    private normalizeWorkItemQueries(values: readonly Partial<SavedWorkItemQuery>[]): SavedWorkItemQuery[] {
        const seenIds = new Set<string>();
        const normalized: SavedWorkItemQuery[] = [];
        for (const raw of values) {
            const id = typeof raw.id === 'string' ? raw.id.trim() : '';
            const label = typeof raw.label === 'string' ? raw.label.trim() : '';
            const description = typeof raw.description === 'string' ? raw.description.trim() : undefined;
            const filter = raw.filter;
            if (!id || !label || !isWorkItemQueryFilter(filter) || seenIds.has(id)) {
                continue;
            }

            seenIds.add(id);
            normalized.push({
                id,
                label,
                filter,
                ...(description ? { description } : {})
            });
        }
        return normalized;
    }

    private normalizePullRequestQueries(values: readonly Partial<SavedPullRequestQuery>[]): SavedPullRequestQuery[] {
        const seenIds = new Set<string>();
        const normalized: SavedPullRequestQuery[] = [];
        for (const raw of values) {
            const id = typeof raw.id === 'string' ? raw.id.trim() : '';
            const label = typeof raw.label === 'string' ? raw.label.trim() : '';
            const description = typeof raw.description === 'string' ? raw.description.trim() : undefined;
            const filter = raw.filter;
            if (!id || !label || !isPullRequestQueryFilter(filter) || seenIds.has(id)) {
                continue;
            }

            seenIds.add(id);
            normalized.push({
                id,
                label,
                filter,
                ...(description ? { description } : {})
            });
        }
        return normalized;
    }

    private resolveActiveQuery<TFilter extends string, TQuery extends SavedQueryDefinition<TFilter>>(
        activeId: string,
        queries: readonly TQuery[]
    ): TQuery {
        const [firstQuery] = queries;
        if (!firstQuery) {
            throw new Error('At least one saved query must be available.');
        }

        const normalizedId = activeId.trim();
        return queries.find(query => query.id === normalizedId) ?? firstQuery;
    }
}

function isWorkItemQueryFilter(value: unknown): value is WorkItemQueryFilter {
    return typeof value === 'string' && WORK_ITEM_QUERY_FILTERS.has(value as WorkItemQueryFilter);
}

function isPullRequestQueryFilter(value: unknown): value is PullRequestQueryFilter {
    return typeof value === 'string' && PULL_REQUEST_QUERY_FILTERS.has(value as PullRequestQueryFilter);
}

function defaultWorkItemQueryLabel(filter: WorkItemQueryFilter): string {
    switch (filter) {
        case 'created':
            return 'Created by me';
        case 'mentioned':
            return 'Mentioning me';
        case 'all':
            return 'All active items';
        case 'assigned':
        default:
            return 'Assigned to me';
    }
}

function defaultPullRequestQueryLabel(filter: PullRequestQueryFilter): string {
    switch (filter) {
        case 'created':
            return 'Created by me';
        case 'assigned':
            return 'Assigned to me';
        case 'all':
            return 'All open pull requests';
        case 'mine':
        default:
            return 'Mine';
    }
}
