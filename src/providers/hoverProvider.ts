import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { resolveProjectScopes } from './projectScopes';

// ---------------------------------------------------------------------------
// Regex patterns for recognizing Azure DevOps references
// ---------------------------------------------------------------------------

/**
 * Matches Azure Boards work item references:
 * - `AB#123`   – canonical Azure Boards commit-message pattern
 * - `#123`     – short-form used in PR descriptions and comments
 *
 * The leading word-boundary makes sure that plain numbers (e.g. "line 123")
 * are not matched, while the look-ahead prevents double-matching inside
 * `AB#123` when the generic `#123` pattern runs last.
 */
export const WORK_ITEM_PATTERNS: RegExp[] = [
    /\bAB#(\d+)\b/g,
    /(?<!\w)#(\d+)\b/g
];

/**
 * Matches pull request references:
 * - `PR #123`  – common English form
 * - `PR!123`   – compact form
 * - `!123`     – GitLab-style shorthand sometimes used in ADO comments
 */
export const PULL_REQUEST_PATTERNS: RegExp[] = [
    /\bPR\s*#(\d+)\b/gi,
    /\bPR!(\d+)\b/gi,
    /(?<![A-Za-z0-9])!(\d+)\b/g
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prStatusLabel(status: number | undefined): string {
    switch (status) {
        case 1: return 'Active';
        case 2: return 'Abandoned';
        case 3: return 'Completed';
        default: return 'Unknown';
    }
}

function commandUri(command: string, args: unknown): vscode.Uri {
    return vscode.Uri.parse(
        `command:${command}?${encodeURIComponent(JSON.stringify(args))}`
    );
}

/**
 * Return the word range of the first match of any pattern in `patterns`
 * that covers the hover position.
 */
function matchRange(
    document: vscode.TextDocument,
    position: vscode.Position,
    patterns: RegExp[]
): { range: vscode.Range; id: number } | undefined {
    const line = document.lineAt(position.line).text;
    for (const pattern of patterns) {
        // Reset the lastIndex so each call starts from the beginning.
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (position.character >= start && position.character <= end) {
                const id = parseInt(match[1], 10);
                return {
                    range: new vscode.Range(position.line, start, position.line, end),
                    id
                };
            }
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Work Item Hover Provider
// ---------------------------------------------------------------------------

export class WorkItemHoverProvider implements vscode.HoverProvider {
    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const hit = matchRange(document, position, WORK_ITEM_PATTERNS);
        if (!hit) { return undefined; }

        if (!this.client.isConnected) { return undefined; }

        // Resolve scope – fail safely when ambiguous (> 1 project-scope).
        let scopes;
        try {
            scopes = await resolveProjectScopes(this.client, this.config);
        } catch {
            return undefined;
        }

        if (scopes.length === 0) { return undefined; }

        if (token.isCancellationRequested) { return undefined; }

        // When multiple scopes are configured, we try all of them in parallel
        // and take the first successful response.
        let workItem: Awaited<ReturnType<typeof this.client.getWorkItemById>> | undefined;
        let matchedOrg: string | undefined;
        let matchedProject: string | undefined;

        if (scopes.length === 1) {
            const scope = scopes[0];
            try {
                workItem = await this.client.getWorkItemById(scope.project, hit.id, scope.organization);
                matchedOrg = scope.organization;
                matchedProject = scope.project;
            } catch {
                return undefined;
            }
        } else {
            const results = await Promise.allSettled(
                scopes.map(async scope => {
                    const item = await this.client.getWorkItemById(scope.project, hit.id, scope.organization);
                    return { item, scope };
                })
            );
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value.item) {
                    workItem = result.value.item;
                    matchedOrg = result.value.scope.organization;
                    matchedProject = result.value.scope.project;
                    break;
                }
            }
        }

        if (!workItem || token.isCancellationRequested) { return undefined; }

        const fields = workItem.fields ?? {};
        const title = (fields['System.Title'] as string | undefined) ?? '(no title)';
        const state = (fields['System.State'] as string | undefined) ?? '';
        const type = (fields['System.WorkItemType'] as string | undefined) ?? '';
        const assignedToRaw = fields['System.AssignedTo'];
        const assignedTo: string = (typeof assignedToRaw === 'object' && assignedToRaw !== null
            ? ((assignedToRaw as { displayName?: string }).displayName ?? '')
            : String(assignedToRaw ?? ''));

        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;
        md.supportHtml = false;

        md.appendMarkdown(`**$(issues) Work Item #${hit.id}**\n\n`);
        if (type) { md.appendMarkdown(`**Type:** ${type}\n\n`); }
        md.appendMarkdown(`**Title:** ${title}\n\n`);
        if (state) { md.appendMarkdown(`**State:** ${state}\n\n`); }
        if (assignedTo) { md.appendMarkdown(`**Assigned To:** ${assignedTo}\n\n`); }

        // Quick-open actions
        if (matchedOrg && matchedProject) {
            const openArgs = { id: hit.id, org: matchedOrg, project: matchedProject };
            const openUri = commandUri('adoext.openWorkItemById', openArgs);
            const detailsUri = commandUri('adoext.viewWorkItemDetailsById', openArgs);
            md.appendMarkdown(`---\n\n[$(link-external) Open in Browser](${openUri}) · [$(eye) View Details](${detailsUri})`);
        }

        return new vscode.Hover(md, hit.range);
    }
}

