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
}

export interface PrThreadViewModel {
    id: number;
    isResolved: boolean;
    statusLabel: string;
    comments: PrCommentViewModel[];
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
    reviewers: PrReviewerViewModel[];
    reviewActions: PrReviewActionViewModel[];
    branchStatuses: NamedBadgeRowViewModel[];
    checks: NamedBadgeRowViewModel[];
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
    | { type: 'openBuild'; buildId: number };

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