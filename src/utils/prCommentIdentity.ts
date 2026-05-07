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

export function isSystemThread(thread: { comments?: Array<{ author?: IdentityRef; content?: string }> }): boolean {
    const first = thread.comments?.[0];
    if (!first?.author) {
        return false;
    }
    const displayName = first.author.displayName?.trim() ?? '';
    return displayName.startsWith('Microsoft.VisualStudio.Services.');
}
