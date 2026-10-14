import { walkProgram, type Node, type Report } from "./estree";
import type { FeatureKey } from "./features";
import { lackingFeatures, type Lacking } from "./lacking";
import { lazySupported, oxc, visitLazy } from "./lazy";

/** Something in the output that a target can't run, or a regex that costs more than it should */
export type Problem = {
    /** What it is */
    readonly kind: "unsupported" | "regex in function";
    /** The feature, for `unsupported` */
    readonly feature?: FeatureKey;
    /** Where it starts in the code, as a UTF-16 offset */
    readonly at: number;
    /** A sentence saying what's wrong */
    readonly message: string;
};

/** How to check */
export type CheckOptions = {
    /** Parses to ESTree where lazy raw transfer isn't available; oxc-parser's own parse by default */
    readonly parse?: (code: string) => Node;
    /** Report a `RegExp` built from literals inside a function; on by default */
    readonly regexInFunction?: boolean;
    /** `lazy` (oxc-parser's raw transfer, the default on Node) or `estree` (a full parse and walk, and what Bun always uses) */
    readonly engine?: "lazy" | "estree";
};

/**
 * Finds what in some JavaScript a target can't run: syntax newer than ES2015 and regex features, from literals and
 * from `RegExp` calls with literal arguments (tsdown rewrites a regex literal its targets can't parse that way), and
 * each `RegExp` built from literals inside a function, where it compiles again on every call.
 *
 * Only the features some target lacks are looked for: the lazy engine visits just the node types that can carry
 * them, which in most code are rare, and with none lacking and no `RegExp` in the text there's no parse at all.
 *
 * @param code - A module, such as one output chunk
 * @param targets - oxc targets, such as `chrome61`; `es` targets and engines with no data are ignored
 * @param options - The parser to fall back on, whether to report `RegExp` calls in functions, and which engine to use
 * @returns Each problem, in source order
 */
export function checkCode(code: string, targets: readonly string[], options: CheckOptions = {}): Problem[] {
    const lacking = lackingFeatures(targets);
    // `RegExp` calls are read only when the text has one: a regex tsdown rewrote, or the code's own
    const regexCalls = code.includes("RegExp");
    const regexInFunction = options.regexInFunction !== false && regexCalls;
    if (lacking.size === 0 && !regexInFunction) return [];

    const { problems, report } = collector(lacking, lacking, regexInFunction);
    // The lazy engine needs raw transfer, which Node has and Bun doesn't; where there's none the check walks ESTree
    const lazy = options.engine !== "estree" && lazySupported();
    if (!lazy || !visitLazy(code, { features: lacking, regexCalls, regexInFunction }, report)) {
        walkProgram((options.parse ?? parseEstree)(code), lacking, report);
    }
    return inSourceOrder(problems);
}

/**
 * Checks a program already parsed to ESTree, every feature some target lacks
 *
 * @param program - From rolldown's `this.parse`, `parseAst`, or anything giving oxc's ESTree
 * @param targets - oxc targets, such as `chrome61`
 * @returns Each problem, in source order
 */
export function checkProgram(program: Node, targets: readonly string[]): Problem[] {
    const lacking = lackingFeatures(targets);
    const { problems, report } = collector(lacking, new Set(lacking.keys()), true);
    walkProgram(program, lacking, report);
    return inSourceOrder(problems);
}

/**
 * @param lacking - Each feature the targets lack, with its message
 * @param wanted - The features to report
 * @param regexInFunction - Whether to report a `RegExp` built from literals inside a function
 * @returns A list of problems, and the report that adds to it
 */
function collector(
    lacking: Lacking,
    wanted: { has(feature: FeatureKey): boolean },
    regexInFunction: boolean,
): { problems: Problem[]; report: Report } {
    const problems: Problem[] = [];
    const report: Report = {
        feature(feature, at) {
            const message = lacking.get(feature);
            if (message !== undefined && wanted.has(feature))
                problems.push({ kind: "unsupported", feature, at, message });
        },
        regexInFunction(pattern, at) {
            if (!regexInFunction) return;
            problems.push({
                kind: "regex in function",
                at,
                message: `new RegExp(${JSON.stringify(pattern)}) compiles on every call; make the regex a module-level constant`,
            });
        },
    };
    return { problems, report };
}

/**
 * @param problems - The problems as the walk found them
 * @returns Them in source order, one per feature and place (a regex can carry a feature twice)
 */
function inSourceOrder(problems: Problem[]): Problem[] {
    const seen = new Set<string>();
    return problems
        .filter((problem) => {
            const key = `${problem.at}|${problem.kind}|${problem.feature}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => a.at - b.at);
}

/**
 * @param code - A module
 * @returns It parsed to ESTree with oxc-parser, for the `estree` engine when no parser is given
 */
function parseEstree(code: string): Node {
    return oxc().parseSync("chunk.js", code, { sourceType: "module", lang: "js" }).program as unknown as Node;
}
