import * as vscode from 'vscode';
import type { ConfigManager } from '../config/configManager';
import type { AuthProvider } from '../auth/authProvider';

/**
 * Manages MCP server integration within the VS Code extension.
 *
 * Delegates to the official Microsoft Azure DevOps MCP server
 * (@azure-devops/mcp) so that updates from Microsoft flow through
 * automatically. ADOExt provides convenience commands for configuration
 * and can pass the extension's OAuth token for seamless auth.
 */
export class McpServerManager implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _config: ConfigManager,
        private readonly _auth: AuthProvider
    ) {}

    /**
     * Register commands that help the user configure the official
     * Azure DevOps MCP server with their current ADOExt credentials.
     */
    register(): void {
        // Copy a ready-to-paste MCP configuration for .vscode/mcp.json
        this._disposables.push(
            vscode.commands.registerCommand('adoext.getMcpServerConfig', async () => {
                const organization = this._config.organization || '${input:ado_org}';

                // If the user is signed in, offer to use the extension's token
                // Otherwise default to interactive (browser-based) auth
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
                        return; // User cancelled
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
                        // interactive (default)
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
                    // Not signed in — use interactive auth (browser-based OAuth, no PAT needed)
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

    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }
}
