import { LitElement, css, html, nothing, type PropertyDeclarations } from 'lit';
import type { BuildSummaryViewModel } from '../webviewTypes';

class AdoBuildList extends LitElement {
    static properties: PropertyDeclarations = {
        builds: {
            attribute: 'builds-json',
            converter: {
                fromAttribute(value: string | null): BuildSummaryViewModel[] {
                    if (!value) {
                        return [];
                    }

                    try {
                        const parsed = JSON.parse(value);
                        return Array.isArray(parsed) ? parsed : [];
                    } catch {
                        return [];
                    }
                }
            }
        },
        emptyLabel: { attribute: 'empty-label' }
    };

    static styles = css`
        :host {
            display: block;
        }

        .empty {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .build-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 10px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            margin-bottom: 6px;
        }

        .build-status {
            font-size: 0.8em;
            font-weight: 600;
            padding: 2px 7px;
            border-radius: 10px;
            white-space: nowrap;
        }

        .build-status-succeeded {
            background: var(--vscode-charts-green);
            color: #fff;
        }

        .build-status-failed {
            background: var(--vscode-charts-red);
            color: #fff;
        }

        .build-status-inprogress {
            background: var(--vscode-charts-blue);
            color: #fff;
        }

        .build-status-other {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        .build-name {
            flex: 1;
            min-width: 120px;
            font-size: 0.9em;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .build-meta {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        button {
            padding: 4px 10px;
            border-radius: 3px;
            border: 1px solid var(--vscode-button-border, transparent);
            cursor: pointer;
            font-family: var(--vscode-font-family);
            font-size: 0.85em;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        @media (max-width: 520px) {
            .build-item {
                align-items: flex-start;
                flex-direction: column;
                gap: 6px;
            }

            .build-name,
            .build-meta {
                min-width: 0;
                max-width: 100%;
                white-space: normal;
            }
        }
    `;

    builds: BuildSummaryViewModel[] = [];
    emptyLabel = 'No builds found.';

    render() {
        if (this.builds.length === 0) {
            return html`<p class="empty">${this.emptyLabel}</p>`;
        }

        return html`${this.builds.map(build => this.renderBuild(build))}`;
    }

    private renderBuild(build: BuildSummaryViewModel) {
        const metaParts = [build.definitionName, build.requestedFor, build.startTime].filter(Boolean);
        const statusClass = this.statusClass(build.statusKind);

        return html`<div class="build-item">
            <span class="build-status ${statusClass}">${build.statusLabel}</span>
            <span class="build-name" title=${build.buildNumber}>${build.buildNumber}</span>
            ${metaParts.length > 0
                ? html`<span class="build-meta" title=${metaParts.join(' - ')}>${metaParts.join(' - ')}</span>`
                : nothing}
            ${build.id > 0
                ? html`<button type="button" @click=${() => this.openBuild(build.id)}>Open</button>`
                : nothing}
        </div>`;
    }

    private statusClass(statusKind: BuildSummaryViewModel['statusKind']): string {
        switch (statusKind) {
            case 'succeeded':
                return 'build-status-succeeded';
            case 'failed':
                return 'build-status-failed';
            case 'inprogress':
                return 'build-status-inprogress';
            default:
                return 'build-status-other';
        }
    }

    private openBuild(buildId: number): void {
        this.dispatchEvent(new CustomEvent('adoext-open-build', {
            bubbles: true,
            composed: true,
            detail: { buildId }
        }));
    }
}

customElements.define('ado-build-list', AdoBuildList);