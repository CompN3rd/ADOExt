import * as vscode from 'vscode';
import type { AdoClient, WikiPageContent } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { buildMessageDocument } from './webviewHtml';
import { showErrorMessage } from '../utils/notifications';

export interface WikiPagePanelScope {
    organization: string;
    project: string;
    wikiId: string;
    wikiName: string;
    wikiRemoteUrl?: string;
    pagePath: string;
}

export class WikiPagePanel {
    private static readonly _panels = new Map<string, WikiPagePanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _disposables: vscode.Disposable[] = [];

    static async show(
        context: vscode.ExtensionContext,
        client: AdoClient,
        config: ConfigManager,
        scope: WikiPagePanelScope
    ): Promise<void> {
        const key = WikiPagePanel.panelKey(scope);
        const existing = WikiPagePanel._panels.get(key);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            await existing.refresh(client, config, scope);
            return;
        }

        const panel = new WikiPagePanel(context, scope);
        WikiPagePanel._panels.set(key, panel);
        await panel.refresh(client, config, scope);
    }

    private static panelKey(scope: WikiPagePanelScope): string {
        return `${scope.organization}\u0000${scope.project}\u0000${scope.wikiId}\u0000${scope.pagePath}`;
    }

    private constructor(
        private readonly _context: vscode.ExtensionContext,
        private _scope: WikiPagePanelScope
    ) {
        this._panel = vscode.window.createWebviewPanel(
            'adoext.wikiPage',
            `Wiki: ${_scope.wikiName}${_scope.pagePath ? ` · ${_scope.pagePath}` : ''}`,
            vscode.ViewColumn.One,
            {
                enableScripts: false,
                retainContextWhenHidden: true
            }
        );

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private async refresh(client: AdoClient, config: ConfigManager, scope: WikiPagePanelScope): Promise<void> {
        this._scope = scope;
        this._panel.webview.html = buildMessageDocument(this._panel.webview, 'Loading wiki page...');

        if (!client.isConnected) {
            this._panel.webview.html = buildMessageDocument(this._panel.webview, 'Sign in to Azure DevOps to load wiki pages.');
            return;
        }

        if (!config.isConfigured) {
            this._panel.webview.html = buildMessageDocument(this._panel.webview, 'Select organizations and projects to load wiki pages.');
            return;
        }

        try {
            const page = await client.getWikiPageMarkdown(scope.project, scope.wikiId, scope.pagePath, scope.organization);
            const pageUrl = buildWikiPageUrl(scope.wikiRemoteUrl, scope.pagePath);
            const html = renderWikiPageHtml(this._panel.webview, scope, page, pageUrl);
            this._panel.title = `Wiki: ${scope.wikiName}${scope.pagePath ? ` · ${scope.pagePath}` : ''}`;
            this._panel.webview.html = html;
        } catch (err) {
            this._panel.webview.html = buildMessageDocument(this._panel.webview, 'Failed to load wiki page.');
            showErrorMessage(`Failed to load wiki page: ${formatError(err)}`);
        }
    }

    dispose(): void {
        WikiPagePanel._panels.delete(WikiPagePanel.panelKey(this._scope));
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}

function renderWikiPageHtml(
    webview: vscode.Webview,
    scope: WikiPagePanelScope,
    page: WikiPageContent,
    pageUrl: string | undefined
): string {
    const csp = [
        "default-src 'none'",
        `img-src ${webview.cspSource} https: data: https://*.dev.azure.com https://*.visualstudio.com`,
        `style-src ${webview.cspSource} 'unsafe-inline'`
    ].join('; ');

    const markdownHtml = renderWikiMarkdown(page.markdown, scope.wikiRemoteUrl);
    const lastUpdated = page.lastModified ? `Last updated: ${escapeHtml(page.lastModified)}` : '';
    const openLink = pageUrl
        ? `<a class="action" href="${escapeAttribute(pageUrl)}" target="_blank" rel="noopener noreferrer">Open in browser</a>`
        : '';

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp};">
<title>${escapeHtml(`Wiki: ${scope.wikiName}`)}</title>
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px}
.meta{display:flex;gap:12px;align-items:center;margin-bottom:12px;color:var(--vscode-descriptionForeground);font-size:12px;flex-wrap:wrap}
.action{color:var(--vscode-textLink-foreground);text-decoration:none}
.action:hover{text-decoration:underline}
.content{line-height:1.5}
pre{background:var(--vscode-textCodeBlock-background);padding:10px;border-radius:4px;overflow:auto}
code{font-family:var(--vscode-editor-font-family)}
img{max-width:100%}
blockquote{border-left:3px solid var(--vscode-textBlockQuote-border);padding-left:12px;margin-left:0;color:var(--vscode-textBlockQuote-foreground)}
table{border-collapse:collapse}
td,th{border:1px solid var(--vscode-panel-border);padding:4px 8px}
</style>
</head>
<body>
<div class="meta">
<span>${escapeHtml(`${scope.organization}/${scope.project} · ${scope.wikiName} · ${scope.pagePath}`)}</span>
${lastUpdated ? `<span>${lastUpdated}</span>` : ''}
${openLink}
</div>
<div class="content">${markdownHtml}</div>
</body>
</html>`;
}

function renderWikiMarkdown(markdown: string, wikiRemoteUrl?: string): string {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const html: string[] = [];
    const paragraph: string[] = [];
    let inCodeBlock = false;
    let listMode: 'ul' | 'ol' | undefined;

    const baseOrigin = wikiRemoteUrl ? safeOrigin(wikiRemoteUrl) : undefined;

    const flushParagraph = () => {
        if (paragraph.length === 0) {
            return;
        }
        const text = paragraph.join(' ').trim();
        if (text) {
            html.push(`<p>${renderInline(text, baseOrigin)}</p>`);
        }
        paragraph.length = 0;
    };

    const closeList = () => {
        if (!listMode) {
            return;
        }
        html.push(listMode === 'ul' ? '</ul>' : '</ol>');
        listMode = undefined;
    };

    for (const rawLine of lines) {
        const line = rawLine.replace(/\t/g, '    ');

        const fenceMatch = line.match(/^```/);
        if (fenceMatch) {
            flushParagraph();
            closeList();
            inCodeBlock = !inCodeBlock;
            html.push(inCodeBlock ? '<pre><code>' : '</code></pre>');
            continue;
        }

        if (inCodeBlock) {
            html.push(`${escapeHtml(line)}\n`);
            continue;
        }

        if (!line.trim()) {
            flushParagraph();
            closeList();
            continue;
        }

        const headingMatch = line.match(/^(#{1,6})\\s+(.+)$/);
        if (headingMatch) {
            flushParagraph();
            closeList();
            const level = headingMatch[1].length;
            html.push(`<h${level}>${renderInline(headingMatch[2].trim(), baseOrigin)}</h${level}>`);
            continue;
        }

        const quoteMatch = line.match(/^>\\s?(.*)$/);
        if (quoteMatch) {
            flushParagraph();
            closeList();
            html.push(`<blockquote><p>${renderInline(quoteMatch[1].trim(), baseOrigin)}</p></blockquote>`);
            continue;
        }

        const ulMatch = line.match(/^[-*+]\\s+(.+)$/);
        if (ulMatch) {
            flushParagraph();
            if (listMode && listMode !== 'ul') {
                closeList();
            }
            if (!listMode) {
                listMode = 'ul';
                html.push('<ul>');
            }
            html.push(`<li>${renderInline(ulMatch[1].trim(), baseOrigin)}</li>`);
            continue;
        }

        const olMatch = line.match(/^\\d+\\.\\s+(.+)$/);
        if (olMatch) {
            flushParagraph();
            if (listMode && listMode !== 'ol') {
                closeList();
            }
            if (!listMode) {
                listMode = 'ol';
                html.push('<ol>');
            }
            html.push(`<li>${renderInline(olMatch[1].trim(), baseOrigin)}</li>`);
            continue;
        }

        paragraph.push(line.trim());
    }

    flushParagraph();
    closeList();

    return html.join('');
}

