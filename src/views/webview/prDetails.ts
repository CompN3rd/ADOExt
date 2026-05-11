import { LitElement, css, html, nothing, type PropertyDeclarations } from 'lit';
import type { PrDetailsMessage, PrDetailsViewModel, PrTestResultsViewModel, PrThreadViewModel } from '../webviewTypes';
import { postMessage, readInitialData } from './vscodeApi';
import './builds';

type ModalMode = 'complete' | 'autoComplete' | null;

class AdoPrDetailsApp extends LitElement {
    static properties: PropertyDeclarations = {
        data: { state: true },
        _modalMode: { state: true },
        _mergeStrategy: { state: true },
        _deleteSourceBranch: { state: true },
        _transitionWorkItems: { state: true },
        _mergeCommitMessage: { state: true }
    };

    static styles = css`
        :host {
            display: block;
            --tool-thread-textarea-min-height: 28px;
            --tool-thread-textarea-font-size: 0.9em;
        }
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
        .tool-thread textarea { min-height: var(--tool-thread-textarea-min-height); font-size: var(--tool-thread-textarea-font-size); }
        .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
        .test-summary { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
        .test-run-list, .test-failure-list { list-style: none; padding: 0; margin: 0; }
        .test-run { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); }
        .test-run:last-child { border-bottom: none; }
        .test-run-status { min-width: 88px; }
        .test-run-name { flex: 1; min-width: 140px; }
        .test-counts { font-size: 0.85em; color: var(--vscode-descriptionForeground); white-space: nowrap; }
        .test-note { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin: 0 0 8px; }
        .test-failure { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 8px; }
        .test-failure > summary { cursor: pointer; padding: 6px 10px; background: var(--vscode-sideBarSectionHeader-background); border-radius: 4px; display: flex; gap: 10px; align-items: center; }
        .test-failure-name { flex: 1; font-weight: 600; }
        .test-failure-meta { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
        .test-failure-body { padding: 8px 10px; }
        .test-failure-body h3 { margin: 10px 0 6px; font-size: 0.9em; }
        .test-failure-body pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family); font-size: 0.85em; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.08)); }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 20px; width: min(480px, 90vw); max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
        .modal h2 { margin: 0 0 16px; font-size: 1.1em; }
        .modal-field { margin-bottom: 12px; }
        .modal-field label { display: block; font-size: 0.85em; margin-bottom: 4px; color: var(--vscode-descriptionForeground); }
        .modal-field select, .modal-field textarea { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 6px 8px; font-family: inherit; font-size: inherit; }
        .modal-field textarea { resize: vertical; min-height: 60px; }
        .modal-check { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 0.9em; }
        .modal-check input[type="checkbox"] { margin: 0; }
        .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
        .modal-wi-list { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin: 4px 0 0 24px; list-style: disc; }
        .btn-danger { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-inputValidation-errorForeground, #f48771); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); }
        .btn-danger:hover { opacity: 0.9; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        @media (max-width: 620px) { .reply-form { flex-direction: column; } .checks-list li { align-items: flex-start; flex-direction: column; } }
    `;

    data: PrDetailsViewModel = readInitialData<PrDetailsViewModel>();
    _modalMode: ModalMode = null;
    _mergeStrategy = 1;
    _deleteSourceBranch = true;
    _transitionWorkItems = true;
    _mergeCommitMessage = '';

