import { LitElement, css, html, nothing, type PropertyDeclarations } from 'lit';
import { baseStyles } from './commonStyles';
import { postMessage, readInitialData } from './vscodeApi';
import type {
    WorkItemSchemaInspectorFieldViewModel,
    WorkItemSchemaInspectorMessage,
    WorkItemSchemaInspectorTypeViewModel,
    WorkItemSchemaInspectorViewModel
} from '../webviewTypes';

class AdoWorkItemSchemaInspectorApp extends LitElement {
    static properties: PropertyDeclarations = {
        model: { state: true },
        filter: { state: true }
    };

    static styles = [baseStyles, css`
        .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .title { display: flex; flex-direction: column; gap: 4px; min-width: 280px; }
        .subtitle { color: var(--vscode-descriptionForeground); }
        .toolbar { margin-top: 8px; }
        .search { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .search input { min-width: 260px; padding: 4px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 3px; }
        details { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 10px 0; background: var(--vscode-sideBar-background); }
        summary { list-style: none; cursor: pointer; padding: 10px 12px; display: flex; align-items: center; gap: 10px; }
        summary::-webkit-details-marker { display: none; }
        .type-icon { width: 18px; height: 18px; object-fit: contain; }
        .type-name { font-weight: 600; }
        .type-meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
        .type-color { width: 10px; height: 10px; border-radius: 2px; border: 1px solid var(--vscode-panel-border); background: var(--type-color, transparent); }
        .pill { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 0.8em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .body { padding: 0 12px 12px; }
        .grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
        @media (min-width: 920px) { .grid { grid-template-columns: 1fr 1fr; } }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; border-bottom: 1px solid var(--vscode-panel-border); padding: 6px 6px; vertical-align: top; }
        th { color: var(--vscode-descriptionForeground); font-weight: 600; font-size: 0.9em; }
        code { font-family: var(--vscode-editor-font-family); }
        .state-color { width: 10px; height: 10px; border-radius: 2px; border: 1px solid var(--vscode-panel-border); background: var(--state-color, transparent); display: inline-block; margin-right: 6px; vertical-align: middle; }
        .warnings { border: 1px solid color-mix(in srgb, var(--vscode-charts-yellow) 50%, transparent); background: color-mix(in srgb, var(--vscode-charts-yellow) 10%, transparent); padding: 10px 12px; border-radius: 4px; margin: 10px 0; }
        .warnings h2 { margin-bottom: 6px; }
        .warnings ul { margin: 0; padding-left: 18px; }
        .copy-btn { white-space: nowrap; }
        .help { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    `];

    model: WorkItemSchemaInspectorViewModel = readInitialData<WorkItemSchemaInspectorViewModel>();
    filter = '';

    render() {
        const filtered = this.filteredTypes();
        const processLabel = this.processLabel();
        return html`<main class="shell">
            <div class="header">
                <div class="title">
                    <h1>Work Item Process Inspector</h1>
                    <div class="subtitle">${this.model.organization}/${this.model.project}${processLabel ? html` · ${processLabel}` : nothing}</div>
                    <div class="subtitle">Fetched: ${this.model.fetchedAt}</div>
                </div>
                <div class="toolbar">
                    <button class="btn btn-secondary" @click=${() => this.send({ type: 'openProcessSettings' })}>Open Process Settings</button>
                    <button class="btn btn-secondary" @click=${() => this.send({ type: 'copyDiagnosticSummary' })}>Copy Diagnostic Summary</button>
                    <button class="btn btn-primary" @click=${() => this.send({ type: 'refresh' })}>Refresh</button>
                </div>
            </div>

            ${this.model.warnings.length
                ? html`<section class="warnings"><h2>Warnings</h2><ul>${this.model.warnings.map(w => html`<li>${w}</li>`)}</ul></section>`
                : nothing}

            <div class="search">
                <label class="meta" for="filter">Filter</label>
                <input id="filter" type="text" placeholder="Type name, state, or field reference…" .value=${this.filter} @input=${this.onFilter} />
                <span class="meta">${filtered.length}/${this.model.types.length} types</span>
            </div>

            ${filtered.length === 0
                ? html`<p class="empty">No matching work item types.</p>`
                : html`${filtered.map(type => this.renderType(type))}`}

            <p class="help">Tip: Use “Copy Diagnostic Summary” when filing bugs about custom fields, states, or icons.</p>
        </main>`;
    }

