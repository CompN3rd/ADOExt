import * as vscode from 'vscode';

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

    get project(): string {
        return this.config.get<string>('project', '');
    }

    async setProject(value: string): Promise<void> {
        await this.config.update('project', value, vscode.ConfigurationTarget.Global);
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

    /** Returns true if both organization and project are configured. */
    get isConfigured(): boolean {
        return this.organization.trim() !== '' && this.project.trim() !== '';
    }
}
