import * as vscode from 'vscode';
import type {
    AdoClient,
    Comment as AdoComment,
    GitPullRequest,
    GitPullRequestCommentThread,
    PullRequestDiffModel
} from '../api/adoClient';
import { parsePrDiffUri, PR_DIFF_SCHEME, buildPrDiffUri } from './prContentProvider';
import { showErrorMessage, showWarningMessage } from '../utils/notifications';
import { isResolvedPullRequestThread } from '../utils/prThreadStatus';

interface PrContext {
    organization: string;
    project: string;
    repositoryId: string;
    pullRequestId: number;
    /**
     * Iteration ids used when posting new line comments. Optional because
     * inline comments on a checked-out branch may be created without a diff
     * being open.
     */
    iterationId?: number;
    baseIterationId?: number;
}

interface DiffSession extends PrContext {
    iterationId: number;
    baseIterationId: number;
    diff: PullRequestDiffModel;
}

interface CheckoutSession extends PrContext {
    /** Lower-cased absolute path of the repo root. */
    repoRootFsPath: string;
    /**
     * Lower-cased absolute fs path → repo-relative path (starting with '/').
     */
    filesByFsPath: Map<string, string>;
}

interface ThreadMetadata {
    pr: PrContext;
    /** The repo-relative file path on the right (modified) side. */
    filePath: string;
    /** Existing ADO thread id once it has been created. */
    adoThreadId?: number;
    /** Iteration ids the thread was created against. */
    iterationId?: number;
    baseIterationId?: number;
    /** changeTrackingId for the file, used by ADO to track the line. */
    changeTrackingId?: number;
    /** True for threads originating from a checked-out workspace file. */
    isOnWorkspaceFile: boolean;
}

export interface CommentReply {
    thread: vscode.CommentThread;
    text: string;
}

/**
 * Bridges ADO pull request comment threads to VS Code's native Comments API
 * so that diffs and checked-out branches expose the same inline UX as the
 * built-in GitHub Pull Request extension.
 */
export class PrCommentController implements vscode.Disposable {
    static readonly CONTROLLER_ID = 'adoext.prComments';

    private readonly _controller: vscode.CommentController;
    private readonly _threadMetadata = new WeakMap<vscode.CommentThread, ThreadMetadata>();
    private readonly _diffSessions = new Map<string, DiffSession>();
    private readonly _checkoutSessions = new Map<string, CheckoutSession>();
    private readonly _threadsBySession = new Map<string, vscode.CommentThread[]>();
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(private readonly _client: AdoClient) {
        this._controller = vscode.comments.createCommentController(
            PrCommentController.CONTROLLER_ID,
            'Azure DevOps Pull Request Comments'
        );
        this._controller.options = {
            prompt: 'Add a pull request comment…',
            placeHolder: 'Write a comment'
        };
        this._controller.commentingRangeProvider = {
            provideCommentingRanges: (document) => this.provideCommentingRanges(document)
        };
        this._disposables.push(this._controller);
    }

    dispose(): void {
        for (const d of this._disposables) {
            try { d.dispose(); } catch { /* ignore */ }
        }
        this._disposables.length = 0;
        this._diffSessions.clear();
        this._checkoutSessions.clear();
        this._threadsBySession.clear();
    }

    // ---------------------------------------------------------------------
    // Diff sessions (native diff editor against adoext-pr:// URIs)
    // ---------------------------------------------------------------------