    render() {
        return html`<main class="shell">
            <div class="toolbar">
                <button class="btn-primary" @click=${() => this.send({ type: 'openDiff' })}>View Diff</button>
                <div class="review-actions" role="group" aria-label="Review actions">
                    ${this.data.reviewActions.map(action => html`<button class="btn-secondary" @click=${() => this.send({ type: 'setVote', vote: action.vote })}>${action.label}</button>`)}
                </div>
                ${this.renderCompletionButtons()}
                <button class="btn-secondary" @click=${() => this.send({ type: 'openInBrowser' })}>Open in Browser</button>
            </div>
            <h1>PR #${this.data.prId}: ${this.data.title}${this.data.isDraft ? html`<span class="badge draft">Draft</span>` : nothing}</h1>
            <div class="meta"><strong>${this.data.author}</strong> opened on ${this.data.createdDate} · <code>${this.data.sourceBranch}</code> -> <code>${this.data.targetBranch}</code></div>
            <section class="section"><h2>Description</h2><pre class="description">${this.data.description}</pre></section>
            ${this.data.reviewers.length > 0 ? html`<section class="section"><h2>Reviewers</h2><ul class="reviewers">${this.data.reviewers.map(reviewer => html`<li><span class="vote ${reviewer.voteClass}">${reviewer.voteLabel}</span>${reviewer.displayName}</li>`)}</ul></section>` : nothing}
            ${this.renderRows('Branch Status', this.data.branchStatuses)}
            ${this.renderRows('Build & Policy Status', this.data.checks)}
            ${this.renderTestResults(this.data.testResults)}
            <section class="section"><h2>Builds</h2><ado-build-list .builds=${this.data.builds} empty-label="No builds found." @adoext-open-build=${this.onOpenBuild}></ado-build-list></section>
            <section class="section"><h2>Comment Threads</h2>${this.renderThreads()}</section>
            <section class="section"><h2>Add Comment</h2><div class="new-comment-form"><textarea id="new-comment" rows="3" placeholder="Write a comment..."></textarea><div><button class="btn-primary" @click=${this.addComment}>Add Comment</button></div></div></section>
            ${this._modalMode ? this.renderModal() : nothing}
        </main>`;
    }

