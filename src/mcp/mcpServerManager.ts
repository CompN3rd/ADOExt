import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import type { AuthProvider } from '../auth/authProvider';

/**
 * Manages MCP server integration within the VS Code extension.
 *
 * Delegates to the official Microsoft Azure DevOps MCP server
 * (@azure-devops/mcp) so that updates from Microsoft flow through
 * automatically. ADOExt provides convenience commands for configuration
 * and shares auth context via environment variables.
 */
export class McpServerManager implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _client: AdoClient,
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
            vscode.commands.registerCommand('adoext.getMcpServerConfig', () => {
                const organization = this._config.organization || '${input:ado_org}';
                const config = {
                    servers: {
                        'azure-devops': {
                            type: 'stdio',
                            command: 'npx',
                            args: ['-y', '@azure-devops/mcp', organization, '--authentication', 'pat'],
                            env: {
                                AZURE_DEVOPS_PAT: '${AZURE_DEVOPS_PAT}'
                            }
                        }
                    }
                };
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
            vscode.commands.registerCommand('adoext.startMcpServer', () => {
                const organization = this._config.organization || '<your-org>';
                void vscode.window.showInformationMessage(
                    `ADOExt uses the official Microsoft Azure DevOps MCP server (@azure-devops/mcp).\n` +
                    `Run: npx -y @azure-devops/mcp ${organization} --authentication pat\n` +
                    `Set AZURE_DEVOPS_PAT in your environment for authentication.`
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