    /**
     * Populate inline threads on top of the URIs that back a native diff
     * editor for a given pull request iteration. Returns the URI pairs the
     * caller can hand to `vscode.diff` for each changed file.
     */
    async loadDiff(
        pr: GitPullRequest,
        diff: PullRequestDiffModel,
        scope: { organization: string; project: string }
    ): Promise<Array<{ filePath: string; baseUri: vscode.Uri; targetUri: vscode.Uri; changeType: string }>> {
        const repositoryId = pr.repository?.id ?? '';
        const pullRequestId = pr.pullRequestId ?? 0;
        if (!repositoryId || !pullRequestId) { return []; }

        const sessionKey = this.diffSessionKey(scope.organization, scope.project, pullRequestId);
        this.disposeSession(sessionKey);
        const session: DiffSession = {
            organization: scope.organization,
            project: scope.project,
            repositoryId,
            pullRequestId,
            iterationId: diff.iterationId,
            baseIterationId: diff.baseIterationId,
            diff
        };
        this._diffSessions.set(sessionKey, session);

        const uriPairs = diff.files.map(file => ({
            filePath: file.path,
            changeType: file.changeType,
            baseUri: buildPrDiffUri({
                organization: scope.organization,
                project: scope.project,
                repositoryId,
                pullRequestId,
                side: 'base',
                path: file.originalPath ?? file.path,
                iterationId: diff.iterationId,
                baseIterationId: diff.baseIterationId
            }),
            targetUri: buildPrDiffUri({
                organization: scope.organization,
                project: scope.project,
                repositoryId,
                pullRequestId,
                side: 'target',
                path: file.path,
                iterationId: diff.iterationId,
                baseIterationId: diff.baseIterationId
            })
        }));

        await this.refreshThreadsForDiffSession(sessionKey);
        return uriPairs;
    }

    /**
     * Re-fetch the ADO comment threads for a tracked diff session and rebuild
     * the inline threads. Safe to call after posting a new comment.
     */
    async refreshThreadsForDiffSession(sessionKey: string): Promise<void> {
        const session = this._diffSessions.get(sessionKey);
        if (!session) { return; }
        const threads = await this.fetchThreads(session);
        this.disposeThreadsForSession(sessionKey);
        const created: vscode.CommentThread[] = [];
        for (const adoThread of threads) {
            const targetUri = this.targetUriForThread(session, adoThread);
            if (!targetUri) { continue; }
            const range = this.rangeForThread(adoThread, 'right');
            if (!range) { continue; }
            const filePath = adoThread.threadContext?.filePath ?? '';
            const created$ = this.createThreadFromAdo(adoThread, targetUri, range, {
                organization: session.organization,
                project: session.project,
                repositoryId: session.repositoryId,
                pullRequestId: session.pullRequestId,
                iterationId: session.iterationId,
                baseIterationId: session.baseIterationId
            }, filePath, /* isOnWorkspaceFile */ false);
            created.push(created$);
        }
        this._threadsBySession.set(sessionKey, created);
    }

    // ---------------------------------------------------------------------
    // Checkout sessions (inline comments on workspace files)
    // ---------------------------------------------------------------------

    /**
     * Attach inline comments to the given repository's working tree files for
     * a pull request that has been checked out locally. The mapping is kept
     * until `clearCheckout` is called or another PR is attached for the same
     * repository.
     */
    async attachCheckout(
        pr: GitPullRequest,
        repoRoot: vscode.Uri,
        scope: { organization: string; project: string }
    ): Promise<number> {
        const repositoryId = pr.repository?.id ?? '';
        const pullRequestId = pr.pullRequestId ?? 0;
        if (!repositoryId || !pullRequestId) { return 0; }

        const adoThreads = await this._client.getPullRequestThreads(
            scope.project,
            repositoryId,
            pullRequestId,
            scope.organization
        );

        // Resolve the latest iteration id once so brand-new line comments
        // posted from the checked-out workspace files are anchored to the
        // current diff (rather than defaulting to iteration 1).
        let iterationId: number | undefined;
        try {
            iterationId = await this._client.getPullRequestLatestIterationId(
                scope.project,
                repositoryId,
                pullRequestId,
                scope.organization
            );
        } catch {
            iterationId = undefined;
        }

        const filesByFsPath = new Map<string, string>();
        for (const adoThread of adoThreads) {
            const filePath = adoThread.threadContext?.filePath;
            if (!filePath) { continue; }
            const fileUri = vscode.Uri.joinPath(repoRoot, ...filePath.split('/').filter(Boolean));
            filesByFsPath.set(fileUri.fsPath.toLowerCase(), filePath);
        }

        const sessionKey = this.checkoutSessionKey(repoRoot);
        this.disposeSession(sessionKey);

        const session: CheckoutSession = {
            organization: scope.organization,
            project: scope.project,
            repositoryId,
            pullRequestId,
            iterationId,
            baseIterationId: iterationId !== undefined ? 0 : undefined,
            repoRootFsPath: repoRoot.fsPath.toLowerCase(),
            filesByFsPath
        };
        this._checkoutSessions.set(sessionKey, session);

        const created: vscode.CommentThread[] = [];
        for (const adoThread of adoThreads) {
            const filePath = adoThread.threadContext?.filePath;
            if (!filePath) { continue; }
            const fileUri = vscode.Uri.joinPath(repoRoot, ...filePath.split('/').filter(Boolean));
            const range = this.rangeForThread(adoThread, 'right');
            if (!range) { continue; }
            const created$ = this.createThreadFromAdo(adoThread, fileUri, range, {
                organization: session.organization,
                project: session.project,
                repositoryId: session.repositoryId,
                pullRequestId: session.pullRequestId,
                iterationId: session.iterationId,
                baseIterationId: session.baseIterationId
            }, filePath, /* isOnWorkspaceFile */ true);
            created.push(created$);
        }
        this._threadsBySession.set(sessionKey, created);
        return created.length;
    }

