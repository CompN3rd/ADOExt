import * as vscode from 'vscode';
import type { AdoClient, WorkItemProcessSchemaInfo } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { showErrorMessage, showInformationMessage, showWarningMessage } from '../utils/notifications';
import { buildWebviewDocument, buildMessageDocument, webviewAssetRoots } from './webviewHtml';
import type { WorkItemSchemaInspectorMessage, WorkItemSchemaInspectorViewModel } from './webviewTypes';

export interface WorkItemSchemaInspectorScope {
    organization: string;
    project: string;
}

export class WorkItemSchemaInspectorPanel {
    private static _panels = new Map<string, WorkItemSchemaInspectorPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _panelKey: string;
    private _disposables: vscode.Disposable[] = [];

    static async show(
        context: vscode.ExtensionContext,
        client: AdoClient,
        config: ConfigManager,
        scope: WorkItemSchemaInspectorScope
    ): Promise<void> {
        const key = WorkItemSchemaInspectorPanel.panelKey(scope);
        const existing = WorkItemSchemaInspectorPanel._panels.get(key);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            await existing._refresh(client, config, scope);
            return;
        }
        new WorkItemSchemaInspectorPanel(context, client, config, scope, key);
    }

    private static panelKey(scope: WorkItemSchemaInspectorScope): string {
        return `${scope.organization}\u0000${scope.project}`;
    }

    private constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _client: AdoClient,
        private readonly _config: ConfigManager,
        private _scope: WorkItemSchemaInspectorScope,
        panelKey: string
    ) {
        this._panelKey = panelKey;
        this._panel = vscode.window.createWebviewPanel(
            'adoext.workItemSchemaInspector',
            `Work Item Process Inspector: ${_scope.organization}/${_scope.project}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: webviewAssetRoots(_context)
            }
        );

        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (msg) => this._handleMessage(msg),
            null,
            this._disposables
        );

        WorkItemSchemaInspectorPanel._panels.set(panelKey, this);
        void this._refresh(this._client, this._config, this._scope);
    }

    private async _handleMessage(msg: WorkItemSchemaInspectorMessage): Promise<void> {
        if (msg.type === 'refresh') {
            await this._refresh(this._client, this._config, this._scope);
            return;
        }

        if (msg.type === 'openProcessSettings') {
            const url = `https://dev.azure.com/${this._scope.organization}/_settings/process`;
            void vscode.env.openExternal(vscode.Uri.parse(url));
            return;
        }

        if (msg.type === 'copyFieldReferenceName') {
            const ref = (msg.referenceName ?? '').trim();
            if (!ref) { return; }
            await vscode.env.clipboard.writeText(ref);
            showInformationMessage(`Copied field reference name: ${ref}`);
            return;
        }

        if (msg.type === 'copyDiagnosticSummary') {
            const summary = await this._buildDiagnosticSummary();
            await vscode.env.clipboard.writeText(summary);
            showInformationMessage('Copied process/schema diagnostic summary to clipboard.');
            return;
        }
    }

    private async _buildDiagnosticSummary(): Promise<string> {
        const organization = this._scope.organization;
        const project = this._scope.project;
        let schema: WorkItemProcessSchemaInfo | undefined;
        try {
            schema = await this._client.getWorkItemProcessSchema(project, organization);
        } catch (err) {
            return JSON.stringify({
                organization,
                project,
                error: this._formatError(err)
            }, null, 2);
        }

        return JSON.stringify({
            organization,
            project,
            processTemplate: schema.processTemplate ?? null,
            fetchedAt: new Date().toISOString(),
            typeCount: schema.types.length,
            warnings: schema.warnings,
            types: schema.types.map(type => ({
                name: type.name,
                referenceName: type.referenceName ?? null,
                color: type.color ?? null,
                iconUrl: type.iconUrl ?? null,
                stateCount: type.states.length,
                fieldCount: type.fields.length,
                states: type.states.map(state => ({
                    name: state.name,
                    category: state.category ?? null,
                    color: state.color ?? null
                })),
                fields: type.fields.map(field => ({
                    referenceName: field.referenceName,
                    name: field.name,
                    alwaysRequired: field.alwaysRequired,
                    helpText: field.helpText ?? null
                }))
            }))
        }, null, 2);
    }

    private async _refresh(
        client: AdoClient,
        _config: ConfigManager,
        scope: WorkItemSchemaInspectorScope
    ): Promise<void> {
        this._scope = scope;
        this._panel.title = `Work Item Process Inspector: ${scope.organization}/${scope.project}`;
        const { organization, project } = scope;

        if (!organization || !project) {
            this._panel.webview.html = buildMessageDocument(this._panel.webview, 'Select an organization and project first.');
            return;
        }

        let schema: WorkItemProcessSchemaInfo;
        try {
            schema = await client.getWorkItemProcessSchema(project, organization);
        } catch (err) {
            showErrorMessage(`Failed to load work item process schema: ${this._formatError(err)}`);
            this._panel.webview.html = buildMessageDocument(this._panel.webview, 'Failed to load work item schema. See the ADOExt output for details.');
            return;
        }

        if (schema.warnings.length) {
            showWarningMessage(`Work item schema loaded with warnings (${schema.warnings.length}).`);
        }

        const model: WorkItemSchemaInspectorViewModel = {
            organization,
            project,
            fetchedAt: new Date().toLocaleString(),
            processTemplate: schema.processTemplate
                ? {
                    templateName: schema.processTemplate.templateName,
                    templateTypeId: schema.processTemplate.templateTypeId,
                    templateVersion: schema.processTemplate.templateVersion
                }
                : undefined,
            warnings: schema.warnings,
            types: schema.types.map(type => ({
                name: type.name,
                referenceName: type.referenceName,
                color: this._sanitizeHexColor(type.color),
                iconUrl: this._sanitizeIconUrl(type.iconUrl),
                stateCount: type.states.length,
                fieldCount: type.fields.length,
                states: type.states
                    .map(state => ({
                        name: state.name,
                        category: state.category,
                        color: this._sanitizeHexColor(state.color)
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name)),
                fields: type.fields
                    .map(field => ({
                        name: field.name,
                        referenceName: field.referenceName,
                        alwaysRequired: field.alwaysRequired,
                        helpText: field.helpText
                    }))
                    .sort((a, b) => a.referenceName.localeCompare(b.referenceName))
            }))
        };

        this._panel.webview.html = this._buildHtml(model);
    }

    private _buildHtml(model: WorkItemSchemaInspectorViewModel): string {
        return buildWebviewDocument(this._context, this._panel.webview, {
            title: `Work Item Process Inspector`,
            entry: 'workItemSchemaInspector.js',
            appTag: 'ado-work-item-schema-inspector-app',
            data: model
        });
    }

    private _sanitizeIconUrl(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }
        try {
            const uri = vscode.Uri.parse(value);
            return uri.scheme === 'https' ? uri.toString(true) : undefined;
        } catch {
            return undefined;
        }
    }

    private _sanitizeHexColor(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }
        const raw = value.trim();
        const withHash = raw.startsWith('#') ? raw : `#${raw}`;
        if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) {
            return undefined;
        }
        return withHash.toLowerCase();
    }

    private _formatError(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }

    private _dispose(): void {
        WorkItemSchemaInspectorPanel._panels.delete(this._panelKey);
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables = [];
    }
}