// ---------------------------------------------------------------------------
// Pull Request Hover Provider
// ---------------------------------------------------------------------------

export class PullRequestHoverProvider implements vscode.HoverProvider {
    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const hit = matchRange(document, position, PULL_REQUEST_PATTERNS);
        if (!hit) { return undefined; }

        if (!this.client.isConnected) { return undefined; }

        // Resolve scope – use the primary org/project for the PR lookup.
        let scopes;
        try {
            scopes = await resolveProjectScopes(this.client, this.config);
        } catch {
            return undefined;
        }

        if (scopes.length === 0) { return undefined; }

        if (token.isCancellationRequested) { return undefined; }

        let pr: Awaited<ReturnType<typeof this.client.getPullRequestById>> | undefined;
        let matchedOrg: string | undefined;
        let matchedProject: string | undefined;

        if (scopes.length === 1) {
            const scope = scopes[0];
            try {
                pr = await this.client.getPullRequestById(hit.id, scope.project, scope.organization);
                matchedOrg = scope.organization;
                matchedProject = scope.project;
            } catch {
                return undefined;
            }
        } else {
            const results = await Promise.allSettled(
                scopes.map(async scope => {
                    const found = await this.client.getPullRequestById(hit.id, scope.project, scope.organization);
                    return { found, scope };
                })
            );
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value.found) {
                    pr = result.value.found;
                    matchedOrg = result.value.scope.organization;
                    matchedProject = result.value.scope.project;
                    break;
                }
            }
        }

        if (!pr || token.isCancellationRequested) { return undefined; }

        const title = pr.title ?? '(no title)';
        const status = prStatusLabel(pr.status);
        const repo = pr.repository?.name ?? '';
        const author = pr.createdBy?.displayName ?? '';

        const md = new vscode.MarkdownString('', true);
        md.isTrusted = true;
        md.supportHtml = false;

        md.appendMarkdown(`**$(git-pull-request) Pull Request #${hit.id}**\n\n`);
        md.appendMarkdown(`**Title:** ${title}\n\n`);
        md.appendMarkdown(`**Status:** ${status}\n\n`);
        if (repo) { md.appendMarkdown(`**Repository:** ${repo}\n\n`); }
        if (author) { md.appendMarkdown(`**Author:** ${author}\n\n`); }

        // Quick-open actions
        const repoName = pr.repository?.name ?? pr.repository?.id ?? '';
        const org = matchedOrg;
        const project = matchedProject;
        if (org && project && repoName) {
            const openArgs = { id: hit.id, org, project, repo: repoName };
            const openUri = commandUri('adoext.openPullRequestById', openArgs);
            md.appendMarkdown(`---\n\n[$(link-external) Open in Browser](${openUri})`);
        }

        return new vscode.Hover(md, hit.range);
    }
}