    clearCheckout(repoRoot: vscode.Uri): void {
        this.disposeSession(this.checkoutSessionKey(repoRoot));
    }

    // ---------------------------------------------------------------------
    // Command handlers
    // ---------------------------------------------------------------------

    async createOrReply(reply: CommentReply): Promise<void> {
        const text = (reply.text ?? '').trim();
        if (!text) { return; }
        let meta = this._threadMetadata.get(reply.thread);
        if (!meta) {
            // Brand-new thread created from the gutter — derive metadata
            // from the thread's URI before posting.
            meta = this.deriveMetadataFromUri(reply.thread.uri);
            if (!meta) {
                showWarningMessage('Cannot post comment because the thread is not associated with a pull request.');
                return;
            }
            this._threadMetadata.set(reply.thread, meta);
        }

        try {
            if (meta.adoThreadId !== undefined) {
                // Reply to an existing thread.
                const adoComment = await this._client.replyToThread(
                    meta.pr.project,
                    meta.pr.repositoryId,
                    meta.pr.pullRequestId,
                    meta.adoThreadId,
                    text,
                    meta.pr.organization
                );
                reply.thread.comments = [
                    ...reply.thread.comments,
                    this.toVsComment(adoComment, reply.thread)
                ];
            } else {
                // Create a brand new thread.
                if (!reply.thread.range) {
                    showWarningMessage('Cannot create comment: thread has no source range.');
                    return;
                }
                const line = reply.thread.range.start.line + 1;
                const iterationId = meta.iterationId ?? meta.pr.iterationId ?? 1;
                const baseIterationId = meta.baseIterationId ?? meta.pr.baseIterationId ?? 1;
                const newThread = await this._client.addPullRequestLineComment(
                    meta.pr.project,
                    meta.pr.repositoryId,
                    meta.pr.pullRequestId,
                    meta.filePath,
                    line,
                    text,
                    iterationId,
                    baseIterationId,
                    meta.changeTrackingId,
                    meta.pr.organization
                );
                meta.adoThreadId = newThread.id;
                reply.thread.comments = (newThread.comments ?? []).map(c => this.toVsComment(c, reply.thread));
                this.applyState(reply.thread, newThread.status);
                reply.thread.canReply = true;
                reply.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
            }
            // VS Code clears the reply input automatically once the command resolves.
            void vscode.commands.executeCommand('adoext.refreshPullRequests');
        } catch (err) {
            showErrorMessage(`Failed to post comment: ${this.formatError(err)}`);
        }
    }

