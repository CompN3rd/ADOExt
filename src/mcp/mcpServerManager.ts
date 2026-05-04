import * as vscode from 'vscode';
import type { ConfigManager } from '../config/configManager';
import type { AuthProvider } from '../auth/authProvider';

/**
 * Manages MCP server integration within the VS Code extension.
 *
 * Registers as a native VS Code MCP server definition provider so the
 * Azure DevOps MCP server appears in "MCP: List Servers" alongside
 * Azure MCP and Foundry MCP. Delegates to the official Microsoft
 * Azure DevOps MCP server (@azure-devops/mcp).
 */
export class McpServerManager implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private readonly _onDidChange = new vscode.EventEmitter<void>();

    constructor(
        private readonly _config: ConfigManager,
        private readonly _auth: AuthProvider
    ) {}

    /**
     * Register the MCP server definition provider and helper commands.
     */
    register(): void {
        // Register as a native MCP server definition provider so the server
        // shows up in "MCP: List Servers" without any manual mcp.json config.
        this._disposables.push(
            vscode.lm.registerMcpServerDefinitionProvider('adoextMcpProvider', {
                onDidChangeMcpServerDefinitions: this._onDidChange.event,
                provideMcpServerDefinitions: (_token) => this._getServerDefinitions(),
                resolveMcpServerDefinition: async (server, _token) => server
            })
        );

        // Re-emit when configuration changes (organization, auth state)
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('adoext.organization') ||
                    e.affectsConfiguration('adoext.organizations')) {
                    this._onDidChange.fire();
                }
            })
        );

        // Copy a ready-to-paste MCP configuration for .vscode/mcp.json
        this._disposables.push(
            vscode.commands.registerCommand('adoext.getMcpServerConfig', async () => {
                const organization = this._config.organization || '${input:ado_org}';

                let config: object;
                if (this._auth.isSignedIn && this._auth.accessToken) {
                    const choice = await vscode.window.showQuickPick(
                        [
                            { label: 'Interactive (browser login)', description: 'Default — opens browser to authenticate', value: 'interactive' },
                            { label: 'Extension token (env var)', description: 'Set ADO_MCP_AUTH_TOKEN in your environment', value: 'envvar' },
                            { label: 'PAT (env var)', description: 'Set PERSONAL_ACCESS_TOKEN in your environment', value: 'pat' }
                        ],
                        { placeHolder: 'Select authentication method for MCP server' }
                    );

                    if (!choice) {
                        return;
                    }

                    if (choice.value === 'envvar') {
                        config = {
                            servers: {
                                'azure-devops': {
                                    type: 'stdio',
                                    command: 'npx',
                                    args: ['-y', '@azure-devops/mcp', organization, '--authentication', 'envvar'],
                                    env: {
                                        ADO_MCP_AUTH_TOKEN: '${ADO_MCP_AUTH_TOKEN}'
                                    }
                                }
                            }
                        };
                    } else if (choice.value === 'pat') {
                        config = {
                            servers: {
                                'azure-devops': {
                                    type: 'stdio',
                                    command: 'npx',
                                    args: ['-y', '@azure-devops/mcp', organization, '--authentication', 'pat'],
                                    env: {
                                        PERSONAL_ACCESS_TOKEN: '${PERSONAL_ACCESS_TOKEN}'
                                    }
                                }
                            }
                        };
                    } else {
                        config = {
                            servers: {
                                'azure-devops': {
                                    type: 'stdio',
                                    command: 'npx',
                                    args: ['-y', '@azure-devops/mcp', organization]
                                }
                            }
                        };
                    }
                } else {
                    config = {
                        servers: {
                            'azure-devops': {
                                type: 'stdio',
                                command: 'npx',
                                args: ['-y', '@azure-devops/mcp', organization]
                            }
                        }
                    };
                }

                const doc = JSON.stringify(config, null, 2);
                void vscode.env.clipboard.writeText(doc);
                void vscode.window.showInformationMessage(
                    'Azure DevOps MCP server configuration copied to clipboard. ' +
                    'Paste it into your .vscode/mcp.json file.'
                );
            })
        );

        // Show info about the MCP server integration
        this._disposables.push(
            vscode.commands.registerCommand('adoext.showMcpServerInfo', () => {
                const organization = this._config.organization || '<your-org>';
                void vscode.window.showInformationMessage(
                    `ADOExt uses the official Microsoft Azure DevOps MCP server (@azure-devops/mcp).\n` +
                    `Run: npx -y @azure-devops/mcp ${organization}\n` +
                    `Auth: interactive (default), --authentication envvar (ADO_MCP_AUTH_TOKEN), ` +
                    `or --authentication pat (PERSONAL_ACCESS_TOKEN).`
                );
            })
        );
    }

    /**
     * Signal that the server definitions have changed (e.g. after sign-in
     * or org change) so VS Code picks up the new configuration.
     */
    refresh(): void {
        this._onDidChange.fire();
    }

    private _getServerDefinitions(): vscode.McpServerDefinition[] {
        const organizations = this._config.selectedOrganizations;
        if (organizations.length === 0) {
            return [];
        }

        return organizations.map(org => {
            const args = ['-y', '@azure-devops/mcp', org];
            const env: Record<string, string> = {};

            if (this._auth.isSignedIn && this._auth.accessToken) {
                args.push('--authentication', 'envvar');
                env['ADO_MCP_AUTH_TOKEN'] = this._auth.accessToken;
            }

            const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
            const label = organizations.length > 1
                ? `Azure DevOps (${org})`
                : 'Azure DevOps';

            return new vscode.McpStdioServerDefinition(label, npxCmd, args, env);
        });
    }

    dispose(): void {
        this._onDidChange.dispose();
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }
}
