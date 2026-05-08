import * as azdev from 'azure-devops-node-api';
import type { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import type { IGitApi } from 'azure-devops-node-api/GitApi';
import type { ICoreApi } from 'azure-devops-node-api/CoreApi';
import type { IPolicyApi } from 'azure-devops-node-api/PolicyApi';
import type { IBuildApi } from 'azure-devops-node-api/BuildApi';
import type { IWikiApi } from 'azure-devops-node-api/WikiApi';
import { CommentExpandOptions, QueryExpand, TreeStructureGroup, WorkItemExpand } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { GitVersionType, VersionControlChangeType, VersionControlRecursionType, GitStatusState, PullRequestAsyncStatus, PullRequestMergeFailureType, PullRequestStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { BuildReason, BuildResult, BuildStatus } from 'azure-devops-node-api/interfaces/BuildInterfaces';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import { normalizeWorkItemTypeName, workItemTypeScopeKey } from '../utils/workItemTypeIcons';
import type {
    WorkItem,
    WorkItemType,
    WorkItemClassificationNode,
    QueryHierarchyItem,
    Comment as WorkItemComment,
    CommentCreate,
    WorkItemReference
} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type {
    GitPullRequest,
    GitPullRequestCommentThread,
    GitPullRequestChange,
    GitPullRequestStatus,
    GitPullRequestCompletionOptions,
    FileDiff,
    GitPullRequestSearchCriteria,
    Comment,
    CommentThreadStatus,
    IdentityRefWithVote
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { Build, BuildArtifact, BuildLog, Timeline } from 'azure-devops-node-api/interfaces/BuildInterfaces';
import type { TeamProject } from 'azure-devops-node-api/interfaces/CoreInterfaces';
import type { IdentityRef, JsonPatchDocument, JsonPatchOperation, ResourceRef } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type { PolicyEvaluationRecord } from 'azure-devops-node-api/interfaces/PolicyInterfaces';
import { PolicyEvaluationStatus } from 'azure-devops-node-api/interfaces/PolicyInterfaces';
import type { WikiPageDetail, WikiV2 } from 'azure-devops-node-api/interfaces/WikiInterfaces';
import type { IncomingMessage } from 'http';

export type {
    WorkItem,
    WorkItemType,
    WorkItemClassificationNode,
    QueryHierarchyItem,
    WorkItemComment,
    GitPullRequest,
    GitPullRequestCommentThread,
    GitPullRequestStatus,
    Comment,
    CommentThreadStatus,
    IdentityRefWithVote,
    IdentityRef,
    TeamProject,
    Build,
    BuildArtifact,
    BuildLog,
    Timeline,
    PolicyEvaluationRecord
};
export { GitStatusState, PolicyEvaluationStatus, PullRequestAsyncStatus, PullRequestMergeFailureType, PullRequestStatus, BuildReason, BuildResult, BuildStatus };

export type PipelineRunsFilter = 'all' | 'running' | 'failed' | 'mine';

export interface WikiPageContent {
    path: string;
    markdown: string;
    lastModified?: string;
    etag?: string;
}

/** A flattened representation of a saved query (non-folder). */
export interface SavedQuery {
    id: string;
    name: string;
    path: string;
}

/** A flattened path for an area or iteration node. */
export interface ClassificationPath {
    /** Full path including project root, e.g. "MyProject\\Iteration 1". */
    path: string;
    /** The display label (last segment of the path). */
    label: string;
}

export interface PullRequestFileDiff {
    path: string;
    originalPath?: string;
    changeType: string;
    changeTrackingId?: number;
    originalContent: string;
    modifiedContent: string;
    lineDiffBlocks: FileDiff['lineDiffBlocks'];
}

export interface PullRequestDiffModel {
    iterationId: number;
    baseIterationId: number;
    baseCommit?: string;
    targetCommit?: string;
    files: PullRequestFileDiff[];
}

export type PullRequestReviewVote = -10 | -5 | 0 | 5 | 10;

export const PullRequestReviewVotes = {
    rejected: -10,
    waitingForAuthor: -5,
    noVote: 0,
    approvedWithSuggestions: 5,
    approved: 10
} as const satisfies Record<string, PullRequestReviewVote>;

const WORK_ITEM_QUERY_LIMIT = 200;
const PLANNING_WORK_ITEM_QUERY_LIMIT = 500;
const BUILDS_PER_QUERY = 10;
const PLANNING_WORK_ITEM_TOTAL_LIMIT = 1000;
const WORK_ITEM_BATCH_SIZE = 200;
const COMPLETION_WORK_ITEM_LIMIT = 50;
const WORK_ITEM_TYPE_ICON_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Thin wrapper around the azure-devops-node-api package.
 * Handles connection setup and exposes high-level helpers used by the tree
 * providers and command handlers.
 */
export class AdoClient {
    private _connection: azdev.WebApi | undefined;
    private _connectionsByOrganization = new Map<string, azdev.WebApi>();
    private _organization: string | undefined;
    private _currentUserIds = new Map<string, string>();
    private _workItemStatesByType = new Map<string, string[]>();
    private _workItemTypeIconsByScope = new Map<string, { expiresAt: number; icons: Map<string, string> }>();

    constructor(private _accessToken: string) {}

    /**
     * Update the access token and reconnect if an organization is already set.
     */
    updateToken(token: string): void {
        this._accessToken = token;
        this._currentUserIds.clear();
        this._connectionsByOrganization.clear();
        this._workItemStatesByType.clear();
        this._workItemTypeIconsByScope.clear();

        if (!token.trim()) {
            this.disconnect();
            return;
        }

        if (this._organization) {
            this.connect(this._organization);
        }
    }

    /**
     * Initialise the connection for the given ADO organization.
     * @param organization  The organization name (e.g. "mycompany" for
     *                      https://dev.azure.com/mycompany).
     */
    connect(organization: string): void {
        this._organization = organization;

        if (!this._accessToken.trim()) {
            this._connection = undefined;
            return;
        }

        this._connection = this.createConnection(organization);
        this._connectionsByOrganization.set(organization, this._connection);
    }

    disconnect(): void {
        this._connection = undefined;
        this._connectionsByOrganization.clear();
        this._currentUserIds.clear();
        this._workItemStatesByType.clear();
        this._workItemTypeIconsByScope.clear();
    }

    private get connection(): azdev.WebApi {
        if (!this._connection) {
            throw new Error('Not connected. Call connect() first.');
        }
        return this._connection;
    }

    private getConnectionFor(organization?: string): azdev.WebApi {
        if (!organization) {
            return this.connection;
        }

        if (!this._accessToken.trim()) {
            throw new Error('Not connected. Sign in first.');
        }

        let connection = this._connectionsByOrganization.get(organization);
        if (!connection) {
            connection = this.createConnection(organization);
            this._connectionsByOrganization.set(organization, connection);
        }

        return connection;
    }

    private createConnection(organization: string): azdev.WebApi {
        const orgUrl = `https://dev.azure.com/${organization}`;
        const authHandler = azdev.getBearerHandler(this._accessToken);
        return new azdev.WebApi(orgUrl, authHandler);
    }

    // -------------------------------------------------------------------------
    // Organizations & Projects
    // -------------------------------------------------------------------------

    /**
     * List all Azure DevOps organizations the signed-in user belongs to.
     * Uses the VSSPS accounts API.
     */
    async listOrganizations(): Promise<{ accountName: string; accountUri: string }[]> {
        const handler = azdev.getBearerHandler(this._accessToken);
        const conn = new azdev.WebApi('https://app.vssps.visualstudio.com', handler);
        type AccountsResponse = { value: { accountName: string; accountUri: string }[] };
        const response = await conn.rest.get<AccountsResponse>(
            'https://app.vssps.visualstudio.com/_apis/accounts?memberId=me&api-version=7.1'
        );
        return response?.result?.value ?? [];
    }

    /**
     * List all projects within the given organization.
     */
    async listProjects(organization?: string): Promise<TeamProject[]> {
        const coreApi: ICoreApi = await this.getConnectionFor(organization).getCoreApi();
        const projects = await coreApi.getProjects();
        return projects ?? [];
    }

    /**
     * List team members for the given project.
     *
     * Queries up to the first 20 teams in the project and deduplicates members
     * by identity id. Returns an empty array when the API is unavailable or
     * the caller lacks permission.
     *
     * Note: projects with more than 20 teams will have members from later teams
     * omitted. The default team is always included because it is typically
     * returned first by the API.
     */
    async listProjectTeamMembers(project: string, organization?: string): Promise<IdentityRef[]> {
        const coreApi: ICoreApi = await this.getConnectionFor(organization).getCoreApi();
        const teams = await coreApi.getTeams(project, false, 20) ?? [];

        const membersById = new Map<string, IdentityRef>();
        await Promise.all(teams.map(async team => {
            if (!team.id) { return; }
            try {
                const teamMembers = await coreApi.getTeamMembersWithExtendedProperties(project, team.id);
                for (const member of teamMembers ?? []) {
                    const identity = member.identity;
                    if (identity?.id) {
                        membersById.set(identity.id, identity);
                    }
                }
            } catch {
                // Ignore errors for individual teams (e.g. permission denied)
            }
        }));

        return Array.from(membersById.values());
    }

    /**
     * Fetch the most recently changed active work items for use in completion
     * suggestions. Limited to {@link COMPLETION_WORK_ITEM_LIMIT} items to keep
     * the initial load fast; results should be cached by the caller.
     */
    async getRecentWorkItems(project: string, organization?: string): Promise<WorkItem[]> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();

        const wiql = {
            query: `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType]
                    FROM WorkItems
                    WHERE [System.TeamProject] = '${this.escapeWiqlString(project)}'
                      AND [System.State] NOT IN ('Closed', 'Removed')
                    ORDER BY [System.ChangedDate] DESC`
        };

        const result = await witApi.queryByWiql(wiql, { project }, false, COMPLETION_WORK_ITEM_LIMIT);
        if (!result.workItems || result.workItems.length === 0) {
            return [];
        }

        const ids = result.workItems
            .flatMap((wi: WorkItemReference) => wi.id !== undefined ? [wi.id] : []);

        if (ids.length === 0) {
            return [];
        }

        const workItems = await witApi.getWorkItems(
            ids,
            undefined,
            undefined,
            undefined,
            undefined,
            project
        );
        return (workItems ?? []).filter((wi): wi is WorkItem => wi !== null);
    }

    // -------------------------------------------------------------------------
    // Work Items
    // -------------------------------------------------------------------------

    /**
     * Fetch work items based on the configured query filter.
     * @param project  The project name/id.
     * @param filter   'assigned' | 'created' | 'mentioned' | 'all'
     */
    async getWorkItems(
        project: string,
        filter: 'assigned' | 'created' | 'mentioned' | 'all' = 'assigned',
        organization?: string
    ): Promise<WorkItem[]> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();

        const projectClause = `[System.TeamProject] = '${this.escapeWiqlString(project)}'`;
        let filterClause: string;
        switch (filter) {
            case 'created':
                filterClause = `[System.CreatedBy] = @me AND [System.State] <> 'Closed' AND [System.State] <> 'Resolved'`;
                break;
            case 'mentioned':
                filterClause = `[System.CommentCount] > 0 AND [System.ChangedBy] = @me AND [System.State] <> 'Closed'`;
                break;
            case 'all':
                filterClause = `[System.State] NOT IN ('Closed', 'Removed')`;
                break;
            case 'assigned':
            default:
                filterClause = `[System.AssignedTo] = @me AND [System.State] <> 'Closed' AND [System.State] <> 'Resolved'`;
                break;
        }

        const wiql = {
            query: `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo]
                    FROM WorkItems
                    WHERE ${projectClause} AND ${filterClause}
                    ORDER BY [System.ChangedDate] DESC`
        };

        const result = await witApi.queryByWiql(wiql, { project }, false, WORK_ITEM_QUERY_LIMIT);
        if (!result.workItems || result.workItems.length === 0) {
            return [];
        }

        const ids = result.workItems
            .slice(0, WORK_ITEM_QUERY_LIMIT)
            .flatMap((wi: WorkItemReference) => wi.id !== undefined ? [wi.id] : []);

        if (ids.length === 0) {
            return [];
        }

        const workItems = await witApi.getWorkItems(
            ids,
            undefined,
            undefined,
            undefined,
            undefined,
            project
        );
        return (workItems ?? []).filter((wi): wi is WorkItem => wi !== null);
    }

    /**
     * Fetch active work items with hierarchy/iteration metadata for backlog,
     * sprint, and board views.
     */
    async getPlanningWorkItems(
        project: string,
        organization?: string,
        assignedToMe = false
    ): Promise<WorkItem[]> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const whereClauses = [
            `[System.TeamProject] = '${this.escapeWiqlString(project)}'`,
            `[System.State] NOT IN ('Closed', 'Removed')`
        ];
        if (assignedToMe) {
            whereClauses.push('[System.AssignedTo] = @me');
        }
        const wiql = {
            query: `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType],
                           [System.AssignedTo], [System.IterationPath], [System.AreaPath], [System.Tags]
                     FROM WorkItems
                     WHERE ${whereClauses.join('\n                       AND ')}
                     ORDER BY [System.ChangedDate] DESC`
        };

        const result = await witApi.queryByWiql(wiql, { project }, false, PLANNING_WORK_ITEM_QUERY_LIMIT);
        if (!result.workItems || result.workItems.length === 0) {
            return [];
        }

        const ids = result.workItems
            .slice(0, PLANNING_WORK_ITEM_QUERY_LIMIT)
            .flatMap((wi: WorkItemReference) => wi.id !== undefined ? [wi.id] : []);

        if (ids.length === 0) {
            return [];
        }

        const workItemMap = new Map<number, WorkItem>();
        await this.fetchWorkItemsIntoMap(witApi, project, ids, workItemMap, PLANNING_WORK_ITEM_TOTAL_LIMIT);

        let missingParentIds = this.findMissingParentIds(workItemMap);
        const requestedParentIds = new Set<number>();
        while (missingParentIds.length > 0 && workItemMap.size < PLANNING_WORK_ITEM_TOTAL_LIMIT) {
            const remainingCapacity = PLANNING_WORK_ITEM_TOTAL_LIMIT - workItemMap.size;
            const parentBatchIds = missingParentIds
                .filter(id => !requestedParentIds.has(id))
                .slice(0, remainingCapacity);
            if (parentBatchIds.length === 0) {
                break;
            }
            parentBatchIds.forEach(id => requestedParentIds.add(id));

            await this.fetchWorkItemsIntoMap(
                witApi,
                project,
                parentBatchIds,
                workItemMap,
                PLANNING_WORK_ITEM_TOTAL_LIMIT
            );
            missingParentIds = this.findMissingParentIds(workItemMap);
        }

        return Array.from(workItemMap.values());
    }

    async updateWorkItemState(
        project: string,
        workItemId: number,
        state: string,
        organization?: string
    ): Promise<WorkItem> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const patch: JsonPatchOperation[] = [
            {
                op: Operation.Add,
                path: '/fields/System.State',
                value: state
            }
        ];
        return witApi.updateWorkItem(
            { 'Content-Type': 'application/json-patch+json' },
            patch as unknown as JsonPatchDocument,
            workItemId,
            project,
            undefined,
            undefined,
            undefined,
            WorkItemExpand.All
        );
    }

    /**
     * Create a new work item of the given type in a project.
     * @param project        The project name/id.
     * @param title          The title for the new work item.
     * @param workItemType   The work item type (e.g. 'Task', 'Bug', 'User Story').
     * @param fields         Optional additional fields to set (field reference name → value).
     * @param organization   Optional organization override.
     */
    async createWorkItem(
        project: string,
        title: string,
        workItemType: string,
        fields?: Record<string, unknown>,
        organization?: string
    ): Promise<WorkItem> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const patch: JsonPatchOperation[] = [
            { op: Operation.Add, path: '/fields/System.Title', value: title },
            ...(fields
                ? Object.entries(fields).map(([key, value]) => ({
                    op: Operation.Add,
                    path: `/fields/${key}`,
                    value
                }))
                : [])
        ];
        return witApi.createWorkItem(
            { 'Content-Type': 'application/json-patch+json' },
            patch as unknown as JsonPatchDocument,
            project,
            workItemType,
            undefined,
            undefined,
            undefined,
            WorkItemExpand.All
        );
    }

    /**
     * Update one or more fields on an existing work item.
     * @param project        The project name/id.
     * @param workItemId     The numeric work item id.
     * @param fields         Map of field reference name → new value.
     * @param organization   Optional organization override.
     */
    async updateWorkItemFields(
        project: string,
        workItemId: number,
        fields: Record<string, unknown>,
        organization?: string
    ): Promise<WorkItem> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const patch: JsonPatchOperation[] = Object.entries(fields).map(([key, value]) => ({
            op: Operation.Add,
            path: `/fields/${key}`,
            value
        }));
        return witApi.updateWorkItem(
            { 'Content-Type': 'application/json-patch+json' },
            patch as unknown as JsonPatchDocument,
            workItemId,
            project,
            undefined,
            undefined,
            undefined,
            WorkItemExpand.All
        );
    }

    /**
     * Fetch available work item types for a project.
     * @param project        The project name/id.
     * @param organization   Optional organization override.
     */
    async getWorkItemTypes(
        project: string,
        organization?: string
    ): Promise<WorkItemType[]> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const types = await witApi.getWorkItemTypes(project);
        return (types ?? []).filter((type): type is WorkItemType => type !== null && !type.isDisabled);
    }

    async getWorkItemTypeStates(
        project: string,
        workItemType: string,
        organization?: string
    ): Promise<string[]> {
        const cacheKey = JSON.stringify([organization ?? this._organization ?? null, project, workItemType]);
        const cached = this._workItemStatesByType.get(cacheKey);
        if (cached) {
            return cached;
        }

        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const states = await witApi.getWorkItemTypeStates(project, workItemType);
        const names = (states ?? [])
            .map(state => state.name)
            .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
        this._workItemStatesByType.set(cacheKey, names);
        return names;
    }

    async getWorkItemTypeIconUrls(
        project: string,
        organization?: string
    ): Promise<Map<string, string>> {
        const cacheKey = workItemTypeScopeKey(organization ?? this._organization, project);
        const now = Date.now();
        const cached = this._workItemTypeIconsByScope.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return cached.icons;
        }

        const types = await this.getWorkItemTypes(project, organization);
        const icons = new Map<string, string>();
        for (const type of types) {
            const name = type.name?.trim();
            const iconUrl = type.icon?.url?.trim();
            if (!name || !iconUrl) {
                continue;
            }
            icons.set(normalizeWorkItemTypeName(name), iconUrl);
        }

        this._workItemTypeIconsByScope.set(cacheKey, {
            expiresAt: now + WORK_ITEM_TYPE_ICON_CACHE_TTL_MS,
            icons
        });
        return icons;
    }

    // -------------------------------------------------------------------------
    // Pull Requests
    // -------------------------------------------------------------------------

    /**
     * Fetch pull requests for the given project.
     * @param project  Project name/id.
     * @param filter   'mine' | 'created' | 'assigned' | 'all'
     * @param currentUserDescriptor  The identity descriptor of the signed-in user.
     */
    async getPullRequests(
        project: string,
        filter: 'mine' | 'created' | 'assigned' | 'all' = 'mine',
        currentUserDescriptor?: string,
        organization?: string
    ): Promise<GitPullRequest[]> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();

        if (filter !== 'all' && !currentUserDescriptor) {
            currentUserDescriptor = await this.getCurrentUserId(organization);
        }

        if (filter !== 'all' && !currentUserDescriptor) {
            return [];
        }

        const searchCriteria: GitPullRequestSearchCriteria = {
            status: 1 // active
        };

        // Limit PR results to prevent UI freeze with large lists
        const PR_LIMIT = 100;
        (searchCriteria as GitPullRequestSearchCriteria & { top?: number }).top = PR_LIMIT;

        if (filter === 'created' && currentUserDescriptor) {
            searchCriteria.creatorId = currentUserDescriptor;
        } else if (filter === 'assigned' && currentUserDescriptor) {
            searchCriteria.reviewerId = currentUserDescriptor;
        } else if (filter === 'mine' && currentUserDescriptor) {
            const [created, assigned] = await Promise.all([
                gitApi.getPullRequestsByProject(project, {
                    ...searchCriteria,
                    creatorId: currentUserDescriptor
                }),
                gitApi.getPullRequestsByProject(project, {
                    ...searchCriteria,
                    reviewerId: currentUserDescriptor
                })
            ]);
            const seen = new Set<number>();
            return [...(created ?? []), ...(assigned ?? [])].filter(pr => {
                if (seen.has(pr.pullRequestId!)) { return false; }
                seen.add(pr.pullRequestId!);
                return true;
            });
        }

        const prs = await gitApi.getPullRequestsByProject(project, searchCriteria);
        return prs ?? [];
    }

    /**
     * Fetch all comment threads for a pull request.
     */
    async getPullRequestThreads(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        organization?: string
    ): Promise<GitPullRequestCommentThread[]> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const threads = await gitApi.getThreads(repositoryId, pullRequestId, project);
        return threads ?? [];
    }

    async getPullRequest(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        organization?: string
    ): Promise<GitPullRequest | undefined> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const pullRequest = await gitApi.getPullRequest(repositoryId, pullRequestId, project);
        return pullRequest ?? undefined;
    }

    /**
     * Fetch a single pull request by its numeric ID without needing to know
     * the repository. Useful for hover-card lookups where only the PR number
     * is available. Pass an optional project to narrow the search scope.
     */
    async getPullRequestById(pullRequestId: number, project?: string, organization?: string): Promise<GitPullRequest | undefined> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const pr = await gitApi.getPullRequestById(pullRequestId, project);
        return pr ?? undefined;
    }

    /**
     * Fetch the latest iteration id for a pull request without downloading
     * any file content. Useful when posting line comments without first
     * loading the full diff.
     */
    async getPullRequestLatestIterationId(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        organization?: string
    ): Promise<number> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const iterations = await gitApi.getPullRequestIterations(repositoryId, pullRequestId, project, true);
        const latestIteration = [...(iterations ?? [])]
            .filter(iteration => typeof iteration.id === 'number')
            .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))[0];
        return latestIteration?.id ?? 1;
    }

    async getPullRequestDiff(
        project: string,
        repositoryId: string,
        pullRequest: GitPullRequest,
        organization?: string
    ): Promise<PullRequestDiffModel> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const pullRequestId = pullRequest.pullRequestId ?? 0;
        const iterations = await gitApi.getPullRequestIterations(repositoryId, pullRequestId, project, true);
        const latestIteration = [...(iterations ?? [])]
            .filter(iteration => typeof iteration.id === 'number')
            .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))[0];

        const iterationId = latestIteration?.id ?? 1;
        const baseIterationId = 0;
        const iterationChanges = await gitApi.getPullRequestIterationChanges(
            repositoryId,
            pullRequestId,
            iterationId,
            project,
            2000,
            0,
            baseIterationId
        );
        const changeEntries = iterationChanges?.changeEntries ?? [];

        const baseCommit =
            latestIteration?.commonRefCommit?.commitId ??
            latestIteration?.targetRefCommit?.commitId ??
            pullRequest.lastMergeTargetCommit?.commitId;
        const targetCommit =
            latestIteration?.sourceRefCommit?.commitId ??
            pullRequest.lastMergeSourceCommit?.commitId;

        const fileDiffs = baseCommit && targetCommit
            ? await this.getFileDiffs(gitApi, project, repositoryId, baseCommit, targetCommit, changeEntries)
            : [];

        const fileDiffByPath = new Map<string, FileDiff>();
        for (const fileDiff of fileDiffs) {
            if (fileDiff.path) {
                fileDiffByPath.set(fileDiff.path, fileDiff);
            }
        }

        const files = await Promise.all(changeEntries
            .filter(change => change.item?.path && !change.item?.isFolder)
            .slice(0, 100)
            .map(async change => {
                const path = change.item?.path ?? '';
                const originalPath = change.originalPath ?? path;
                const changeType = this.formatChangeType(change.changeType);
                const changeTypeValue = change.changeType ?? 0;
                const isAdd = (changeTypeValue & VersionControlChangeType.Add) === VersionControlChangeType.Add;
                const isDelete = (changeTypeValue & VersionControlChangeType.Delete) === VersionControlChangeType.Delete;
                const [originalContent, modifiedContent] = await Promise.all([
                    !isAdd && baseCommit
                        ? this.getItemText(gitApi, project, repositoryId, originalPath, baseCommit)
                        : Promise.resolve(''),
                    !isDelete && targetCommit
                        ? this.getItemText(gitApi, project, repositoryId, path, targetCommit)
                        : Promise.resolve('')
                ]);

                const fileDiff = fileDiffByPath.get(path);
                return {
                    path,
                    originalPath: originalPath !== path ? originalPath : undefined,
                    changeType,
                    changeTrackingId: change.changeTrackingId,
                    originalContent,
                    modifiedContent,
                    lineDiffBlocks: fileDiff?.lineDiffBlocks ?? []
                };
            }));

        return {
            iterationId,
            baseIterationId,
            baseCommit,
            targetCommit,
            files
        };
    }

    async addPullRequestLineComment(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        filePath: string,
        line: number,
        content: string,
        iterationId: number,
        baseIterationId: number,
        changeTrackingId?: number,
        organization?: string
    ): Promise<GitPullRequestCommentThread> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const thread: GitPullRequestCommentThread = {
            comments: [{ content }],
            status: 1,
            threadContext: {
                filePath,
                rightFileStart: { line, offset: 1 },
                rightFileEnd: { line, offset: 1 }
            },
            pullRequestThreadContext: {
                changeTrackingId,
                iterationContext: {
                    firstComparingIteration: baseIterationId,
                    secondComparingIteration: iterationId
                }
            }
        };
        return gitApi.createThread(thread, repositoryId, pullRequestId, project);
    }

    async setPullRequestReviewVote(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        vote: PullRequestReviewVote,
        organization?: string
    ): Promise<IdentityRefWithVote> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const reviewerId = await this.getCurrentUserId(organization);
        if (!reviewerId) {
            throw new Error('Unable to determine the current Azure DevOps user.');
        }

        const reviewer: IdentityRefWithVote = {
            id: reviewerId,
            vote
        };

        try {
            return await gitApi.updatePullRequestReviewer(
                reviewer,
                repositoryId,
                pullRequestId,
                reviewerId,
                project
            );
        } catch {
            return gitApi.createPullRequestReviewer(
                reviewer,
                repositoryId,
                pullRequestId,
                reviewerId,
                project
            );
        }
    }

    /**
     * Reply to an existing comment thread.
     */
    async replyToThread(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        threadId: number,
        content: string,
        organization?: string
    ): Promise<Comment> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const comment: Comment = { content };
        return gitApi.createComment(comment, repositoryId, pullRequestId, threadId, project);
    }

    /**
     * Update the status of a comment thread (resolve / reactivate).
     */
    async updateThreadStatus(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        threadId: number,
        status: CommentThreadStatus,
        organization?: string
    ): Promise<GitPullRequestCommentThread> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        return gitApi.updateThread(
            { status },
            repositoryId,
            pullRequestId,
            threadId,
            project
        );
    }

    /**
     * Add a new top-level comment to a pull request.
     */
    async addPullRequestComment(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        content: string,
        organization?: string
    ): Promise<GitPullRequestCommentThread> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const thread: GitPullRequestCommentThread = {
            comments: [{ content }],
            status: 1
        };
        return gitApi.createThread(thread, repositoryId, pullRequestId, project);
    }

    /**
     * Fetch a single work item with all fields and links.
     */
    async getWorkItemById(project: string, id: number, organization?: string): Promise<WorkItem | undefined> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const item = await witApi.getWorkItem(id, undefined, undefined, WorkItemExpand.All, project);
        return item ?? undefined;
    }

    /**
     * Fetch the discussion comments for a work item.
     */
    async getWorkItemComments(project: string, workItemId: number, organization?: string): Promise<WorkItemComment[]> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const result = await witApi.getComments(project, workItemId, undefined, undefined, false, CommentExpandOptions.RenderedText);
        return (result?.comments ?? []).filter((comment): comment is WorkItemComment => !comment.isDeleted);
    }

    /**
     * Add a discussion comment to a work item.
     */
    async addWorkItemComment(project: string, workItemId: number, text: string, organization?: string): Promise<WorkItemComment> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const request: CommentCreate = { text };
        return witApi.addComment(request, project, workItemId);
    }

    /**
     * Fetch the flat list of saved queries (non-folder items) for a project.
     * The top-level query folders are fetched with a depth of 2 to capture
     * immediate children; deeper nesting is not traversed.
     */
    async getSavedQueries(project: string, organization?: string): Promise<SavedQuery[]> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const roots = await witApi.getQueries(project, QueryExpand.None, 2, false);
        const queries: SavedQuery[] = [];
        const flatten = (items: QueryHierarchyItem[] | undefined): void => {
            for (const item of items ?? []) {
                if (item.isFolder) {
                    flatten(item.children);
                } else if (item.id && item.name && item.path) {
                    queries.push({ id: item.id, name: item.name, path: item.path });
                }
            }
        };
        flatten(roots);
        return queries;
    }

    /**
     * Run a saved query by its ID and return the matching work items.
     */
    async getWorkItemsBySavedQuery(project: string, queryId: string, organization?: string): Promise<WorkItem[]> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const result = await witApi.queryById(queryId, { project }, false, WORK_ITEM_QUERY_LIMIT);
        if (!result.workItems || result.workItems.length === 0) {
            return [];
        }

        const ids = result.workItems
            .slice(0, WORK_ITEM_QUERY_LIMIT)
            .flatMap((wi: WorkItemReference) => wi.id !== undefined ? [wi.id] : []);

        if (ids.length === 0) {
            return [];
        }

        const workItems = await witApi.getWorkItems(
            ids,
            undefined,
            undefined,
            undefined,
            undefined,
            project
        );
        return (workItems ?? []).filter((wi): wi is WorkItem => wi !== null);
    }

    /**
     * Fetch all area paths for a project as a flat list.
     */
    async getAreaPaths(project: string, organization?: string): Promise<ClassificationPath[]> {
        return this.getClassificationPaths(project, TreeStructureGroup.Areas, organization);
    }

    /**
     * Fetch all iteration paths for a project as a flat list.
     */
    async getIterationPaths(project: string, organization?: string): Promise<ClassificationPath[]> {
        return this.getClassificationPaths(project, TreeStructureGroup.Iterations, organization);
    }

    private async getClassificationPaths(
        project: string,
        structureGroup: TreeStructureGroup,
        organization?: string
    ): Promise<ClassificationPath[]> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const root = await witApi.getClassificationNode(project, structureGroup, undefined, 10);
        const paths: ClassificationPath[] = [];
        const flatten = (node: WorkItemClassificationNode, parentPath: string): void => {
            const nodeName = node.name?.trim() ?? '';
            const nodePath = nodeName
                ? (parentPath ? `${parentPath}\\${nodeName}` : nodeName)
                : parentPath;
            if (nodePath) {
                const segments = nodePath.split('\\').filter(Boolean);
                paths.push({
                    path: nodePath,
                    label: segments.length > 0 ? segments[segments.length - 1]! : nodePath
                });
            }
            for (const child of node.children ?? []) {
                flatten(child, nodePath);
            }
        };
        if (root) {
            flatten(root, '');
        }
        return paths;
    }

    /**
     * Fetch the build/check statuses posted on a pull request.
     */
    async getPullRequestStatuses(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        organization?: string
    ): Promise<GitPullRequestStatus[]> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const statuses = await gitApi.getPullRequestStatuses(repositoryId, pullRequestId, project);
        return statuses ?? [];
    }

    /**
     * Fetch the policy evaluation records for a pull request.
     * The artifact ID is built from the project GUID and pull request ID using the
     * format `vstfs:///CodeReview/CodeReviewId/{projectId}/{pullRequestId}`.
     */
    async getPullRequestPolicyEvaluations(
        project: string,
        pullRequestId: number,
        projectId: string,
        organization?: string
    ): Promise<PolicyEvaluationRecord[]> {
        const policyApi: IPolicyApi = await this.getConnectionFor(organization).getPolicyApi();
        const artifactId = `vstfs:///CodeReview/CodeReviewId/${encodeURIComponent(projectId)}/${encodeURIComponent(String(pullRequestId))}`;
        const evaluations = await policyApi.getPolicyEvaluations(project, artifactId, false);
        return evaluations ?? [];
    }

    /**
     * Returns the clone URL for a repository (used for branch checkout).
     */
    async getRepositoryCloneUrl(
        project: string,
        repositoryId: string,
        organization?: string
    ): Promise<string | undefined> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const repo = await gitApi.getRepository(repositoryId, project);
        return repo?.remoteUrl;
    }

    /**
     * Returns the name of a repository given its ID or name.
     * Useful for resolving vstfs artifact link GUIDs to human-readable names.
     */
    async getRepositoryName(
        project: string,
        repositoryId: string,
        organization?: string
    ): Promise<string | undefined> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const repo = await gitApi.getRepository(repositoryId, project);
        return repo?.name;
    }

    // -------------------------------------------------------------------------
    // Builds
    // -------------------------------------------------------------------------

    /**
     * Fetch the most recent builds for a pull request.
     * Filters by the PR's repository and source branch, limited to builds
     * triggered by pull request validation policies.
     */
    async getBuildsForPullRequest(
        project: string,
        repositoryId: string,
        sourceBranch: string,
        organization?: string
    ): Promise<Build[]> {
        const buildApi: IBuildApi = await this.getConnectionFor(organization).getBuildApi();
        const builds = await buildApi.getBuilds(
            project,
            undefined, // definitions
            undefined, // queues
            undefined, // buildNumber
            undefined, // minTime
            undefined, // maxTime
            undefined, // requestedFor
            BuildReason.PullRequest,
            undefined, // statusFilter
            undefined, // resultFilter
            undefined, // tagFilters
            undefined, // properties
            BUILDS_PER_QUERY, // top
            undefined, // continuationToken
            undefined, // maxBuildsPerDefinition
            undefined, // deletedFilter
            undefined, // queryOrder
            sourceBranch,
            undefined, // buildIds
            repositoryId,
            'TfsGit'
        );
        return builds ?? [];
    }

    /**
     * Fetch builds linked to a work item via its artifact relations.
     * Parses `vstfs:///Build/Build/{id}` URLs from the work item's relations.
     */
    async getBuildsForWorkItem(
        project: string,
        workItem: WorkItem,
        organization?: string
    ): Promise<Build[]> {
        const relations = workItem.relations ?? [];
        const buildArtifactPattern = /vstfs:\/\/\/Build\/Build\/(\d+)/i;
        const buildIds = relations
            .flatMap(r => {
                if (r.rel !== 'ArtifactLink') { return []; }
                const match = buildArtifactPattern.exec(r.url ?? '');
                return match ? [Number(match[1])] : [];
            });

        if (buildIds.length === 0) {
            return [];
        }

        const buildApi: IBuildApi = await this.getConnectionFor(organization).getBuildApi();
        const builds = await Promise.all(
            buildIds.slice(0, BUILDS_PER_QUERY).map(id =>
                buildApi.getBuild(project, id).catch(() => undefined)
            )
        );
        return builds.filter((b): b is Build => b !== undefined);
    }

    /**
     * Lists recent pipeline runs for a project using the Build API, which covers
     * both classic and YAML-backed Azure Pipelines.
     */
    async listPipelineRuns(
        project: string,
        organization?: string,
        options?: {
            top?: number;
            filter?: PipelineRunsFilter;
        }
    ): Promise<Build[]> {
        const buildApi: IBuildApi = await this.getConnectionFor(organization).getBuildApi();
        const top = options?.top ?? 25;
        const filter = options?.filter ?? 'all';

        const statusFilter = filter === 'running'
            ? (BuildStatus.InProgress | BuildStatus.Cancelling | BuildStatus.NotStarted)
            : undefined;

        const resultFilter = filter === 'failed'
            ? (BuildResult.Failed | BuildResult.PartiallySucceeded)
            : undefined;

        const builds = await buildApi.getBuilds(
            project,
            undefined, // definitions
            undefined, // queues
            undefined, // buildNumber
            undefined, // minTime
            undefined, // maxTime
            undefined, // requestedFor
            undefined, // reasonFilter
            statusFilter,
            resultFilter,
            undefined, // tagFilters
            undefined, // properties
            top
        );

        const items = builds ?? [];
        if (filter !== 'mine') {
            return items;
        }

        const currentUserId = await this.getCurrentUserIdFor(organization);
        if (!currentUserId) {
            return items;
        }

        return items.filter(build => build.requestedFor?.id === currentUserId);
    }

    async getPipelineRun(
        project: string,
        buildId: number,
        organization?: string
    ): Promise<Build> {
        const buildApi: IBuildApi = await this.getConnectionFor(organization).getBuildApi();
        return buildApi.getBuild(project, buildId);
    }

    async getPipelineRunTimeline(
        project: string,
        buildId: number,
        organization?: string
    ): Promise<Timeline | undefined> {
        const buildApi: IBuildApi = await this.getConnectionFor(organization).getBuildApi();
        return buildApi.getBuildTimeline(project, buildId);
    }

    async getPipelineRunArtifacts(
        project: string,
        buildId: number,
        organization?: string
    ): Promise<BuildArtifact[]> {
        const buildApi: IBuildApi = await this.getConnectionFor(organization).getBuildApi();
        const artifacts = await buildApi.getArtifacts(project, buildId);
        return artifacts ?? [];
    }

    async getPipelineRunLogLines(
        project: string,
        buildId: number,
        logId: number,
        organization?: string,
        startLine?: number,
        endLine?: number
    ): Promise<string[]> {
        const buildApi: IBuildApi = await this.getConnectionFor(organization).getBuildApi();
        return buildApi.getBuildLogLines(project, buildId, logId, startLine, endLine);
    }

    async rerunPipelineRun(
        project: string,
        buildId: number,
        organization?: string
    ): Promise<Build> {
        const build = await this.getPipelineRun(project, buildId, organization);
        const definitionId = build.definition?.id;
        if (!definitionId) {
            throw new Error('Build definition not found for this run.');
        }

        const buildApi: IBuildApi = await this.getConnectionFor(organization).getBuildApi();
        return buildApi.queueBuild(
            {
                definition: { id: definitionId },
                sourceBranch: build.sourceBranch,
                parameters: build.parameters
            } as unknown as Build,
            project
        );
    }

    async cancelPipelineRun(
        project: string,
        buildId: number,
        organization?: string
    ): Promise<Build> {
        const buildApi: IBuildApi = await this.getConnectionFor(organization).getBuildApi();
        return buildApi.updateBuild(
            { status: BuildStatus.Cancelling } as unknown as Build,
            project,
            buildId
        );
    }

    get organization(): string | undefined {
        return this._organization;
    }

    get isConnected(): boolean {
        return this._connection !== undefined && this._accessToken.trim() !== '';
    }

    /**
     * Public accessor for the cached current-user id used by callers that
     * need to attribute or filter comments by author (e.g. the new-comment
     * notifier).
     */
    async getCurrentUserIdFor(organization?: string): Promise<string | undefined> {
        return this.getCurrentUserId(organization);
    }

    private async getCurrentUserId(organization?: string): Promise<string | undefined> {
        const cacheKey = organization ?? this._organization ?? '';
        const cached = this._currentUserIds.get(cacheKey);
        if (cached) {
            return cached;
        }

        const connection = this.getConnectionFor(organization);
        let currentUserId: string | undefined;

        try {
            const connectionData = await connection.connect();
            currentUserId =
                connectionData.authenticatedUser?.id ??
                connectionData.authorizedUser?.id;
        } catch {
            // Fall back to the profile API if connection data is unavailable.
        }

        if (!currentUserId) {
            try {
                const profileApi = await connection.getProfileApi();
                const profile = await profileApi.getUserDefaults();
                currentUserId = profile.id;
            } catch {
                // Leave undefined and let callers handle the missing identity.
            }
        }

        if (currentUserId) {
            this._currentUserIds.set(cacheKey, currentUserId);
        }

        return currentUserId;
    }

    private escapeWiqlString(value: string): string {
        return value.replace(/'/g, "''");
    }

    private async fetchWorkItemsIntoMap(
        witApi: IWorkItemTrackingApi,
        project: string,
        ids: number[],
        workItemMap: Map<number, WorkItem>,
        totalLimit: number
    ): Promise<void> {
        const pendingIds = ids.filter(id => !workItemMap.has(id));
        while (pendingIds.length > 0 && workItemMap.size < totalLimit) {
            const remainingCapacity = totalLimit - workItemMap.size;
            const batchIds = pendingIds.splice(0, Math.min(WORK_ITEM_BATCH_SIZE, remainingCapacity));
            if (batchIds.length === 0) {
                break;
            }

            const workItems = await witApi.getWorkItems(
                batchIds,
                undefined,
                undefined,
                WorkItemExpand.Relations,
                undefined,
                project
            );

            for (const workItem of workItems ?? []) {
                if (workItem?.id !== undefined) {
                    workItemMap.set(workItem.id, workItem);
                }
            }
        }
    }

    private findMissingParentIds(workItemMap: Map<number, WorkItem>): number[] {
        const missingParentIds = new Set<number>();
        for (const workItem of workItemMap.values()) {
            for (const relation of workItem.relations ?? []) {
                if (relation.rel !== 'System.LinkTypes.Hierarchy-Reverse') {
                    continue;
                }

                const parentId = this.extractWorkItemIdFromUrl(relation.url);
                if (parentId !== undefined && !workItemMap.has(parentId)) {
                    missingParentIds.add(parentId);
                }
            }
        }
        return [...missingParentIds];
    }

    private extractWorkItemIdFromUrl(url?: string): number | undefined {
        const match = url?.match(/\/workItems\/(\d+)$/i);
        return match ? Number.parseInt(match[1], 10) : undefined;
    }

    private async getFileDiffs(
        gitApi: IGitApi,
        project: string,
        repositoryId: string,
        baseCommit: string,
        targetCommit: string,
        changeEntries: GitPullRequestChange[]
    ): Promise<FileDiff[]> {
        const fileDiffParams = changeEntries
            .filter(change => change.item?.path && !change.item?.isFolder)
            .slice(0, 100)
            .map(change => ({
                path: change.item?.path,
                originalPath: change.originalPath ?? change.item?.path
            }));

        if (fileDiffParams.length === 0) {
            return [];
        }

        try {
            return await gitApi.getFileDiffs(
                {
                    baseVersionCommit: baseCommit,
                    targetVersionCommit: targetCommit,
                    fileDiffParams
                },
                project,
                repositoryId
            ) ?? [];
        } catch {
            return [];
        }
    }

    private async getItemText(
        gitApi: IGitApi,
        project: string,
        repositoryId: string,
        itemPath: string,
        commitId: string
    ): Promise<string> {
        try {
            const stream = await gitApi.getItemContent(
                repositoryId,
                itemPath,
                project,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                {
                    version: commitId,
                    versionType: GitVersionType.Commit
                },
                true
            );
            return this.streamToString(stream);
        } catch {
            return '';
        }
    }

    async listWikis(project: string, organization?: string): Promise<WikiV2[]> {
        const wikiApi: IWikiApi = await this.getConnectionFor(organization).getWikiApi();
        return wikiApi.getAllWikis(project);
    }

    async listWikiPages(project: string, wikiIdentifier: string, organization?: string): Promise<WikiPageDetail[]> {
        const wikiApi: IWikiApi = await this.getConnectionFor(organization).getWikiApi();
        const pages = await wikiApi.getPagesBatch({ top: 1000 }, project, wikiIdentifier);
        return Array.isArray(pages) ? pages : [];
    }

    async getWikiPageMarkdown(
        project: string,
        wikiIdentifier: string,
        pagePath: string,
        organization?: string
    ): Promise<WikiPageContent> {
        const wikiApi: IWikiApi = await this.getConnectionFor(organization).getWikiApi();
        const stream = await wikiApi.getPageText(
            project,
            wikiIdentifier,
            pagePath,
            VersionControlRecursionType.None
        );
        const message = stream as unknown as IncomingMessage;
        const lastModified = typeof message.headers['last-modified'] === 'string'
            ? message.headers['last-modified']
            : Array.isArray(message.headers['last-modified'])
                ? message.headers['last-modified'][0]
                : undefined;
        const etag = typeof message.headers.etag === 'string'
            ? message.headers.etag
            : Array.isArray(message.headers.etag)
                ? message.headers.etag[0]
                : undefined;

        return {
            path: pagePath,
            markdown: await this.streamToString(message),
            ...(lastModified ? { lastModified } : {}),
            ...(etag ? { etag } : {})
        };
    }

    private streamToString(stream: NodeJS.ReadableStream): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', chunk => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
    }

    /**
     * Get work item references associated with a pull request.
     */
    async getPullRequestWorkItemRefs(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        organization?: string
    ): Promise<ResourceRef[]> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        return gitApi.getPullRequestWorkItemRefs(repositoryId, pullRequestId, project);
    }

    /**
     * Complete (merge) a pull request.
     */
    async completePullRequest(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        lastMergeSourceCommitId: string,
        completionOptions: GitPullRequestCompletionOptions,
        organization?: string
    ): Promise<GitPullRequest> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();
        const updatedPr: GitPullRequest = {
            status: PullRequestStatus.Completed,
            lastMergeSourceCommit: { commitId: lastMergeSourceCommitId },
            completionOptions
        };
        return gitApi.updatePullRequest(updatedPr, repositoryId, pullRequestId, project);
    }

    /**
     * Set or cancel auto-complete on a pull request.
     * When enabling, pass completionOptions to define merge behavior.
     * When disabling, pass enable=false (completionOptions is ignored).
     */
    async setAutoComplete(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        enable: boolean,
        completionOptions: GitPullRequestCompletionOptions | undefined,
        organization?: string
    ): Promise<GitPullRequest> {
        const gitApi: IGitApi = await this.getConnectionFor(organization).getGitApi();

        let autoCompleteSetBy: IdentityRef;
        if (enable) {
            const userId = await this.getCurrentUserId(organization);
            if (!userId) {
                throw new Error('Unable to determine the current Azure DevOps user.');
            }
            autoCompleteSetBy = { id: userId };
        } else {
            // Setting id to empty string cancels auto-complete
            autoCompleteSetBy = { id: '' };
        }

        const updatedPr: GitPullRequest = {
            autoCompleteSetBy,
            completionOptions: enable ? completionOptions : undefined
        };
        return gitApi.updatePullRequest(updatedPr, repositoryId, pullRequestId, project);
    }

    private formatChangeType(changeType: VersionControlChangeType | undefined): string {
        if (changeType === undefined) {
            return 'edit';
        }

        if ((changeType & VersionControlChangeType.Add) === VersionControlChangeType.Add) {
            return 'add';
        }
        if ((changeType & VersionControlChangeType.Delete) === VersionControlChangeType.Delete) {
            return 'delete';
        }
        if ((changeType & VersionControlChangeType.Rename) === VersionControlChangeType.Rename) {
            return 'rename';
        }
        return 'edit';
    }
}
