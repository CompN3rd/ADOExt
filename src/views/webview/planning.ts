import { LitElement, css, html, nothing, type PropertyDeclarations, type TemplateResult } from 'lit';
import { baseStyles } from './commonStyles';
import { postMessage, readInitialData } from './vscodeApi';
import type { PlanningItemViewModel, PlanningMessage, PlanningScopeViewModel, PlanningViewModel } from '../webviewTypes';

const BACKLOG_TYPES = new Set(['epic', 'feature', 'user story', 'product backlog item', 'pbi', 'requirement', 'bug']);

class AdoPlanningApp extends LitElement {
    static properties: PropertyDeclarations = {
        model: { state: true },
        filter: { state: true },
        sortMode: { state: true },
        collapsed: { state: true }
    };

    static styles = [baseStyles, css`
        h1 { font-size: 1.25rem; }
        .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
        .subtitle { color: var(--vscode-descriptionForeground); margin-top: 4px; }
        .scope { margin: 0 0 22px; }
        .scope-title { font-size: 0.98rem; font-weight: 600; margin: 0 0 8px; color: var(--vscode-sideBarTitle-foreground); display: flex; align-items: center; gap: 8px; }
        .scope-count { color: var(--vscode-descriptionForeground); font-weight: 400; }
        .scope-new-item { margin-left: auto; }
        .filter-sort-controls { display: flex; gap: 10px; align-items: center; padding: 10px 12px; background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)); border-bottom: 1px solid var(--vscode-panel-border); flex-wrap: wrap; font-size: 0.9em; margin-bottom: 12px; }
        .filter-sort-controls label { color: var(--vscode-descriptionForeground); font-weight: 500; }
        .filter-sort-controls input { padding: 4px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 3px; min-width: 180px; }
        .backlog { border-top: 1px solid var(--vscode-panel-border); }
        .tree-row, .sprint-task { display: grid; grid-template-columns: minmax(280px, 1fr) auto; align-items: center; gap: 12px; min-height: 32px; border-bottom: 1px solid var(--vscode-panel-border); }
        .tree-row { padding: 3px 8px 3px calc(8px + var(--depth, 0) * 18px); }
        .sprint-task { padding: 3px 0 3px 26px; border-bottom-style: dotted; }
        .tree-row:hover, .card:hover { background: var(--vscode-list-hoverBackground); }
        .tree-twisty { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: none; background: transparent; color: var(--vscode-foreground); cursor: pointer; padding: 0; margin-right: 2px; }
        .tree-twisty.placeholder { cursor: default; visibility: hidden; }
        .chev { display: inline-block; transition: transform 120ms ease; }
        .collapsed-chev { transform: rotate(-90deg); }
        .title-line { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
        .id { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
        .type { white-space: nowrap; padding: 1px 6px; border-radius: 8px; font-size: 0.78em; color: var(--vscode-editor-background); background: var(--vscode-charts-blue); }
        .type.epic { background: var(--vscode-charts-purple, #8a2be2); }
        .type.feature { background: var(--vscode-charts-orange, #d9822b); }
        .type.user-story, .type.product-backlog-item, .type.pbi, .type.requirement { background: var(--vscode-charts-blue, #007acc); }
        .type.bug { background: var(--vscode-charts-red, #c4314b); }
        .type.task { background: var(--vscode-charts-yellow, #d7a416); color: #000; }
        .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .state-badge { display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 0.78em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .state-control { display: flex; align-items: center; gap: 6px; }
        .btn-small { padding: 2px 7px; font-size: 0.82em; }
        .meta-edit { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
        .board-table { display: grid; gap: 1px; background: var(--vscode-panel-border); border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: auto; }
        .board-cell { background: var(--vscode-sideBar-background); padding: 8px; min-height: 60px; }
        .board-head, .lane-head, .lane-corner { background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)); font-weight: 600; }
        .lane-cell { display: flex; flex-direction: column; gap: 6px; }
        .card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 6px 8px; }
        .card-title { display: flex; gap: 6px; min-width: 0; margin-bottom: 4px; flex-wrap: wrap; }
        .card-title .title { white-space: normal; }
        .card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
        .sprint { margin-bottom: 18px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
        .sprint-head { padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-sideBar-background)); border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; }
        .sprint-head h3 { margin: 0; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .sprint-body { padding: 6px 0; }
        .sprint-parent { padding: 4px 10px; }
        .sprint-parent-header { display: flex; align-items: center; gap: 6px; padding: 4px 0; font-weight: 600; flex-wrap: wrap; }
        @media (max-width: 720px) { .tree-row, .sprint-task { grid-template-columns: 1fr; align-items: start; } .state-control { justify-content: flex-start; } .header { align-items: flex-start; flex-direction: column; } }
    `];

