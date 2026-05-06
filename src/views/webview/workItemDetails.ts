import { LitElement, css, html, nothing, type PropertyDeclarations } from 'lit';
import type { LinkedItemViewModel, WorkItemDetailsMessage, WorkItemDetailsViewModel } from '../webviewTypes';
import { postMessage, readInitialData } from './vscodeApi';
import './builds';
import './richText';

class AdoWorkItemDetailsApp extends LitElement {
    static properties: PropertyDeclarations = {
        data: { state: true },
        selectedState: { state: true }
    };

    static styles = css`
        :host { display: block; }
        * { box-sizing: border-box; }
        .shell { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; min-height: 100vh; }
        h1 { font-size: 1.3em; margin: 0 0 4px; line-height: 1.35; }
        h2 { font-size: 1em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; margin-bottom: 8px; }
        .toolbar, .state-edit { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
        button { padding: 4px 12px; border-radius: 3px; border: 1px solid var(--vscode-button-border, transparent); cursor: pointer; font-family: inherit; font-size: 0.85em; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
        select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); border-radius: 3px; padding: 3px 22px 3px 6px; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; font-weight: 600; margin-right: 6px; }
        .badge-type { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .badge-state { background: color-mix(in srgb, var(--state-color) 14%, transparent); color: var(--state-color); border: 1px solid color-mix(in srgb, var(--state-color) 38%, transparent); }
        .priority-1 { background: #c84b3222; color: #c84b32; border: 1px solid #c84b3255; }
        .priority-2 { background: #e8a33522; color: #e8a335; border: 1px solid #e8a33555; }
        .priority-3 { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .priority-4 { background: var(--vscode-badge-background); color: var(--vscode-descriptionForeground); }
        .section { margin-bottom: 20px; }
        .meta-table { border-collapse: collapse; margin-top: 8px; }
        .meta-table td { padding: 3px 12px 3px 0; vertical-align: top; }
        .meta-label { color: var(--vscode-descriptionForeground); font-size: 0.9em; white-space: nowrap; min-width: 110px; }
        .description { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); padding: 10px 14px; border-radius: 0 4px 4px 0; line-height: 1.6; }
        ado-rich-text { word-break: break-word; line-height: 1.5; }
        ado-rich-text.plain-text { white-space: pre-wrap; }
        ado-rich-text p { margin: 0 0 8px; }
        ado-rich-text ul, ado-rich-text ol { padding-left: 24px; margin: 0 0 8px; }
        ado-rich-text table { border-collapse: collapse; margin-bottom: 8px; }
        ado-rich-text td, ado-rich-text th { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; }
        ado-rich-text a { color: var(--vscode-textLink-foreground); }
        ado-rich-text a:hover { color: var(--vscode-textLink-activeForeground); }
        ado-rich-text img { max-width: 100%; }
        ado-rich-text pre, ado-rich-text code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); }
        ado-rich-text pre { padding: 8px; overflow-x: auto; }
        .comment { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 10px; padding: 10px; }
        .comment-header { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
        .comment-author { font-weight: bold; font-size: 0.9em; }
        .comment-date { color: var(--vscode-descriptionForeground); font-size: 0.8em; }
        .new-comment-form { display: flex; flex-direction: column; gap: 6px; }
        textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 6px 8px; font-family: inherit; font-size: inherit; resize: vertical; min-height: 60px; width: 100%; }
        .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
        .linked-items-list { display: flex; flex-wrap: wrap; gap: 6px; }
        .linked-item-btn { text-align: left; }
    `;

    data: WorkItemDetailsViewModel = readInitialData<WorkItemDetailsViewModel>();
    selectedState = this.data.state;

