import { LitElement, css, html, nothing, type PropertyDeclarations } from 'lit';
import type { PrDetailsMessage, PrDetailsViewModel, PrThreadViewModel } from '../webviewTypes';
import { postMessage, readInitialData } from './vscodeApi';
import './builds';

class AdoPrDetailsApp extends LitElement {
    static properties: PropertyDeclarations = {
        data: { state: true }
    };

    static styles = css`
        :host { display: block; }
        * { box-sizing: border-box; }
        .shell { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; min-height: 100vh; }
        h1 { font-size: 1.3em; margin: 0 0 4px; line-height: 1.35; }
        .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 12px; }
        .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; margin-left: 6px; }
        .draft { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .section { margin-bottom: 20px; }
        .section h2 { font-size: 1em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; margin-bottom: 8px; }
        .toolbar, .review-actions { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
        button { padding: 4px 10px; border-radius: 3px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; font-family: inherit; font-size: 0.85em; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .reviewers, .checks-list { list-style: none; padding: 0; margin: 0; }
        .reviewers li { margin: 4px 0; display: flex; gap: 8px; align-items: center; }
        .vote { min-width: 112px; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; text-align: center; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
        .vote-positive { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
        .vote-waiting { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
        .vote-negative { color: var(--vscode-charts-red); border-color: var(--vscode-charts-red); }
        .checks-list li { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); }
        .checks-list li:last-child { border-bottom: none; }
        .check-state { font-size: 0.8em; min-width: 80px; padding: 2px 6px; border-radius: 3px; text-align: center; border: 1px solid; }
        .check-success { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
        .check-failure { color: var(--vscode-charts-red); border-color: var(--vscode-charts-red); }
        .check-pending { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
        .check-neutral { color: var(--vscode-descriptionForeground); border-color: var(--vscode-panel-border); }
        .check-name { flex: 1; min-width: 120px; }
        .check-desc { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
        .thread { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 10px; }
        .thread-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: var(--vscode-sideBarSectionHeader-background); border-radius: 4px 4px 0 0; }
        .thread-status { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
        .thread-meta { display: flex; align-items: center; gap: 8px; }
        .resolved .thread-header { opacity: 0.7; }
        .tool-thread { border-style: dashed; opacity: 0.9; }
        .comment { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
        .comment.tool { border-left: 3px solid var(--vscode-descriptionForeground); }
        .comment:last-child { border-bottom: none; }
        .comment-author { font-weight: bold; font-size: 0.85em; margin-bottom: 2px; display: flex; align-items: center; gap: 6px; }
        .bot-badge { display: inline-flex; align-items: center; border: 1px solid var(--vscode-panel-border); border-radius: 999px; padding: 0 6px; font-size: 0.75em; font-weight: normal; color: var(--vscode-descriptionForeground); }
        .comment-content, .description { white-space: pre-wrap; word-break: break-word; }
        .description { font-family: var(--vscode-editor-font-family); }
        .reply-form, .new-comment-form { padding: 8px 10px; display: flex; gap: 6px; }
        .reply-disclosure { padding: 8px 10px; }
        .reply-disclosure > summary { cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
        .reply-disclosure > .reply-form { padding: 8px 0 0; }
        .new-comment-form { padding: 0; flex-direction: column; }
        textarea { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 4px 6px; font-family: inherit; font-size: inherit; resize: vertical; min-height: 32px; }
        .tool-thread textarea { min-height: 28px; font-size: 0.9em; }
        .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
        @media (max-width: 620px) { .reply-form { flex-direction: column; } .checks-list li { align-items: flex-start; flex-direction: column; } }
    `;

    data: PrDetailsViewModel = readInitialData<PrDetailsViewModel>();

    render() {
        return html`<main class="shell">
            <div class="toolbar">
                <button class="btn-primary" @click=${() => this.send({ type: 'openDiff' })}>View Diff</button>
                <div class="review-actions" role="group" aria-label="Review actions">
                    ${this.data.reviewActions.map(action => html`<button class="btn-secondary" @click=${() => this.send({ type: 'setVote', vote: action.vote })}>${action.label}</button>`)}
                </div>
                <button class="btn-secondary" @click=${() => this.send({ type: 'openInBrowser' })}>Open in Browser</button>
            </div>
            <h1>PR #${this.data.prId}: ${this.data.title}${this.data.isDraft ? html`<span class="badge draft">Draft</span>` : nothing}</h1>
            <div class="meta"><strong>${this.data.author}</strong> opened on ${this.data.createdDate} · <code>${this.data.sourceBranch}</code> -> <code>${this.data.targetBranch}</code></div>
            <section class="section"><h2>Description</h2><pre class="description">${this.data.description}</pre></section>
            ${this.data.reviewers.length > 0 ? html`<section class="section"><h2>Reviewers</h2><ul class="reviewers">${this.data.reviewers.map(reviewer => html`<li><span class="vote ${reviewer.voteClass}">${reviewer.voteLabel}</span>${reviewer.displayName}</li>`)}</ul></section>` : nothing}
            ${this.renderRows('Branch Status', this.data.branchStatuses)}
            ${this.renderRows('Build & Policy Status', this.data.checks)}
            <section class="section"><h2>Builds</h2><ado-build-list .builds=${this.data.builds} empty-label="No builds found." @adoext-open-build=${this.onOpenBuild}></ado-build-list></section>
            <section class="section"><h2>Comment Threads</h2>${this.renderThreads()}</section>
            <section class="section"><h2>Add Comment</h2><div class="new-comment-form"><textarea id="new-comment" rows="3" placeholder="Write a comment..."></textarea><div><button class="btn-primary" @click=${this.addComment}>Add Comment</button></div></div></section>
        </main>`;
    }

