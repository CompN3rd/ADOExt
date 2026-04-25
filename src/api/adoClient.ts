import * as azdev from 'azure-devops-node-api';
import type { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import type { IGitApi } from 'azure-devops-node-api/GitApi';
import type { ICoreApi } from 'azure-devops-node-api/CoreApi';
import type { WorkItem, WorkItemType } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import type {
    GitPullRequest,
    GitPullRequestCommentThread,
    GitPullRequestSearchCriteria,
    Comment,
    CommentThreadStatus
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import type { TeamProject } from 'azure-devops-node-api/interfaces/CoreInterfaces';

export type {
    WorkItem,
    WorkItemType,
    GitPullRequest,
    GitPullRequestCommentThread,
    Comment,
    CommentThreadStatus,
    TeamProject
};

/**
 * Thin wrapper around the azure-devops-node-api package.
 * Handles connection setup and exposes high-level helpers used by the tree
 * providers and command handlers.
 */
export class AdoClient {
    private _connection: azdev.WebApi | undefined;
    private _organization: string | undefined;

    constructor(private _accessToken: string) {}

    /**
     * Update the access token and reconnect if an organization is already set.
     */
    updateToken(token: string): void {
        this._accessToken = token;
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
        const orgUrl = `https://dev.azure.com/${organization}`;
        const authHandler = azdev.getBearerHandler(this._accessToken);
        this._connection = new azdev.WebApi(orgUrl, authHandler);
    }

    private get connection(): azdev.WebApi {
        if (!this._connection) {
            throw new Error('Not connected. Call connect() first.');
        }
        return this._connection;
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
    async listProjects(): Promise<TeamProject[]> {
        const coreApi: ICoreApi = await this.connection.getCoreApi();
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
        filter: 'assigned' | 'created' | 'mentioned' | 'all' = 'assigned'
    ): Promise<WorkItem[]> {
        const witApi: IWorkItemTrackingApi = await this.connection.getWorkItemTrackingApi();

        let whereClause: string;
        switch (filter) {
            case 'created':
                whereClause = `[System.CreatedBy] = @me AND [System.State] <> 'Closed' AND [System.State] <> 'Resolved'`;
                break;
            case 'mentioned':
                whereClause = `[System.CommentCount] > 0 AND [System.ChangedBy] = @me AND [System.State] <> 'Closed'`;
                break;
            case 'all':
                whereClause = `[System.TeamProject] = '${project}' AND [System.State] NOT IN ('Closed', 'Removed')`;
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
            .map(wi => wi.id!)
            .filter(id => id !== undefined);

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
        return workItems.filter((wi): wi is WorkItem => wi !== null);
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
        currentUserDescriptor?: string
    ): Promise<GitPullRequest[]> {
        const gitApi: IGitApi = await this.connection.getGitApi();

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
        pullRequestId: number
    ): Promise<GitPullRequestCommentThread[]> {
        const gitApi: IGitApi = await this.connection.getGitApi();
        const threads = await gitApi.getThreads(repositoryId, pullRequestId, project);
        return threads ?? [];
    }

    /**
     * Reply to an existing comment thread.
     */
    async replyToThread(
        project: string,
        repositoryId: string,
        pullRequestId: number,
        threadId: number,
        content: string
    ): Promise<Comment> {
        const gitApi: IGitApi = await this.connection.getGitApi();
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
        status: CommentThreadStatus
    ): Promise<GitPullRequestCommentThread> {
        const gitApi: IGitApi = await this.connection.getGitApi();
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
        content: string
    ): Promise<GitPullRequestCommentThread> {
        const gitApi: IGitApi = await this.connection.getGitApi();
        const thread: GitPullRequestCommentThread = {
            comments: [{ content }],
            status: 1 // active
        };
        return gitApi.createThread(thread, repositoryId, pullRequestId, project);
    }

    /**
     * Returns the clone URL for a repository (used for branch checkout).
     */
    async getRepositoryCloneUrl(
        project: string,
        repositoryId: string
    ): Promise<string | undefined> {
        const gitApi: IGitApi = await this.connection.getGitApi();
        const repo = await gitApi.getRepository(repositoryId, project);
        return repo?.remoteUrl;
    }

    get organization(): string | undefined {
        return this._organization;
    }
}
