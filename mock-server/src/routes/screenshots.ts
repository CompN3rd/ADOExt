import { Router } from 'express';

const router = Router();

// VS Code Dark+ theme CSS variables injected into standalone pages
const VSCODE_VARS = `
    --vscode-foreground: #cccccc;
    --vscode-editor-background: #1e1e1e;
    --vscode-editor-foreground: #d4d4d4;
    --vscode-descriptionForeground: #8a8a8a;
    --vscode-badge-background: #4d4d4d;
    --vscode-badge-foreground: #ffffff;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-border: transparent;
    --vscode-button-secondaryBackground: #3a3d41;
    --vscode-button-secondaryForeground: #cccccc;
    --vscode-button-secondaryHoverBackground: #45494e;
    --vscode-input-background: #3c3c3c;
    --vscode-input-foreground: #cccccc;
    --vscode-input-border: #3c3c3c;
    --vscode-panel-border: #2d2d2d;
    --vscode-sideBarSectionHeader-background: #2d2d2d;
    --vscode-dropdown-background: #3c3c3c;
    --vscode-dropdown-foreground: #cccccc;
    --vscode-dropdown-border: #3c3c3c;
    --vscode-textLink-foreground: #3794ff;
    --vscode-textLink-activeForeground: #3794ff;
    --vscode-charts-green: #4ec9b0;
    --vscode-charts-red: #f14c4c;
    --vscode-charts-yellow: #cca700;
    --vscode-charts-blue: #3794ff;
    --vscode-charts-orange: #ce9178;
    --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, 'Ubuntu', 'Droid Sans', sans-serif;
    --vscode-font-size: 13px;
    --vscode-editor-font-family: 'SF Mono', Monaco, Menlo, Consolas, 'Ubuntu Mono', 'Liberation Mono', 'Courier New', monospace;
    --vscode-inputValidation-errorBackground: #5a1d1d;
    --vscode-inputValidation-errorForeground: #f48771;
    --vscode-inputValidation-errorBorder: #be1100;
`;

