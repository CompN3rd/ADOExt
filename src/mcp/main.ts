#!/usr/bin/env node
/**
 * Thin wrapper that launches the official Microsoft Azure DevOps MCP server
 * (@azure-devops/mcp) with authentication from the environment.
 *
 * This allows ADOExt to integrate with the official server — updates from
 * Microsoft flow through automatically without local rewrites.
 *
 * Authentication:
 *   Set AZURE_DEVOPS_PAT with a personal access token.
 *
 * Required environment variables:
 *   ADO_ORGANIZATION - The Azure DevOps organization name
 *
 * Optional environment variables:
 *   ADO_MCP_DOMAINS  - Comma-separated list of domains to enable (default: all)
 *
 * Usage:
 *   node out/mcp/main.js
 */
import { spawn } from 'child_process';

function main(): void {
    const organization = process.env.ADO_ORGANIZATION ?? '';
    if (!organization) {
        process.stderr.write(
            'Error: No organization provided.\n' +
            'Set ADO_ORGANIZATION environment variable.\n'
        );
        process.exit(1);
    }

    const pat = process.env.AZURE_DEVOPS_PAT ?? '';
    if (!pat) {
        process.stderr.write(
            'Error: No authentication token provided.\n' +
            'Set AZURE_DEVOPS_PAT environment variable.\n'
        );
        process.exit(1);
    }

    // Build args for the official @azure-devops/mcp server
    const args: string[] = [
        '-y', '@azure-devops/mcp',
        organization,
        '--authentication', 'pat'
    ];

    // Optionally filter domains
    const domains = process.env.ADO_MCP_DOMAINS;
    if (domains) {
        args.push('--domains', ...domains.split(',').map(d => d.trim()));
    }

    // Resolve npx path
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

    // Spawn the official server, piping stdio through for MCP protocol
    const child = spawn(npxCmd, args, {
        stdio: 'inherit',
        env: {
            ...process.env,
            // The official server reads PAT via AZURE_DEVOPS_PAT env var
            AZURE_DEVOPS_PAT: pat
        }
    });

    child.on('error', (err) => {
        process.stderr.write(`Failed to start Azure DevOps MCP server: ${err.message}\n`);
        process.stderr.write('Ensure @azure-devops/mcp is available (npx will download it automatically).\n');
        process.exit(1);
    });

    child.on('exit', (code) => {
        process.exit(code ?? 0);
    });
}

main();
