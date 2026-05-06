import { css } from 'lit';

export const baseStyles = css`
    :host {
        display: block;
        min-height: 100vh;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
    }

    .shell {
        padding: 16px;
    }

    h1 {
        margin: 0 0 4px;
        font-size: 1.3em;
        font-weight: 600;
    }

    h2 {
        font-size: 1em;
        border-bottom: 1px solid var(--vscode-panel-border);
        padding-bottom: 4px;
        margin: 0 0 8px;
    }

    .section {
        margin-bottom: 20px;
    }

    .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        flex-wrap: wrap;
        align-items: center;
    }

    button,
    select,
    textarea,
    input {
        font: inherit;
    }

    .btn {
        padding: 4px 10px;
        border-radius: 3px;
        border: 1px solid var(--vscode-button-border, transparent);
        cursor: pointer;
        font-size: 0.85em;
    }

    .btn-primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }

    .btn-primary:hover {
        background: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }

    .btn-secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }

    .btn-link {
        background: transparent;
        border: none;
        color: var(--vscode-textLink-foreground);
        padding: 0;
        cursor: pointer;
        text-align: left;
    }

    .btn-link:hover {
        color: var(--vscode-textLink-activeForeground);
        text-decoration: underline;
    }

    .empty {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
    }

    .meta {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
    }

    .badge {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.8em;
    }

    .reply-input {
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 3px;
        padding: 6px 8px;
        resize: vertical;
        box-sizing: border-box;
    }

    select {
        background: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 3px;
        padding: 3px 22px 3px 6px;
    }

    .check-state {
        font-size: 0.8em;
        min-width: 80px;
        padding: 2px 6px;
        border-radius: 3px;
        text-align: center;
        border: 1px solid;
    }

    .check-success { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
    .check-failure { color: var(--vscode-charts-red); border-color: var(--vscode-charts-red); }
    .check-pending { color: var(--vscode-charts-yellow); border-color: var(--vscode-charts-yellow); }
    .check-neutral { color: var(--vscode-descriptionForeground); border-color: var(--vscode-panel-border); }

    @media (max-width: 720px) {
        .shell {
            padding: 12px;
        }
    }
`;