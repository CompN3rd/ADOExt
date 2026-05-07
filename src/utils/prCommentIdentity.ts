import type { IdentityRef } from '../api/adoClient';

export function isToolIdentity(identity: IdentityRef | undefined): boolean {
    if (!identity) {
        return false;
    }

    if (identity.isContainer === true) {
        return true;
    }

    const descriptor = identity.descriptor?.toLowerCase() ?? '';
    if (descriptor.startsWith('svc.')) {
        return true;
    }

    const displayName = identity.displayName?.trim() ?? '';
    if (displayName.startsWith('Microsoft.VisualStudio.Services.')) {
        return true;
    }

    return false;
}

const SYSTEM_CONTENT_PATTERNS: RegExp[] = [
    /^policy status has been updated\.?$/i,
    /^voted on this pull request/i,
    /^reset .+ vote/i,
    /^The reference refs\//i,
    /^iteration \d+ has been published/i,
    /^a]+(?: added| removed) as a reviewer/i,
];

export function isSystemThread(thread: {
    properties?: Record<string, { $value?: unknown }>;
    comments?: Array<{ author?: IdentityRef; content?: string }>;
}): boolean {
    // Check thread properties for system thread type markers
    const threadType = thread.properties?.['CodeReviewThreadType']?.$value;
    if (threadType !== undefined && threadType !== null) {
        // CodeReviewThreadType values other than 0 (Regular) are system-generated
        const numType = typeof threadType === 'number' ? threadType : Number(threadType);
        if (!isNaN(numType) && numType !== 0) {
            return true;
        }
    }

    // Fall back to identity-based detection
    const first = thread.comments?.[0];
    if (!first?.author) {
        return false;
    }
    const displayName = first.author.displayName?.trim() ?? '';
    if (displayName.startsWith('Microsoft.VisualStudio.Services.')) {
        return true;
    }

    // Fall back to content pattern matching
    const content = first.content?.trim() ?? '';
    return SYSTEM_CONTENT_PATTERNS.some(pattern => pattern.test(content));
}
