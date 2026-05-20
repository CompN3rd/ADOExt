// Shared lazy loaders for heavy webview panel modules.
// Caching the import promise here ensures all callers (extension.ts and
// command modules) observe the same loaded-or-not state, which matters for
// static refresh methods that must no-op when the module was never opened.

let _planning: Promise<typeof import('./planningPanel')> | undefined;
export const loadPlanningPanel = () => (_planning ??= import('./planningPanel'));
export const planningPanelLoaded = () => _planning;

let _prDetails: Promise<typeof import('./prDetailsPanel')> | undefined;
export const loadPrDetailsPanel = () => (_prDetails ??= import('./prDetailsPanel'));
export const prDetailsPanelLoaded = () => _prDetails;

let _pipelineRun: Promise<typeof import('./pipelineRunDetailsPanel')> | undefined;
export const loadPipelineRunDetailsPanel = () =>
    (_pipelineRun ??= import('./pipelineRunDetailsPanel'));
export const pipelineRunDetailsPanelLoaded = () => _pipelineRun;
