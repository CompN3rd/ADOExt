export type AuthRecoveryResult = 'not-auth' | 'refreshed' | 'signed-out';

export type AuthRecoveryHandler = (
    error: unknown,
    source: string
) => Promise<AuthRecoveryResult>;
