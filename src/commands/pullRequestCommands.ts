import * as vscode from 'vscode';
import type {
    PullRequestNode,
    PullRequestCommentNode,
    PullRequestThreadNode
} from '../providers/pullRequestProvider';
import type { AdoClient, GitPullRequest, PullRequestReviewVote } from '../api/adoClient';
import { PullRequestReviewVotes } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { PrDetailsPanel } from '../views/prDetailsPanel';
import type { PrCommentController } from '../views/prCommentController';
import type { PrDiffCache } from '../views/prContentProvider';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';

export interface PrScope {
    pr: GitPullRequest;
    organization?: string;
    project?: string;
}

function asPrScope(arg: PullRequestNode | PrScope): PrScope {
    return { pr: arg.pr, organization: arg.organization, project: arg.project };
}

/**
 * Open a pull request in the browser.
 */
export function openPullRequest(
    node: PullRequestNode,
    client: AdoClient,
    config: ConfigManager
): void {
    const pr = node.pr;
    const org = node.organization ?? client.organization ?? config.organization;
    const project = node.project ?? config.project;
    const repoId = pr.repository?.name ?? pr.repository?.id ?? '';
    const prId = pr.pullRequestId ?? 0;
    const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repoId)}/pullrequest/${prId}`;
    void vscode.env.openExternal(vscode.Uri.parse(url));
}

/**
 * Show the PR details webview panel.
 */
export async function viewPullRequestDetails(
    node: PullRequestNode,
    context: vscode.ExtensionContext,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    await PrDetailsPanel.show(context, client, config, node.pr, {
        organization: node.organization,
        project: node.project
    });
}

/**
 * Open the pull request diff using VS Code's native diff editor for each
 * changed file. Hooks the inline `CommentController` so that ADO comment
 * threads appear in the gutter (and new ones can be authored with the same
 * UX as the built-in GitHub Pull Request extension).
 */
export async function viewPullRequestDiff(
    nodeOrScope: PullRequestNode | PrScope | undefined,
    client: AdoClient,
    config: ConfigManager,
    commentController: PrCommentController,
    diffCache: PrDiffCache
): Promise<void> {
    if (!nodeOrScope) {
        showInformationMessage('Select a pull request first, then run "View Pull Request Diff".');
        return;
    }
    const scope = asPrScope(nodeOrScope);
    const pr = scope.pr;
    const repoId = pr.repository?.id ?? '';
    const prId = pr.pullRequestId ?? 0;
    const project = scope.project ?? config.project;
    const organization = scope.organization ?? client.organization ?? config.organization;

    if (!repoId || !project || !organization || !prId) {
        showWarningMessage(
            'Unable to load diff because organization, project, repository, or pull request ID is missing.'
        );
        return;
    }

    const diff = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Loading PR #${prId} diff…` },
        () => client.getPullRequestDiff(project, repoId, pr, organization)
    ).then(model => model, err => {
        showErrorMessage(`Failed to load pull request diff: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
    });
    if (!diff) { return; }

    diffCache.set(organization, project, prId, diff);
    const fileEntries = await commentController.loadDiff(pr, diff, { organization, project });

    if (fileEntries.length === 0) {
        showInformationMessage(`Pull request #${prId} has no changed files to display.`);
        return;
    }

    // Open all changed files at once in VS Code's multi-diff editor — same
    // UX as the GitHub Pull Request extension's "Files Changed" view. Each
    // entry is a `[resourceUri, originalUri, modifiedUri]` tuple; the
    // resource URI is what shows up in the file list and what the
    // `CommentController` keys on, so we use the right-side (target) URI to
    // line up with the inline comments registered by `loadDiff`.
    const resources: Array<[vscode.Uri, vscode.Uri, vscode.Uri]> = fileEntries.map(
        entry => [entry.targetUri, entry.baseUri, entry.targetUri]
    );
    const title = `Pull Request #${prId}: ${pr.title ?? ''}`.trim();

    try {
        await vscode.commands.executeCommand('vscode.changes', title, resources);
    } catch (err) {
        // Older VS Code builds may not have `vscode.changes`; fall back to
        // opening the files sequentially as side-by-side diffs so the user
        // still gets something usable.
        showWarningMessage(
            `Multi-diff editor unavailable (${err instanceof Error ? err.message : String(err)}); opening diffs individually.`
        );
        for (const entry of fileEntries) {
            await vscode.commands.executeCommand(
                'vscode.diff',
                entry.baseUri,
                entry.targetUri,
                `PR #${prId}: ${entry.filePath}`,
                { preview: false }
            );
        }
    }
}

export async function setPullRequestReviewVote(
    node: PullRequestNode | undefined,
    client: AdoClient,
    config: ConfigManager,
    vote: PullRequestReviewVote,
    label: string
): Promise<boolean> {
    if (!node) {
        showInformationMessage('Select a pull request first, then run a review action.');
        return false;
    }

    const pullRequest = node.pr;
    const repositoryId = pullRequest.repository?.id;
    const pullRequestId = pullRequest.pullRequestId;
    const project = node.project ?? config.project;
    const organization = node.organization ?? client.organization ?? config.organization;

    if (!organization || !project || !repositoryId || typeof pullRequestId !== 'number') {
        showWarningMessage(
            'Unable to set review vote because organization, project, repository, or pull request ID is missing.'
        );
        return false;
    }

    try {
        await client.setPullRequestReviewVote(project, repositoryId, pullRequestId, vote, organization);
        showInformationMessage(`Review vote set to ${label}.`);
        return true;
    } catch (err) {
        showErrorMessage(`Failed to set review vote: ${err}`);
        return false;
    }
}

export function approvePullRequest(
    node: PullRequestNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    return setPullRequestReviewVote(node, client, config, PullRequestReviewVotes.approved, 'Approved');
}

export function approvePullRequestWithSuggestions(
    node: PullRequestNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    return setPullRequestReviewVote(
        node,
        client,
        config,
        PullRequestReviewVotes.approvedWithSuggestions,
        'Approved with suggestions'
    );
}

export function waitForPullRequestAuthor(
    node: PullRequestNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    return setPullRequestReviewVote(
        node,
        client,
        config,
        PullRequestReviewVotes.waitingForAuthor,
        'Waiting for author'
    );
}

export function rejectPullRequest(
    node: PullRequestNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    return setPullRequestReviewVote(node, client, config, PullRequestReviewVotes.rejected, 'Rejected');
}

export function resetPullRequestVote(
    node: PullRequestNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    return setPullRequestReviewVote(node, client, config, PullRequestReviewVotes.noVote, 'No vote');
}

/**
 * Checkout the source branch of a pull request in the current workspace.
 * Uses the VS Code Git extension API. After a successful checkout, attaches
 * the PR's existing comment threads inline on the affected workspace files
 * via the supplied {@link PrCommentController}.
 */
export async function checkoutPullRequest(
    node: PullRequestNode,
    client: AdoClient,
    config: ConfigManager,
    commentController: PrCommentController
): Promise<void> {
    const pr = node.pr;
    const branchRef = pr.sourceRefName ?? '';
    const branchName = branchRef.replace('refs/heads/', '');

    if (!branchName) {
        showWarningMessage('Could not determine branch name for this PR.');
        return;
    }

    const gitExtension =
        vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (!gitExtension) {
        showWarningMessage(
            'The built-in Git extension is not available.'
        );
        return;
    }

    const git = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();
    const gitApi = git.getAPI(1);
    if (!gitApi) {
        showWarningMessage('Git API is not available.');
        return;
    }

    const repos = gitApi.repositories;
    if (repos.length === 0) {
        showWarningMessage(
            'No Git repositories found in the current workspace.'
        );
        return;
    }

    // If there are multiple repos, ask the user to pick one
    let repo = repos[0];
    if (repos.length > 1) {
        const repoName = pr.repository?.name ?? '';
        const matchingRepo = repos.find(r =>
            r.rootUri.fsPath.toLowerCase().includes(repoName.toLowerCase())
        );
        if (matchingRepo) {
            repo = matchingRepo;
        } else {
            const picked = await vscode.window.showQuickPick(
                repos.map(r => ({
                    label: r.rootUri.fsPath,
                    repo: r
                })),
                { placeHolder: 'Select the repository to checkout the branch in' }
            );
            if (!picked) { return; }
            repo = picked.repo;
        }
    }

    // Fetch the remote first so the branch ref is available
    let checkoutSucceeded = false;
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Fetching and checking out ${branchName}…`
        },
        async () => {
            try {
                // Fetch to make sure we have the latest remote refs
                await repo.fetch({ prune: false });

                // Try checking out a local branch that tracks the remote
                const remotes = repo.state.remotes;
                const remoteName =
                    remotes.find(r => r.name === 'origin')?.name ??
                    remotes[0]?.name ?? 'origin';

                // Use the VS Code Git API checkout command
                await repo.checkout(branchName);
                checkoutSucceeded = true;
                showInformationMessage(
                    `Checked out branch: ${branchName} (from ${remoteName})`
                );
            } catch (err) {
                // If local checkout fails, try with remote tracking branch
                try {
                    const remotes = repo.state.remotes;
                    const remoteName =
                        remotes.find(r => r.name === 'origin')?.name ??
                        remotes[0]?.name ?? 'origin';
                    await repo.checkout(`${remoteName}/${branchName}`);
                    checkoutSucceeded = true;
                    showInformationMessage(
                        `Checked out branch: ${branchName}`
                    );
                } catch (innerErr) {
                    showErrorMessage(
                        `Failed to checkout branch "${branchName}": ${innerErr}`
                    );
                }
            }
        }
    );

    if (!checkoutSucceeded) { return; }

    // Attach the PR's existing comment threads inline on the workspace files
    // so reviewers can read and reply to them while editing the checked-out
    // branch.
    const project = node.project ?? config.project;
    const organization = node.organization ?? client.organization ?? config.organization;
    if (project && organization) {
        try {
            const count = await commentController.attachCheckout(pr, repo.rootUri, { organization, project });
            if (count > 0) {
                showInformationMessage(
                    `Loaded ${count} pull request comment thread${count === 1 ? '' : 's'} inline. New comments can be added from the gutter.`
                );
            }
        } catch (err) {
            showWarningMessage(
                `Branch checked out, but inline comments could not be loaded: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }
}

