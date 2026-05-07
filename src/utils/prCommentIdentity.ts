import type { IdentityRef } from '../api/adoClient';

export function isToolIdentity(identity: IdentityRef | undefined): boolean {
    if (!identity) {
        return false;
    }

    if (identity.isContainer === true) {
        return true;
    }

    const descriptor = identity.descriptor?.toLowerCase() ?? '';
    return descriptor.startsWith('svc.');
}
