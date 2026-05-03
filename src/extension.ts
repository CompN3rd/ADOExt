import * as vscode from 'vscode';
import { AuthProvider } from './auth/authProvider';
import { AdoClient } from './api/adoClient';
import { ConfigManager } from './config/configManager';
import { WorkItemProvider, WorkItemNode } from './providers/workItemProvider';
import {
    PullRequestProvider,
    PullRequestNode,
    PullRequestCommentNode,
    PullRequestThreadNode
} from './providers/pullRequestProvider';
import { BacklogProvider, SprintProvider, BoardProvider } from './providers/planningProviders';
import { PlanningPanel } from './views/planningPanel';
import { PrCommentController, type CommentReply } from './views/prCommentController';
import { PrDiffCache, PrDiffContentProvider, PR_DIFF_SCHEME } from './views/prContentProvider';
import { PrCommentNotifier } from './views/prCommentNotifier';
import {
    selectOrganization,
    selectProject
} from './commands/accountCommands';
import { changeWorkItemState, openWorkItem, viewWorkItemDetails } from './commands/workItemCommands';
import {
    openPullRequest,
    viewPullRequestDetails,
    viewPullRequestDiff,
    approvePullRequest,
    approvePullRequestWithSuggestions,
    waitForPullRequestAuthor,
    rejectPullRequest,
    resetPullRequestVote,
    checkoutPullRequest,
    replyToComment,
    resolveThread,
    reopenThread
} from './commands/pullRequestCommands';
import { McpServerManager } from './mcp/mcpServerManager';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const auth = new AuthProvider();
    const config = new ConfigManager();
    const client = new AdoClient('');  // token will be set after sign-in

    // -------------------------------------------------------------------------
    // Helper: ensure the user is signed in and the client is connected
    // -------------------------------------------------------------------------
    async function ensureSignedIn(): Promise<boolean> {
        if (!auth.isSignedIn) {
            // Try silent restore first
            const restored = await auth.tryRestoreSession();
            if (!restored) {
                return false;
            }
            rebuildClient();
        }
        return true;
    }

    function rebuildClient(): void {
        if (!auth.accessToken) { return; }
        client.updateToken(auth.accessToken);
        if (config.organization) {
            client.connect(config.organization);
        }
        updateSignedInContext();
        // Re-prime the notifier (also captures the brand-new sign-in case).
        prCommentNotifier.applyConfig();
    }

    function updateSignedInContext(): void {
        void vscode.commands.executeCommand(
            'setContext',
            'adoext.isSignedIn',
            auth.isSignedIn
        );
    }

    function refreshAllViews(): void {
        workItemProvider.refresh();
        pullRequestProvider.refresh();
        backlogProvider.refresh();
        sprintProvider.refresh();
        boardProvider.refresh();
    }

    // -------------------------------------------------------------------------
    // Tree providers
    // -------------------------------------------------------------------------
    const workItemProvider = new WorkItemProvider(client, config);
    const pullRequestProvider = new PullRequestProvider(client, config);
    const backlogProvider = new BacklogProvider(client, config);
    const sprintProvider = new SprintProvider(client, config);
    const boardProvider = new BoardProvider(client, config);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('adoext.workItems', workItemProvider),
        vscode.window.registerTreeDataProvider('adoext.pullRequests', pullRequestProvider),
        vscode.window.registerTreeDataProvider('adoext.backlog', backlogProvider),
        vscode.window.registerTreeDataProvider('adoext.sprints', sprintProvider),
        vscode.window.registerTreeDataProvider('adoext.boards', boardProvider)
    );

    // -------------------------------------------------------------------------
    // Native diff editor + inline comment controller
    // -------------------------------------------------------------------------
    const diffCache = new PrDiffCache();
    const diffContentProvider = new PrDiffContentProvider(client, diffCache);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(PR_DIFF_SCHEME, diffContentProvider)
    );

    const prCommentController = new PrCommentController(client);
    context.subscriptions.push(prCommentController);

    // Surface a small toast when a tracked PR receives new comments. The
    // user can mute the notifications from the toast itself or via the
    // `adoext.notifyOnNewPullRequestComments` setting.
    const prCommentNotifier = new PrCommentNotifier(client, config, context.globalState);
    context.subscriptions.push(prCommentNotifier);

    // -------------------------------------------------------------------------
    // Commands
    // -------------------------------------------------------------------------

    // Sign in
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.signIn', async () => {
            const ok = await auth.signIn();
            if (ok) {
                rebuildClient();
                vscode.window.showInformationMessage(
                    `Signed in as ${auth.accountName}`
                );
                refreshAllViews();
            }
        })
    );

    // Sign out
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.signOut', () => {
            auth.signOut();
            client.updateToken('');
            updateSignedInContext();
            vscode.window.showInformationMessage('Signed out from Azure DevOps.');
            refreshAllViews();
        })
    );

    // Select organization
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.selectOrganization', async () => {
            if (!(await ensureSignedIn())) {
                const signedIn = await auth.signIn();
                if (!signedIn) { return; }
                rebuildClient();
            }
            const ok = await selectOrganization(client, config, auth);
            if (ok) {
                refreshAllViews();
            }
        })
    );

    // Select project
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.selectProject', async () => {
            if (!(await ensureSignedIn())) { return; }
            const ok = await selectProject(client, config);
            if (ok) {
                refreshAllViews();
            }
        })
    );

    // Refresh work items
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.refreshWorkItems', async () => {
            await ensureSignedIn();
            workItemProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.refreshBacklog', async () => {
            await ensureSignedIn();
            backlogProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.refreshSprints', async () => {
            await ensureSignedIn();
            sprintProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.refreshBoards', async () => {
            await ensureSignedIn();
            boardProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.openBacklogView', async () => {
            if (!(await ensureSignedIn())) { return; }
            await PlanningPanel.show('backlog', client, config, refreshAllViews);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.openBoardView', async () => {
            if (!(await ensureSignedIn())) { return; }
            await PlanningPanel.show('board', client, config, refreshAllViews);
        })
    );

    // View work item details in webview
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.viewWorkItemDetails',
            (node?: WorkItemNode) => viewWorkItemDetails(node, client, config)
        )
    );

    // Open work item in browser (secondary action)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openWorkItem',
            (node: WorkItemNode) => openWorkItem(node, client, config)
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.changeWorkItemState',
            async (node?: WorkItemNode) => {
                const updated = await changeWorkItemState(node, client, config);
                if (updated) {
                    refreshAllViews();
                }
            }
        )
    );

    // Refresh pull requests
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.refreshPullRequests', async () => {
            await ensureSignedIn();
            pullRequestProvider.refresh();
        })
    );

    // Open pull request in browser
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openPullRequest',
            (node: PullRequestNode) => openPullRequest(node, client, config)
        )
    );

    // View PR details in webview
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.viewPullRequestDetails',
            (node: PullRequestNode) =>
                viewPullRequestDetails(node, context, client, config)
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.viewPullRequestDiff',
            async (node: PullRequestNode | { pr: import('./api/adoClient').GitPullRequest; organization?: string; project?: string }) => {
                if (!(await ensureSignedIn())) { return; }
                await viewPullRequestDiff(node, client, config, prCommentController, diffCache);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.approvePullRequest',
            async (node?: PullRequestNode) => {
                if (!(await ensureSignedIn())) { return; }
                const updated = await approvePullRequest(node, client, config);
                if (updated) {
                    pullRequestProvider.refresh();
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.approvePullRequestWithSuggestions',
            async (node?: PullRequestNode) => {
                if (!(await ensureSignedIn())) { return; }
                const updated = await approvePullRequestWithSuggestions(node, client, config);
                if (updated) {
                    pullRequestProvider.refresh();
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.waitForPullRequestAuthor',
            async (node?: PullRequestNode) => {
                if (!(await ensureSignedIn())) { return; }
                const updated = await waitForPullRequestAuthor(node, client, config);
                if (updated) {
                    pullRequestProvider.refresh();
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.rejectPullRequest',
            async (node?: PullRequestNode) => {
                if (!(await ensureSignedIn())) { return; }
                const updated = await rejectPullRequest(node, client, config);
                if (updated) {
                    pullRequestProvider.refresh();
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.resetPullRequestVote',
            async (node?: PullRequestNode) => {
                if (!(await ensureSignedIn())) { return; }
                const updated = await resetPullRequestVote(node, client, config);
                if (updated) {
                    pullRequestProvider.refresh();
                }
            }
        )
    );

    // Checkout PR branch
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.checkoutPullRequest',
            (node: PullRequestNode) => checkoutPullRequest(node, client, config, prCommentController)
        )
    );

    // Inline comment controller commands (used by the gutter/title affordances).
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.prComment.create',
            async (reply: CommentReply) => {
                await prCommentController.createOrReply(reply);
            }
        ),
        vscode.commands.registerCommand(
            'adoext.prComment.reply',
            async (reply: CommentReply) => {
                await prCommentController.createOrReply(reply);
            }
        ),
        vscode.commands.registerCommand(
            'adoext.prComment.resolve',
            async (thread: vscode.CommentThread) => {
                await prCommentController.setThreadStatus(thread, 2 /* Fixed */);
            }
        ),
        vscode.commands.registerCommand(
            'adoext.prComment.reopen',
            async (thread: vscode.CommentThread) => {
                await prCommentController.setThreadStatus(thread, 1 /* Active */);
            }
        )
    );

    // Reply to a comment (from tree context menu)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.replyToComment',
            async (node: PullRequestCommentNode) => {
                await replyToComment(node, client, config);
                pullRequestProvider.refresh();
            }
        )
    );

    // Resolve thread
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.resolveThread',
            async (node: PullRequestThreadNode) => {
                await resolveThread(node, client, config);
                pullRequestProvider.refresh();
            }
        )
    );

    // Reopen thread
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.reopenThread',
            async (node: PullRequestThreadNode) => {
                await reopenThread(node, client, config);
                pullRequestProvider.refresh();
            }
        )
    );

    // Add new comment to PR
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.addPullRequestComment',
            async (node: PullRequestNode) => {
                if (!node) { return; }
                const content = await vscode.window.showInputBox({
                    prompt: 'Enter your comment',
                    placeHolder: 'Write a comment…'
                });
                if (!content) { return; }

                const pr = node.pr;
                const repoId = pr.repository?.id ?? '';
                const prId = pr.pullRequestId ?? 0;
                const project = node.project ?? config.project;
                const organization = node.organization ?? client.organization ?? config.organization;

                try {
                    await client.addPullRequestComment(
                        project,
                        repoId,
                        prId,
                        content,
                        organization
                    );
                    vscode.window.showInformationMessage('Comment added.');
                    pullRequestProvider.refresh();
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to add comment: ${err}`);
                }
            }
        )
    );

    // -------------------------------------------------------------------------
    // MCP Server
    // -------------------------------------------------------------------------
    const mcpManager = new McpServerManager(config, auth);
    mcpManager.register();
    context.subscriptions.push(mcpManager);

    // -------------------------------------------------------------------------
    // Auto-restore session on activation
    // -------------------------------------------------------------------------
    const restored = await auth.tryRestoreSession();
    if (restored) {
        rebuildClient();
        if (config.isConfigured) {
            refreshAllViews();
        }
    }
    updateSignedInContext();
    prCommentNotifier.applyConfig();

    // React to configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('adoext')) {
                if (config.organization && auth.isSignedIn) {
                    client.connect(config.organization);
                }
                refreshAllViews();
                if (
                    e.affectsConfiguration('adoext.notifyOnNewPullRequestComments') ||
                    e.affectsConfiguration('adoext.pullRequestCommentPollIntervalSeconds')
                ) {
                    prCommentNotifier.applyConfig();
                }
            }
        })
    );
}

export function deactivate(): void {
    // Nothing to clean up; VS Code disposes subscriptions automatically.
}
