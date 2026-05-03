#!/usr/bin/env node
/**
 * Standalone MCP server entry point for ADOExt.
 *
 * This can be launched by any MCP-compatible client (e.g. VS Code, Claude Desktop)
 * via stdio transport. It shares the same Azure DevOps tool implementations as the
 * VS Code extension.
 *
 * Authentication:
 *   Set the AZURE_DEVOPS_PAT environment variable with a personal access token, or
 *   set ADO_ACCESS_TOKEN with an OAuth/bearer token.
 *
 * Optional environment variables:
 *   ADO_ORGANIZATION - Default organization name
 *
 * Usage:
 *   node out/mcp/main.js
 */
import { AdoClient } from '../api/adoClient';
import { createMcpServer } from './mcpServer';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js') as {
    StdioServerTransport: new () => unknown;
};

async function main(): Promise<void> {
    const token = process.env.AZURE_DEVOPS_PAT ?? process.env.ADO_ACCESS_TOKEN ?? '';

    if (!token) {
        process.stderr.write(
            'Error: No authentication token provided.\n' +
            'Set AZURE_DEVOPS_PAT or ADO_ACCESS_TOKEN environment variable.\n'
        );
        process.exit(1);
    }

    const client = new AdoClient(token);

    const organization = process.env.ADO_ORGANIZATION;
    if (organization) {
        client.connect(organization);
    }

    const mcpServer = createMcpServer(client);
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
}

main().catch(err => {
    process.stderr.write(`Fatal error: ${err}\n`);
    process.exit(1);
});
