import * as vscode from 'vscode';
import { TODO_COMMENT_PATTERN } from '../utils/todoPattern';

/**
 * Code-action provider that offers a "Create Azure DevOps Work Item" quick-fix
 * when the cursor is on a line that contains a TODO comment.
 */
export class TodoCodeActionProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection
    ): vscode.CodeAction[] | undefined {
        const line = document.lineAt(range.start.line);
        const match = TODO_COMMENT_PATTERN.exec(line.text);
        if (!match) {
            return undefined;
        }

        const todoText = match[1].trim();
        const action = new vscode.CodeAction(
            'Create Azure DevOps Work Item from TODO',
            vscode.CodeActionKind.QuickFix
        );
        action.command = {
            command: 'adoext.createWorkItemFromTodo',
            title: 'Create Azure DevOps Work Item from TODO',
            arguments: [todoText, range.start.line]
        };
        return [action];
    }
}