    private renderRows(title: string, rows: PrDetailsViewModel['checks']) {
        if (rows.length === 0) { return nothing; }
        return html`<section class="section"><h2>${title}</h2><ul class="checks-list">${rows.map(row => html`<li><span class="check-state ${row.badge.className}">${row.badge.label}</span><span class="check-name">${row.name}</span>${row.description ? html`<span class="check-desc">${row.description}</span>` : nothing}</li>`)}</ul></section>`;
    }

    private renderThreads() {
        const resolvedCount = this.data.threads.filter(thread => thread.isResolved).length;
        const visibleThreads = this.data.showResolvedThreads
            ? this.data.threads
            : this.data.threads.filter(thread => !thread.isResolved);

        return html`
            <div class="toolbar">
                <button class="btn-secondary" @click=${this.toggleResolvedThreads}>
                    ${this.data.showResolvedThreads ? 'Hide resolved threads' : `Show resolved threads (${resolvedCount})`}
                </button>
            </div>
            ${visibleThreads.length === 0
            ? html`<p class="empty">No comment threads.</p>`
            : html`${visibleThreads.map(thread => this.renderThread(thread))}`}
        `;
    }

    private renderThread(thread: PrThreadViewModel) {
        return html`<article class="thread ${thread.isResolved ? 'resolved' : ''} ${thread.isToolThread ? 'tool-thread' : ''}">
            <div class="thread-header">
                <div class="thread-meta">
                    <span class="thread-status">${thread.statusLabel}</span>
                    ${thread.isToolThread ? html`<span class="bot-badge">Bot</span>` : nothing}
                </div>
                <button class="btn-secondary" @click=${() => this.setThreadStatus(thread)}>${thread.isResolved ? 'Reopen' : 'Resolve'}</button>
            </div>
            ${thread.comments.map(comment => html`<div class="comment ${comment.isTool ? 'tool' : ''}"><div class="comment-author">${comment.author}${comment.isTool ? html`<span class="bot-badge">Bot</span>` : nothing}</div><div class="comment-content">${comment.content}</div></div>`)}
            ${thread.isToolThread
                ? html`<details class="reply-disclosure"><summary>Reply (collapsed)</summary><div class="reply-form"><textarea id="reply-${thread.id}" rows="2" placeholder="Reply..."></textarea><button class="btn-primary" @click=${() => this.reply(thread.id)}>Reply</button></div></details>`
                : html`<div class="reply-form"><textarea id="reply-${thread.id}" rows="2" placeholder="Reply..."></textarea><button class="btn-primary" @click=${() => this.reply(thread.id)}>Reply</button></div>`}
        </article>`;
    }

    private toggleResolvedThreads = (): void => {
        this.data = {
            ...this.data,
            showResolvedThreads: !this.data.showResolvedThreads
        };
        this.send({ type: 'setShowResolvedThreads', showResolved: this.data.showResolvedThreads });
    };

    private addComment = (): void => {
        const input = this.renderRoot.querySelector<HTMLTextAreaElement>('#new-comment');
        const content = input?.value.trim();
        if (!content) { return; }
        this.send({ type: 'addComment', content });
        if (input) { input.value = ''; }
    };

    private reply(threadId: number): void {
        const input = this.renderRoot.querySelector<HTMLTextAreaElement>(`#reply-${threadId}`);
        const content = input?.value.trim();
        if (!content) { return; }
        this.send({ type: 'reply', threadId, content });
        if (input) { input.value = ''; }
    }

    private setThreadStatus(thread: PrThreadViewModel): void {
        this.send({ type: 'setStatus', threadId: thread.id, status: thread.isResolved ? 1 : 2 });
    }

    private onOpenBuild = (event: Event): void => {
        const buildId = Number((event as CustomEvent<{ buildId: number }>).detail?.buildId);
        if (Number.isFinite(buildId) && buildId > 0) {
            this.send({ type: 'openBuild', buildId });
        }
    };

    private send(message: PrDetailsMessage): void {
        postMessage(message);
    }
}

customElements.define('ado-pr-details-app', AdoPrDetailsApp);
