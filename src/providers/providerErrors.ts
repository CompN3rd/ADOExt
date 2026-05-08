import * as vscode from 'vscode';
import { formatAdoError } from '../utils/adoErrors';
import type { AuthRecoveryHandler } from '../utils/authRecovery';

export async function handleProviderError(
    error: unknown,
    source: string,
    onAuthError: AuthRecoveryHandler | undefined,
    prefix = 'Error'
): Promise<vscode.TreeItem[]> {
    const recovery = onAuthError ? await onAuthError(error, source) : 'not-auth';
    if (recovery === 'refreshed') {
        return [infoNode('Authentication refreshed. Refreshing...')];
    }
    if (recovery === 'signed-out') {
        return [signInNode()];
    }
    return [errorNode(error, prefix)];
}

export function errorNode(error: unknown, prefix = 'Error'): vscode.TreeItem {
    const message = formatAdoError(error);
    const node = new vscode.TreeItem(`${prefix}: ${message}`, vscode.TreeItemCollapsibleState.None);
    node.tooltip = message;
    node.iconPath = new vscode.ThemeIcon('error');
    return node;
}

function infoNode(label: string): vscode.TreeItem {
    const node = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    node.iconPath = new vscode.ThemeIcon('sync~spin');
    return node;
}

function signInNode(): vscode.TreeItem {
    const node = new vscode.TreeItem('Sign in to Azure DevOps...', vscode.TreeItemCollapsibleState.None);
    node.command = { command: 'adoext.signIn', title: 'Sign In', arguments: [true] };
    node.iconPath = new vscode.ThemeIcon('sign-in');
    return node;
}