    model: PlanningViewModel = readInitialData<PlanningViewModel>();
    filter = '';
    sortMode: 'name' | 'date' = 'name';
    collapsed = new Set<string>();

    render() {
        const canExpand = this.model.kind === 'backlog' || this.model.kind === 'sprint';
        return html`<main class="shell">
            <div class="header"><div><h1>${this.model.title}</h1><div class="subtitle">${this.model.subtitle}</div></div><div class="toolbar">${canExpand ? html`<button class="btn btn-secondary" @click=${this.expandAll}>Expand all</button><button class="btn btn-secondary" @click=${this.collapseAll}>Collapse all</button>` : nothing}<button class="btn btn-primary" @click=${() => this.send({ type: 'quickCreate' })}>+ New Item</button><button class="btn btn-secondary" @click=${() => this.send({ type: 'refresh' })}>Refresh</button></div></div>
            <div class="filter-sort-controls"><label for="filter-input">Filter</label><input id="filter-input" type="text" placeholder="e.g. bug|critical" .value=${this.filter} @input=${this.onFilter}><label for="sort-select">Sort</label><select id="sort-select" .value=${this.sortMode} @change=${this.onSort}><option value="name">Name (A-Z)</option><option value="date">ID</option></select><button class="btn btn-small" @click=${this.clearFilter}>Clear</button></div>
            ${this.model.items.length === 0 ? html`<p class="empty">No planning work items found.</p>` : this.model.scopes.map(scope => this.renderScope(scope))}
        </main>`;
    }

    private renderScope(scope: PlanningScopeViewModel) {
        const items = this.sorted(this.model.items.filter(item => item.scopeKey === this.scopeKey(scope))).filter(item => this.itemMatches(item));
        const body = this.model.kind === 'backlog' ? this.renderBacklog(scope, items) : this.model.kind === 'board' ? this.renderBoard(scope, items) : this.renderSprint(scope, items);
        return html`<section class="scope"><h2 class="scope-title">${scope.label} <span class="scope-count">${items.length}</span><button class="btn btn-primary btn-small scope-new-item" @click=${() => this.send({ type: 'quickCreate', organization: scope.organization, project: scope.project })}>+ New Item</button></h2>${body}</section>`;
    }

    private renderBacklog(scope: PlanningScopeViewModel, items: PlanningItemViewModel[]) {
        if (!items.length) { return html`<p class="empty">No backlog items in this project.</p>`; }
        const ids = new Set(items.map(item => item.id));
        const roots = items.filter(item => item.parentId === undefined || !ids.has(item.parentId));
        return html`<div class="backlog" role="tree">${roots.map(root => this.renderBacklogItem(scope, root, items, 0, new Set<number>()))}</div>`;
    }

    private renderBacklogItem(scope: PlanningScopeViewModel, item: PlanningItemViewModel, items: PlanningItemViewModel[], depth: number, seen: Set<number>): TemplateResult | typeof nothing {
        if (seen.has(item.id)) { return nothing; }
        seen.add(item.id);
        const children = this.sorted(items.filter(candidate => candidate.parentId === item.id));
        const key = `backlog-${scope.organization}-${scope.project}-${item.id}`;
        const isCollapsed = this.collapsed.has(key);
        return html`${this.renderItemRow(item, depth, children.length > 0, key, isCollapsed)}${children.length && !isCollapsed ? html`<div role="group">${children.map(child => this.renderBacklogItem(scope, child, items, depth + 1, new Set(seen)))}</div>` : nothing}`;
    }

    private renderBoard(scope: PlanningScopeViewModel, items: PlanningItemViewModel[]) {
        if (!items.length) { return html`<p class="empty">No board items in this project.</p>`; }
        const states = uniqueSortedStates(items);
        const lanes = this.boardLanes(items);
        const gridTemplate = `minmax(200px, 1.4fr) ${states.map(() => 'minmax(220px, 1fr)').join(' ')}`;
        return html`<div class="board-table" style=${`grid-template-columns:${gridTemplate}`}><div class="board-cell lane-corner"></div>${states.map(state => html`<div class="board-cell board-head">${state}</div>`)}${lanes.map(lane => html`${this.renderLaneHead(lane.parent)}${states.map(state => html`<div class="board-cell lane-cell">${lane.cards.filter(card => card.state === state).map(card => this.renderCard(card))}</div>`)}`)}</div>`;
    }

