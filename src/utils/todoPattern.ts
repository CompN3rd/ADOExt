/** Matches TODO-style comments used by both the command handler and the code action provider. */
export const TODO_COMMENT_PATTERN = /(?:\/\/|#|\/\*)\s*TODO(?:\([^)]*\))?[:\s]+(.+?)(?:\s*\*\/\s*)?$/i;
