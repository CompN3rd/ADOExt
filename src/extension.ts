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
import { PrThreadCache } from './providers/prThreadCache';
import { PipelinesProvider, type PipelineRunNode, type PipelineStepLogNode } from './providers/pipelinesProvider';
import { BacklogProvider, SprintProvider, BoardProvider } from './providers/planningProviders';
import { WorkItemIconResolver } from './providers/workItemIconResolver';
import { PrCommentController, type CommentReply } from './views/prCommentController';
import { PrDiffCache, PrDiffContentProvider, PR_DIFF_SCHEME } from './views/prContentProvider';
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
import {
    cancelPipelineRun,
    openPipelineRunInBrowser,
    openPipelineRunLogsInBrowser,
    rerunPipelineRun,
    viewPipelineRunDetails
} from './commands/pipelineCommands';
import { McpServerManager } from './mcp/mcpServerManager';
import { TodoCodeActionProvider } from './views/todoCodeActionProvider';
import { AdoCompletionProvider } from './providers/completionProvider';
import { installNotificationMirroring, showErrorMessage, showInformationMessage, showOutputChannel, showWarningMessage } from './utils/notifications';
import { WorkItemHoverProvider, PullRequestHoverProvider } from './providers/hoverProvider';
import { adoErrorFingerprint, classifyAdoAuthError } from './utils/adoErrors';
import type { AuthRecoveryResult } from './utils/authRecovery';
import {
    loadPlanningPanel,
    loadedPlanningPanel,
    loadedPrDetailsPanel,
    loadPipelineRunDetailsPanel
} from './views/lazyPanels';
import { CommandRegistry } from './commands/commandRegistry';

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
    const prThreadCache = new PrThreadCache();
    const pullRequestProvider = new PullRequestProvider(client, config, recoverAuthAfterAdoError, prThreadCache);
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
        new PrCommentHandler(client, config, context.globalState, prThreadCache),
        new PrReviewRequestHandler(client, config, context.globalState),
        new PrStatusChangeHandler(client, config, context.globalState)
    ], recoverAuthAfterAdoError);
    context.subscriptions.push(notificationService);

    // -------------------------------------------------------------------------
    // Commands
    // -------------------------------------------------------------------------
    const registry = new CommandRegistry(ensureSignedIn);

    // Sign in
    registry.add('adoext.showOutput', () => {
        showOutputChannel();
    });

    registry.add('adoext.signIn', async (forceNewSession?: boolean) => {
        const ok = forceNewSession ? await auth.reauthenticate() : await auth.signIn();
        if (ok) {
            attemptedForbiddenRecoveries.clear();
            rebuildClient();
            showInformationMessage(
                `Signed in as ${auth.accountName}`
            );
            refreshAllViews();
        }
    });

    // Sign out
    registry.add('adoext.signOut', () => {
        auth.signOut();
        client.updateToken('');
        updateSignedInContext();
        notificationService.applyConfig();
        mcpManager.refresh();
        showInformationMessage('Signed out from Azure DevOps.');
        refreshAllViews();
    });

    // Select organization
    registry.add('adoext.selectOrganization', async () => {
        if (!(await ensureSignedIn())) {
            const signedIn = await auth.signIn();
            if (!signedIn) { return; }
            rebuildClient();
        }
        const ok = await selectOrganization(client, config, auth);
        if (ok) {
            refreshAllViews();
        }
    });

    // Detect and suggest org/project from the active workspace's git remotes
    registry.add('adoext.detectRepoContext', async () => {
        const ok = await detectAndSuggestRepoContext(config);
        if (ok) {
            if (auth.isSignedIn && config.organization) {
                client.connect(config.organization);
            }
            refreshAllViews();
        }
    });

    // Select project
    registry.addRefreshing('adoext.selectProject', () => selectProject(client, config), refreshAllViews);

    // Refresh work items
    registry.addRefresh('adoext.refreshWorkItems', () => workItemProvider.refresh());

    // Switch / persist work item query preset
    registry.add('adoext.selectWorkItemQuery', async () => {
        const changed = await selectWorkItemQuery(config);
        if (changed) { workItemProvider.refresh(); }
    });
    registry.add('adoext.saveWorkItemQuery', async () => {
        const saved = await saveWorkItemQuery(config);
        if (saved) { workItemProvider.refresh(); }
    });

    // Set work item filter regex
    registry.add('adoext.setWorkItemFilter', async () => {
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
    });

    // Set work item sort order
    registry.add('adoext.setWorkItemSort', async () => {
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
    });

    // Toggle hide "Done" work items
    function updateWorkItemDoneHiddenContext(): void {
        const isDoneHidden = config.workItemHideStates.some(s => s.toLowerCase() === 'done');
        void vscode.commands.executeCommand('setContext', 'adoext.workItemDoneHidden', isDoneHidden);
    }

    updateWorkItemDoneHiddenContext();

    registry.add('adoext.toggleHideDoneWorkItems', async () => {
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
    });

    registry.addRefresh('adoext.refreshBacklog', () => backlogProvider.refresh());

    registry.addRefresh('adoext.refreshSprints', () => sprintProvider.refresh());

    registry.addRefresh('adoext.refreshBoards', () => boardProvider.refresh());

    registry.add('adoext.setPlanningAssignedFilter', async () => {
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
    });

    registry.addGuarded('adoext.openBacklogView', async () => {
        await (await loadPlanningPanel()).PlanningPanel.show(context, 'backlog', client, config, refreshAllViews);
    });
    registry.addGuarded('adoext.openBoardView', async () => {
        await (await loadPlanningPanel()).PlanningPanel.show(context, 'board', client, config, refreshAllViews);
    });
    registry.addGuarded('adoext.openSprintView', async () => {
        await (await loadPlanningPanel()).PlanningPanel.show(context, 'sprint', client, config, refreshAllViews);
    });

    // View work item details in webview
    registry.add(
        'adoext.viewWorkItemDetails',
        (node?: WorkItemNode) => viewWorkItemDetails(context, node, client, config)
    );

    // Open work item in browser (secondary action)
    registry.add(
        'adoext.openWorkItem',
        (node: WorkItemNode) => openWorkItem(node, client, config)
    );

    registry.addRefreshing(
        'adoext.changeWorkItemState',
        (node?: WorkItemNode) => changeWorkItemState(node, client, config),
        refreshAllViews
    );

    registry.add(
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
    );

    registry.addGuarded('adoext.openSavedQuery', () => openSavedQuery(context, client, config));

    registry.addRefreshing('adoext.createWorkItem', () => createWorkItem(client, config), refreshAllViews);

    registry.addRefreshing(
        'adoext.createWorkItemFromSelection',
        () => createWorkItemFromSelection(context, client, config),
        refreshAllViews
    );

    registry.addRefreshing(
        'adoext.createWorkItemFromTodo',
        (todoText?: string, lineNumber?: number) => createWorkItemFromTodo(context, client, config, todoText, lineNumber),
        refreshAllViews
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { pattern: '**/*' },
            new TodoCodeActionProvider(),
            { providedCodeActionKinds: TodoCodeActionProvider.providedCodeActionKinds }
        )
    );

    // Refresh pull requests
    registry.addRefresh('adoext.refreshPullRequests', () => pullRequestProvider.refresh());

    // Set pull request filter regex
    registry.add('adoext.setPullRequestFilter', async () => {
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
    });

    // Set pull request sort order
    registry.add('adoext.setPullRequestSort', async () => {
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
    });

    // Refresh a single pull request bucket independently
    registry.addGuarded('adoext.refreshPullRequestBucket', (node: PullRequestBucketNode) => {
        pullRequestProvider.refreshBucket(node);
    });
    registry.add('adoext.savePullRequestQuery', async () => {
        const saved = await savePullRequestQuery(config);
        if (saved) { pullRequestProvider.refresh(); }
    });

    // Open pull request in browser
    registry.add(
        'adoext.openPullRequest',
        (node: PullRequestNode) => openPullRequest(node, client, config)
    );

    // Open pull request source branch in browser
    registry.add(
        'adoext.openPullRequestSourceBranch',
        (node: PullRequestNode) => openPullRequestSourceBranch(node, client, config)
    );

    // Open pull request head commit in browser
    registry.add(
        'adoext.openPullRequestCommit',
        (node: PullRequestNode) => openPullRequestCommit(node, client, config)
    );

    // View PR details in webview
    registry.add(
        'adoext.viewPullRequestDetails',
        (node: PullRequestNode) => viewPullRequestDetails(node, context, client, config)
    );

    registry.addGuarded(
        'adoext.viewPullRequestDiff',
        (node: PullRequestNode | { pr: import('./api/adoClient').GitPullRequest; organization?: string; project?: string }) =>
            viewPullRequestDiff(node, client, config, prCommentController, diffCache)
    );

    registry.addRefreshing(
        'adoext.approvePullRequest',
        (node?: PullRequestNode) => approvePullRequest(node, client, config),
        () => pullRequestProvider.refresh()
    );

    registry.addRefreshing(
        'adoext.approvePullRequestWithSuggestions',
        (node?: PullRequestNode) => approvePullRequestWithSuggestions(node, client, config),
        () => pullRequestProvider.refresh()
    );

    registry.addRefreshing(
        'adoext.waitForPullRequestAuthor',
        (node?: PullRequestNode) => waitForPullRequestAuthor(node, client, config),
        () => pullRequestProvider.refresh()
    );

    registry.addRefreshing(
        'adoext.rejectPullRequest',
        (node?: PullRequestNode) => rejectPullRequest(node, client, config),
        () => pullRequestProvider.refresh()
    );

    registry.addRefreshing(
        'adoext.resetPullRequestVote',
        (node?: PullRequestNode) => resetPullRequestVote(node, client, config),
        () => pullRequestProvider.refresh()
    );

    // Checkout PR branch
    registry.add(
        'adoext.checkoutPullRequest',
        (node: PullRequestNode) => checkoutPullRequest(node, client, config, prCommentController)
    );

    // Inline comment controller commands (used by the gutter/title affordances).
    registry.add('adoext.prComment.create', (reply: CommentReply) => prCommentController.createOrReply(reply));
    registry.add('adoext.prComment.reply', (reply: CommentReply) => prCommentController.createOrReply(reply));
    registry.add('adoext.prComment.resolve', (thread: vscode.CommentThread) => prCommentController.setThreadStatus(thread, 2 /* Fixed */));
    registry.add('adoext.prComment.reopen', (thread: vscode.CommentThread) => prCommentController.setThreadStatus(thread, 1 /* Active */));

    // Reply to a comment (from tree context menu)
    registry.add('adoext.replyToComment', async (node: PullRequestCommentNode) => {
        await replyToComment(node, client, config);
        pullRequestProvider.refresh();
    });

    // Resolve thread
    registry.add('adoext.resolveThread', async (node: PullRequestThreadNode) => {
        await resolveThread(node, client, config);
        pullRequestProvider.refresh();
    });

    // Reopen thread
    registry.add('adoext.reopenThread', async (node: PullRequestThreadNode) => {
        await reopenThread(node, client, config);
        pullRequestProvider.refresh();
    });

    registry.add('adoext.toggleResolvedPullRequestThreads', async () => {
        await toggleResolvedPullRequestThreads(config);
        pullRequestProvider.refresh();
        const prMod = loadedPrDetailsPanel();
        if (prMod) { await (await prMod).PrDetailsPanel.refreshAllOpenPanels(); }
    });

    registry.addRefresh('adoext.refreshPipelines', () => {
        pipelineLogContentProvider.clear();
        pipelinesProvider.refresh();
    });

    registry.addGuarded(
        'adoext.viewPipelineRunDetails',
        (node?: PipelineRunNode) => viewPipelineRunDetails(context, node, client, config)
    );

    registry.addGuarded(
        'adoext.openPipelineRun',
        (node?: PipelineRunNode) => openPipelineRunInBrowser(node, client, config)
    );

    registry.addGuarded(
        'adoext.openPipelineRunLogs',
        (node?: PipelineRunNode) => openPipelineRunLogsInBrowser(node, client, config)
    );

    registry.addGuarded('adoext.openPipelineStepLog', async (node?: PipelineStepLogNode) => {
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
    });

    registry.addGuarded('adoext.rerunPipelineRun', async (node?: PipelineRunNode) => {
        const newId = await rerunPipelineRun(node, client, config);
        if (typeof newId === 'number' && newId > 0) {
            await (await loadPipelineRunDetailsPanel()).PipelineRunDetailsPanel.show(context, client, config, newId, {
                organization: node?.organization,
                project: node?.project
            });
        }
        pipelinesProvider.refresh();
    });

    registry.addGuarded('adoext.cancelPipelineRun', async (node?: PipelineRunNode) => {
        await cancelPipelineRun(node, client, config);
        pipelinesProvider.refresh();
    });

    registry.add('adoext.setPipelineRunsFilter', async () => {
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
    });

    registry.add('adoext.setPipelineRunsGroupBy', async () => {
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
    });

    // Add new comment to PR
    registry.add('adoext.addPullRequestComment', async (node: PullRequestNode) => {
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
    });

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
    registry.add('adoext.openWorkItemById', (args: { id: number; org: string; project: string }) => {
        if (!args?.id || !args?.org || !args?.project) { return; }
        const url = `https://dev.azure.com/${encodeURIComponent(args.org)}/${encodeURIComponent(args.project)}/_workitems/edit/${args.id}`;
        void vscode.env.openExternal(vscode.Uri.parse(url));
    });

    // Command: open a work item details panel by numeric ID + org/project args.
    registry.addGuarded('adoext.viewWorkItemDetailsById', async (args: { id: number; org: string; project: string }) => {
        if (!args?.id || !args?.org || !args?.project) { return; }
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
    });

    // Command: open a pull request in the browser by numeric ID + scope args.
    registry.add('adoext.openPullRequestById', (args: { id: number; org: string; project: string; repo: string }) => {
        if (!args?.id || !args?.org || !args?.project || !args?.repo) { return; }
        const url = `https://dev.azure.com/${encodeURIComponent(args.org)}/${encodeURIComponent(args.project)}/_git/${encodeURIComponent(args.repo)}/pullrequest/${args.id}`;
        void vscode.env.openExternal(vscode.Uri.parse(url));
    });

    registry.registerAll(context);

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
                    const planningMod = loadedPlanningPanel();
                    if (planningMod) { void planningMod.then(m => m.PlanningPanel.refreshOpenPanels()); }
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
