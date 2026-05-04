import * as azdev from 'azure-devops-node-api';
import type { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import type { IGitApi } from 'azure-devops-node-api/GitApi';
import type { ICoreApi } from 'azure-devops-node-api/CoreApi';
import type { IPolicyApi } from 'azure-devops-node-api/PolicyApi';
import { CommentExpandOptions, WorkItemExpand } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { GitVersionType, VersionControlChangeType, GitStatusState, PullRequestAsyncStatus, PullRequestMergeFailureType } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type {
    WorkItem,
    WorkItemType,
    Comment as WorkItemComment,
    CommentCreate,
    WorkItemReference
} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type {
    GitPullRequest,
    GitPullRequestCommentThread,
    GitPullRequestChange,
    GitPullRequestStatus,
    FileDiff,
    GitPullRequestSearchCriteria,
    Comment,
    CommentThreadStatus,
    IdentityRefWithVote
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { TeamProject } from 'azure-devops-node-api/interfaces/CoreInterfaces';
import type { JsonPatchDocument, JsonPatchOperation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type { PolicyEvaluationRecord } from 'azure-devops-node-api/interfaces/PolicyInterfaces';
import { PolicyEvaluationStatus } from 'azure-devops-node-api/interfaces/PolicyInterfaces';

export type {
    WorkItem,
    WorkItemType,
    WorkItemComment,
    GitPullRequest,
    GitPullRequestCommentThread,
    GitPullRequestStatus,
    Comment,
    CommentThreadStatus,
    IdentityRefWithVote,
    TeamProject,
    PolicyEvaluationRecord
};
export { GitStatusState, PolicyEvaluationStatus, PullRequestAsyncStatus, PullRequestMergeFailureType };

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
const PLANNING_WORK_ITEM_TOTAL_LIMIT = 1000;
const WORK_ITEM_BATCH_SIZE = 200;

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

    constructor(private _accessToken: string) {}

    /**
     * Update the access token and reconnect if an organization is already set.
     */
    updateToken(token: string): void {
        this._accessToken = token;
        this._currentUserIds.clear();
        this._connectionsByOrganization.clear();
        this._workItemStatesByType.clear();

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
        organization?: string
    ): Promise<WorkItem[]> {
        const witApi: IWorkItemTrackingApi = await this.getConnectionFor(organization).getWorkItemTrackingApi();
        const wiql = {
            query: `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType],
                           [System.AssignedTo], [System.IterationPath], [System.AreaPath], [System.Tags]
                    FROM WorkItems
                    WHERE [System.TeamProject] = '${this.escapeWiqlString(project)}'
                      AND [System.State] NOT IN ('Closed', 'Removed')
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
        return (await witApi.getWorkItemTypes(project)) ?? [];
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
