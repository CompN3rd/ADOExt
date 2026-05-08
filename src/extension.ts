import * as vscode from 'vscode';
import { AuthProvider } from './auth/authProvider';
import { AdoClient } from './api/adoClient';
import { ConfigManager } from './config/configManager';
import { WorkItemProvider, WorkItemNode } from './providers/workItemProvider';
import {
    PullRequestProvider,
    PullRequestBucketNode,
    PullRequestNode,
    PullRequestCommentNode,
    PullRequestThreadNode
} from './providers/pullRequestProvider';
import { PipelinesProvider, type PipelineRunNode, type PipelineStepLogNode } from './providers/pipelinesProvider';
import { BacklogProvider, SprintProvider, BoardProvider } from './providers/planningProviders';
import { WorkItemIconResolver } from './providers/workItemIconResolver';
import { PlanningPanel } from './views/planningPanel';
import { PrCommentController, type CommentReply } from './views/prCommentController';
import { PrDiffCache, PrDiffContentProvider, PR_DIFF_SCHEME } from './views/prContentProvider';
import { PrDetailsPanel } from './views/prDetailsPanel';
import { PipelineLogContentProvider, PIPELINE_LOG_SCHEME } from './views/pipelineLogContentProvider';
import { NotificationService } from './notifications/notificationService';
import { PrCommentHandler } from './notifications/handlers/prCommentHandler';
import { PrReviewRequestHandler } from './notifications/handlers/prReviewRequestHandler';
import { PrStatusChangeHandler } from './notifications/handlers/prStatusChangeHandler';
import {
    selectOrganization,
    selectProject,
    detectAndSuggestRepoContext
} from './commands/accountCommands';
import {
    changeWorkItemState,
    openWorkItem,
    viewWorkItemDetails,
    startWorkingOnWorkItem,
    openSavedQuery,
    createWorkItem,
    createWorkItemFromSelection,
    createWorkItemFromTodo
} from './commands/workItemCommands';
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
    reopenThread,
    toggleResolvedPullRequestThreads,
    openPullRequestSourceBranch,
    openPullRequestCommit
} from './commands/pullRequestCommands';
import {
    selectWorkItemQuery,
    saveWorkItemQuery,
    savePullRequestQuery
} from './commands/queryCommands';
import { openWorkItemSchemaInspector } from './commands/schemaInspectorCommands';
import {
    cancelPipelineRun,
    openPipelineRunInBrowser,
    openPipelineRunLogsInBrowser,
    rerunPipelineRun,
    viewPipelineRunDetails
} from './commands/pipelineCommands';
import { McpServerManager } from './mcp/mcpServerManager';
import { TodoCodeActionProvider } from './views/todoCodeActionProvider';
import { PipelineRunDetailsPanel } from './views/pipelineRunDetailsPanel';
import { AdoCompletionProvider } from './providers/completionProvider';
import { installNotificationMirroring, showErrorMessage, showInformationMessage, showOutputChannel, showWarningMessage } from './utils/notifications';
import { WorkItemHoverProvider, PullRequestHoverProvider } from './providers/hoverProvider';
import { adoErrorFingerprint, classifyAdoAuthError } from './utils/adoErrors';
import type { AuthRecoveryResult } from './utils/authRecovery';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    installNotificationMirroring();
    const auth = new AuthProvider();
    const config = new ConfigManager();
    const client = new AdoClient('');  // token will be set after sign-in
    const attemptedForbiddenRecoveries = new Set<string>();
    let authRecoveryPromise: Promise<AuthRecoveryResult> | undefined;
    let reauthenticationPromptActive = false;

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
        // Re-prime the notification service (also captures the brand-new sign-in case).
        notificationService.applyConfig();
        // Notify MCP provider of new auth/org state
        mcpManager.refresh();
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
        pipelinesProvider.refresh();
        pipelineLogContentProvider.clear();
        backlogProvider.refresh();
        sprintProvider.refresh();
        boardProvider.refresh();
    }

    function disconnectAfterAuthLost(): void {
        auth.signOut();
        client.disconnect();
        updateSignedInContext();
        notificationService.applyConfig();
        mcpManager.refresh();
        refreshAllViews();
    }

    async function recoverAuthAfterAdoError(error: unknown, source: string): Promise<AuthRecoveryResult> {
        const classification = classifyAdoAuthError(error);
        if (classification.kind === 'none') {
            return 'not-auth';
        }

        if (classification.kind === 'forbidden-refresh-candidate') {
            const fingerprint = adoErrorFingerprint(error, source);
            if (attemptedForbiddenRecoveries.has(fingerprint)) {
                return 'not-auth';
            }
            attemptedForbiddenRecoveries.add(fingerprint);
        }

        if (authRecoveryPromise) {
            return authRecoveryPromise;
        }

        authRecoveryPromise = doRecoverAuthAfterAdoError(classification.kind);
        try {
            return await authRecoveryPromise;
        } finally {
            authRecoveryPromise = undefined;
        }
    }

    async function doRecoverAuthAfterAdoError(kind: 'refreshable' | 'forbidden-refresh-candidate'): Promise<AuthRecoveryResult> {
        const refreshResult = await auth.refreshSession();
        if (refreshResult === 'refreshed') {
            rebuildClient();
            refreshAllViews();
            return 'refreshed';
        }

        if (kind === 'forbidden-refresh-candidate' && refreshResult === 'unchanged') {
            return 'not-auth';
        }

        disconnectAfterAuthLost();
        void promptForReauthentication();
        return 'signed-out';
    }

    async function promptForReauthentication(): Promise<void> {
        if (reauthenticationPromptActive) {
            return;
        }

        reauthenticationPromptActive = true;
        try {
            const choice = await showWarningMessage(
                'Azure DevOps authentication expired or could not be refreshed. Sign in again to continue using ADOExt.',
                'Sign In'
            );
            if (choice !== 'Sign In') {
                return;
            }

            const ok = await auth.reauthenticate();
            if (ok) {
                attemptedForbiddenRecoveries.clear();
                rebuildClient();
                showInformationMessage(`Signed in as ${auth.accountName}`);
                refreshAllViews();
            }
        } finally {
            reauthenticationPromptActive = false;
        }
    }

    // -------------------------------------------------------------------------
    // Tree providers
    // -------------------------------------------------------------------------
    const workItemIconResolver = new WorkItemIconResolver(client, config);
    const workItemProvider = new WorkItemProvider(client, config, workItemIconResolver, recoverAuthAfterAdoError);
    const pullRequestProvider = new PullRequestProvider(client, config, recoverAuthAfterAdoError);
    const pipelinesProvider = new PipelinesProvider(client, config);
    const pipelineLogContentProvider = new PipelineLogContentProvider(client);
    const backlogProvider = new BacklogProvider(client, config, workItemIconResolver, recoverAuthAfterAdoError);
    const sprintProvider = new SprintProvider(client, config, workItemIconResolver, recoverAuthAfterAdoError);
    const boardProvider = new BoardProvider(client, config, workItemIconResolver, recoverAuthAfterAdoError);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('adoext.workItems', workItemProvider),
        vscode.window.registerTreeDataProvider('adoext.pullRequests', pullRequestProvider),
        vscode.window.registerTreeDataProvider('adoext.pipelines', pipelinesProvider),
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
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(PIPELINE_LOG_SCHEME, pipelineLogContentProvider)
    );

    const prCommentController = new PrCommentController(client);
    context.subscriptions.push(prCommentController);

    // Shared notification service: surfaces toasts for PR comments, review
    // requests, and vote/status changes.  New event types can be added by
    // registering additional INotificationHandler implementations below.
    const notificationService = new NotificationService(client, config, [
        new PrCommentHandler(client, config, context.globalState),
        new PrReviewRequestHandler(client, config, context.globalState),
        new PrStatusChangeHandler(client, config, context.globalState)
    ], recoverAuthAfterAdoError);
    context.subscriptions.push(notificationService);

    // -------------------------------------------------------------------------
    // Commands
    // -------------------------------------------------------------------------

    // Sign in
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.showOutput', () => {
            showOutputChannel();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.signIn', async (forceNewSession?: boolean) => {
            const ok = forceNewSession ? await auth.reauthenticate() : await auth.signIn();
            if (ok) {
                attemptedForbiddenRecoveries.clear();
                rebuildClient();
                showInformationMessage(
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
            notificationService.applyConfig();
            mcpManager.refresh();
            showInformationMessage('Signed out from Azure DevOps.');
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

    // Detect and suggest org/project from the active workspace's git remotes
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.detectRepoContext', async () => {
            const ok = await detectAndSuggestRepoContext(config);
            if (ok) {
                if (auth.isSignedIn && config.organization) {
                    client.connect(config.organization);
                }
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

    // Switch / persist work item query preset
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.selectWorkItemQuery', async () => {
            const changed = await selectWorkItemQuery(config);
            if (changed) { workItemProvider.refresh(); }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.saveWorkItemQuery', async () => {
            const saved = await saveWorkItemQuery(config);
            if (saved) { workItemProvider.refresh(); }
        })
    );

    // Set work item filter regex
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.setWorkItemFilter', async () => {
            const current = config.workItemFilterRegex;
            const pattern = await vscode.window.showInputBox({
                prompt: 'Enter regex pattern to filter work items (leave empty to clear)',
                value: current,
                validateInput: (value) => {
                    if (!value.trim()) return undefined;
                    try {
                        new RegExp(value, 'i');
                        return undefined;
                    } catch {
                        return 'Invalid regex pattern';
                    }
                }
            });
            if (pattern !== undefined) {
                await config.setWorkItemFilterRegex(pattern);
                workItemProvider.refresh();
            }
        })
    );

    // Set work item sort order
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.setWorkItemSort', async () => {
            const current = config.workItemSortOrder;
            const choice = await vscode.window.showQuickPick(
                [
                    { label: 'Name (A-Z)', value: 'name', picked: current === 'name' },
                    { label: 'Date (Newest first)', value: 'date', picked: current === 'date' }
                ],
                { placeHolder: 'Choose sort order for work items' }
            );
            if (choice) {
                await config.setWorkItemSortOrder(choice.value as 'name' | 'date');
                workItemProvider.refresh();
            }
        })
    );

    // Toggle hide "Done" work items
    function updateWorkItemDoneHiddenContext(): void {
        const isDoneHidden = config.workItemHideStates.some(s => s.toLowerCase() === 'done');
        void vscode.commands.executeCommand('setContext', 'adoext.workItemDoneHidden', isDoneHidden);
    }

    updateWorkItemDoneHiddenContext();

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.toggleHideDoneWorkItems', async () => {
            const hideStates = config.workItemHideStates;
            const isDoneHidden = hideStates.some(s => s.toLowerCase() === 'done');
            const newHideStates = isDoneHidden
                ? hideStates.filter(s => s.toLowerCase() !== 'done')
                : [...hideStates, 'Done'];
            await config.setWorkItemHideStates(newHideStates);
            updateWorkItemDoneHiddenContext();
            workItemProvider.refresh();
            backlogProvider.refresh();
            sprintProvider.refresh();
            boardProvider.refresh();
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
        vscode.commands.registerCommand('adoext.setPlanningAssignedFilter', async () => {
            const current = config.planningAssignedFilter;
            const choice = await vscode.window.showQuickPick(
                [
                    { label: 'All items', value: 'all', picked: current === 'all' },
                    { label: 'Assigned to me', value: 'mine', picked: current === 'mine' }
                ],
                { placeHolder: 'Choose assignee filter for Backlog, Sprint, and Board views' }
            );
            if (!choice || choice.value === current) {
                return;
            }

            await config.setPlanningAssignedFilter(choice.value as 'all' | 'mine');
            backlogProvider.refresh();
            sprintProvider.refresh();
            boardProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.openBacklogView', async () => {
            if (!(await ensureSignedIn())) { return; }
            await PlanningPanel.show(context, 'backlog', client, config, refreshAllViews);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.openBoardView', async () => {
            if (!(await ensureSignedIn())) { return; }
            await PlanningPanel.show(context, 'board', client, config, refreshAllViews);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.openSprintView', async () => {
            if (!(await ensureSignedIn())) { return; }
            await PlanningPanel.show(context, 'sprint', client, config, refreshAllViews);
        })
    );

    // View work item details in webview
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.viewWorkItemDetails',
            (node?: WorkItemNode) => viewWorkItemDetails(context, node, client, config)
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

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.startWorkingOnWorkItem',
            async (nodeOrItem?: WorkItemNode | import('./api/adoClient').WorkItem, organization?: string, project?: string) => {
                if (!nodeOrItem) {
                    showInformationMessage('Select a work item first, then run "Start Working".');
                    return;
                }
                // Accept either a WorkItemNode (from context menu) or a raw WorkItem
                // (forwarded from the details panel webview message handler).
                const isNode = nodeOrItem instanceof WorkItemNode;
                const workItem = isNode ? nodeOrItem.workItem : nodeOrItem as import('./api/adoClient').WorkItem;
                const org = isNode
                    ? (nodeOrItem.organization ?? client.organization ?? config.organization)
                    : organization;
                const proj = isNode ? (nodeOrItem.project ?? config.project) : project;
                await startWorkingOnWorkItem(workItem, org, proj);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.openSavedQuery', async () => {
            if (!(await ensureSignedIn())) { return; }
            await openSavedQuery(context, client, config);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.openWorkItemSchemaInspector', async () => {
            if (!(await ensureSignedIn())) { return; }
            await openWorkItemSchemaInspector(context, client, config);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.createWorkItem', async () => {
            if (!(await ensureSignedIn())) { return; }
            const created = await createWorkItem(client, config);
            if (created) {
                refreshAllViews();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.createWorkItemFromSelection',
            async () => {
                if (!(await ensureSignedIn())) { return; }
                const created = await createWorkItemFromSelection(context, client, config);
                if (created) { refreshAllViews(); }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.createWorkItemFromTodo',
            async (todoText?: string, lineNumber?: number) => {
                if (!(await ensureSignedIn())) { return; }
                const created = await createWorkItemFromTodo(context, client, config, todoText, lineNumber);
                if (created) { refreshAllViews(); }
            }
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { pattern: '**/*' },
            new TodoCodeActionProvider(),
            { providedCodeActionKinds: TodoCodeActionProvider.providedCodeActionKinds }
        )
    );

    // Refresh pull requests
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.refreshPullRequests', async () => {
            await ensureSignedIn();
            pullRequestProvider.refresh();
        })
    );

    // Set pull request filter regex
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.setPullRequestFilter', async () => {
            const current = config.pullRequestFilterRegex;
            const pattern = await vscode.window.showInputBox({
                prompt: 'Enter regex pattern to filter pull requests (leave empty to clear)',
                value: current,
                validateInput: (value) => {
                    if (!value.trim()) return undefined;
                    try {
                        new RegExp(value, 'i');
                        return undefined;
                    } catch {
                        return 'Invalid regex pattern';
                    }
                }
            });
            if (pattern !== undefined) {
                await config.setPullRequestFilterRegex(pattern);
                pullRequestProvider.refresh();
            }
        })
    );

    // Set pull request sort order
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.setPullRequestSort', async () => {
            const current = config.pullRequestSortOrder;
            const choice = await vscode.window.showQuickPick(
                [
                    { label: 'Title (A-Z)', value: 'title', picked: current === 'title' },
                    { label: 'Date (Newest first)', value: 'date', picked: current === 'date' }
                ],
                { placeHolder: 'Choose sort order for pull requests' }
            );
            if (choice) {
                await config.setPullRequestSortOrder(choice.value as 'title' | 'date');
                pullRequestProvider.refresh();
            }
        })
    );

    // Refresh a single pull request bucket independently
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.refreshPullRequestBucket', async (node: PullRequestBucketNode) => {
            if (!(await ensureSignedIn())) { return; }
            pullRequestProvider.refreshBucket(node);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.savePullRequestQuery', async () => {
            const saved = await savePullRequestQuery(config);
            if (saved) { pullRequestProvider.refresh(); }
        })
    );

    // Open pull request in browser
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openPullRequest',
            (node: PullRequestNode) => openPullRequest(node, client, config)
        )
    );

    // Open pull request source branch in browser
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openPullRequestSourceBranch',
            (node: PullRequestNode) => openPullRequestSourceBranch(node, client, config)
        )
    );

    // Open pull request head commit in browser
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openPullRequestCommit',
            (node: PullRequestNode) => openPullRequestCommit(node, client, config)
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

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.toggleResolvedPullRequestThreads',
            async () => {
                await toggleResolvedPullRequestThreads(config);
                pullRequestProvider.refresh();
                await PrDetailsPanel.refreshAllOpenPanels();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.refreshPipelines', async () => {
            await ensureSignedIn();
            pipelineLogContentProvider.clear();
            pipelinesProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.viewPipelineRunDetails',
            async (node?: PipelineRunNode) => {
                if (!(await ensureSignedIn())) { return; }
                await viewPipelineRunDetails(context, node, client, config);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openPipelineRun',
            async (node?: PipelineRunNode) => {
                if (!(await ensureSignedIn())) { return; }
                await openPipelineRunInBrowser(node, client, config);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openPipelineRunLogs',
            async (node?: PipelineRunNode) => {
                if (!(await ensureSignedIn())) { return; }
                await openPipelineRunLogsInBrowser(node, client, config);
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openPipelineStepLog',
            async (node?: PipelineStepLogNode) => {
                if (!(await ensureSignedIn())) { return; }
                if (!node) { return; }

                const uri = pipelineLogContentProvider.createUri({
                    organization: node.organization,
                    project: node.project,
                    buildId: node.buildId,
                    logId: node.logId,
                    stepName: node.stepName,
                    runLabel: node.runLabel
                });
                const document = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(document, { preview: false });
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.rerunPipelineRun',
            async (node?: PipelineRunNode) => {
                if (!(await ensureSignedIn())) { return; }
                const newId = await rerunPipelineRun(node, client, config);
                if (typeof newId === 'number' && newId > 0) {
                    await PipelineRunDetailsPanel.show(context, client, config, newId, {
                        organization: node?.organization,
                        project: node?.project
                    });
                }
                pipelinesProvider.refresh();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.cancelPipelineRun',
            async (node?: PipelineRunNode) => {
                if (!(await ensureSignedIn())) { return; }
                await cancelPipelineRun(node, client, config);
                pipelinesProvider.refresh();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.setPipelineRunsFilter', async () => {
            const current = config.pipelineRunsFilter;
            const choice = await vscode.window.showQuickPick(
                [
                    { label: 'All runs', description: 'Recent pipeline runs', value: 'all', picked: current === 'all' },
                    { label: 'Running', description: 'Queued or in-progress runs', value: 'running', picked: current === 'running' },
                    { label: 'Failed', description: 'Failed or partially succeeded runs', value: 'failed', picked: current === 'failed' },
                    { label: 'Mine', description: 'Runs requested by me', value: 'mine', picked: current === 'mine' }
                ],
                { placeHolder: 'Choose which pipeline runs to show' }
            );
            if (!choice || choice.value === current) {
                return;
            }
            await config.setPipelineRunsFilter(choice.value as typeof current);
            pipelinesProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.setPipelineRunsGroupBy', async () => {
            const current = config.pipelineRunsGroupBy;
            const choice = await vscode.window.showQuickPick(
                [
                    { label: 'No grouping', value: 'none', picked: current === 'none' },
                    { label: 'Group by repository', value: 'repository', picked: current === 'repository' },
                    { label: 'Group by branch', value: 'branch', picked: current === 'branch' }
                ],
                { placeHolder: 'Choose grouping for pipeline runs' }
            );
            if (!choice || choice.value === current) {
                return;
            }
            await config.setPipelineRunsGroupBy(choice.value as typeof current);
            pipelinesProvider.refresh();
        })
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
                    showInformationMessage('Comment added.');
                    pullRequestProvider.refresh();
                } catch (err) {
                    showErrorMessage(`Failed to add comment: ${err}`);
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

    // Completion providers (work item references and user @-mentions)
    // -------------------------------------------------------------------------
    const completionProvider = new AdoCompletionProvider(client, config);
    completionProvider.register();
    context.subscriptions.push(completionProvider);

    // -------------------------------------------------------------------------
    // Hover providers (work items + pull requests)
    // -------------------------------------------------------------------------
    const workItemHoverProvider = new WorkItemHoverProvider(client, config);
    const pullRequestHoverProvider = new PullRequestHoverProvider(client, config);
    const hoverSelector: vscode.DocumentSelector = [{ language: '*' }];

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(hoverSelector, workItemHoverProvider),
        vscode.languages.registerHoverProvider(hoverSelector, pullRequestHoverProvider)
    );

    // Command: open a work item in the browser by numeric ID + org/project args.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openWorkItemById',
            (args: { id: number; org: string; project: string }) => {
                if (!args?.id || !args?.org || !args?.project) { return; }
                const url = `https://dev.azure.com/${encodeURIComponent(args.org)}/${encodeURIComponent(args.project)}/_workitems/edit/${args.id}`;
                void vscode.env.openExternal(vscode.Uri.parse(url));
            }
        )
    );

    // Command: open a work item details panel by numeric ID + org/project args.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.viewWorkItemDetailsById',
            async (args: { id: number; org: string; project: string }) => {
                if (!args?.id || !args?.org || !args?.project) { return; }
                if (!(await ensureSignedIn())) { return; }
                try {
                    const workItem = await client.getWorkItemById(args.project, args.id, args.org);
                    if (!workItem) {
                        showErrorMessage(`Work item #${args.id} not found.`);
                        return;
                    }
                    const { WorkItemDetailsPanel } = await import('./views/workItemDetailsPanel');
                    await WorkItemDetailsPanel.show(context, client, config, workItem, {
                        organization: args.org,
                        project: args.project
                    });
                } catch (err) {
                    showErrorMessage(`Failed to open work item #${args.id}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        )
    );

    // Command: open a pull request in the browser by numeric ID + scope args.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openPullRequestById',
            (args: { id: number; org: string; project: string; repo: string }) => {
                if (!args?.id || !args?.org || !args?.project || !args?.repo) { return; }
                const url = `https://dev.azure.com/${encodeURIComponent(args.org)}/${encodeURIComponent(args.project)}/_git/${encodeURIComponent(args.repo)}/pullrequest/${args.id}`;
                void vscode.env.openExternal(vscode.Uri.parse(url));
            }
        )
    );

    // -------------------------------------------------------------------------
    // Auto-restore session on activation
    // -------------------------------------------------------------------------
    const restored = await auth.tryRestoreSession();
    if (restored) {
        rebuildClient();
        if (config.isConfigured) {
            refreshAllViews();
        } else {
            // Offer to infer org/project from workspace ADO remotes when the
            // extension is authenticated but not yet configured.
            const { detectAdoRepoContexts } = await import('./utils/repoContext');
            const detected = await detectAdoRepoContexts();
            if (detected.length > 0) {
                const org = detected[0].organization.replace(/[<>&"]/g, '');
                const proj = detected[0].project.replace(/[<>&"]/g, '');
                const choice = await vscode.window.showInformationMessage(
                    `ADOExt detected an Azure DevOps repository (${org}/${proj}) in your workspace. Use it?`,
                    'Yes',
                    'Choose…',
                    'Dismiss'
                );
                if (choice === 'Yes' && detected[0]) {
                    await config.setSelectedOrganizations([detected[0].organization]);
                    await config.setProjectSelections({ [detected[0].organization]: [detected[0].project] });
                    client.connect(detected[0].organization);
                    refreshAllViews();
                } else if (choice === 'Choose…') {
                    await vscode.commands.executeCommand('adoext.detectRepoContext');
                }
            }
        }
    }

    updateSignedInContext();
    notificationService.applyConfig();

    // React to Microsoft auth session changes so token refreshes are picked up
    // without requiring a full window reload.
    let handlingSessionChange = false;
    context.subscriptions.push(
        vscode.authentication.onDidChangeSessions(async e => {
            if (e.provider.id !== 'microsoft') {
                return;
            }
            // Guard against re-entrancy: getSession() can fire onDidChangeSessions
            if (handlingSessionChange) {
                return;
            }
            handlingSessionChange = true;
            try {
                const wasSignedIn = auth.isSignedIn;
                const restored = await auth.tryRestoreSession();

                if (restored) {
                    attemptedForbiddenRecoveries.clear();
                    rebuildClient();
                    if (config.isConfigured) {
                        refreshAllViews();
                    }
                    return;
                }

                if (wasSignedIn) {
                    disconnectAfterAuthLost();
                    showWarningMessage(
                        'Azure DevOps session changed or expired. Please sign in again.'
                    );
                }
            } finally {
                handlingSessionChange = false;
            }
        })
    );

    // React to configuration changes.
    // Debounce to avoid redundant refreshes when commands write multiple
    // settings in quick succession (each update fires onDidChangeConfiguration).
    let configDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('adoext')) {
                return;
            }
            if (configDebounceTimer) {
                clearTimeout(configDebounceTimer);
            }
            configDebounceTimer = setTimeout(() => {
                configDebounceTimer = undefined;
                if (config.organization && auth.isSignedIn) {
                    client.connect(config.organization);
                }
                if (e.affectsConfiguration('adoext.workItemHideStates')) {
                    updateWorkItemDoneHiddenContext();
                }
                refreshAllViews();
                if (e.affectsConfiguration('adoext.planningAssignedFilter')) {
                    void PlanningPanel.refreshOpenPanels();
                }
                if (
                    e.affectsConfiguration('adoext.notifyOnNewPullRequestComments') ||
                    e.affectsConfiguration('adoext.notifyOnPullRequestReviewRequests') ||
                    e.affectsConfiguration('adoext.notifyOnPullRequestStatusChanges') ||
                    e.affectsConfiguration('adoext.pullRequestCommentPollIntervalSeconds') ||
                    e.affectsConfiguration('adoext.pullRequestFilter') ||
                    e.affectsConfiguration('adoext.pullRequestQueries') ||
                    e.affectsConfiguration('adoext.activePullRequestQueryId')
                ) {
                    notificationService.applyConfig();
                }
            }, 300);
        })
    );
}

export function deactivate(): void {
    // Nothing to clean up; VS Code disposes subscriptions automatically.
}
