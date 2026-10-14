/**
 * The rules both engines apply to a node, so the full ESTree walk (`src/estree.ts`) and the lazy visitor
 * (`src/lazy.ts`), which read nodes in different shapes, can't drift apart on them
 */

/** The logical assignment operators, ES2021 */
export const LOGICAL_ASSIGNMENT: ReadonlySet<string> = new Set(["??=", "||=", "&&="]);

/**
 * @param kind - A variable declaration's kind
 * @returns Whether it's a `using` declaration (explicit resource management)
 */
export function isUsing(kind: string): boolean {
    return kind === "using" || kind === "await using";
}

/**
 * @param values - A `RegExp` call's arguments, each its string if it's a string literal and undefined if it isn't
 * @returns Its pattern and flags when it's called with one or two string literals, as tsdown rewrites a regex literal;
 *   undefined otherwise, such as for a pattern the code builds itself
 */
export function regexFromLiterals(
    values: readonly (string | undefined)[],
): { pattern: string; flags: string } | undefined {
    if (values.length === 0 || values.length > 2) return undefined;
    const [pattern, flags = ""] = values;
    if (pattern === undefined || (values.length === 2 && values[1] === undefined)) return undefined;
    return { pattern, flags };
}
