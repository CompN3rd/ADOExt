export type BuildSummaryStatusKind = 'succeeded' | 'failed' | 'inprogress' | 'other';

export interface BuildSummaryViewModel {
    id: number;
    buildNumber: string;
    definitionName: string;
    requestedFor: string;
    startTime: string;
    statusLabel: string;
    statusKind: BuildSummaryStatusKind;
}

export type PipelineTimelineStatusKind = 'succeeded' | 'failed' | 'running' | 'canceled' | 'other';

export interface PipelineTimelineNodeViewModel {
    id: string;
    name: string;
    recordType: string;
    statusLabel: string;
    statusKind: PipelineTimelineStatusKind;
    startTime: string;
    duration: string;
    children: PipelineTimelineNodeViewModel[];
}

export interface PipelineArtifactViewModel {
    name: string;
    downloadUrl: string;
}

export interface PipelineRunDetailsViewModel {
    id: number;
    pipelineName: string;
    runNumber: string;
    statusLabel: string;
    statusKind: PipelineTimelineStatusKind;
    branch: string;
    requestedBy: string;
    reason: string;
    startTime: string;
    finishTime: string;
    duration: string;
    repository: string;
    commit: string;
    yamlFile: string;
    canRerun: boolean;
    canCancel: boolean;
    webUrl: string;
    logsUrl: string;
    artifacts: PipelineArtifactViewModel[];
    timeline: PipelineTimelineNodeViewModel[];
}

export interface BadgeViewModel {
    label: string;
    className: string;
}

export interface NamedBadgeRowViewModel {
    name: string;
    badge: BadgeViewModel;
    description?: string;
}

export interface PrReviewerViewModel {
    displayName: string;
    voteLabel: string;
    voteClass: string;
}

export interface PrReviewActionViewModel {
    label: string;
    vote: number;
}

export interface PrCommentViewModel {
    author: string;
    content: string;
    isTool: boolean;
}

export interface PrThreadViewModel {
    id: number;
    isResolved: boolean;
    isToolThread: boolean;
    statusLabel: string;
    comments: PrCommentViewModel[];
}

export interface PrWorkItemRefViewModel {
    id: number;
    title: string;
}

export interface PrDetailsViewModel {
    prId: number;
    title: string;
    description: string;
    sourceBranch: string;
    targetBranch: string;
    author: string;
    isDraft: boolean;
    createdDate: string;
    status: number;
    mergeStatus: string;
    hasConflicts: boolean;
    autoCompleteSetBy: string | null;
    lastMergeSourceCommitId: string;
    associatedWorkItems: PrWorkItemRefViewModel[];
    canComplete: boolean;
    reviewers: PrReviewerViewModel[];
    reviewActions: PrReviewActionViewModel[];
    branchStatuses: NamedBadgeRowViewModel[];
    checks: NamedBadgeRowViewModel[];
    showResolvedThreads: boolean;
    threads: PrThreadViewModel[];
    builds: BuildSummaryViewModel[];
}

export type LinkedItemType = 'pr' | 'branch' | 'commit';

export interface LinkedItemViewModel {
    type: LinkedItemType;
    label: string;
    webUrl: string;
}

export interface WorkItemCommentViewModel {
    author: string;
    date: string;
    html: string;
    isPlainText: boolean;
}

export interface WorkItemMetaRowViewModel {
    label: string;
    value: string;
}

export interface WorkItemDetailsViewModel {
    id: number;
    title: string;
    workItemType: string;
    workItemTypeIconUrl?: string;
    state: string;
    stateColor: string;
    priority?: number;
    metaRows: WorkItemMetaRowViewModel[];
    descriptionHtml: string;
    linkedItems: LinkedItemViewModel[];
    comments: WorkItemCommentViewModel[];
    allowedStates: string[];
    builds: BuildSummaryViewModel[];
}

export type PlanningPanelKind = 'backlog' | 'board' | 'sprint';

export interface PlanningScopeViewModel {
    key: string;
    organization: string;
    project: string;
    label: string;
}

export interface PlanningItemViewModel {
    id: number;
    workItemType: string;
    typeClass: string;
    title: string;
    state: string;
    assignee: string;
    iteration: string;
    iterationLabel: string;
    parentId?: number;
    allowedStates: string[];
    organization: string;
    project: string;
    scopeKey: string;
}

export interface PlanningViewModel {
    kind: PlanningPanelKind;
    title: string;
    subtitle: string;
    scopes: PlanningScopeViewModel[];
    items: PlanningItemViewModel[];
}

export type PrDetailsMessage =
    | { type: 'openInBrowser' }
    | { type: 'openDiff' }
    | { type: 'setVote'; vote: number }
    | { type: 'addComment'; content: string }
    | { type: 'reply'; threadId: number; content: string }
    | { type: 'setStatus'; threadId: number; status: number }
    | { type: 'setShowResolvedThreads'; showResolved: boolean }
    | { type: 'openBuild'; buildId: number }
    | { type: 'completePr'; mergeStrategy: number; deleteSourceBranch: boolean; transitionWorkItems: boolean; mergeCommitMessage: string }
    | { type: 'setAutoComplete'; mergeStrategy: number; deleteSourceBranch: boolean; transitionWorkItems: boolean; mergeCommitMessage: string }
    | { type: 'cancelAutoComplete' };

export type WorkItemDetailsMessage =
    | { type: 'openInBrowser' }
    | { type: 'startWorking' }
    | { type: 'addComment'; content: string }
    | { type: 'setState'; state: string }
    | { type: 'openLinkedItem'; url: string }
    | { type: 'openBuild'; buildId: number };

export type PlanningMessage =
    | { type: 'refresh' }
    | { type: 'quickCreate'; organization?: string; project?: string }
    | { type: 'openWorkItem'; id: number; organization?: string; project?: string }
    | { type: 'setState'; id: number; state: string; organization?: string; project?: string }
    | { type: 'editAssignee'; id: number; organization?: string; project?: string }
    | { type: 'editIteration'; id: number; organization?: string; project?: string };

export type PipelineRunDetailsMessage =
    | { type: 'openInBrowser' }
    | { type: 'openLogs' }
    | { type: 'rerun' }
    | { type: 'cancel' }
    | { type: 'openArtifact'; url: string };
