import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import type { WikiProvider, WikiPageNode } from '../providers/wikiProvider';
import { showInformationMessage } from '../utils/notifications';
import { WikiPagePanel } from '../views/wikiPagePanel';

export async function refreshWiki(provider: WikiProvider): Promise<void> {
    provider.refresh();
}

export async function searchWikiPages(provider: WikiProvider): Promise<void> {
    const value = await vscode.window.showInputBox({
        prompt: 'Filter wiki pages (matches page path and name)',
        placeHolder: 'e.g. onboarding, /Team/Docs'
    });
    if (value === undefined) {
        return;
    }
    provider.setSearchQuery(value);
}

export async function clearWikiSearch(provider: WikiProvider): Promise<void> {
    provider.clearSearchQuery();
}

export async function viewWikiPage(
    context: vscode.ExtensionContext,
    client: AdoClient,
    config: ConfigManager,
    node: WikiPageNode
): Promise<void> {
    await WikiPagePanel.show(context, client, config, {
        organization: node.scope.organization,
        project: node.scope.project,
        wikiId: node.wiki.id,
        wikiName: node.wiki.name,
        wikiRemoteUrl: node.wiki.remoteUrl,
        pagePath: node.path
    });
}

export async function openWikiPageInBrowser(node: WikiPageNode): Promise<void> {
    const pageUrl = buildWikiPageUrl(node.wiki.remoteUrl, node.path);
    if (!pageUrl) {
        return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(pageUrl));
}

export async function copyWikiPageLink(node: WikiPageNode): Promise<void> {
    const pageUrl = buildWikiPageUrl(node.wiki.remoteUrl, node.path);
    if (!pageUrl) {
        return;
    }
    await vscode.env.clipboard.writeText(pageUrl);
    showInformationMessage('Wiki page link copied to clipboard.');
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