function scaffoldPage(title: string, appTag: string, bundle: string, data: unknown): string {
    const dataJson = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  :root { ${VSCODE_VARS} }
  html, body { margin: 0; padding: 0; background: var(--vscode-editor-background); }
</style>
</head>
<body>
<script>
  // Mock VS Code webview API so bundles don't crash
  window.acquireVsCodeApi = function() {
    return {
      postMessage: function() {},
      getState: function() { return undefined; },
      setState: function() {}
    };
  };
</script>
<${appTag}></${appTag}>
<script id="adoext-data" type="application/json">${dataJson}</script>
<script src="${bundle}"></script>
</body>
</html>`;
}

const PR_DETAILS_DATA = {
    prId: 201,
    title: 'feat: add Redis session cache',
    description: 'Implements Redis-backed session caching to reduce DB load by ~40%.\n\nSee work item #104 for context.\n\nChanges:\n- Added `SessionStore` class with Redis backend\n- LRU fallback when Redis is unavailable\n- TTL configurable via `REDIS_TTL` env var',
    sourceBranch: 'feature/redis-cache',
    targetBranch: 'main',
    author: 'Bob Baker',
    isDraft: false,
    createdDate: '5/15/2026',
    status: 1,
    mergeStatus: 'Succeeded',
    hasConflicts: false,
    autoCompleteSetBy: null,
    lastMergeSourceCommitId: 'abc1230000000000000000000000000000000002',
    associatedWorkItems: [
        { id: 104, title: 'Add Redis cache for user sessions' },
    ],
    canComplete: true,
    reviewers: [
        { displayName: 'Alice Alvarez', voteLabel: 'Approved', voteClass: 'vote-positive' },
        { displayName: 'Carol Chen', voteLabel: 'No Vote', voteClass: '' },
    ],
    reviewActions: [
        { label: 'Approve', vote: 10 },
        { label: 'Approve with Suggestions', vote: 5 },
        { label: 'Wait for Author', vote: -5 },
        { label: 'Reject', vote: -10 },
        { label: 'Reset Vote', vote: 0 },
    ],
    branchStatuses: [],
    checks: [
        { name: 'CI Pipeline', badge: { label: 'Passed', className: 'check-success' }, description: 'Build #20260515.3 succeeded in 45m' },
        { name: 'Minimum number of reviewers', badge: { label: 'Waiting', className: 'check-pending' }, description: '1 of 1 required approvals' },
    ],
    testResults: {
        totalTests: 45,
        passedTests: 42,
        failedTests: 3,
        skippedTests: 0,
        durationLabel: '17m 0s',
        runs: [
            {
                runId: 401,
                runName: 'CI Test Run - 20260515.3',
                runUrl: 'http://localhost:3000/mockorg/Acme%20Platform/_testManagement/runs?runId=401',
                buildId: 301,
                buildLabel: '#20260515.3',
                statusLabel: 'Completed',
                statusClass: 'check-success',
                totalTests: 45,
                passedTests: 42,
                failedTests: 3,
                skippedTests: 0,
                durationLabel: '17m 0s',
            },
        ],
        failures: [
            {
                testName: 'Session TTL defaults to 3600s',
                errorMessageSnippet: 'Expected TTL 3600 but got 1800',
                stackTraceSnippet: 'at SessionStore.connect (src/session/store.ts:42)',
                runId: 401,
                runName: 'CI Test Run - 20260515.3',
                runUrl: 'http://localhost:3000/mockorg/Acme%20Platform/_testManagement/runs?runId=401',
                buildId: 301,
                buildLabel: '#20260515.3',
            },
        ],
    },
    showResolvedThreads: false,
    threads: [
        {
            id: 1,
            isResolved: false,
            isToolThread: false,
            statusLabel: 'Active',
            comments: [
                { author: 'Alice Alvarez', content: 'Should we add a TTL fallback for when Redis is unavailable?', isTool: false },
                { author: 'Bob Baker', content: "Good point — I'll add a fallback to in-memory LRU cache.", isTool: false },
            ],
        },
        {
            id: 3,
            isResolved: false,
            isToolThread: false,
            statusLabel: 'Pending',
            comments: [
                { author: 'Alice Alvarez', content: 'Overall looks good. Waiting on the CI check before I approve.', isTool: false },
            ],
        },
    ],
    builds: [
        {
            id: 301,
            buildNumber: '20260515.3',
            definitionName: 'CI Pipeline',
            requestedFor: 'Bob Baker',
            startTime: '5/15/2026, 10:00 AM',
            statusLabel: 'Succeeded',
            statusKind: 'succeeded',
        },
    ],
};

const PIPELINE_RUN_DATA = {
    id: 302,
    pipelineName: 'CI Pipeline',
    runNumber: '20260518.1',
    statusLabel: 'Failed',
    statusKind: 'failed',
    branch: 'chore/pg-upgrade',
    requestedBy: 'Carol Chen',
    reason: 'Manual',
    startTime: '5/18/2026, 8:00 AM',
    finishTime: '5/18/2026, 8:22 AM',
    duration: '22:00',
    repository: 'platform-api',
    commit: 'fed9870',
    yamlFile: '.azure-pipelines/ci.yml',
    canRerun: true,
    canCancel: false,
    webUrl: 'http://localhost:3000/mockorg/Acme%20Platform/_build/results?buildId=302',
    logsUrl: 'http://localhost:3000/mockorg/Acme%20Platform/_build/results?buildId=302&view=logs',
    artifacts: [],
    timeline: [
        {
            id: 'phase-1',
            name: 'Phase: Build',
            recordType: 'Phase',
            statusLabel: 'Failed',
            statusKind: 'failed',
            startTime: '8:00 AM',
            duration: '22:00',
            children: [
                {
                    id: 'job-1',
                    name: 'Job: CI',
                    recordType: 'Job',
                    statusLabel: 'Failed',
                    statusKind: 'failed',
                    startTime: '8:01 AM',
                    duration: '20:00',
                    children: [
                        { id: 'step-1', name: 'Checkout', recordType: 'Task', statusLabel: 'Succeeded', statusKind: 'succeeded', startTime: '8:01 AM', duration: '1:00', logId: 1, order: 1, children: [] },
                        { id: 'step-2', name: 'Restore packages', recordType: 'Task', statusLabel: 'Succeeded', statusKind: 'succeeded', startTime: '8:02 AM', duration: '8:00', logId: 2, order: 2, children: [] },
                        { id: 'step-3', name: 'Build', recordType: 'Task', statusLabel: 'Succeeded', statusKind: 'succeeded', startTime: '8:10 AM', duration: '8:00', logId: 3, order: 3, children: [] },
                        { id: 'step-4', name: 'Run unit tests', recordType: 'Task', statusLabel: 'Failed', statusKind: 'failed', startTime: '8:18 AM', duration: '3:00', logId: 4, order: 4, children: [] },
                    ],
                },
            ],
        },
    ],
    agentDiagnosticsRequested: false,
};

const WORK_ITEM_DATA = {
    id: 101,
    title: 'Login page crashes on Safari 17',
    workItemType: 'Bug',
    workItemTypeIconUrl: 'http://localhost:3000/static/icons/Bug.svg',
    state: 'Active',
    stateColor: '#CC293D',
    priority: 1,
    metaRows: [
        { label: 'Assigned To', value: 'Alice Alvarez' },
        { label: 'Area', value: 'Acme Platform\\Frontend' },
        { label: 'Iteration', value: 'Acme Platform\\Sprint 12' },
        { label: 'Created', value: '4/1/2026' },
        { label: 'Changed', value: '5/10/2026' },
    ],
    descriptionHtml: '<p>The login page crashes when <code>navigator.credentials.get()</code> is called on Safari 17. The API returns a promise that never resolves on macOS 14.4+.</p><p>Repro: open Safari 17, navigate to /login, click "Sign in with SSO".</p>',
    linkedItems: [
        { type: 'pr', label: 'PR #203: fix: Safari 17 login crash', webUrl: 'http://localhost:3000/mockorg/Acme%20Platform/_git/platform-api/pullrequest/203' },
    ],
    comments: [
        { author: 'Alice Alvarez', date: '5/10/2026', html: '<p>Confirmed on Safari 17.4. The issue is in the credentials polyfill.</p>', isPlainText: false },
        { author: 'Bob Baker', date: '5/11/2026', html: '<p>Workaround: fall back to form-based auth when <code>navigator.credentials</code> is not available.</p>', isPlainText: false },
    ],
    allowedStates: ['Active', 'Resolved', 'Closed'],
    builds: [
        {
            id: 305,
            buildNumber: '20260512.1',
            definitionName: 'CI Pipeline',
            requestedFor: 'Alice Alvarez',
            startTime: '5/12/2026, 8:02 AM',
            statusLabel: 'Succeeded',
            statusKind: 'succeeded',
        },
    ],
};

const PLANNING_DATA = {
    kind: 'backlog',
    title: 'Backlog',
    subtitle: 'Acme Platform',
    scopes: [
        { key: 'mockorg Acme Platform', organization: 'mockorg', project: 'Acme Platform', label: 'Acme Platform' },
    ],
    items: [
        { id: 101, workItemType: 'Bug', typeClass: 'bug', title: 'Login page crashes on Safari 17', state: 'Active', assignee: 'Alice Alvarez', iteration: 'Acme Platform\\Sprint 12', iterationLabel: 'Sprint 12', allowedStates: ['Active', 'Resolved', 'Closed'], organization: 'mockorg', project: 'Acme Platform', scopeKey: 'mockorg Acme Platform' },
        { id: 102, workItemType: 'Bug', typeClass: 'bug', title: 'API rate limiter ignores X-Forwarded-For', state: 'Active', assignee: 'Bob Baker', iteration: 'Acme Platform\\Sprint 12', iterationLabel: 'Sprint 12', allowedStates: ['Active', 'Resolved', 'Closed'], organization: 'mockorg', project: 'Acme Platform', scopeKey: 'mockorg Acme Platform' },
        { id: 103, workItemType: 'Task', typeClass: 'task', title: 'Upgrade PostgreSQL driver to 16.x', state: 'Active', assignee: 'Carol Chen', iteration: 'Acme Platform\\Sprint 12', iterationLabel: 'Sprint 12', allowedStates: ['Active', 'Closed'], organization: 'mockorg', project: 'Acme Platform', scopeKey: 'mockorg Acme Platform' },
        { id: 104, workItemType: 'Task', typeClass: 'task', title: 'Add Redis cache for user sessions', state: 'New', assignee: 'Bob Baker', iteration: 'Acme Platform\\Sprint 13', iterationLabel: 'Sprint 13', allowedStates: ['New', 'Active', 'Closed'], organization: 'mockorg', project: 'Acme Platform', scopeKey: 'mockorg Acme Platform' },
        { id: 105, workItemType: 'User Story', typeClass: 'user-story', title: 'As a user I can reset my password via email', state: 'Active', assignee: 'Alice Alvarez', iteration: 'Acme Platform\\Sprint 12', iterationLabel: 'Sprint 12', allowedStates: ['New', 'Active', 'Resolved', 'Closed'], organization: 'mockorg', project: 'Acme Platform', scopeKey: 'mockorg Acme Platform' },
        { id: 106, workItemType: 'User Story', typeClass: 'user-story', title: 'As an admin I can view audit logs', state: 'New', assignee: 'Carol Chen', iteration: 'Acme Platform\\Sprint 13', iterationLabel: 'Sprint 13', allowedStates: ['New', 'Active', 'Resolved', 'Closed'], organization: 'mockorg', project: 'Acme Platform', scopeKey: 'mockorg Acme Platform' },
        { id: 107, workItemType: 'Bug', typeClass: 'bug', title: 'Pagination breaks when filter is applied', state: 'Resolved', assignee: 'Alice Alvarez', iteration: 'Acme Platform\\Sprint 11', iterationLabel: 'Sprint 11', allowedStates: ['Active', 'Resolved', 'Closed'], organization: 'mockorg', project: 'Acme Platform', scopeKey: 'mockorg Acme Platform' },
        { id: 108, workItemType: 'Task', typeClass: 'task', title: 'Write OpenAPI spec for v2 endpoints', state: 'Resolved', assignee: 'Bob Baker', iteration: 'Acme Platform\\Sprint 11', iterationLabel: 'Sprint 11', allowedStates: ['Active', 'Closed'], organization: 'mockorg', project: 'Acme Platform', scopeKey: 'mockorg Acme Platform' },
        { id: 109, workItemType: 'User Story', typeClass: 'user-story', title: 'As a developer I can generate API keys', state: 'Resolved', assignee: 'Carol Chen', iteration: 'Acme Platform\\Sprint 11', iterationLabel: 'Sprint 11', allowedStates: ['New', 'Active', 'Resolved', 'Closed'], organization: 'mockorg', project: 'Acme Platform', scopeKey: 'mockorg Acme Platform' },
        { id: 110, workItemType: 'Bug', typeClass: 'bug', title: 'WebSocket disconnects after 30 seconds idle', state: 'New', assignee: 'Alice Alvarez', iteration: 'Acme Platform\\Sprint 13', iterationLabel: 'Sprint 13', allowedStates: ['Active', 'Resolved', 'Closed'], organization: 'mockorg', project: 'Acme Platform', scopeKey: 'mockorg Acme Platform' },
    ],
};

router.get('/screenshots/pr-details', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(scaffoldPage('PR #201 – ADOExt', 'ado-pr-details-app', '/ext-media/prDetails.js', PR_DETAILS_DATA));
});

router.get('/screenshots/pipeline-run', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(scaffoldPage('Build #20260518.1 – ADOExt', 'ado-pipeline-run-details-app', '/ext-media/pipelineRunDetails.js', PIPELINE_RUN_DATA));
});

router.get('/screenshots/work-item', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(scaffoldPage('Work Item #101 – ADOExt', 'ado-work-item-details-app', '/ext-media/workItemDetails.js', WORK_ITEM_DATA));
});

router.get('/screenshots/planning', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(scaffoldPage('Backlog – ADOExt', 'ado-planning-app', '/ext-media/planning.js', PLANNING_DATA));
});

router.get('/screenshots', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html><html><head><title>ADOExt Screenshots</title>
<style>body{font-family:sans-serif;padding:24px;background:#1e1e1e;color:#ccc}a{color:#3794ff;display:block;margin:8px 0;font-size:1.1em}</style>
</head><body><h1>ADOExt Screenshot Pages</h1>
<a href="/screenshots/pr-details">PR Details (PR #201)</a>
<a href="/screenshots/pipeline-run">Pipeline Run Details (Build #20260518.1 — failed)</a>
<a href="/screenshots/work-item">Work Item Details (#101 Bug)</a>
<a href="/screenshots/planning">Backlog Planning</a>
</body></html>`);
});

export default router;
