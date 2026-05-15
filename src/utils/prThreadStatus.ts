import { CommentThreadStatus } from 'azure-devops-node-api/interfaces/GitInterfaces';

const RESOLVED_THREAD_STATUSES = new Set<CommentThreadStatus>([
    CommentThreadStatus.Fixed,
    CommentThreadStatus.WontFix,
    CommentThreadStatus.Closed,
    CommentThreadStatus.ByDesign
]);

export function isResolvedPullRequestThread(status: CommentThreadStatus | undefined): boolean {
    return status !== undefined && RESOLVED_THREAD_STATUSES.has(status);
}