function renderInline(text: string, baseOrigin?: string): string {
    const tokenRe = /(`[^`]+`|!\\[[^\\]]*\\]\\([^\\)]+\\)|\\[[^\\]]+\\]\\([^\\)]+\\))/g;
    let result = '';
    let lastIndex = 0;
    for (;;) {
        const match = tokenRe.exec(text);
        if (!match) {
            break;
        }
        result += escapeHtml(text.slice(lastIndex, match.index));
        const token = match[0];
        if (token.startsWith('`')) {
            const content = token.slice(1, -1);
            result += `<code>${escapeHtml(content)}</code>`;
        } else if (token.startsWith('![')) {
            const parsed = parseMarkdownLink(token.slice(1));
            if (parsed && parsed.url) {
                const url = resolveUrl(parsed.url, baseOrigin);
                if (url && isSafeUrl(url, true)) {
                    result += `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(parsed.text)}">`;
                } else {
                    result += escapeHtml(token);
                }
            } else {
                result += escapeHtml(token);
            }
        } else if (token.startsWith('[')) {
            const parsed = parseMarkdownLink(token);
            if (parsed && parsed.url) {
                const url = resolveUrl(parsed.url, baseOrigin);
                if (url && isSafeUrl(url, false)) {
                    result += `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(parsed.text)}</a>`;
                } else {
                    result += escapeHtml(parsed.text);
                }
            } else {
                result += escapeHtml(token);
            }
        } else {
            result += escapeHtml(token);
        }
        lastIndex = match.index + token.length;
    }
    result += escapeHtml(text.slice(lastIndex));
    return result;
}

function parseMarkdownLink(token: string): { text: string; url: string } | undefined {
    const match = token.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
    if (!match) {
        return undefined;
    }
    return { text: match[1] ?? '', url: match[2] ?? '' };
}

function resolveUrl(url: string, baseOrigin?: string): string | undefined {
    const trimmed = url.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed.startsWith('/') && baseOrigin) {
        try {
            return new URL(trimmed, baseOrigin).toString();
        } catch {
            return undefined;
        }
    }
    return trimmed;
}

function safeOrigin(rawUrl: string): string | undefined {
    try {
        const url = new URL(rawUrl);
        return url.origin;
    } catch {
        return undefined;
    }
}

function isSafeUrl(url: string, isImage: boolean): boolean {
    const lower = url.trim().toLowerCase();
    if (lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('#')) {
        return true;
    }
    if (lower.startsWith('data:image/')) {
        const mimeEnd = lower.search(/[;,]/);
        const mime = mimeEnd > 0 ? lower.slice(0, mimeEnd) : lower;
        return mime !== 'data:image/svg+xml';
    }
    return isImage ? lower.startsWith('/') : false;
}

function buildWikiPageUrl(wikiRemoteUrl: string | undefined, pagePath: string): string | undefined {
    if (!wikiRemoteUrl) {
        return undefined;
    }
    try {
        const url = new URL(wikiRemoteUrl);
        const normalized = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
        url.searchParams.set('pagePath', normalized);
        return url.toString();
    } catch {
        return undefined;
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttribute(text: string): string {
    return escapeHtml(text).replace(/'/g, '&#39;');
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
