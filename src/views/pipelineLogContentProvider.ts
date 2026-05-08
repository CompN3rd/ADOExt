import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';

export const PIPELINE_LOG_SCHEME = 'adoext-pipeline-log';

export interface PipelineLogDocumentOptions {
    organization: string;
    project: string;
    buildId: number;
    logId: number;
    stepName: string;
    runLabel: string;
}

export class PipelineLogContentProvider implements vscode.TextDocumentContentProvider {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    private readonly cache = new Map<string, string>();

    constructor(private readonly client: AdoClient) {}

    createUri(options: PipelineLogDocumentOptions): vscode.Uri {
        return createPipelineLogUri(options);
    }

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const options = parseOptions(uri);
        const cacheKey = `${options.organization}\u0000${options.project}\u0000${options.buildId}\u0000${options.logId}`;
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        const lines = await this.client.getPipelineRunLogLines(
            options.project,
            options.buildId,
            options.logId,
            options.organization
        );

        const content = [
            `Pipeline run: ${options.runLabel}`,
            `Step: ${options.stepName}`,
            `Scope: ${options.organization}/${options.project}`,
            `Build ID: ${options.buildId}`,
            `Log ID: ${options.logId}`,
            `Lines: ${lines.length}`,
            ''.padEnd(80, '-'),
            ...lines
        ].join('\n');

        this.cache.set(cacheKey, content);
        return content;
    }

    clear(): void {
        this.cache.clear();
    }
}

export function createPipelineLogUri(options: PipelineLogDocumentOptions): vscode.Uri {
    const fileName = sanitizePathSegment(`${options.runLabel}-${options.stepName}-${options.logId}.log`);
    return vscode.Uri.from({
        scheme: PIPELINE_LOG_SCHEME,
        path: `/${fileName}`,
        query: encodeURIComponent(JSON.stringify(options))
    });
}

function parseOptions(uri: vscode.Uri): PipelineLogDocumentOptions {
    return JSON.parse(decodeURIComponent(uri.query)) as PipelineLogDocumentOptions;
}

function sanitizePathSegment(value: string): string {
    const cleaned = value
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.slice(0, 160) || 'pipeline-log.log';
}