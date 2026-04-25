import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import type { AuthProvider } from '../auth/authProvider';

/**
 * Prompt the user to select an ADO organization from the list of organizations
 * the signed-in account belongs to.  If the list cannot be fetched (e.g. API
 * limitations in some tenants), the user is offered a free-text input instead.
 */
export async function selectOrganization(
    client: AdoClient,
    config: ConfigManager,
    auth: AuthProvider
): Promise<boolean> {
    if (!auth.isSignedIn) {
        const signedIn = await auth.signIn();
        if (!signedIn) { return false; }
    }

    // Try to auto-discover organizations; fall back to manual entry
    let orgName: string | undefined;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Fetching organizations…' },
        async () => {
            try {
                const orgs = await client.listOrganizations();
                if (orgs.length > 0) {
                    const picked = await vscode.window.showQuickPick(
                        orgs.map(o => ({
                            label: o.accountName,
                            detail: o.accountUri
                        })),
                        { placeHolder: 'Select an Azure DevOps organization', title: 'Azure DevOps Organizations' }
                    );
                    orgName = picked?.label;
                }
            } catch {
                // fallthrough to manual entry
            }
        }
    );

    if (orgName === undefined) {
        orgName = await vscode.window.showInputBox({
            prompt: 'Enter your Azure DevOps organization name',
            placeHolder: 'e.g. mycompany (for https://dev.azure.com/mycompany)',
            value: config.organization
        });
    }

    if (!orgName) { return false; }

    await config.setOrganization(orgName);
    client.connect(orgName);

    // Immediately prompt for project selection
    return selectProject(client, config);
}

/**
 * Prompt the user to select a project within the current organization.
 */
export async function selectProject(
    client: AdoClient,
    config: ConfigManager
): Promise<boolean> {
    let projectName: string | undefined;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Fetching projects…' },
        async () => {
            try {
                const projects = await client.listProjects();
                if (projects.length > 0) {
                    const picked = await vscode.window.showQuickPick(
                        projects.map(p => ({
                            label: p.name ?? '',
                            detail: p.description ?? ''
                        })),
                        { placeHolder: 'Select a project', title: 'Azure DevOps Projects' }
                    );
                    projectName = picked?.label;
                }
            } catch {
                // fallthrough
            }
        }
    );

    if (projectName === undefined) {
        projectName = await vscode.window.showInputBox({
            prompt: 'Enter the Azure DevOps project name',
            value: config.project
        });
    }

    if (!projectName) { return false; }

    await config.setProject(projectName);
    return true;
}
