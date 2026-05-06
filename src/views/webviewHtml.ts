import * as crypto from 'crypto';
import * as vscode from 'vscode';

interface WebviewDocumentOptions {
    title: string;
    entry: string;
    appTag: string;
    data: unknown;
    cspExtra?: string;
}

export function webviewAssetRoots(context: vscode.ExtensionContext): vscode.Uri[] {
    return [vscode.Uri.joinPath(context.extensionUri, 'media', 'webviews')];
}

export function buildWebviewDocument(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
    options: WebviewDocumentOptions
): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'media', 'webviews', options.entry)
    );
    const dataJson = escapeScriptJson(JSON.stringify(options.data));
    const csp = [
        "default-src 'none'",
        `img-src ${webview.cspSource} https: data: https://*.dev.azure.com https://*.visualstudio.com`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}' ${webview.cspSource}`,
        options.cspExtra
    ].filter(Boolean).join('; ');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp};">
<title>${escapeHtml(options.title)}</title>
</head>
<body>
<${options.appTag}></${options.appTag}>
<script id="adoext-data" type="application/json" nonce="${nonce}">${dataJson}</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function buildMessageDocument(webview: vscode.Webview, message: string): string {
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline';`;
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px}.empty{color:var(--vscode-descriptionForeground);font-style:italic}
</style>
</head>
<body><p class="empty">${escapeHtml(message)}</p></body>
</html>`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeScriptJson(json: string): string {
    return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}