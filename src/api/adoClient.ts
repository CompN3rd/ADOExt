import * as azdev from 'azure-devops-node-api';
import type { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import type { IGitApi } from 'azure-devops-node-api/GitApi';
import type { ICoreApi } from 'azure-devops-node-api/CoreApi';
import { WorkItemExpand } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { GitVersionType, VersionControlChangeType } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import type {
    WorkItem,
    WorkItemType,
    Comment as WorkItemComment,
    CommentCreate
} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type {
    GitPullRequest,
    GitPullRequestCommentThread,
    GitPullRequestChange,
    FileDiff,
    GitPullRequestSearchCriteria,
    Comment,
    CommentThreadStatus
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { TeamProject } from 'azure-devops-node-api/interfaces/CoreInterfaces';
import type { JsonPatchDocument, JsonPatchOperation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';

export type {
    WorkItem,
    WorkItemType,
    WorkItemComment,
    GitPullRequest,
    GitPullRequestCommentThread,
    Comment,
    CommentThreadStatus,
    TeamProject
};

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

    constructor(private _accessToken: string) {}

    /**
     * Update the access token and reconnect if an organization is already set.
     */
    updateToken(token: string): void {
        this._accessToken = token;
        this._currentUserIds.clear();
        this._connectionsByOrganization.clear();

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
     * List all projects within the current organization.
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

        let whereClause: string;
        switch (filter) {
            case 'created':
                whereClause = `[System.CreatedBy] = @me AND [System.State] <> 'Closed' AND [System.State] <> 'Resolved'`;
                break;
            case 'mentioned':
                whereClause = `[System.CommentCount] > 0 AND [System.ChangedBy] = @me AND [System.State] <> 'Closed'`;
                break;
            case 'all':
                whereClause = `[System.TeamProject] = '${this.escapeWiqlString(project)}' AND [System.State] NOT IN ('Closed', 'Removed')`;
                break;
            case 'assigned':
            default:
                whereClause = `[System.AssignedTo] = @me AND [System.State] <> 'Closed' AND [System.State] <> 'Resolved'`;
                break;
        }

        const wiql = {
            query: `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.AssignedTo]
                    FROM WorkItems
                    WHERE ${whereClause}
                    ORDER BY [System.ChangedDate] DESC`
        };

        const result = await witApi.queryByWiql(wiql, { project });
        if (!result.workItems || result.workItems.length === 0) {
            return [];
        }

        const ids = result.workItems
            .slice(0, 200)
            .flatMap(wi => wi.id !== undefined ? [wi.id] : []);

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

        const result = await witApi.queryByWiql(wiql, { project });
        if (!result.workItems || result.workItems.length === 0) {
            return [];
        }

        const ids = result.workItems
            .slice(0, 500)
            .flatMap(wi => wi.id !== undefined ? [wi.id] : []);

        if (ids.length === 0) {
            return [];
        }

        const workItems = await witApi.getWorkItems(
            ids,
            undefined,
            undefined,
            WorkItemExpand.Relations,
            undefined,
            project
        );
        return (workItems ?? []).filter((wi): wi is WorkItem => wi !== null);
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
            // Fetch both and merge
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
                const isAdd = change.changeType === VersionControlChangeType.Add;
                const isDelete = change.changeType === VersionControlChangeType.Delete;
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
            status: 1 // active
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
        const result = await witApi.getComments(project, workItemId);
        return (result?.comments ?? []).filter((c): c is WorkItemComment => !c.isDeleted);
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

    get organization(): string | undefined {
        return this._organization;
    }

    get isConnected(): boolean {
        return this._connection !== undefined && this._accessToken.trim() !== '';
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