    private renderSprint(scope: PlanningScopeViewModel, items: PlanningItemViewModel[]) {
        if (!items.length) { return html`<p class="empty">No sprint items in this project.</p>`; }
        const byIteration = new Map<string, PlanningItemViewModel[]>();
        for (const item of items) {
            const iteration = item.iteration || 'Unscheduled';
            byIteration.set(iteration, [...(byIteration.get(iteration) ?? []), item]);
        }
        return html`${[...byIteration.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([iteration, iterationItems]) => {
            const key = `sprint-${scope.organization}-${scope.project}-${iteration}`;
            const isCollapsed = this.collapsed.has(key);
            const lanes = this.boardLanes(iterationItems, items);
            return html`<section class="sprint"><header class="sprint-head" role="button" tabindex="0" aria-expanded=${String(!isCollapsed)} @click=${() => this.toggle(key)} @keydown=${(event: KeyboardEvent) => this.toggleOnKey(event, key)}><h3><span class="chev ${isCollapsed ? 'collapsed-chev' : ''}">v</span>${iterationLabel(iteration)}</h3><span class="meta">${iterationItems.length} item${iterationItems.length === 1 ? '' : 's'} · ${iteration}</span></header>${!isCollapsed ? html`<div class="sprint-body">${lanes.map(lane => html`<div class="sprint-parent">${lane.parent ? this.renderSprintParent(lane.parent) : html`<div class="sprint-parent-header"><span class="title">Unparented</span><span class="meta">${lane.cards.length}</span></div>`}${lane.cards.length ? lane.cards.map(card => this.renderSprintTask(card)) : html`<div class="meta" style="padding-left:26px;">No child items.</div>`}</div>`)}</div>` : nothing}</section>`;
        })}`;
    }

    private renderItemRow(item: PlanningItemViewModel, depth: number, hasChildren: boolean, key: string, isCollapsed: boolean) {
        return html`<div class="tree-row" role="treeitem" style=${`--depth:${depth}`}><div class="title-line">${hasChildren ? html`<button class="tree-twisty" type="button" aria-expanded=${String(!isCollapsed)} aria-label=${`Toggle children of work item ${item.id}`} @click=${() => this.toggle(key)}><span class="chev ${isCollapsed ? 'collapsed-chev' : ''}">v</span></button>` : html`<span class="tree-twisty placeholder" aria-hidden="true"></span>`}${this.renderItemTitle(item)}${this.renderMetaActions(item, true)}</div>${this.renderStateControl(item)}</div>`;
    }

    private renderCard(item: PlanningItemViewModel) {
        return html`<article class="card"><div class="card-title">${this.renderItemTitle(item)}</div>${this.renderMetaActions(item, false)}<div class="card-footer">${this.renderStateControl(item)}</div></article>`;
    }

    private renderSprintTask(item: PlanningItemViewModel) {
        return html`<div class="sprint-task"><div class="title-line">${this.renderItemTitle(item)}${this.renderMetaActions(item, true)}</div>${this.renderStateControl(item)}</div>`;
    }

    private renderSprintParent(item: PlanningItemViewModel) {
        return html`<div class="sprint-parent-header">${this.renderItemTitle(item)}${item.state ? html`<span class="state-badge">${item.state}</span>` : nothing}</div>`;
    }

    private renderLaneHead(item: PlanningItemViewModel | undefined) {
        if (!item) { return html`<div class="board-cell lane-head"><div class="title-line"><span class="title">Unparented</span></div></div>`; }
        return html`<div class="board-cell lane-head"><div class="title-line">${this.renderItemTitle(item)}<span class="meta">${item.assignee}</span></div></div>`;
    }

    private renderItemTitle(item: PlanningItemViewModel) {
        return html`<span class="type ${item.typeClass}">${item.workItemType}</span><span class="id">#${item.id}</span><button class="btn-link" @click=${() => this.send({ type: 'openWorkItem', id: item.id, organization: item.organization, project: item.project })}><span class="title">${item.title}</span></button>`;
    }

    private renderMetaActions(item: PlanningItemViewModel, prefixed: boolean) {
        return html`${prefixed ? html`<span class="meta">·</span>` : nothing}<button class="btn-link meta-edit" title="Edit assignee" @click=${() => this.send({ type: 'editAssignee', id: item.id, organization: item.organization, project: item.project })}>${item.assignee}</button><span class="meta">·</span><button class="btn-link meta-edit" title="Edit iteration" @click=${() => this.send({ type: 'editIteration', id: item.id, organization: item.organization, project: item.project })}>${item.iterationLabel || 'No iteration'}</button>`;
    }

    private renderStateControl(item: PlanningItemViewModel) {
        return html`<div class="state-control"><select aria-label=${`State for work item ${item.id}`}>${item.allowedStates.map(state => html`<option value=${state} ?selected=${state === item.state}>${state}</option>`)}</select><button class="btn btn-primary" @click=${(event: Event) => this.saveState(event, item)}>Save</button></div>`;
    }

    private saveState(event: Event, item: PlanningItemViewModel): void {
        const select = (event.currentTarget as HTMLElement).closest('.state-control')?.querySelector('select');
        if (!select?.value) { return; }
        this.send({ type: 'setState', id: item.id, state: select.value, organization: item.organization, project: item.project });
    }

