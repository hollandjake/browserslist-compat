import { createRequire } from "node:module";

import type { Report } from "./estree";
import type { FeatureKey } from "./features";
import { regexFeatures } from "./regex";
import { isUsing, LOGICAL_ASSIGNMENT, regexFromLiterals } from "./syntax";

/**
 * A node from oxc-parser's lazy deserialization: an object whose getters read the parser's buffer, built only for
 * the node types a visitor asks for. Its `type` is oxc's own name for it (`IdentifierReference`, `StringLiteral`), not
 * ESTree's.
 */
type LazyNode = { readonly start: number; readonly [key: string]: any };

type Handler = (node: LazyNode) => void;

/** What a lazy visitor checks: the features to find, whether to read `RegExp` calls, and whether to report those inside functions */
export type Wanted = {
    readonly features: { has(feature: FeatureKey): boolean; keys(): Iterable<FeatureKey> };
    readonly regexCalls: boolean;
    readonly regexInFunction: boolean;
};

/** oxc-parser's lazy deserialization, which its type declarations leave out while it's experimental */
type LazyParser = {
    parseSync(
        filename: string,
        code: string,
        options: { experimentalLazy: true; sourceType: "module"; lang: "js" },
    ): { errors: readonly unknown[]; visit(visitor: unknown): void; dispose?(): void };
    experimentalGetLazyVisitor(): new (handlers: Record<string, Handler>) => unknown;
};
type Oxc = typeof import("oxc-parser") & LazyParser;

const require = createRequire(import.meta.url);

/**
 * oxc-parser, loaded on the first check rather than with this module, so a Vite config that only sets the target
 * never loads its native binding. It's an ES module, which `require` loads on every Node this package supports, and Bun.
 */
let loaded: Oxc | undefined;
export const oxc = (): Oxc => (loaded ??= require("oxc-parser") as Oxc);

/** Whether oxc-parser is loaded yet: until it is, a small chunk is checked faster without it (see `src/plugin.ts`) */
export const oxcLoaded = (): boolean => loaded !== undefined;

/** Whether this runtime has raw transfer: Node 22 and later, Deno 2 and later, on 64-bit little-endian */
let supported: boolean | undefined;
export const lazySupported = (): boolean => (supported ??= oxc().rawTransferSupported());

/** The run a visitor's handlers report to, and the code it's visiting: set before each visit, which is synchronous */
let report: Report;
let source = "";
/** Where `...` and `RegExp` are in the code, found once per visit, so a handler can tell whether its node holds one */
let dots: number[] = [];
let regexps: number[] = [];
/** How many functions the visit is inside */
let depth = 0;

/** Visitors by the features they find, since every chunk of a build wants much the same */
const visitors = new Map<string, unknown>();

/**
 * Parses code with oxc-parser's lazy raw transfer and visits only the node types the wanted features need, so no
 * object is built for any other node: several times faster than parsing to ESTree (the README's Speed section has the
 * numbers).
 *
 * @param code - JavaScript, as a module
 * @param wanted - The features to find, and what to do about `RegExp` calls
 * @param to - Where each feature found, and each `RegExp` built from literals in a function, goes
 * @returns False if the code didn't parse, so the caller can report the parser's error its own way
 */
export function visitLazy(code: string, wanted: Wanted, to: Report): boolean {
    const result = oxc().parseSync("chunk.js", code, { experimentalLazy: true, sourceType: "module", lang: "js" });
    try {
        if (result.errors.length) return false;
        report = to;
        source = code;
        dots = wanted.features.has("objectRestSpread") ? positions(code, "...") : [];
        regexps = wanted.regexCalls ? positions(code, "RegExp") : [];
        depth = 0;
        result.visit(visitorFor(wanted));
        return true;
    } finally {
        result.dispose?.();
    }
}

/** @returns The visitor for a set of wanted features, built once */
function visitorFor(wanted: Wanted): unknown {
    const key = `${[...wanted.features.keys()].sort().join(",")}|${wanted.regexCalls}|${wanted.regexInFunction}`;
    let visitor = visitors.get(key);
    if (!visitor) {
        const Visitor = oxc().experimentalGetLazyVisitor();
        visitor = new Visitor(handlers(wanted));
        visitors.set(key, visitor);
    }
    return visitor;
}

