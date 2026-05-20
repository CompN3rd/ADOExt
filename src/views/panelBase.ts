import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import { webviewAssetRoots } from './webviewHtml';

/**
 * Shared lifecycle for webview panels. Handles webview creation,
 * message listener registration, and disposal.
 *
 * Subclasses implement their own static show(), refresh(), and
 * handleMessage().
 */
export abstract class PanelBase {
    protected readonly _panel: vscode.WebviewPanel;
    protected readonly _disposables: vscode.Disposable[] = [];

    constructor(
        protected readonly _context: vscode.ExtensionContext,
        protected readonly _client: AdoClient,
        protected readonly _config: ConfigManager,
        viewType: string,
        title: string,
    ) {
        this._panel = vscode.window.createWebviewPanel(
            viewType,
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: webviewAssetRoots(_context)
            }
        );
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    protected onMessage(handler: (msg: unknown) => Promise<void>): void {
        this._panel.webview.onDidReceiveMessage(
            async (msg) => handler(msg),
            null,
            this._disposables
        );
    }

    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
    }
}
