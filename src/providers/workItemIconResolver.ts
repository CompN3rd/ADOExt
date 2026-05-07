import * as vscode from 'vscode';
import type { AdoClient } from '../api/adoClient';
import type { ConfigManager } from '../config/configManager';
import type { ProjectScope } from './projectScopes';
import { scopeKey } from './projectScopes';
import { mapWithConcurrencyLimit } from '../utils/async';
import { bundledWorkItemTypeIconFile, normalizeWorkItemTypeName } from '../utils/workItemTypeIcons';

const MAX_CONCURRENT_SCOPE_REQUESTS = 4;

function toHttpsUri(value: string): vscode.Uri | undefined {
    try {
        const uri = vscode.Uri.parse(value);
        return uri.scheme === 'https' ? uri : undefined;
    } catch {
        return undefined;
    }
}

function bundledTypeIcon(wiType: string): vscode.ThemeIcon | vscode.Uri {
    const fileName = bundledWorkItemTypeIconFile(wiType);
    if (fileName) {
        const extension = vscode.extensions.getExtension('MarcKassubeck.adoext');
        if (extension) {
            return vscode.Uri.joinPath(extension.extensionUri, 'media', 'icons', 'workitems', fileName);
        }
    }
    return new vscode.ThemeIcon('issues');
}

export class WorkItemIconResolver {
    private readonly _iconsByScope = new Map<string, Map<string, vscode.Uri>>();

    constructor(
        private readonly client: AdoClient,
        private readonly config: ConfigManager
    ) {}

    async loadForScopes(scopes: ProjectScope[]): Promise<void> {
        const scopeKeys = new Set(scopes.map(s => scopeKey(s)));
        for (const cachedKey of this._iconsByScope.keys()) {
            if (!scopeKeys.has(cachedKey)) {
                this._iconsByScope.delete(cachedKey);
            }
        }

        if (!this.config.useRemoteWorkItemIcons) {
            this._iconsByScope.clear();
            return;
        }

        await mapWithConcurrencyLimit(scopes, MAX_CONCURRENT_SCOPE_REQUESTS, async scope => {
            const key = scopeKey(scope);
            if (this._iconsByScope.has(key)) {
                return;
            }
            try {
                const iconsByType = await this.client.getWorkItemTypeIconUrls(scope.project, scope.organization);
                const normalized = new Map<string, vscode.Uri>();
                for (const [typeName, iconUrl] of iconsByType.entries()) {
                    const uri = toHttpsUri(iconUrl);
                    if (uri) {
                        normalized.set(typeName, uri);
                    }
                }
                this._iconsByScope.set(key, normalized);
            } catch {
                // Fall back to bundled icons when type icon lookup fails.
            }
        });
    }

    resolve(wiType: string, scope?: ProjectScope): vscode.ThemeIcon | vscode.Uri {
        if (this.config.useRemoteWorkItemIcons && scope) {
            const byType = this._iconsByScope.get(scopeKey(scope));
            const remoteIcon = byType?.get(normalizeWorkItemTypeName(wiType));
            if (remoteIcon) {
                return remoteIcon;
            }
        }
        return bundledTypeIcon(wiType);
    }

    clear(): void {
        this._iconsByScope.clear();
    }
}