/** @returns One handler per node type that can carry a wanted feature */
function handlers({ features: want, regexCalls, regexInFunction }: Wanted): Record<string, Handler> {
    const on: Record<string, Handler> = {};
    // Reports a feature only if it's wanted, so a handler shared by several features can report each unchecked
    const found = (feature: FeatureKey, node: LazyNode) => {
        if (want.has(feature)) report.feature(feature, node.start);
    };
    const regexWanted = REGEX_FEATURES.some((feature) => want.has(feature));
    const calls = regexCalls && (regexWanted || regexInFunction);
    const trackDepth = calls || want.has("topLevelAwait");

    if (want.has("bigint")) on.BigIntLiteral = (node) => found("bigint", node);
    if (want.has("numericSeparators"))
        on.NumericLiteral = (node) => {
            if (node.raw?.includes("_")) found("numericSeparators", node);
        };
    if (regexWanted) {
        on.RegExpLiteral = (node) => {
            // `raw` is `/pattern/flags`, a plain string; `regex` holds objects that read the buffer
            const raw: string = node.raw;
            const slash = raw.lastIndexOf("/");
            regexFeatures(raw.slice(1, slash), raw.slice(slash + 1), (feature) => found(feature, node));
        };
    }
    if (want.has("exponentiation"))
        on.BinaryExpression = (node) => {
            if (node.operator === "**") found("exponentiation", node);
        };
    if (want.has("exponentiation") || want.has("logicalAssignment")) {
        on.AssignmentExpression = (node) => {
            const operator: string = node.operator;
            if (operator === "**=") found("exponentiation", node);
            else if (LOGICAL_ASSIGNMENT.has(operator)) found("logicalAssignment", node);
        };
    }
    if (want.has("privateIn")) on.PrivateInExpression = (node) => found("privateIn", node);
    if (want.has("nullishCoalescing"))
        on.LogicalExpression = (node) => {
            if (node.operator === "??") found("nullishCoalescing", node);
        };
    if (want.has("optionalChaining")) on.ChainExpression = (node) => found("optionalChaining", node);
    if (want.has("objectRestSpread")) {
        on.ObjectExpression = (node) => {
            // Most object literals hold no `...` at all: only then read their properties
            if (!within(dots, node.start, node.end)) return;
            for (const property of node.properties) {
                if (property.type === "SpreadElement") {
                    found("objectRestSpread", node);
                    return;
                }
            }
        };
        // A pattern's rest element isn't among its lazy properties, and must come last: look for `...` after them
        const rest: Handler = (node) => {
            const properties = node.properties;
            const from = properties.length ? properties[properties.length - 1].end : node.start + 1;
            if (source.slice(from, node.end).includes("...")) found("objectRestSpread", node);
        };
        on.ObjectPattern = rest;
        on.ObjectAssignmentTarget = rest;
    }
    if (want.has("asyncFunctions") || want.has("asyncIteration") || trackDepth) {
        const asyncFunction: Handler = (node) => {
            if (node.async) {
                found(node.generator ? "asyncIteration" : "asyncFunctions", node);
            }
            depth++;
        };
        const exit: Handler = () => {
            depth--;
        };
        on.Function = asyncFunction;
        on.ArrowFunctionExpression = asyncFunction;
        on["Function:exit"] = exit;
        on["ArrowFunctionExpression:exit"] = exit;
    }
    if (want.has("asyncIteration") || want.has("topLevelAwait")) {
        on.ForOfStatement = (node) => {
            if (!node.await) return;
            const feature = depth === 0 ? "topLevelAwait" : "asyncIteration";
            if (want.has(feature)) found(feature, node);
        };
    }
    if (want.has("topLevelAwait"))
        on.AwaitExpression = (node) => {
            if (depth === 0) found("topLevelAwait", node);
        };
    if (want.has("optionalCatchBinding"))
        on.CatchClause = (node) => {
            if (node.param === null) found("optionalCatchBinding", node);
        };
    if (want.has("classFields")) on.PropertyDefinition = (node) => found("classFields", node);
    if (want.has("privateMethods")) {
        on.MethodDefinition = (node) => {
            if (node.key.type === "PrivateIdentifier") found("privateMethods", node);
        };
    }
    if (want.has("staticBlocks")) on.StaticBlock = (node) => found("staticBlocks", node);
    if (want.has("explicitResourceManagement")) {
        on.VariableDeclaration = (node) => {
            if (isUsing(node.kind)) found("explicitResourceManagement", node);
        };
    }
    if (want.has("importMeta")) on.ImportMeta = (node) => found("importMeta", node);
    if (want.has("dynamicImport")) on.ImportExpression = (node) => found("dynamicImport", node);
    if (want.has("hashbang")) on.Hashbang = (node) => found("hashbang", node);
    if (calls) {
        const call: Handler = (node) => {
            // The callee comes first: skip every call that doesn't start with `RegExp` (or `new RegExp`) unread
            if (!within(regexps, node.start, node.start + 16)) return;
            const callee = node.callee;
            if (callee.type !== "IdentifierReference" || callee.name !== "RegExp") return;
            const values: (string | undefined)[] = [];
            for (const arg of node.arguments) values.push(arg.type === "StringLiteral" ? arg.value : undefined);
            const literal = regexFromLiterals(values);
            if (!literal) return;
            const { pattern, flags } = literal;
            if (regexWanted) regexFeatures(pattern, flags, (feature) => found(feature, node));
            if (regexInFunction && depth > 0) report.regexInFunction(pattern, node.start);
        };
        on.NewExpression = call;
        on.CallExpression = call;
    }
    return on;
}

/** The features a regex can carry */
export const REGEX_FEATURES: readonly FeatureKey[] = [
    "regexDotAll",
    "regexNamedGroups",
    "regexDuplicateNamedGroups",
    "regexPropertyEscapes",
    "regexUnicodeSets",
    "regexModifiers",
    "regexLookbehind",
    "regexHasIndices",
];

/** @returns Each index at which `token` starts in `code`, in order */
function positions(code: string, token: string): number[] {
    const found: number[] = [];
    for (let i = code.indexOf(token); i !== -1; i = code.indexOf(token, i + token.length)) found.push(i);
    return found;
}

/** @returns Whether any of the sorted positions is in `[from, to)` */
function within(sorted: readonly number[], from: number, to: number): boolean {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (sorted[mid] < from) low = mid + 1;
        else high = mid;
    }
    return low < sorted.length && sorted[low] < to;
}
