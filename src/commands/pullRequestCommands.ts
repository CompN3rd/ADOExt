import * as vscode from 'vscode';
import type {
    PullRequestNode,
    PullRequestCommentNode,
    PullRequestThreadNode
} from '../providers/pullRequestProvider';
import type { AdoClient, PullRequestReviewVote } from '../api/adoClient';
import { PullRequestReviewVotes } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { PrDetailsPanel } from '../views/prDetailsPanel';
import { PrDiffPanel } from '../views/prDiffPanel';

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
 * Show the PR diff webview panel.
 */
export async function viewPullRequestDiff(
    node: PullRequestNode | undefined,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    if (!node) {
        vscode.window.showInformationMessage('Select a pull request first, then run "View Pull Request Diff".');
        return;
    }

    await PrDiffPanel.show(client, config, node.pr, {
        organization: node.organization,
        project: node.project
    });
}

export async function setPullRequestReviewVote(
    node: PullRequestNode | undefined,
    client: AdoClient,
    config: ConfigManager,
    vote: PullRequestReviewVote,
    label: string
): Promise<boolean> {
    if (!node) {
        vscode.window.showInformationMessage('Select a pull request first, then run a review action.');
        return false;
    }

    const pullRequest = node.pr;
    const repositoryId = pullRequest.repository?.id;
    const pullRequestId = pullRequest.pullRequestId;
    const project = node.project ?? config.project;
    const organization = node.organization ?? client.organization ?? config.organization;

    if (!organization || !project || !repositoryId || typeof pullRequestId !== 'number') {
        vscode.window.showWarningMessage(
            'Unable to set review vote because organization, project, repository, or pull request ID is missing.'
        );
        return false;
    }

    try {
        await client.setPullRequestReviewVote(project, repositoryId, pullRequestId, vote, organization);
        vscode.window.showInformationMessage(`Review vote set to ${label}.`);
        return true;
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to set review vote: ${err}`);
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
 * Uses the VS Code Git extension API.
 */
export async function checkoutPullRequest(
    node: PullRequestNode,
    _client: AdoClient,
    _config: ConfigManager
): Promise<void> {
    const pr = node.pr;
    const branchRef = pr.sourceRefName ?? '';
    const branchName = branchRef.replace('refs/heads/', '');

    if (!branchName) {
        vscode.window.showWarningMessage('Could not determine branch name for this PR.');
        return;
    }

    const gitExtension =
        vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (!gitExtension) {
        vscode.window.showWarningMessage(
            'The built-in Git extension is not available.'
        );
        return;
    }

    const git = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();
    const gitApi = git.getAPI(1);
    if (!gitApi) {
        vscode.window.showWarningMessage('Git API is not available.');
        return;
    }

    const repos = gitApi.repositories;
    if (repos.length === 0) {
        vscode.window.showWarningMessage(
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
                vscode.window.showInformationMessage(
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
                    vscode.window.showInformationMessage(
                        `Checked out branch: ${branchName}`
                    );
                } catch (innerErr) {
                    vscode.window.showErrorMessage(
                        `Failed to checkout branch "${branchName}": ${innerErr}`
                    );
                }
            }
        }
    );
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
        vscode.window.showInformationMessage('Reply posted.');
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to post reply: ${err}`);
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
        vscode.window.showInformationMessage('Thread resolved.');
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to resolve thread: ${err}`);
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
        vscode.window.showInformationMessage('Thread reopened.');
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to reopen thread: ${err}`);
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
