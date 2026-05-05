/**
 * Matches TODO-style comments used by both the command handler and the code action provider.
 * The comment marker (//  #  or  /*) must appear at the very start of the non-whitespace
 * content on the line so that TODO text inside string literals is not treated as a comment.
 */
export const TODO_COMMENT_PATTERN = /^\s*(?:\/\/|#|\/\*)\s*TODO(?:\([^)]*\))?[:\s]+(.+?)(?:\s*\*\/\s*)?$/i;