    private boardLanes(items: PlanningItemViewModel[], laneLookupItems: PlanningItemViewModel[] = items): Array<{ parent?: PlanningItemViewModel; cards: PlanningItemViewModel[] }> {
        const itemsById = new Map(laneLookupItems.map(item => [item.id, item]));
        const lanes = new Map<number, { parent: PlanningItemViewModel; cards: PlanningItemViewModel[] }>();
        const orphanCandidates: PlanningItemViewModel[] = [];
        for (const item of items) {
            const owner = laneOwner(item, itemsById);
            if (owner && item.id !== owner.id) {
                if (!lanes.has(owner.id)) { lanes.set(owner.id, { parent: owner, cards: [] }); }
                lanes.get(owner.id)!.cards.push(item);
            } else {
                orphanCandidates.push(item);
            }
        }
        const result: Array<{ parent?: PlanningItemViewModel; cards: PlanningItemViewModel[] }> = [...lanes.values()].sort((a, b) => compareItems(a.parent, b.parent));
        const orphanCards = orphanCandidates.filter(item => !lanes.has(item.id));
        if (orphanCards.length) { result.push({ cards: orphanCards }); }
        return result;
    }

    private sorted(items: PlanningItemViewModel[]): PlanningItemViewModel[] {
        return [...items].sort(this.sortMode === 'name' ? compareByName : compareItems);
    }

    private itemMatches(item: PlanningItemViewModel): boolean {
        if (!this.filter) { return true; }
        try {
            const regex = new RegExp(this.filter, 'i');
            return regex.test(`#${item.id} ${item.title} ${item.workItemType} ${item.state} ${item.assignee} ${item.iteration}`);
        } catch {
            return true;
        }
    }

    private toggle(key: string): void {
        const next = new Set(this.collapsed);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        this.collapsed = next;
    }

    private toggleOnKey(event: KeyboardEvent, key: string): void {
        if (event.key !== 'Enter' && event.key !== ' ') { return; }
        event.preventDefault();
        this.toggle(key);
    }

    private expandAll = () => { this.collapsed = new Set(); };
    private collapseAll = () => {
        const next = new Set<string>();
        for (const scope of this.model.scopes) {
            const items = this.model.items.filter(item => item.scopeKey === this.scopeKey(scope));
            for (const item of items) { next.add(`backlog-${scope.organization}-${scope.project}-${item.id}`); }
            for (const item of items) { if (item.iteration) { next.add(`sprint-${scope.organization}-${scope.project}-${item.iteration}`); } }
        }
        this.collapsed = next;
    };
    private onFilter = (event: Event) => { this.filter = (event.target as HTMLInputElement).value.trim(); };
    private onSort = (event: Event) => { this.sortMode = (event.target as HTMLSelectElement).value === 'date' ? 'date' : 'name'; };
    private clearFilter = () => { this.filter = ''; };
    private scopeKey(scope: PlanningScopeViewModel): string { return `${scope.organization}\u0000${scope.project}`; }
    private send(message: PlanningMessage): void { postMessage(message); }
}

function compareItems(left: PlanningItemViewModel, right: PlanningItemViewModel): number { return left.id - right.id; }
function compareByName(left: PlanningItemViewModel, right: PlanningItemViewModel): number { return left.title.localeCompare(right.title) || compareItems(left, right); }
function stateSortValue(state: string): number { const value = state.toLowerCase(); return value === 'new' || value === 'proposed' ? 10 : value === 'active' || value === 'committed' || value === 'in progress' ? 20 : value === 'resolved' ? 30 : value === 'closed' || value === 'done' ? 40 : 100; }
function uniqueSortedStates(items: PlanningItemViewModel[]): string[] { return [...new Set(items.map(item => item.state || 'Unknown'))].sort((a, b) => stateSortValue(a) - stateSortValue(b) || a.localeCompare(b)); }
function laneOwner(item: PlanningItemViewModel, itemsById: Map<number, PlanningItemViewModel>): PlanningItemViewModel | undefined { if (BACKLOG_TYPES.has(item.workItemType.toLowerCase())) { return item; } let current: PlanningItemViewModel | undefined = item; const visited = new Set<number>(); while (current) { if (visited.has(current.id)) { break; } visited.add(current.id); if (current.parentId === undefined) { return undefined; } const parent = itemsById.get(current.parentId); if (!parent) { return undefined; } if (BACKLOG_TYPES.has(parent.workItemType.toLowerCase())) { return parent; } current = parent; } return undefined; }
function iterationLabel(iterationPath: string): string { const pieces = iterationPath.split('\\').filter(Boolean); return pieces.length ? pieces[pieces.length - 1] : iterationPath; }

customElements.define('ado-planning-app', AdoPlanningApp);