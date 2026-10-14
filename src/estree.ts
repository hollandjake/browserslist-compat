import type { FeatureKey } from "./features";
import type { Lacking } from "./lacking";
import { regexFeatures } from "./regex";
import { isUsing, LOGICAL_ASSIGNMENT, regexFromLiterals } from "./syntax";

/** An ESTree node as rolldown's `this.parse` (oxc) gives it: its type, offsets and any other fields */
export type Node = {
    readonly type: string;
    readonly start: number;
    readonly end: number;
    readonly [key: string]: unknown;
};

/** Called with each feature found and where; a `RegExp` built from literals in a function with its pattern */
export type Report = {
    feature(feature: FeatureKey, at: number): void;
    regexInFunction(pattern: string, at: number): void;
};

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/**
 * Walks a whole ESTree program: the fallback where oxc-parser's lazy raw transfer isn't available (Bun), and the
 * reference the lazy path is tested against
 *
 * @param program - The program, from rolldown's `this.parse` or anything giving oxc's ESTree
 * @param lacking - The features to look for
 * @param report - Where each feature found, and each `RegExp` built from literals in a function, goes
 */
export function walkProgram(program: Node, lacking: Lacking, report: Report): void {
    if (program.hashbang && lacking.has("hashbang")) report.feature("hashbang", 0);
    walk(program, 0, report);
}

/**
 * Visits a node and everything under it
 *
 * @param depth - How many functions it's inside, so an `await` at depth 0 is top-level
 */
function walk(node: Node, depth: number, report: Report): void {
    const at = node.start;
    const found = (feature: FeatureKey) => report.feature(feature, at);
    switch (node.type) {
        case "Literal":
            if (node.bigint !== undefined) found("bigint");
            else if (node.regex) {
                const { pattern, flags } = node.regex as { pattern: string; flags: string };
                regexFeatures(pattern, flags, found);
            } else if (typeof node.value === "number" && typeof node.raw === "string" && node.raw.includes("_")) {
                found("numericSeparators");
            }
            break;
        case "BinaryExpression":
            if (node.operator === "**") found("exponentiation");
            else if (node.operator === "in" && (node.left as Node).type === "PrivateIdentifier") found("privateIn");
            break;
        case "AssignmentExpression":
            if (node.operator === "**=") found("exponentiation");
            else if (LOGICAL_ASSIGNMENT.has(node.operator as string)) found("logicalAssignment");
            break;
        case "LogicalExpression":
            if (node.operator === "??") found("nullishCoalescing");
            break;
        case "ChainExpression":
            found("optionalChaining");
            break;
        case "ObjectExpression":
            if ((node.properties as Node[]).some((p) => p.type === "SpreadElement")) found("objectRestSpread");
            break;
        case "ObjectPattern":
            if ((node.properties as Node[]).some((p) => p.type === "RestElement")) found("objectRestSpread");
            break;
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
            if (node.async && node.generator) found("asyncIteration");
            else if (node.async) found("asyncFunctions");
            break;
        case "ForOfStatement":
            if (node.await) found(depth === 0 ? "topLevelAwait" : "asyncIteration");
            break;
        case "AwaitExpression":
            if (depth === 0) found("topLevelAwait");
            break;
        case "CatchClause":
            if (node.param === null) found("optionalCatchBinding");
            break;
        case "PropertyDefinition":
            found("classFields");
            break;
        case "MethodDefinition":
            if ((node.key as Node).type === "PrivateIdentifier") found("privateMethods");
            break;
        case "StaticBlock":
            found("staticBlocks");
            break;
        case "VariableDeclaration":
            if (isUsing(node.kind as string)) found("explicitResourceManagement");
            break;
        case "MetaProperty":
            if ((node.meta as { name: string }).name === "import") found("importMeta");
            break;
        case "ImportExpression":
            found("dynamicImport");
            break;
        case "NewExpression":
        case "CallExpression": {
            const literal = regexCall(node);
            if (literal) {
                regexFeatures(literal.pattern, literal.flags, found);
                if (depth > 0) report.regexInFunction(literal.pattern, at);
            }
            break;
        }
    }
    const inner = FUNCTIONS.has(node.type) ? depth + 1 : depth;
    for (const key in node) {
        const value = node[key];
        if (Array.isArray(value)) {
            for (const child of value) if (isNode(child)) walk(child, inner, report);
        } else if (isNode(value)) walk(value, inner, report);
    }
}

/** @returns Whether a value is an ESTree node */
function isNode(value: unknown): value is Node {
    return typeof value === "object" && value !== null && typeof (value as Node).type === "string";
}

/**
 * @param node - A call or `new` expression
 * @returns The pattern and flags of `RegExp(…)` or `new RegExp(…)` called with string literals only
 */
function regexCall(node: Node): { pattern: string; flags: string } | undefined {
    const callee = node.callee as Node;
    if (callee.type !== "Identifier" || callee.name !== "RegExp") return undefined;
    const literal = (arg: Node) => (arg.type === "Literal" && typeof arg.value === "string" ? arg.value : undefined);
    return regexFromLiterals((node.arguments as Node[]).map(literal));
}
