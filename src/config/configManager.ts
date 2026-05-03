import * as vscode from 'vscode';

export const ALL_PROJECTS = '*';

export type ProjectSelectionsByOrganization = Record<string, string[]>;

/**
 * Centralises all reads and writes to the extension's VS Code configuration.
 * Settings are stored under the "adoext" namespace in workspace/user settings.
 */
export class ConfigManager {
    private get config(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration('adoext');
    }

    get organization(): string {
        return this.config.get<string>('organization', '');
    }

    async setOrganization(value: string): Promise<void> {
        await this.config.update('organization', value, vscode.ConfigurationTarget.Global);
    }

    get selectedOrganizations(): string[] {
        const organizations = this.config.get<string[]>('organizations', []);
        const normalized = this.normalizeList(organizations);
        if (normalized.length > 0) {
            return normalized;
        }

        return this.organization.trim() ? [this.organization.trim()] : [];
    }

    async setSelectedOrganizations(values: string[]): Promise<void> {
        const organizations = this.normalizeList(values);
        await this.config.update('organizations', organizations, vscode.ConfigurationTarget.Global);
        await this.config.update('organization', organizations[0] ?? '', vscode.ConfigurationTarget.Global);
    }

    get project(): string {
        return this.config.get<string>('project', '');
    }

    async setProject(value: string): Promise<void> {
        await this.config.update('project', value, vscode.ConfigurationTarget.Global);
    }

    get projectsByOrganization(): ProjectSelectionsByOrganization {
        return this.config.get<ProjectSelectionsByOrganization>('projectsByOrganization', {});
    }

    getProjectSelection(organization: string): string[] {
        const selections = this.projectsByOrganization;
        const configured = this.normalizeList(selections[organization] ?? []);
        if (configured.length > 0) {
            return configured;
        }

        if (organization === this.organization && this.project.trim()) {
            return [this.project.trim()];
        }

        return [];
    }

    async setProjectSelections(selections: ProjectSelectionsByOrganization): Promise<void> {
        const normalized: ProjectSelectionsByOrganization = {};
        let firstProject = '';

        for (const [organization, projects] of Object.entries(selections)) {
            const organizationName = organization.trim();
            const normalizedProjects = this.normalizeList(projects);
            if (!organizationName || normalizedProjects.length === 0) {
                continue;
            }

            normalized[organizationName] = normalizedProjects;
            const concreteProject = normalizedProjects.find(project => project !== ALL_PROJECTS);
            if (!firstProject && concreteProject) {
                firstProject = concreteProject;
            }
        }

        await this.config.update('projectsByOrganization', normalized, vscode.ConfigurationTarget.Global);
        await this.config.update('project', firstProject, vscode.ConfigurationTarget.Global);
    }

    get workItemQuery(): 'assigned' | 'created' | 'mentioned' | 'all' {
        return this.config.get<'assigned' | 'created' | 'mentioned' | 'all'>(
            'workItemQuery',
            'assigned'
        );
    }

    get pullRequestFilter(): 'mine' | 'created' | 'assigned' | 'all' {
        return this.config.get<'mine' | 'created' | 'assigned' | 'all'>(
            'pullRequestFilter',
            'mine'
        );
    }

    /** Whether to show a small toast when new comments appear on tracked PRs. */
    get notifyOnNewPullRequestComments(): boolean {
        return this.config.get<boolean>('notifyOnNewPullRequestComments', true);
    }

    /** Poll interval for the new-comment notifier, in seconds (minimum 60). */
    get pullRequestCommentPollIntervalSeconds(): number {
        const raw = this.config.get<number>('pullRequestCommentPollIntervalSeconds', 300);
        return Math.max(60, Math.floor(raw));
    }

    /** Returns true if both organization and project are configured. */
    get isConfigured(): boolean {
        const organizations = this.selectedOrganizations;
        return organizations.length > 0 && organizations.some(org => this.getProjectSelection(org).length > 0);
    }

    private normalizeList(values: readonly string[]): string[] {
        const seen = new Set<string>();
        const normalized: string[] = [];
        for (const raw of values) {
            const value = raw.trim();
            if (!value || seen.has(value)) {
                continue;
            }
            seen.add(value);
            normalized.push(value);
        }
        return normalized;
    }
}
