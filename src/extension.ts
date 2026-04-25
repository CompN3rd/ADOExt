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
import {
    selectOrganization,
    selectProject
} from './commands/accountCommands';
import { openWorkItem, viewWorkItemDetails } from './commands/workItemCommands';
import {
    openPullRequest,
    viewPullRequestDetails,
    checkoutPullRequest,
    replyToComment,
    resolveThread,
    reopenThread
} from './commands/pullRequestCommands';

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
    }

    function updateSignedInContext(): void {
        void vscode.commands.executeCommand(
            'setContext',
            'adoext.isSignedIn',
            auth.isSignedIn
        );
    }

    // -------------------------------------------------------------------------
    // Tree providers
    // -------------------------------------------------------------------------
    const workItemProvider = new WorkItemProvider(client, config);
    const pullRequestProvider = new PullRequestProvider(client, config);

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('adoext.workItems', workItemProvider),
        vscode.window.registerTreeDataProvider('adoext.pullRequests', pullRequestProvider)
    );

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
                workItemProvider.refresh();
                pullRequestProvider.refresh();
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
            workItemProvider.refresh();
            pullRequestProvider.refresh();
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
                workItemProvider.refresh();
                pullRequestProvider.refresh();
            }
        })
    );

    // Select project
    context.subscriptions.push(
        vscode.commands.registerCommand('adoext.selectProject', async () => {
            if (!(await ensureSignedIn())) { return; }
            const ok = await selectProject(client, config);
            if (ok) {
                workItemProvider.refresh();
                pullRequestProvider.refresh();
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

    // View work item details in webview
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.viewWorkItemDetails',
            (node: WorkItemNode) => viewWorkItemDetails(node, context, client, config)
        )
    );

    // Open work item in browser (secondary action)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.openWorkItem',
            (node: WorkItemNode) => openWorkItem(node, client, config)
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

    // Checkout PR branch
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'adoext.checkoutPullRequest',
            (node: PullRequestNode) => checkoutPullRequest(node, client, config)
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

                try {
                    await client.addPullRequestComment(
                        config.project,
                        repoId,
                        prId,
                        content
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
    // Auto-restore session on activation
    // -------------------------------------------------------------------------
    const restored = await auth.tryRestoreSession();
    if (restored) {
        rebuildClient();
        if (config.isConfigured) {
            workItemProvider.refresh();
            pullRequestProvider.refresh();
        }
    }
    updateSignedInContext();

    // React to configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('adoext')) {
                if (config.organization && auth.isSignedIn) {
                    client.connect(config.organization);
                }
                workItemProvider.refresh();
                pullRequestProvider.refresh();
            }
        })
    );
}

export function deactivate(): void {
    // Nothing to clean up; VS Code disposes subscriptions automatically.
}
