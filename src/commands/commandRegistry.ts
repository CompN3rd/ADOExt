import * as vscode from 'vscode';

/**
 * Lightweight registry for VS Code command registrations.
 *
 * Helpers fold the most common command shapes:
 * - `add(id, handler)`            plain command.
 * - `addGuarded(id, handler)`     ensures sign-in first; aborts if not signed in.
 * - `addRefreshing(id, handler, refresh)` guarded + calls refresh() when handler returns truthy.
 *
 * Call {@link registerAll} once to push everything onto `context.subscriptions`.
 */
export class CommandRegistry {
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(private readonly _ensureSignedIn: () => Promise<boolean>) {}

    add<T extends unknown[]>(
        id: string,
        handler: (...args: T) => unknown | Promise<unknown>
    ): void {
        this._disposables.push(vscode.commands.registerCommand(id, handler));
    }

    addGuarded<T extends unknown[]>(
        id: string,
        handler: (...args: T) => unknown | Promise<unknown>
    ): void {
        this._disposables.push(
            vscode.commands.registerCommand(id, async (...args: T) => {
                if (!(await this._ensureSignedIn())) {
                    return;
                }
                return handler(...args);
            })
        );
    }

    addRefreshing<T extends unknown[]>(
        id: string,
        handler: (...args: T) => unknown | Promise<unknown>,
        refresh: () => void
    ): void {
        this._disposables.push(
            vscode.commands.registerCommand(id, async (...args: T) => {
                if (!(await this._ensureSignedIn())) {
                    return;
                }
                const result = await handler(...args);
                if (result) {
                    refresh();
                }
            })
        );
    }

    registerAll(context: vscode.ExtensionContext): void {
        context.subscriptions.push(...this._disposables);
    }
}