    private renderTestResults(testResults: PrTestResultsViewModel | undefined) {
        if (!testResults) { return nothing; }

        const failures = testResults.failures ?? [];
        const runs = testResults.runs ?? [];
        const hasPendingRuns = runs.some(run => run.statusClass === 'check-pending');

        return html`
            <section class="section">
                <h2>Test Results</h2>
                <div class="test-summary">
                    <span>Total: ${testResults.totalTests}</span>
                    <span>Passed: ${testResults.passedTests}</span>
                    <span>Failed: ${testResults.failedTests}</span>
                    <span>Skipped: ${testResults.skippedTests}</span>
                    ${testResults.durationLabel ? html`<span>Duration: ${testResults.durationLabel}</span>` : nothing}
                </div>
                <div class="toolbar">
                    ${testResults.failedTests > 0
                        ? html`<button class="btn-secondary" @click=${() => this.copyFailureSummary(testResults)}>Copy Failure Summary</button>`
                        : nothing}
                </div>
                ${runs.length === 0
                    ? html`<p class="empty">No test runs found.</p>`
                    : html`
                        <ul class="test-run-list">
                            ${runs.map(run => html`
                                <li class="test-run">
                                    <span class="check-state ${run.statusClass} test-run-status">${run.statusLabel}</span>
                                    <span class="test-run-name">${run.runName}</span>
                                    <span class="test-counts">${run.passedTests}P / ${run.failedTests}F / ${run.skippedTests}S · ${run.totalTests} total${run.durationLabel ? html` · ${run.durationLabel}` : nothing}</span>
                                    <button class="btn-secondary" @click=${() => this.openTestRun(run.runId)}>Open Run</button>
                                    ${run.buildId ? html`<button class="btn-secondary" @click=${() => this.send({ type: 'openBuild', buildId: run.buildId! })}>Open Build</button>` : nothing}
                                </li>
                            `)}
                        </ul>
                    `}
                ${testResults.failureDetailsNotice
                    ? html`<p class="test-note">${testResults.failureDetailsNotice}</p>`
                    : nothing}
                ${testResults.failedTests === 0
                    ? html`<p class="empty">${hasPendingRuns ? 'No failing tests reported yet.' : 'No failing tests.'}</p>`
                    : failures.length === 0
                        ? html`<p class="empty">Failing tests were detected, but detailed failure records were unavailable.</p>`
                    : html`
                        <h3>Failed Tests</h3>
                        <ul class="test-failure-list">
                            ${failures.map(failure => html`
                                <li>
                                    <details class="test-failure">
                                        <summary>
                                            <span class="test-failure-name">${failure.testName}</span>
                                            <span class="test-failure-meta">${failure.buildLabel ? `${failure.buildLabel} · ` : ''}${failure.runName}</span>
                                        </summary>
                                        <div class="test-failure-body">
                                            ${failure.errorMessageSnippet ? html`<h3>Error</h3><pre>${failure.errorMessageSnippet}</pre>` : html`<p class="empty">No error message provided.</p>`}
                                            ${failure.stackTraceSnippet ? html`<h3>Stack Trace</h3><pre>${failure.stackTraceSnippet}</pre>` : nothing}
                                            <div class="toolbar">
                                                <button class="btn-secondary" @click=${() => this.openTestRun(failure.runId)}>Open Run</button>
                                                ${failure.buildId ? html`<button class="btn-secondary" @click=${() => this.send({ type: 'openBuild', buildId: failure.buildId! })}>Open Build</button>` : nothing}
                                            </div>
                                        </div>
                                    </details>
                                </li>
                            `)}
                        </ul>
                    `}
            </section>
        `;
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
            ${thread.comments.map(comment => this.renderComment(comment))}
            ${this.renderReplySection(thread)}
        </article>`;
    }

    private renderComment(comment: PrThreadViewModel['comments'][number]) {
        return html`<div class="comment ${comment.isTool ? 'tool' : ''}">
            <div class="comment-author">
                ${comment.author}
                ${comment.isTool ? html`<span class="bot-badge">Bot</span>` : nothing}
            </div>
            <div class="comment-content">${comment.content}</div>
        </div>`;
    }

    private renderReplySection(thread: PrThreadViewModel) {
        const replyForm = html`<div class="reply-form">
            <textarea id="reply-${thread.id}" rows="2" placeholder="Reply..."></textarea>
            <button class="btn-primary" @click=${() => this.reply(thread.id)}>Reply</button>
        </div>`;

        return thread.isToolThread
            ? html`<details class="reply-disclosure"><summary>Reply (expand)</summary>${replyForm}</details>`
            : replyForm;
    }

    private renderCompletionButtons() {
        if (!this.data.canComplete) { return nothing; }
        if (this.data.autoCompleteSetBy) {
            return html`
                <button class="btn-secondary" @click=${() => this.send({ type: 'cancelAutoComplete' })}>Cancel Auto-Complete</button>
            `;
        }
        return html`
            <button class="btn-primary" @click=${this.openCompleteModal} ?disabled=${this.data.hasConflicts || this.data.isDraft}>Complete</button>
            <button class="btn-secondary" @click=${this.openAutoCompleteModal} ?disabled=${this.data.isDraft}>Set Auto-Complete</button>
        `;
    }

    private renderModal() {
        const isComplete = this._modalMode === 'complete';
        const title = isComplete ? 'Complete Pull Request' : 'Set Auto-Complete';
        const confirmLabel = isComplete ? 'Complete Merge' : 'Set Auto-Complete';
        return html`
            <div class="modal-overlay" @click=${this.onOverlayClick}>
                <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
                    <h2>${title}</h2>
                    <div class="modal-field">
                        <label>Merge Type</label>
                        <select @change=${this.onMergeStrategyChange}>
                            <option value="1" ?selected=${this._mergeStrategy === 1}>Merge (no fast-forward)</option>
                            <option value="2" ?selected=${this._mergeStrategy === 2}>Squash commit</option>
                            <option value="3" ?selected=${this._mergeStrategy === 3}>Rebase and fast-forward</option>
                            <option value="4" ?selected=${this._mergeStrategy === 4}>Semi-linear merge (rebase + merge commit)</option>
                        </select>
                    </div>
                    <div class="modal-field">
                        <label>Commit Message</label>
                        <textarea rows="3" .value=${this._mergeCommitMessage} @input=${this.onCommitMsgInput}></textarea>
                    </div>
                    <label class="modal-check">
                        <input type="checkbox" .checked=${this._deleteSourceBranch} @change=${this.onDeleteBranchChange}>
                        Delete source branch after merge
                    </label>
                    <label class="modal-check">
                        <input type="checkbox" .checked=${this._transitionWorkItems} @change=${this.onTransitionWiChange}>
                        Complete associated work items
                    </label>
                    ${this.data.associatedWorkItems.length > 0 ? html`
                        <ul class="modal-wi-list">
                            ${this.data.associatedWorkItems.map(wi => html`<li>#${wi.id}: ${wi.title}</li>`)}
                        </ul>
                    ` : nothing}
                    <div class="modal-actions">
                        <button class="btn-secondary" @click=${this.closeModal}>Cancel</button>
                        <button class="${isComplete ? 'btn-primary' : 'btn-primary'}" @click=${this.confirmModal}>${confirmLabel}</button>
                    </div>
                </div>
            </div>
        `;
    }

    private openCompleteModal = (): void => {
        this._mergeCommitMessage = `Merged PR ${this.data.prId}: ${this.data.title}`;
        this._modalMode = 'complete';
    };

    private openAutoCompleteModal = (): void => {
        this._mergeCommitMessage = `Merged PR ${this.data.prId}: ${this.data.title}`;
        this._modalMode = 'autoComplete';
    };

    private closeModal = (): void => {
        this._modalMode = null;
    };

    private onOverlayClick = (): void => {
        this.closeModal();
    };

    private onMergeStrategyChange = (e: Event): void => {
        this._mergeStrategy = Number((e.target as HTMLSelectElement).value);
    };

    private onCommitMsgInput = (e: Event): void => {
        this._mergeCommitMessage = (e.target as HTMLTextAreaElement).value;
    };

    private onDeleteBranchChange = (e: Event): void => {
        this._deleteSourceBranch = (e.target as HTMLInputElement).checked;
    };

    private onTransitionWiChange = (e: Event): void => {
        this._transitionWorkItems = (e.target as HTMLInputElement).checked;
    };

    private confirmModal = (): void => {
        const msg = {
            mergeStrategy: this._mergeStrategy,
            deleteSourceBranch: this._deleteSourceBranch,
            transitionWorkItems: this._transitionWorkItems,
            mergeCommitMessage: this._mergeCommitMessage
        };
        if (this._modalMode === 'complete') {
            this.send({ type: 'completePr', ...msg });
        } else if (this._modalMode === 'autoComplete') {
            this.send({ type: 'setAutoComplete', ...msg });
        }
        this._modalMode = null;
    };

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

    private openTestRun = (runId: number): void => {
        if (Number.isFinite(runId) && runId > 0) {
            this.send({ type: 'openTestRun', runId });
        }
    };

    private copyFailureSummary = (testResults: PrTestResultsViewModel): void => {
        const failures = testResults.failures ?? [];
        if (testResults.failedTests === 0) { return; }

        const lines = failures.length > 0
            ? [
                `Test failures (${failures.length}${failures.length < testResults.failedTests ? ` of ${testResults.failedTests}` : ''})`,
                ...failures.map(failure => {
                    const location = [failure.buildLabel, failure.runName].filter(Boolean).join(' · ');
                    const msg = failure.errorMessageSnippet ? `\n  ${failure.errorMessageSnippet.split('\n')[0]}` : '';
                    return `- ${failure.testName}${location ? ` (${location})` : ''}${msg}`;
                })
            ]
            : [
                `Test failures (${testResults.failedTests})`,
                ...testResults.runs
                    .filter(run => run.failedTests > 0)
                    .map(run => `- ${run.runName}: ${run.failedTests} failing test${run.failedTests === 1 ? '' : 's'}${run.buildLabel ? ` (${run.buildLabel})` : ''}`)
            ];

        this.send({ type: 'copyText', text: lines.join('\n') });
    };

    private send(message: PrDetailsMessage): void {
        postMessage(message);
    }
}

customElements.define('ado-pr-details-app', AdoPrDetailsApp);
