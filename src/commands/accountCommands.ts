import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import { ALL_PROJECTS, type ConfigManager, type ProjectSelectionsByOrganization } from '../config/configManager';
import type { AuthProvider } from '../auth/authProvider';
import { showWarningMessage } from '../utils/notifications';

interface OrganizationPickItem extends vscode.QuickPickItem {
    organization?: string;
    all?: boolean;
}

interface ProjectPickItem extends vscode.QuickPickItem {
    project?: string;
    all?: boolean;
}

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
        if (auth.accessToken) {
            client.updateToken(auth.accessToken);
        }
    }

    let selectedOrganizations: string[] | undefined;
    let discoveredOrganizations: { accountName: string; accountUri: string }[] = [];

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Fetching organizations…' },
        async () => {
            try {
                discoveredOrganizations = await client.listOrganizations();
            } catch {
                // fallthrough to manual entry
            }
        }
    );

    if (discoveredOrganizations.length > 0) {
        const picked = await vscode.window.showQuickPick<OrganizationPickItem>(
            [
                {
                    label: 'All organizations',
                    description: 'Aggregate every listed organization',
                    all: true
                },
                ...discoveredOrganizations.map(o => ({
                    label: o.accountName,
                    detail: o.accountUri,
                    organization: o.accountName,
                    picked: config.selectedOrganizations.includes(o.accountName)
                }))
            ],
            {
                canPickMany: true,
                placeHolder: 'Select Azure DevOps organizations to aggregate',
                title: 'Azure DevOps Organizations'
            }
        );

        if (picked) {
            selectedOrganizations = picked.some(item => item.all)
                ? discoveredOrganizations.map(o => o.accountName)
                : picked.flatMap(item => item.organization ? [item.organization] : []);
        }
    }

    if (selectedOrganizations === undefined) {
        const orgNames = await vscode.window.showInputBox({
            prompt: 'Enter Azure DevOps organization names, separated by commas',
            placeHolder: 'e.g. mycompany, secondcompany',
            value: config.selectedOrganizations.join(', ') || config.organization
        });
        selectedOrganizations = orgNames?.split(',').map(value => value.trim()).filter(Boolean);
    }

    if (!selectedOrganizations || selectedOrganizations.length === 0) { return false; }

    await config.setSelectedOrganizations(selectedOrganizations);
    client.connect(selectedOrganizations[0]);

    // Immediately prompt for project selection
    return selectProject(client, config, selectedOrganizations);
}

/**
 * Prompt the user to select projects within each selected organization.
 */
export async function selectProject(
    client: AdoClient,
    config: ConfigManager,
    organizations: string[] = config.selectedOrganizations
): Promise<boolean> {
    if (organizations.length === 0) {
        showWarningMessage('Select at least one organization first.');
        return false;
    }

    const selections: ProjectSelectionsByOrganization = {
        ...config.projectsByOrganization
    };

    for (const organization of organizations) {
        let selectedProjects: string[] | undefined;
        let projects: { name?: string; description?: string }[] = [];

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Fetching projects for ${organization}…` },
            async () => {
                try {
                    projects = await client.listProjects(organization);
                } catch {
                    // fallthrough
                }
            }
        );

        if (projects.length > 0) {
            const existingSelection = config.getProjectSelection(organization);
            const picked = await vscode.window.showQuickPick<ProjectPickItem>(
                [
                    {
                        label: 'All projects',
                        description: `Aggregate every project in ${organization}`,
                        all: true,
                        picked: existingSelection.includes(ALL_PROJECTS)
                    },
                    ...projects.map(p => ({
                        label: p.name ?? '',
                        detail: p.description ?? '',
                        project: p.name,
                        picked: p.name !== undefined && existingSelection.includes(p.name)
                    }))
                ],
                {
                    canPickMany: true,
                    placeHolder: `Select projects to aggregate from ${organization}`,
                    title: `Azure DevOps Projects: ${organization}`
                }
            );

            if (picked) {
                selectedProjects = picked.some(item => item.all)
                    ? [ALL_PROJECTS]
                    : picked.flatMap(item => item.project ? [item.project] : []);
            }
        }

        if (selectedProjects === undefined) {
            const manualProjects = await vscode.window.showInputBox({
                prompt: `Enter project names for ${organization}, separated by commas`,
                placeHolder: 'Use all or * to aggregate every project',
                value: config.getProjectSelection(organization).join(', ') || config.project
            });
            selectedProjects = manualProjects
                ?.split(',')
                .map(value => value.trim())
                .filter(Boolean)
                .map(value => value.toLowerCase() === 'all' ? ALL_PROJECTS : value);
        }

        if (!selectedProjects || selectedProjects.length === 0) { return false; }
        selections[organization] = selectedProjects;
    }

    await config.setProjectSelections(selections);
    return true;
}
