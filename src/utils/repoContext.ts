import * as vscode from 'vscode';

export interface RepoContext {
    organization: string;
    project: string;
    repository: string;
    remoteUrl: string;
}

/**
 * Parses an Azure DevOps remote URL and extracts org/project/repo components.
 *
 * Supported formats:
 *  - HTTPS: https://dev.azure.com/{org}/{project}/_git/{repo}
 *  - HTTPS: https://{org}.visualstudio.com/{project}/_git/{repo}
 *  - HTTPS: https://{org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}
 *  - SSH:   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 *  - SSH:   ssh://{org}@vs-ssh.visualstudio.com:22/v3/{org}/{project}/{repo}  (legacy)
 */
export function parseAdoRemoteUrl(url: string): RepoContext | undefined {
    if (!url) { return undefined; }

    // HTTPS: https://dev.azure.com/{org}/{project}/_git/{repo}
    const devAzureMatch = url.match(
        /^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?\s]+?)(?:\.git)?(?:\s|$)/i
    );
    if (devAzureMatch) {
        return {
            organization: decodeURIComponent(devAzureMatch[1]),
            project: decodeURIComponent(devAzureMatch[2]),
            repository: decodeURIComponent(devAzureMatch[3]),
            remoteUrl: url
        };
    }

    // HTTPS: https://{org}.visualstudio.com/{project}/_git/{repo}
    //     or https://{org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}
    const vscomMatch = url.match(
        /^https?:\/\/([^.]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?\s]+?)(?:\.git)?(?:\s|$)/i
    );
    if (vscomMatch) {
        return {
            organization: decodeURIComponent(vscomMatch[1]),
            project: decodeURIComponent(vscomMatch[2]),
            repository: decodeURIComponent(vscomMatch[3]),
            remoteUrl: url
        };
    }

    // SSH: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
    const sshMatch = url.match(
        /^git@ssh\.dev\.azure\.com(?::\d+)?:v3\/([^/]+)\/([^/]+)\/([^/\s]+?)(?:\.git)?(?:\s|$)/i
    );
    if (sshMatch) {
        return {
            organization: decodeURIComponent(sshMatch[1]),
            project: decodeURIComponent(sshMatch[2]),
            repository: decodeURIComponent(sshMatch[3]),
            remoteUrl: url
        };
    }

    // SSH: ssh://{org}@vs-ssh.visualstudio.com:22/v3/{org}/{project}/{repo}
    const legacySshMatch = url.match(
        /^ssh:\/\/([^@]+)@vs-ssh\.visualstudio\.com(?::\d+)?\/v3\/([^/]+)\/([^/]+)\/([^/\s]+?)(?:\.git)?(?:\s|$)/i
    );
    if (legacySshMatch) {
        return {
            organization: decodeURIComponent(legacySshMatch[1]),
            project: decodeURIComponent(legacySshMatch[3]),
            repository: decodeURIComponent(legacySshMatch[4]),
            remoteUrl: url
        };
    }

    return undefined;
}

interface GitRemote {
    name: string;
    fetchUrl?: string;
    pushUrl?: string;
}

interface GitRepository {
    rootUri: vscode.Uri;
    state: { remotes: GitRemote[] };
}

interface GitExtension {
    getAPI(version: 1): { repositories: GitRepository[] };
}

async function getGitApi(): Promise<{ repositories: GitRepository[] } | undefined> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
        return undefined;
    }

    const git = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();
    return git?.getAPI(1);
}

/**
 * Inspects all Git repositories in the current workspace and returns any
 * Azure DevOps contexts discovered from their remote URLs.
 */
export async function detectAdoRepoContexts(): Promise<RepoContext[]> {
    const gitApi = await getGitApi();
    if (!gitApi) {
        return [];
    }

    const contexts: RepoContext[] = [];
    const seen = new Set<string>();

    for (const repo of gitApi.repositories) {
        for (const remote of repo.state.remotes) {
            const url = remote.fetchUrl ?? remote.pushUrl ?? '';
            if (!url) { continue; }
            const ctx = parseAdoRemoteUrl(url);
            if (!ctx) { continue; }
            const key = `${ctx.organization}\u0000${ctx.project}\u0000${ctx.repository}`;
            if (seen.has(key)) { continue; }
            seen.add(key);
            contexts.push(ctx);
        }
    }

    return contexts;
}