    async setThreadStatus(thread: vscode.CommentThread, status: 1 | 2): Promise<void> {
        const meta = this._threadMetadata.get(thread);
        if (!meta || meta.adoThreadId === undefined) {
            return;
        }
        try {
            const updated = await this._client.updateThreadStatus(
                meta.pr.project,
                meta.pr.repositoryId,
                meta.pr.pullRequestId,
                meta.adoThreadId,
                status,
                meta.pr.organization
            );
            this.applyState(thread, updated.status ?? status);
            void vscode.commands.executeCommand('adoext.refreshPullRequests');
        } catch (err) {
            showErrorMessage(`Failed to update thread: ${this.formatError(err)}`);
        }
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    private provideCommentingRanges(document: vscode.TextDocument): vscode.Range[] | undefined {
        if (document.lineCount === 0) { return undefined; }
        const fullRange = new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0);

        if (document.uri.scheme === PR_DIFF_SCHEME) {
            const parts = parsePrDiffUri(document.uri);
            // Comments may only be added on the right-hand (target) side of
            // an Azure DevOps PR diff. Suppress commenting ranges on the
            // base side so the gutter affordance doesn't appear.
            if (!parts || parts.side !== 'target') { return undefined; }
            return [fullRange];
        }

        // Workspace file – only allow commenting if a checked-out PR has
        // claimed this file path.
        const session = this.findCheckoutSessionForUri(document.uri);
        if (!session) { return undefined; }
        return [fullRange];
    }

    private findCheckoutSessionForUri(uri: vscode.Uri): CheckoutSession | undefined {
        if (uri.scheme !== 'file') { return undefined; }
        const fsPathLower = uri.fsPath.toLowerCase();
        for (const session of this._checkoutSessions.values()) {
            if (session.filesByFsPath.has(fsPathLower)) {
                return session;
            }
            // Allow new threads on any workspace file beneath the repo root,
            // not just files that already have ADO threads on them.
            if (
                fsPathLower === session.repoRootFsPath ||
                fsPathLower.startsWith(session.repoRootFsPath + '/') ||
                fsPathLower.startsWith(session.repoRootFsPath + '\\')
            ) {
                return session;
            }
        }
        return undefined;
    }

    /**
     * Build {@link ThreadMetadata} for a brand-new comment thread whose URI
     * either points at a PR diff document or at a workspace file owned by a
     * checked-out PR.
     */
    private deriveMetadataFromUri(uri: vscode.Uri): ThreadMetadata | undefined {
        if (uri.scheme === PR_DIFF_SCHEME) {
            const parts = parsePrDiffUri(uri);
            if (!parts || parts.side !== 'target') { return undefined; }
            const sessionKey = this.diffSessionKey(parts.organization, parts.project, parts.pullRequestId);
            const session = this._diffSessions.get(sessionKey);
            const file = session?.diff.files.find(f => f.path === parts.path || f.originalPath === parts.path);
            return {
                pr: {
                    organization: parts.organization,
                    project: parts.project,
                    repositoryId: parts.repositoryId,
                    pullRequestId: parts.pullRequestId,
                    iterationId: parts.iterationId,
                    baseIterationId: parts.baseIterationId
                },
                filePath: parts.path,
                iterationId: parts.iterationId,
                baseIterationId: parts.baseIterationId,
                changeTrackingId: file?.changeTrackingId,
                isOnWorkspaceFile: false
            };
        }

        const session = this.findCheckoutSessionForUri(uri);
        if (!session) { return undefined; }
        const fsPathLower = uri.fsPath.toLowerCase();
        let filePath = session.filesByFsPath.get(fsPathLower);
        if (!filePath) {
            // Convert absolute workspace path → repo-relative '/' path
            const relative = uri.fsPath.slice(session.repoRootFsPath.length).replace(/\\/g, '/');
            filePath = relative.startsWith('/') ? relative : '/' + relative;
        }
        return {
            pr: {
                organization: session.organization,
                project: session.project,
                repositoryId: session.repositoryId,
                pullRequestId: session.pullRequestId,
                iterationId: session.iterationId,
                baseIterationId: session.baseIterationId
            },
            filePath,
            iterationId: session.iterationId,
            baseIterationId: session.baseIterationId,
            isOnWorkspaceFile: true
        };
    }

    private async fetchThreads(session: PrContext): Promise<GitPullRequestCommentThread[]> {
        try {
            return await this._client.getPullRequestThreads(
                session.project,
                session.repositoryId,
                session.pullRequestId,
                session.organization
            );
        } catch (err) {
            showWarningMessage(`Failed to load PR comments: ${this.formatError(err)}`);
            return [];
        }
    }

