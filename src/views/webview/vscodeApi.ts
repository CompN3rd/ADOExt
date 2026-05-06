interface VsCodeApi<State = unknown> {
    postMessage(message: unknown): void;
    getState(): State | undefined;
    setState(state: State): void;
}

declare const acquireVsCodeApi: <State = unknown>() => VsCodeApi<State>;

let api: VsCodeApi | undefined;

export function vscode(): VsCodeApi {
    if (!api) {
        api = acquireVsCodeApi();
    }
    return api;
}

export function readInitialData<T>(): T {
    const element = document.getElementById('adoext-data');
    if (!element?.textContent) {
        throw new Error('Missing ADOExt webview data.');
    }
    return JSON.parse(element.textContent) as T;
}

export function postMessage(message: unknown): void {
    vscode().postMessage(message);
}