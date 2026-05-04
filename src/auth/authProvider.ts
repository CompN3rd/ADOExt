import * as vscode from 'vscode';
import { showErrorMessage } from '../utils/notifications';

/**
 * Azure DevOps resource scope for Microsoft authentication.
 * This is the standard scope required to access Azure DevOps REST APIs via OAuth.
 */
const ADO_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';

/**
 * Manages Microsoft authentication sessions for Azure DevOps access.
 * Uses VS Code's built-in Microsoft authentication provider so users can
 * leverage their existing VS Code Microsoft accounts without additional setup.
 */
export class AuthProvider {
    private _session: vscode.AuthenticationSession | undefined;

    /**
     * Attempt to restore an existing session silently (no UI prompt).
     * Returns true if a session was restored.
     */
    async tryRestoreSession(): Promise<boolean> {
        try {
            this._session = await vscode.authentication.getSession(
                'microsoft',
                [ADO_SCOPE],
                { createIfNone: false, silent: true }
            );
            return this._session !== undefined;
        } catch {
            return false;
        }
    }

    /**
     * Sign in interactively. Shows the Microsoft account picker so users can
     * choose from any of their VS Code Microsoft accounts.
     */
    async signIn(): Promise<boolean> {
        try {
            this._session = await vscode.authentication.getSession(
                'microsoft',
                [ADO_SCOPE],
                { createIfNone: true }
            );
            return this._session !== undefined;
        } catch (err) {
            showErrorMessage(`Failed to sign in: ${err}`);
            return false;
        }
    }

    /**
     * Sign out by clearing the cached session.
     * VS Code manages the actual token lifecycle; we just forget our reference.
     */
    signOut(): void {
        this._session = undefined;
    }

    /** Returns true if currently authenticated. */
    get isSignedIn(): boolean {
        return this._session !== undefined;
    }

    /** Returns the current access token, or undefined if not signed in. */
    get accessToken(): string | undefined {
        return this._session?.accessToken;
    }

    /** Returns the display name of the signed-in account. */
    get accountName(): string | undefined {
        return this._session?.account.label;
    }

    /** Returns the account id of the signed-in account. */
    get accountId(): string | undefined {
        return this._session?.account.id;
    }
}