/**
 * Reply to a PR comment thread directly from the tree view.
 */
export async function replyToComment(
    node: PullRequestCommentNode,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    const content = await vscode.window.showInputBox({
        prompt: 'Enter your reply',
        placeHolder: 'Write a reply…'
    });
    if (!content) { return; }

    const pr = node.pr;
    const repoId = pr.repository?.id ?? '';
    const prId = pr.pullRequestId ?? 0;
    const threadId = node.thread.id ?? 0;
    const project = node.project ?? config.project;
    const organization = node.organization ?? client.organization ?? config.organization;

    try {
        await client.replyToThread(
            project,
            repoId,
            prId,
            threadId,
            content,
            organization
        );
        showInformationMessage('Reply posted.');
    } catch (err) {
        showErrorMessage(`Failed to post reply: ${err}`);
    }
}

/**
 * Resolve a PR comment thread.
 */
export async function resolveThread(
    node: PullRequestThreadNode,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    const pr = node.pr;
    const repoId = pr.repository?.id ?? '';
    const prId = pr.pullRequestId ?? 0;
    const threadId = node.thread.id ?? 0;
    const project = node.project ?? config.project;
    const organization = node.organization ?? client.organization ?? config.organization;

    try {
        await client.updateThreadStatus(project, repoId, prId, threadId, 2 /* Fixed */, organization);
        showInformationMessage('Thread resolved.');
    } catch (err) {
        showErrorMessage(`Failed to resolve thread: ${err}`);
    }
}