    private renderType(type: WorkItemSchemaInspectorTypeViewModel) {
        const style = type.color ? `--type-color:${type.color}` : '';
        return html`<details>
            <summary style=${style}>
                ${type.iconUrl ? html`<img class="type-icon" src=${type.iconUrl} alt="" />` : nothing}
                <span class="type-color" aria-hidden="true"></span>
                <span class="type-name">${type.name}</span>
                <span class="type-meta">${type.referenceName ? html`<code>${type.referenceName}</code> · ` : nothing}<span class="pill">${type.stateCount} states</span> <span class="pill">${type.fieldCount} fields</span></span>
            </summary>
            <div class="body">
                <div class="grid">
                    <section>
                        <h2>States</h2>
                        ${type.states.length === 0
                            ? html`<p class="empty">No state metadata available.</p>`
                            : html`<table><thead><tr><th>Name</th><th>Category</th></tr></thead><tbody>${type.states.map(state => this.renderStateRow(state))}</tbody></table>`}
                    </section>
                    <section>
                        <h2>Fields</h2>
                        ${type.fields.length === 0
                            ? html`<p class="empty">No field metadata available.</p>`
                            : html`<table><thead><tr><th>Reference</th><th>Name</th><th></th></tr></thead><tbody>${type.fields.map(field => this.renderFieldRow(field))}</tbody></table>`}
                    </section>
                </div>
            </div>
        </details>`;
    }

    private renderStateRow(state: WorkItemSchemaInspectorTypeViewModel['states'][number]) {
        const style = state.color ? `--state-color:${state.color}` : '';
        return html`<tr>
            <td><span class="state-color" style=${style} aria-hidden="true"></span>${state.name}</td>
            <td>${state.category ?? ''}</td>
        </tr>`;
    }

    private renderFieldRow(field: WorkItemSchemaInspectorFieldViewModel) {
        return html`<tr>
            <td><code>${field.referenceName}</code>${field.alwaysRequired ? html` <span class="pill">required</span>` : nothing}</td>
            <td>${field.name}${field.helpText ? html`<div class="meta">${field.helpText}</div>` : nothing}</td>
            <td><button class="btn btn-secondary copy-btn" @click=${() => this.copyField(field)}>Copy</button></td>
        </tr>`;
    }

    private copyField(field: WorkItemSchemaInspectorFieldViewModel): void {
        this.send({ type: 'copyFieldReferenceName', referenceName: field.referenceName });
    }

    private onFilter = (event: Event): void => {
        this.filter = (event.target as HTMLInputElement).value ?? '';
    };

    private filteredTypes(): WorkItemSchemaInspectorTypeViewModel[] {
        const filter = this.filter.trim().toLowerCase();
        if (!filter) {
            return this.model.types;
        }

        return this.model.types.filter(type => {
            if (this.match(filter, type.name) || this.match(filter, type.referenceName ?? '')) {
                return true;
            }
            if (type.states.some(state => this.match(filter, state.name) || this.match(filter, state.category ?? ''))) {
                return true;
            }
            if (type.fields.some(field => this.match(filter, field.name) || this.match(filter, field.referenceName))) {
                return true;
            }
            return false;
        });
    }

    private match(filter: string, value: string): boolean {
        return value.toLowerCase().includes(filter);
    }

    private processLabel(): string | undefined {
        const template = this.model.processTemplate?.templateName?.trim();
        const version = this.model.processTemplate?.templateVersion?.trim();
        if (!template && !version) {
            return undefined;
        }
        if (template && version) {
            return `${template} (${version})`;
        }
        return template || version;
    }

    private send(message: WorkItemSchemaInspectorMessage): void {
        postMessage(message);
    }
}

customElements.define('ado-work-item-schema-inspector-app', AdoWorkItemSchemaInspectorApp);

