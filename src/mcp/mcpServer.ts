import { AdoClient } from '../api/adoClient';
import type { PullRequestReviewVote, CommentThreadStatus } from '../api/adoClient';

// Use require() to avoid pulling in the MCP SDK's heavy generic types at
// compile time which causes exponential type instantiation with zod.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js') as {
    McpServer: new (options: { name: string; version: string }) => McpServerInstance;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { z } = require('zod') as { z: typeof import('zod').z };

export interface McpServerInstance {
    tool(
        name: string,
        description: string,
        schema: Record<string, unknown>,
        handler: (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>
    ): void;
    connect(transport: unknown): Promise<void>;
}

/**
 * Creates an MCP server that exposes Azure DevOps capabilities as MCP tools.
 * Shares the same AdoClient and authentication as the VS Code extension,
 * providing a unified experience for AI assistants.
 */
export function createMcpServer(client: AdoClient): McpServerInstance {
    const server: McpServerInstance = new McpServer({
        name: 'ADOExt',
        version: '0.1.0'
    });

    // -------------------------------------------------------------------------
    // Organization & Project tools
    // -------------------------------------------------------------------------

    server.tool(
        'list_organizations',
        'List all Azure DevOps organizations the authenticated user belongs to',
        {},
        async () => {
            const orgs = await client.listOrganizations();
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(orgs, null, 2)
                }]
            };
        }
    );

    server.tool(
        'list_projects',
        'List all projects in an Azure DevOps organization',
        { organization: z.string().describe('The Azure DevOps organization name') },
        async (args: Record<string, unknown>) => {
            const organization = args.organization as string;
            const projects = await client.listProjects(organization);
            const result = projects.map(p => ({
                id: p.id,
                name: p.name,
                description: p.description,
                state: p.state
            }));
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };
        }
    );

    // -------------------------------------------------------------------------
    // Work Item tools
    // -------------------------------------------------------------------------

    server.tool(
        'list_work_items',
        'List work items in a project with optional filtering',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            filter: z.enum(['assigned', 'created', 'mentioned', 'all']).default('assigned')
                .describe('Filter: assigned to me, created by me, mentioned, or all active')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, filter } = args as {
                organization: string; project: string;
                filter: 'assigned' | 'created' | 'mentioned' | 'all';
            };
            const items = await client.getWorkItems(project, filter, organization);
            const result = items.map(wi => ({
                id: wi.id,
                title: wi.fields?.['System.Title'],
                state: wi.fields?.['System.State'],
                type: wi.fields?.['System.WorkItemType'],
                assignedTo: wi.fields?.['System.AssignedTo']?.displayName
            }));
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };
        }
    );

    server.tool(
        'get_work_item',
        'Get detailed information about a specific work item',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            id: z.number().describe('The work item ID')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, id } = args as {
                organization: string; project: string; id: number;
            };
            const item = await client.getWorkItemById(project, id, organization);
            if (!item) {
                return {
                    content: [{ type: 'text', text: `Work item ${id} not found.` }],
                    isError: true
                };
            }
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        id: item.id,
                        title: item.fields?.['System.Title'],
                        state: item.fields?.['System.State'],
                        type: item.fields?.['System.WorkItemType'],
                        assignedTo: item.fields?.['System.AssignedTo']?.displayName,
                        description: item.fields?.['System.Description'],
                        iterationPath: item.fields?.['System.IterationPath'],
                        areaPath: item.fields?.['System.AreaPath'],
                        tags: item.fields?.['System.Tags']
                    }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'update_work_item_state',
        'Change the state of a work item (e.g. Active, Resolved, Closed)',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            id: z.number().describe('The work item ID'),
            state: z.string().describe('The new state (e.g. "Active", "Resolved", "Closed")')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, id, state } = args as {
                organization: string; project: string; id: number; state: string;
            };
            const updated = await client.updateWorkItemState(project, id, state, organization);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        id: updated.id,
                        title: updated.fields?.['System.Title'],
                        state: updated.fields?.['System.State']
                    }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'get_work_item_comments',
        'Get discussion comments on a work item',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            workItemId: z.number().describe('The work item ID')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, workItemId } = args as {
                organization: string; project: string; workItemId: number;
            };
            const comments = await client.getWorkItemComments(project, workItemId, organization);
            const result = comments.map(c => ({
                id: c.id,
                text: c.text,
                createdBy: c.createdBy?.displayName,
                createdDate: c.createdDate
            }));
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };
        }
    );

    server.tool(
        'add_work_item_comment',
        'Add a discussion comment to a work item',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            workItemId: z.number().describe('The work item ID'),
            text: z.string().describe('The comment text')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, workItemId, text } = args as {
                organization: string; project: string; workItemId: number; text: string;
            };
            const comment = await client.addWorkItemComment(project, workItemId, text, organization);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        id: comment.id,
                        text: comment.text,
                        createdBy: comment.createdBy?.displayName
                    }, null, 2)
                }]
            };
        }
    );

    // -------------------------------------------------------------------------
    // Pull Request tools
    // -------------------------------------------------------------------------

    server.tool(
        'list_pull_requests',
        'List pull requests in a project',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            filter: z.enum(['mine', 'created', 'assigned', 'all']).default('mine')
                .describe('Filter: mine (created or reviewing), created by me, assigned to me, or all active')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, filter } = args as {
                organization: string; project: string;
                filter: 'mine' | 'created' | 'assigned' | 'all';
            };
            const prs = await client.getPullRequests(project, filter, undefined, organization);
            const result = prs.map(pr => ({
                id: pr.pullRequestId,
                title: pr.title,
                status: pr.status,
                createdBy: pr.createdBy?.displayName,
                sourceRefName: pr.sourceRefName,
                targetRefName: pr.targetRefName,
                repositoryId: pr.repository?.id,
                repositoryName: pr.repository?.name
            }));
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };
        }
    );

    server.tool(
        'get_pull_request',
        'Get detailed information about a specific pull request',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            repositoryId: z.string().describe('The repository ID'),
            pullRequestId: z.number().describe('The pull request ID')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, repositoryId, pullRequestId } = args as {
                organization: string; project: string;
                repositoryId: string; pullRequestId: number;
            };
            const pr = await client.getPullRequest(project, repositoryId, pullRequestId, organization);
            if (!pr) {
                return {
                    content: [{ type: 'text', text: `Pull request ${pullRequestId} not found.` }],
                    isError: true
                };
            }
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        id: pr.pullRequestId,
                        title: pr.title,
                        description: pr.description,
                        status: pr.status,
                        createdBy: pr.createdBy?.displayName,
                        creationDate: pr.creationDate,
                        sourceRefName: pr.sourceRefName,
                        targetRefName: pr.targetRefName,
                        reviewers: pr.reviewers?.map(r => ({
                            displayName: r.displayName,
                            vote: r.vote
                        }))
                    }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'get_pull_request_threads',
        'Get comment threads on a pull request',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            repositoryId: z.string().describe('The repository ID'),
            pullRequestId: z.number().describe('The pull request ID')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, repositoryId, pullRequestId } = args as {
                organization: string; project: string;
                repositoryId: string; pullRequestId: number;
            };
            const threads = await client.getPullRequestThreads(
                project, repositoryId, pullRequestId, organization
            );
            const result = threads
                .filter(t => !t.isDeleted)
                .map(t => ({
                    id: t.id,
                    status: t.status,
                    filePath: t.threadContext?.filePath,
                    comments: t.comments?.filter(c => !c.isDeleted).map(c => ({
                        id: c.id,
                        content: c.content,
                        author: c.author?.displayName,
                        publishedDate: c.publishedDate
                    }))
                }));
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };
        }
    );

    server.tool(
        'add_pull_request_comment',
        'Add a top-level comment to a pull request',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            repositoryId: z.string().describe('The repository ID'),
            pullRequestId: z.number().describe('The pull request ID'),
            content: z.string().describe('The comment content (markdown supported)')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, repositoryId, pullRequestId, content } = args as {
                organization: string; project: string;
                repositoryId: string; pullRequestId: number; content: string;
            };
            const thread = await client.addPullRequestComment(
                project, repositoryId, pullRequestId, content, organization
            );
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ threadId: thread.id, status: 'created' }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'reply_to_pull_request_thread',
        'Reply to an existing comment thread on a pull request',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            repositoryId: z.string().describe('The repository ID'),
            pullRequestId: z.number().describe('The pull request ID'),
            threadId: z.number().describe('The thread ID to reply to'),
            content: z.string().describe('The reply content (markdown supported)')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, repositoryId, pullRequestId, threadId, content } = args as {
                organization: string; project: string;
                repositoryId: string; pullRequestId: number;
                threadId: number; content: string;
            };
            const comment = await client.replyToThread(
                project, repositoryId, pullRequestId, threadId, content, organization
            );
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        commentId: comment.id,
                        author: comment.author?.displayName,
                        status: 'replied'
                    }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'update_pull_request_thread_status',
        'Resolve or reopen a comment thread on a pull request',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            repositoryId: z.string().describe('The repository ID'),
            pullRequestId: z.number().describe('The pull request ID'),
            threadId: z.number().describe('The thread ID'),
            status: z.enum(['active', 'fixed', 'wontFix', 'closed', 'byDesign'])
                .describe('The new thread status')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, repositoryId, pullRequestId, threadId, status } = args as {
                organization: string; project: string;
                repositoryId: string; pullRequestId: number;
                threadId: number; status: string;
            };
            const statusMap: Record<string, number> = {
                active: 1,
                fixed: 2,
                wontFix: 3,
                closed: 4,
                byDesign: 5
            };
            const thread = await client.updateThreadStatus(
                project, repositoryId, pullRequestId, threadId,
                statusMap[status] as CommentThreadStatus,
                organization
            );
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ threadId: thread.id, status: thread.status }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'set_pull_request_vote',
        'Set your review vote on a pull request',
        {
            organization: z.string().describe('The Azure DevOps organization name'),
            project: z.string().describe('The project name'),
            repositoryId: z.string().describe('The repository ID'),
            pullRequestId: z.number().describe('The pull request ID'),
            vote: z.enum(['approved', 'approvedWithSuggestions', 'noVote', 'waitingForAuthor', 'rejected'])
                .describe('The review vote')
        },
        async (args: Record<string, unknown>) => {
            const { organization, project, repositoryId, pullRequestId, vote } = args as {
                organization: string; project: string;
                repositoryId: string; pullRequestId: number; vote: string;
            };
            const voteMap: Record<string, PullRequestReviewVote> = {
                rejected: -10,
                waitingForAuthor: -5,
                noVote: 0,
                approvedWithSuggestions: 5,
                approved: 10
            };
            const result = await client.setPullRequestReviewVote(
                project, repositoryId, pullRequestId, voteMap[vote], organization
            );
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        reviewerId: result.id,
                        displayName: result.displayName,
                        vote: result.vote
                    }, null, 2)
                }]
            };
        }
    );

    return server;
}
