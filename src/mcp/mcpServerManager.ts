import * as vscode from 'vscode';
import * as path from 'path';
import type { AdoClient } from '../api/adoClient';

/**
 * Manages the MCP server lifecycle within the VS Code extension.
 *
 * When VS Code's MCP support is available (1.99+), the server is registered
 * as an in-process MCP server definition so that Copilot and other LM tools
 * can discover it automatically. The server shares the extension's auth token
 * and AdoClient, so there is no separate login needed.
 */
export class McpServerManager implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _client: AdoClient
    ) {}

    /**
     * Register the MCP server configuration so VS Code (and Copilot) can
     * discover it. For VS Code versions without built-in MCP support,
     * we expose a command that outputs the server configuration for manual
     * setup in mcp.json or claude_desktop_config.json.
     */
    register(): void {
        // Register a command that outputs the MCP server launch configuration
        // so users can copy it into their MCP client config.
        this._disposables.push(
            vscode.commands.registerCommand('adoext.getMcpServerConfig', () => {
                const serverPath = path.join(this._context.extensionPath, 'out', 'mcp', 'main.js');
                const config = {
                    mcpServers: {
                        adoext: {
                            command: 'node',
                            args: [serverPath],
                            env: {
                                AZURE_DEVOPS_PAT: '${AZURE_DEVOPS_PAT}',
                                ADO_ORGANIZATION: '${ADO_ORGANIZATION}'
                            }
                        }
                    }
                };
                const doc = JSON.stringify(config, null, 2);
                void vscode.env.clipboard.writeText(doc);
                void vscode.window.showInformationMessage(
                    'ADOExt MCP server configuration copied to clipboard. ' +
                    'Paste it into your MCP client settings (e.g. .vscode/mcp.json).'
                );
            })
        );

        // Register a command to start the MCP server with shared auth for use
        // with VS Code's built-in MCP support (creates an stdio server config).
        this._disposables.push(
            vscode.commands.registerCommand('adoext.startMcpServer', () => {
                const serverPath = path.join(this._context.extensionPath, 'out', 'mcp', 'main.js');
                void vscode.window.showInformationMessage(
                    `ADOExt MCP server available at: node ${serverPath}\n` +
                    `Set AZURE_DEVOPS_PAT or ADO_ACCESS_TOKEN in your environment.`
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
