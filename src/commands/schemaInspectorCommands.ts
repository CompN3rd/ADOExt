import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { resolveProjectScopes, scopeLabel, type ProjectScope } from '../providers/projectScopes';
import { showInformationMessage } from '../utils/notifications';
import { WorkItemSchemaInspectorPanel } from '../views/workItemSchemaInspectorPanel';

export async function openWorkItemSchemaInspector(
    context: vscode.ExtensionContext,
    client: AdoClient,
    config: ConfigManager
): Promise<void> {
    const scopes = await resolveProjectScopes(client, config);
    if (scopes.length === 0) {
        showInformationMessage('Select an organization and project first (ADOExt: Select Organization / Select Project).');
        return;
    }

    const scope = await pickScope(scopes);
    if (!scope) {
        return;
    }

    await WorkItemSchemaInspectorPanel.show(context, client, config, scope);
}

async function pickScope(scopes: ProjectScope[]): Promise<ProjectScope | undefined> {
    if (scopes.length === 1) {
        return scopes[0];
    }

    const choice = await vscode.window.showQuickPick(
        scopes.map(scope => ({
            label: scopeLabel(scope),
            scope
        })),
        { placeHolder: 'Select a project scope to inspect' }
    );
    return choice?.scope;
}

