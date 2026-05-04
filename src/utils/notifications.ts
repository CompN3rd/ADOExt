import * as vscode from 'vscode';

type NotificationItem = string | vscode.MessageItem;

let outputChannel: vscode.OutputChannel | undefined;
let isMirroringInstalled = false;

const originalShowInformationMessage = vscode.window.showInformationMessage.bind(vscode.window);
const originalShowWarningMessage = vscode.window.showWarningMessage.bind(vscode.window);
const originalShowErrorMessage = vscode.window.showErrorMessage.bind(vscode.window);

function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('ADOExt');
    }
    return outputChannel;
}

function appendNotification(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const timestamp = new Date().toISOString();
    getOutputChannel().appendLine(`[${timestamp}] [${level}] ${message}`);
}

function showInformationMessageImpl(message: string, items: NotificationItem[]): Thenable<NotificationItem | undefined> {
    appendNotification('INFO', message);
    return items.length > 0 && typeof items[0] !== 'string'
        ? originalShowInformationMessage(message, ...(items as vscode.MessageItem[]))
        : originalShowInformationMessage(message, ...(items as string[]));
}

function showWarningMessageImpl(message: string, items: NotificationItem[]): Thenable<NotificationItem | undefined> {
    appendNotification('WARN', message);
    return items.length > 0 && typeof items[0] !== 'string'
        ? originalShowWarningMessage(message, ...(items as vscode.MessageItem[]))
        : originalShowWarningMessage(message, ...(items as string[]));
}

function showErrorMessageImpl(message: string, items: NotificationItem[]): Thenable<NotificationItem | undefined> {
    appendNotification('ERROR', message);
    return items.length > 0 && typeof items[0] !== 'string'
        ? originalShowErrorMessage(message, ...(items as vscode.MessageItem[]))
        : originalShowErrorMessage(message, ...(items as string[]));
}

export function showInformationMessage<T extends string>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showInformationMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showInformationMessage(message: string, ...items: NotificationItem[]): Thenable<NotificationItem | undefined> {
    return showInformationMessageImpl(message, items);
}

export function showWarningMessage<T extends string>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showWarningMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showWarningMessage(message: string, ...items: NotificationItem[]): Thenable<NotificationItem | undefined> {
    return showWarningMessageImpl(message, items);
}

export function showErrorMessage<T extends string>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showErrorMessage<T extends vscode.MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showErrorMessage(message: string, ...items: NotificationItem[]): Thenable<NotificationItem | undefined> {
    return showErrorMessageImpl(message, items);
}

export function installNotificationMirroring(): void {
    if (isMirroringInstalled) {
        return;
    }
    isMirroringInstalled = true;

    const windowApi = vscode.window as typeof vscode.window & {
        showInformationMessage: typeof vscode.window.showInformationMessage;
        showWarningMessage: typeof vscode.window.showWarningMessage;
        showErrorMessage: typeof vscode.window.showErrorMessage;
    };

    windowApi.showInformationMessage = ((message: string, ...items: NotificationItem[]) =>
        showInformationMessageImpl(message, items)) as typeof vscode.window.showInformationMessage;
    windowApi.showWarningMessage = ((message: string, ...items: NotificationItem[]) =>
        showWarningMessageImpl(message, items)) as typeof vscode.window.showWarningMessage;
    windowApi.showErrorMessage = ((message: string, ...items: NotificationItem[]) =>
        showErrorMessageImpl(message, items)) as typeof vscode.window.showErrorMessage;
}

export function showOutputChannel(preserveFocus = false): void {
    getOutputChannel().show(preserveFocus);
}