/**
 * Reopen a resolved PR comment thread.
 */
export async function reopenThread(
    node: PullRequestThreadNode,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    const pr = node.pr;
    const repoId = pr.repository?.id ?? '';
    const prId = pr.pullRequestId ?? 0;
    const threadId = node.thread.id ?? 0;
    const project = node.project ?? config.project;
    const organization = node.organization ?? client.organization ?? config.organization;

    try {
        await client.updateThreadStatus(project, repoId, prId, threadId, 1 /* Active */, organization);
        showInformationMessage('Thread reopened.');
    } catch (err) {
        showErrorMessage(`Failed to reopen thread: ${err}`);
    }
}

// ---------------------------------------------------------------------------
// Minimal VS Code Git extension API types for TypeScript
// These mirror the public API shape without importing the full extension.
// ---------------------------------------------------------------------------

interface GitExtension {
    getAPI(version: 1): GitAPI;
}

interface GitAPI {
    repositories: Repository[];
}

interface Repository {
    rootUri: vscode.Uri;
    state: RepositoryState;
    checkout(treeish: string): Promise<void>;
    fetch(options?: { prune?: boolean }): Promise<void>;
}

interface RepositoryState {
    remotes: Remote[];
}

interface Remote {
    name: string;
    fetchUrl?: string;
    pushUrl?: string;
}
