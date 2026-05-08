export type AdoAuthErrorKind = 'none' | 'refreshable' | 'forbidden-refresh-candidate';

export interface AdoAuthErrorClassification {
    kind: AdoAuthErrorKind;
    statusCode?: number;
    message: string;
}

const MAX_MESSAGE_PARTS = 8;
const MAX_BODY_LENGTH = 2000;

const REFRESHABLE_AUTH_PATTERN = new RegExp([
    '\\bunauthori[sz]ed\\b',
    '\\bVS30063\\b',
    '\\bAADSTS\\d+\\b',
    '\\bMSAL[A-Z0-9_]*\\b',
    '\\bExpiredAuthenticationToken\\b',
    '\\bInvalidAuthenticationToken\\b',
    '\\binvalid[_ -]?grant\\b',
    '\\binvalid[_ -]?token\\b',
    '\\btoken expired\\b',
    '\\bexpired token\\b',
    '\\baccess token expired\\b',
    '\\bauthentication token expired\\b',
    '\\bbearer token expired\\b',
    '\\baccess token is invalid\\b',
    '\\bauthentication token is invalid\\b',
    '\\bbearer token is invalid\\b'
].join('|'), 'i');

export function classifyAdoAuthError(error: unknown): AdoAuthErrorClassification {
    const message = formatAdoError(error);
    const statusCode = findStatusCode(error);
    const searchable = collectSearchableText(error, message);

    if (statusCode === 401 || REFRESHABLE_AUTH_PATTERN.test(searchable)) {
        return { kind: 'refreshable', statusCode, message };
    }

    if (statusCode === 403) {
        return { kind: 'forbidden-refresh-candidate', statusCode, message };
    }

    return { kind: 'none', statusCode, message };
}

export function formatAdoError(error: unknown): string {
    const messages = collectMessages(error);
    const first = messages.find(message => message.trim().length > 0);
    if (first) {
        return first.trim();
    }

    if (typeof error === 'string') {
        return error;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

export function adoErrorFingerprint(error: unknown, source: string): string {
    const classification = classifyAdoAuthError(error);
    return [
        source,
        classification.kind,
        classification.statusCode ?? '',
        classification.message.slice(0, 500)
    ].join('\u0000');
}

function collectSearchableText(error: unknown, formattedMessage: string): string {
    return [formattedMessage, ...collectMessages(error)].join('\n');
}

function collectMessages(error: unknown, depth = 0, seen = new Set<unknown>()): string[] {
    if (error === undefined || error === null || depth > 4 || seen.has(error)) {
        return [];
    }
    seen.add(error);

    if (typeof error === 'string') {
        return [error];
    }

    if (error instanceof Error) {
        return [error.message, ...collectObjectMessages(error, depth, seen)];
    }

    if (typeof error !== 'object') {
        return [String(error)];
    }

    return collectObjectMessages(error, depth, seen);
}

function collectObjectMessages(error: object, depth: number, seen: Set<unknown>): string[] {
    const record = error as Record<string, unknown>;
    const messages: string[] = [];

    for (const key of ['message', 'Message', 'errorMessage', 'typeKey', 'typeName', 'errorCode', 'code']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            messages.push(value);
        }
    }

    for (const key of ['body', 'responseBody', 'result', 'serverError', 'error', 'innerException']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            messages.push(...messagesFromBody(value));
        } else if (value && typeof value === 'object') {
            messages.push(...collectMessages(value, depth + 1, seen));
        }
    }

    const response = record['response'];
    if (response && typeof response === 'object') {
        messages.push(...collectMessages(response, depth + 1, seen));
    }

    return dedupe(messages).slice(0, MAX_MESSAGE_PARTS);
}

function messagesFromBody(body: string): string[] {
    const trimmed = body.trim();
    if (!trimmed) {
        return [];
    }

    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length <= MAX_BODY_LENGTH) {
        try {
            return collectMessages(JSON.parse(trimmed));
        } catch {
            return [trimmed];
        }
    }

    return [trimmed.length > MAX_BODY_LENGTH ? `${trimmed.slice(0, MAX_BODY_LENGTH)}...` : trimmed];
}

function findStatusCode(error: unknown, depth = 0, seen = new Set<unknown>()): number | undefined {
    if (!error || typeof error !== 'object' || depth > 4 || seen.has(error)) {
        return undefined;
    }
    seen.add(error);

    const record = error as Record<string, unknown>;
    for (const key of ['statusCode', 'status']) {
        const value = record[key];
        if (typeof value === 'number' && value >= 100 && value <= 599) {
            return value;
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) {
                return parsed;
            }
        }
    }

    for (const key of ['response', 'result', 'serverError', 'error']) {
        const value = record[key];
        const nested = findStatusCode(value, depth + 1, seen);
        if (nested !== undefined) {
            return nested;
        }
    }

    return undefined;
}

function dedupe(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const normalized = value.trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}