    render() {
        const style = `--state-color: ${this.data.stateColor}`;
        return html`<main class="shell" style=${style}>
            <div class="toolbar">
                <button class="btn-secondary" @click=${() => this.send({ type: 'openInBrowser' })}>Open in Browser</button>
                <button class="btn-primary" @click=${() => this.send({ type: 'startWorking' })}>Start Working</button>
                <div class="state-edit"><select aria-label="Work item state" .value=${this.selectedState} @change=${this.onStateChanged}>${this.data.allowedStates.map(state => html`<option value=${state}>${state}</option>`)}</select><button class="btn-primary" @click=${this.updateState}>Update State</button></div>
            </div>
            <h1><span class="badge badge-type">${this.data.workItemType}</span><span class="badge badge-state">${this.data.state}</span>${this.data.priority !== undefined ? html`<span class="badge priority-${this.data.priority}">P${this.data.priority}</span>` : nothing}#${this.data.id}: ${this.data.title}</h1>
            <section class="section"><table class="meta-table">${this.data.metaRows.map(row => html`<tr><td class="meta-label">${row.label}</td><td>${row.value}</td></tr>`)}</table></section>
            <section class="section"><h2>Description</h2><div class="description"><ado-rich-text .htmlText=${this.data.descriptionHtml} empty-label="No description provided."></ado-rich-text></div></section>
            <section class="section"><h2>Linked Items (${this.data.linkedItems.length})</h2><div class="linked-items-list">${this.renderLinkedItems()}</div></section>
            <section class="section"><h2>Builds</h2><ado-build-list .builds=${this.data.builds} empty-label="No linked builds." @adoext-open-build=${this.onOpenBuild}></ado-build-list></section>
            <section class="section"><h2>Comments (${this.data.comments.length})</h2>${this.renderComments()}</section>
            <section class="section"><h2>Add Comment</h2><div class="new-comment-form"><textarea id="new-comment" rows="4" placeholder="Write a comment..."></textarea><div><button class="btn-primary" @click=${this.addComment}>Add Comment</button></div></div></section>
        </main>`;
    }

    private renderLinkedItems() {
        if (this.data.linkedItems.length === 0) {
            return html`<p class="empty">No linked branches, commits, or pull requests.</p>`;
        }
        return html`${this.data.linkedItems.map(item => html`<button class="btn-secondary linked-item-btn" @click=${() => this.openLinkedItem(item)}>${this.linkedIcon(item.type)} ${item.label}</button>`)}`;
    }

    private renderComments() {
        if (this.data.comments.length === 0) {
            return html`<p class="empty">No comments yet.</p>`;
        }
        return html`${this.data.comments.map(comment => html`<article class="comment"><div class="comment-header"><span class="comment-author">${comment.author}</span><span class="comment-date">${comment.date}</span></div><ado-rich-text .htmlText=${comment.html} .plainText=${comment.isPlainText}></ado-rich-text></article>`)}`;
    }

    private linkedIcon(type: LinkedItemViewModel['type']): string {
        switch (type) {
            case 'pr': return 'PR';
            case 'branch': return 'Branch';
            case 'commit': return 'Commit';
        }
    }

    private onStateChanged = (event: Event): void => {
        this.selectedState = (event.target as HTMLSelectElement).value;
    };

    private updateState = (): void => {
        if (this.selectedState) {
            this.send({ type: 'setState', state: this.selectedState });
        }
    };

    private addComment = (): void => {
        const input = this.renderRoot.querySelector<HTMLTextAreaElement>('#new-comment');
        const content = input?.value.trim();
        if (!content) { return; }
        this.send({ type: 'addComment', content });
        if (input) { input.value = ''; }
    };

    private openLinkedItem(item: LinkedItemViewModel): void {
        this.send({ type: 'openLinkedItem', url: item.webUrl });
    }

    private onOpenBuild = (event: Event): void => {
        const buildId = Number((event as CustomEvent<{ buildId: number }>).detail?.buildId);
        if (Number.isFinite(buildId) && buildId > 0) {
            this.send({ type: 'openBuild', buildId });
        }
    };

    private send(message: WorkItemDetailsMessage): void {
        postMessage(message);
    }
}

customElements.define('ado-work-item-details-app', AdoWorkItemDetailsApp);