    private targetUriForThread(session: DiffSession, adoThread: GitPullRequestCommentThread): vscode.Uri | undefined {
        const filePath = adoThread.threadContext?.filePath;
        if (!filePath) { return undefined; }
        const file = session.diff.files.find(f => f.path === filePath || f.originalPath === filePath);
        if (!file) { return undefined; }
        return buildPrDiffUri({
            organization: session.organization,
            project: session.project,
            repositoryId: session.repositoryId,
            pullRequestId: session.pullRequestId,
            side: 'target',
            path: file.path,
            iterationId: session.iterationId,
            baseIterationId: session.baseIterationId
        });
    }

    private rangeForThread(adoThread: GitPullRequestCommentThread, preferredSide: 'right' | 'left'): vscode.Range | undefined {
        const ctx = adoThread.threadContext;
        if (!ctx) { return undefined; }
        const start = (preferredSide === 'right' ? ctx.rightFileStart : ctx.leftFileStart)
            ?? ctx.rightFileStart ?? ctx.leftFileStart;
        const end = (preferredSide === 'right' ? ctx.rightFileEnd : ctx.leftFileEnd)
            ?? ctx.rightFileEnd ?? ctx.leftFileEnd ?? start;
        if (!start) { return undefined; }
        const startLine = Math.max(0, (start.line ?? 1) - 1);
        const endLine = Math.max(startLine, ((end?.line ?? start.line ?? 1) - 1));
        return new vscode.Range(startLine, 0, endLine, 0);
    }

    private createThreadFromAdo(
        adoThread: GitPullRequestCommentThread,
        uri: vscode.Uri,
        range: vscode.Range,
        pr: PrContext,
        filePath: string,
        isOnWorkspaceFile: boolean
    ): vscode.CommentThread {
        const thread = this._controller.createCommentThread(uri, range, []);
        thread.canReply = true;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
        const metadata: ThreadMetadata = {
            pr,
            filePath,
            adoThreadId: adoThread.id,
            iterationId: pr.iterationId,
            baseIterationId: pr.baseIterationId,
            isOnWorkspaceFile
        };
        this._threadMetadata.set(thread, metadata);
        thread.comments = (adoThread.comments ?? [])
            .filter(c => !c.isDeleted)
            .map(c => this.toVsComment(c, thread));
        this.applyState(thread, adoThread.status);
        return thread;
    }

    private toVsComment(adoComment: AdoComment, _thread: vscode.CommentThread): vscode.Comment {
        const author = adoComment.author?.displayName ?? 'Unknown';
        return {
            body: new vscode.MarkdownString(adoComment.content ?? ''),
            mode: vscode.CommentMode.Preview,
            author: { name: author },
            timestamp: adoComment.publishedDate ? new Date(adoComment.publishedDate) : undefined,
            contextValue: 'adoextPrComment'
        };
    }

    private applyState(thread: vscode.CommentThread, status: number | undefined): void {
        const isResolved = isResolvedPullRequestThread(status);
        thread.state = isResolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
        thread.contextValue = isResolved ? 'prThreadResolved' : 'prThreadActive';
        thread.label = isResolved ? 'Resolved' : 'Active';
    }

    private disposeSession(sessionKey: string): void {
        this.disposeThreadsForSession(sessionKey);
        this._diffSessions.delete(sessionKey);
        this._checkoutSessions.delete(sessionKey);
    }

    private disposeThreadsForSession(sessionKey: string): void {
        const threads = this._threadsBySession.get(sessionKey);
        if (!threads) { return; }
        for (const thread of threads) {
            try { thread.dispose(); } catch { /* ignore */ }
        }
        this._threadsBySession.delete(sessionKey);
    }

    private diffSessionKey(org: string, project: string, prId: number): string {
        return `diff\u0000${org}\u0000${project}\u0000${prId}`;
    }

    private checkoutSessionKey(repoRoot: vscode.Uri): string {
        return `checkout\u0000${repoRoot.fsPath.toLowerCase()}`;
    }

    private formatError(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }
}
