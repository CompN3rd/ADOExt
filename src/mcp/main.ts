#!/usr/bin/env node
/**
 * Thin wrapper that launches the official Microsoft Azure DevOps MCP server
 * (@azure-devops/mcp) with authentication from the environment.
 *
 * This allows ADOExt to integrate with the official server — updates from
 * Microsoft flow through automatically without local rewrites.
 *
 * Authentication (checked in order):
 *   1. ADO_ACCESS_TOKEN — Bearer/OAuth token (e.g. from the extension's auth session).
 *      Passed to the official server via --authentication envvar / ADO_MCP_AUTH_TOKEN.
 *   2. AZURE_DEVOPS_PAT — Personal access token.
 *      Passed via --authentication pat / PERSONAL_ACCESS_TOKEN.
 *   3. Neither set — Falls back to --authentication interactive (browser-based OAuth).
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

    // Determine authentication method.
    // Priority: bearer token > PAT > interactive (browser)
    const accessToken = process.env.ADO_ACCESS_TOKEN ?? '';
    const pat = process.env.AZURE_DEVOPS_PAT ?? '';

    let authMethod: string;
    const childEnv: Record<string, string | undefined> = { ...process.env };

    if (accessToken) {
        // Use the extension's OAuth/bearer token via the "envvar" method
        authMethod = 'envvar';
        childEnv['ADO_MCP_AUTH_TOKEN'] = accessToken;
    } else if (pat) {
        // Use PAT authentication
        authMethod = 'pat';
        childEnv['PERSONAL_ACCESS_TOKEN'] = pat;
    } else {
        // Fall back to interactive browser-based OAuth (no env vars needed)
        authMethod = 'interactive';
    }

    // Build args for the official @azure-devops/mcp server
    const args: string[] = [
        '-y', '@azure-devops/mcp',
        organization,
        '--authentication', authMethod
    ];

    // Optionally filter domains
    const domains = process.env.ADO_MCP_DOMAINS;
    if (domains) {
        const domainList = domains.split(',').map(d => d.trim()).filter(d => d.length > 0);
        if (domainList.length > 0) {
            args.push('--domains', ...domainList);
        }
    }

    // Resolve npx path — on Windows, .cmd files require shell: true
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

    // Spawn the official server, piping stdio through for MCP protocol
    const child = spawn(npxCmd, args, {
        stdio: 'inherit',
        env: childEnv,
        shell: process.platform === 'win32'
    });

    child.on('error', (err) => {
        process.stderr.write(`Failed to start Azure DevOps MCP server: ${err.message}\n`);
        process.stderr.write('Ensure @azure-devops/mcp is available (npx will download it automatically).\n');
        process.exit(1);
    });

    child.on('exit', (code, signal) => {
        if (signal) {
            process.stderr.write(`Azure DevOps MCP server terminated by signal: ${signal}\n`);
            process.exit(1);
        }
        process.exit(code ?? 0);
    });
}

main();
