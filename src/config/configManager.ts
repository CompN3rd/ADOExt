import * as vscode from 'vscode';
import type { PipelineRunsFilter } from '../api/adoClient';

export const ALL_PROJECTS = '*';

export type ProjectSelectionsByOrganization = Record<string, string[]>;
export type WorkItemQueryFilter = 'assigned' | 'created' | 'mentioned' | 'all';
export type PullRequestQueryFilter = 'mine' | 'created' | 'assigned' | 'all';
export type PlanningAssignedFilter = 'all' | 'mine';
export type { PipelineRunsFilter };
export type PipelineRunsGroupBy = 'none' | 'repository' | 'branch';

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

const DEFAULT_WORK_ITEM_QUERIES: readonly SavedWorkItemQuery[] = [
    { id: 'assigned', label: defaultWorkItemQueryLabel('assigned'), filter: 'assigned' },
    { id: 'created', label: defaultWorkItemQueryLabel('created'), filter: 'created' },
    { id: 'mentioned', label: defaultWorkItemQueryLabel('mentioned'), filter: 'mentioned' },
    { id: 'all', label: defaultWorkItemQueryLabel('all'), filter: 'all' }
];

const DEFAULT_PULL_REQUEST_QUERIES: readonly SavedPullRequestQuery[] = [
    { id: 'mine', label: defaultPullRequestQueryLabel('mine'), filter: 'mine' },
    { id: 'created', label: defaultPullRequestQueryLabel('created'), filter: 'created' },
    { id: 'assigned', label: defaultPullRequestQueryLabel('assigned'), filter: 'assigned' },
    { id: 'all', label: defaultPullRequestQueryLabel('all'), filter: 'all' }
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

    get savedWorkItemQueries(): SavedWorkItemQuery[] {
        return this.normalizeWorkItemQueries(
            this.config.get<Partial<SavedWorkItemQuery>[]>('workItemQueries', [])
        );
    }

    get availableWorkItemQueries(): SavedWorkItemQuery[] {
        return mergeQueries(DEFAULT_WORK_ITEM_QUERIES, this.savedWorkItemQueries);
    }

    get workItemQueries(): SavedWorkItemQuery[] {
        return this.availableWorkItemQueries;
    }

    get activeWorkItemQueryId(): string {
        const configuredId = this.config.get<string>('activeWorkItemQueryId', '').trim();
        if (configuredId) {
            return this.resolveActiveQuery(configuredId, this.availableWorkItemQueries).id;
        }

        return this.resolveQueryByFilter(this.getLegacyWorkItemQuery(), this.availableWorkItemQueries).id;
    }

    get activeWorkItemQuery(): SavedWorkItemQuery {
        const configuredId = this.config.get<string>('activeWorkItemQueryId', '').trim();
        if (configuredId) {
            return this.resolveActiveQuery(configuredId, this.availableWorkItemQueries);
        }

        return this.resolveQueryByFilter(this.getLegacyWorkItemQuery(), this.availableWorkItemQueries);
    }

    async setWorkItemQueries(queries: SavedWorkItemQuery[], activeId?: string): Promise<void> {
        const normalized = this.normalizeWorkItemQueries(queries);
        const availableQueries = mergeQueries(DEFAULT_WORK_ITEM_QUERIES, normalized);
        const configuredActiveId = (activeId ?? this.config.get<string>('activeWorkItemQueryId', '')).trim();
        const activeQuery = configuredActiveId
            ? this.resolveActiveQuery(configuredActiveId, availableQueries)
            : this.resolveQueryByFilter(this.getLegacyWorkItemQuery(), availableQueries);
        const nextActiveId = configuredActiveId || normalized.length > 0
            ? activeQuery.id
            : '';

        await this.config.update('workItemQueries', normalized, vscode.ConfigurationTarget.Global);
        await this.config.update(
            'activeWorkItemQueryId',
            nextActiveId,
            vscode.ConfigurationTarget.Global
        );
        await this.config.update('workItemQuery', activeQuery.filter, vscode.ConfigurationTarget.Global);
    }

    async setActiveWorkItemQueryId(id: string): Promise<void> {
        const activeQuery = this.resolveActiveQuery(id, this.availableWorkItemQueries);
        await this.config.update('activeWorkItemQueryId', activeQuery.id, vscode.ConfigurationTarget.Global);
        await this.config.update('workItemQuery', activeQuery.filter, vscode.ConfigurationTarget.Global);
    }

    get workItemQuery(): WorkItemQueryFilter {
        return this.activeWorkItemQuery.filter;
    }

    get savedPullRequestQueries(): SavedPullRequestQuery[] {
        return this.normalizePullRequestQueries(
            this.config.get<Partial<SavedPullRequestQuery>[]>('pullRequestQueries', [])
        );
    }

    get availablePullRequestQueries(): SavedPullRequestQuery[] {
        return mergeQueries(DEFAULT_PULL_REQUEST_QUERIES, this.savedPullRequestQueries);
    }

    get pullRequestQueries(): SavedPullRequestQuery[] {
        return this.availablePullRequestQueries;
    }

    get activePullRequestQueryId(): string {
        const configuredId = this.config.get<string>('activePullRequestQueryId', '').trim();
        if (configuredId) {
            return this.resolveActiveQuery(configuredId, this.availablePullRequestQueries).id;
        }

        return this.resolveQueryByFilter(this.getLegacyPullRequestFilter(), this.availablePullRequestQueries).id;
    }

    get activePullRequestQuery(): SavedPullRequestQuery {
        const configuredId = this.config.get<string>('activePullRequestQueryId', '').trim();
        if (configuredId) {
            return this.resolveActiveQuery(configuredId, this.availablePullRequestQueries);
        }

        return this.resolveQueryByFilter(this.getLegacyPullRequestFilter(), this.availablePullRequestQueries);
    }

    async setPullRequestQueries(queries: SavedPullRequestQuery[], activeId?: string): Promise<void> {
        const normalized = this.normalizePullRequestQueries(queries);
        const availableQueries = mergeQueries(DEFAULT_PULL_REQUEST_QUERIES, normalized);
        const configuredActiveId = (activeId ?? this.config.get<string>('activePullRequestQueryId', '')).trim();
        const activeQuery = configuredActiveId
            ? this.resolveActiveQuery(configuredActiveId, availableQueries)
            : this.resolveQueryByFilter(this.getLegacyPullRequestFilter(), availableQueries);
        const nextActiveId = configuredActiveId || normalized.length > 0
            ? activeQuery.id
            : '';

        await this.config.update('pullRequestQueries', normalized, vscode.ConfigurationTarget.Global);
        await this.config.update(
            'activePullRequestQueryId',
            nextActiveId,
            vscode.ConfigurationTarget.Global
        );
        await this.config.update('pullRequestFilter', activeQuery.filter, vscode.ConfigurationTarget.Global);
    }

    async setActivePullRequestQueryId(id: string): Promise<void> {
        const activeQuery = this.resolveActiveQuery(id, this.availablePullRequestQueries);
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

    /** Whether to show a toast when the user is added as a reviewer on a PR. */
    get notifyOnPullRequestReviewRequests(): boolean {
        return this.config.get<boolean>('notifyOnPullRequestReviewRequests', true);
    }

    /** Whether to show a toast when a reviewer votes on a PR created by the user. */
    get notifyOnPullRequestStatusChanges(): boolean {
        return this.config.get<boolean>('notifyOnPullRequestStatusChanges', true);
    }

    /** Poll interval for the notification service, in seconds (minimum 60). */
    get pullRequestCommentPollIntervalSeconds(): number {
        const raw = this.config.get<number>('pullRequestCommentPollIntervalSeconds', 300);
        return Math.max(60, Math.floor(raw));
    }

    get showResolvedPullRequestThreads(): boolean {
        return this.config.get<boolean>('showResolvedPullRequestThreads', true);
    }

    async setShowResolvedPullRequestThreads(value: boolean): Promise<void> {
        await this.config.update('showResolvedPullRequestThreads', value, vscode.ConfigurationTarget.Global);
    }

    get hideSystemPullRequestThreads(): boolean {
        return this.config.get<boolean>('hideSystemPullRequestThreads', true);
    }

    // --------- Filtering & Sorting --------- //

    /** Regex pattern for filtering work items. */
    get workItemFilterRegex(): string {
        return this.config.get<string>('workItemFilterRegex', '');
    }

    /** Whether to prefer work item type icons from Azure DevOps metadata. */
    get useRemoteWorkItemIcons(): boolean {
        return this.config.get<boolean>('useRemoteWorkItemIcons', true);
    }

    async setWorkItemFilterRegex(value: string): Promise<void> {
        await this.config.update('workItemFilterRegex', value, vscode.ConfigurationTarget.Global);
    }

    /** Sort order for work items ('name' | 'date'). */
    get workItemSortOrder(): 'name' | 'date' {
        const raw = this.config.get<string>('workItemSortOrder', 'name');
        return raw === 'date' ? 'date' : 'name';
    }

    async setWorkItemSortOrder(value: 'name' | 'date'): Promise<void> {
        await this.config.update('workItemSortOrder', value, vscode.ConfigurationTarget.Global);
    }

    /** Work item states to hide from the Work Items tree view. */
    get workItemHideStates(): string[] {
        return this.config.get<string[]>('workItemHideStates', []);
    }

    async setWorkItemHideStates(states: string[]): Promise<void> {
        await this.config.update('workItemHideStates', states, vscode.ConfigurationTarget.Global);
    }

    /** Regex pattern for filtering backlog items. */
    get backlogFilterRegex(): string {
        return this.config.get<string>('backlogFilterRegex', '');
    }

    async setBacklogFilterRegex(value: string): Promise<void> {
        await this.config.update('backlogFilterRegex', value, vscode.ConfigurationTarget.Global);
    }

    /** Sort order for backlog items ('name' | 'date'). */
    get backlogSortOrder(): 'name' | 'date' {
        const raw = this.config.get<string>('backlogSortOrder', 'name');
        return raw === 'date' ? 'date' : 'name';
    }

    async setBacklogSortOrder(value: 'name' | 'date'): Promise<void> {
        await this.config.update('backlogSortOrder', value, vscode.ConfigurationTarget.Global);
    }

    /** Scope planning views to all items or items assigned to the current user. */
    get planningAssignedFilter(): PlanningAssignedFilter {
        const raw = this.config.get<string>('planningAssignedFilter', 'all');
        return raw === 'mine' ? 'mine' : 'all';
    }

    async setPlanningAssignedFilter(value: PlanningAssignedFilter): Promise<void> {
        await this.config.update('planningAssignedFilter', value, vscode.ConfigurationTarget.Global);
    }

    /** Regex pattern for filtering pull requests. */
    get pullRequestFilterRegex(): string {
        return this.config.get<string>('pullRequestFilterRegex', '');
    }

    async setPullRequestFilterRegex(value: string): Promise<void> {
        await this.config.update('pullRequestFilterRegex', value, vscode.ConfigurationTarget.Global);
    }

    /** Sort order for pull requests ('title' | 'date'). */
    get pullRequestSortOrder(): 'title' | 'date' {
        const raw = this.config.get<string>('pullRequestSortOrder', 'title');
        return raw === 'date' ? 'date' : 'title';
    }

    async setPullRequestSortOrder(value: 'title' | 'date'): Promise<void> {
        await this.config.update('pullRequestSortOrder', value, vscode.ConfigurationTarget.Global);
    }

    /** Filter for pipeline runs in the Pipelines tree view. */
    get pipelineRunsFilter(): PipelineRunsFilter {
        const raw = this.config.get<string>('pipelineRunsFilter', 'all');
        switch (raw) {
            case 'running':
            case 'failed':
            case 'mine':
            case 'all':
                return raw;
            default:
                return 'all';
        }
    }

    async setPipelineRunsFilter(value: PipelineRunsFilter): Promise<void> {
        await this.config.update('pipelineRunsFilter', value, vscode.ConfigurationTarget.Global);
    }

    /** Optional grouping for pipeline runs under each project scope. */
    get pipelineRunsGroupBy(): PipelineRunsGroupBy {
        const raw = this.config.get<string>('pipelineRunsGroupBy', 'none');
        switch (raw) {
            case 'repository':
            case 'branch':
            case 'none':
                return raw;
            default:
                return 'none';
        }
    }

    async setPipelineRunsGroupBy(value: PipelineRunsGroupBy): Promise<void> {
        await this.config.update('pipelineRunsGroupBy', value, vscode.ConfigurationTarget.Global);
    }

    /** Max runs fetched per scope for the Pipelines view (1-100). */
    get pipelineRunsTop(): number {
        const raw = this.config.get<number>('pipelineRunsTop', 25);
        const top = Math.floor(raw);
        return Math.max(1, Math.min(100, top));
    }

    /** Returns true if both organization and project are configured. */
    get isConfigured(): boolean {
        const organizations = this.selectedOrganizations;
        return organizations.length > 0 && organizations.some(org => this.getProjectSelection(org).length > 0);
    }

    /** Enables the optional Wiki view contribution. */
    get enableWikiView(): boolean {
        return this.config.get<boolean>('enableWikiView', false);
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

    private resolveQueryByFilter<TFilter extends string, TQuery extends SavedQueryDefinition<TFilter>>(
        filter: TFilter,
        queries: readonly TQuery[]
    ): TQuery {
        return queries.find(query => query.filter === filter) ?? this.resolveActiveQuery('', queries);
    }
}

function mergeQueries<TFilter extends string, TQuery extends SavedQueryDefinition<TFilter>>(
    defaults: readonly TQuery[],
    saved: readonly TQuery[]
): TQuery[] {
    const seenIds = new Set(defaults.map(query => query.id));
    const merged = [...defaults];
    for (const query of saved) {
        if (seenIds.has(query.id)) {
            continue;
        }
        seenIds.add(query.id);
        merged.push(query);
    }
    return merged;
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
