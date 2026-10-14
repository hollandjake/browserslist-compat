import type { Plugin } from "rolldown";

import { checkCode, type Problem } from "./check";
import { CheckCache } from "./check-cache";
import type { Node } from "./estree";
import { cacheDir } from "./files";
import { oxcLoaded } from "./lazy";
import { resolveTargets, type TargetOptions, type Targets } from "./targets";
import { compare, parseTarget } from "./version";

/** How the plugin finds its targets, and what it checks */
export type BrowserslistCompatOptions = TargetOptions & {
    /** Check each output chunk runs on the targets; on by default */
    readonly check?: boolean;
    /**
     * What to do about a `RegExp` built from literals inside a function, which compiles on every call: fail the build
     * (the default), warn (tsdown doesn't fail on warnings unless told to), or say nothing
     */
    readonly regexInFunction?: "error" | "warn" | "off";
};

/** How many problems one error lists before saying how many more there are */
const SHOWN = 20;

/** The chunk size, in UTF-16 code units, under which rolldown's parser checks a first chunk sooner than the lazy engine */
const SMALL_CHUNK = 250_000;

/**
 * A tsdown and rolldown plugin that builds for the package's `browserslist` and `engines`, and fails the build if the
 * output still holds syntax or a regex feature one of them can't run.
 *
 * It sets rolldown's `transform.target`, so oxc lowers what it can; a `target` set in the build's own config is replaced,
 * with a warning. What oxc can't lower (BigInt literals, regex lookbehind and the rest) is an error, with the chunk,
 * line, column and the targets that lack it. So is a regex tsdown turned into `new RegExp(…)` inside a function, which
 * compiles on every call, unless `regexInFunction` says otherwise.
 *
 * @param options - Where to read the targets from, or the targets' sources themselves; `cwd` defaults to rolldown's
 * @returns The plugin
 */
export function browserslistCompat(options: BrowserslistCompatOptions = {}): Plugin {
    let resolved: Targets;
    let checkCache: CheckCache | undefined;
    let settings = "";
    const regexInFunction = options.regexInFunction ?? "error";
    // In watch mode most chunks come back unchanged: each chunk's last code, and what the check found in it
    const lastCheckByChunk = new Map<string, { code: string; problems: Problem[] }>();

    const plugin: Plugin = {
        name: "browserslist-compat",
        options(input) {
            const cwd = options.cwd ?? input.cwd ?? process.cwd();
            resolved = resolveTargets({ ...options, cwd });
            if (options.check !== false && options.cache !== false) {
                const dir = cacheDir(cwd);
                if (dir) checkCache = new CheckCache(dir);
            }
            settings = `${resolved.targets.join(",")}|${regexInFunction}`;
            const replaced = setByUser(input.transform?.target, resolved.targets);
            if (replaced) {
                this.warn(
                    `the target ${replaced.join(", ")} is replaced by ${resolved.targets.join(", ")}, from the ` +
                        `package's browserslist and engines: set the targets there instead`,
                );
            }
            return { ...input, transform: { ...input.transform, target: [...resolved.targets] } };
        },
        buildStart() {
            this.info(`targets: ${resolved.targets.join(", ")}`);
            if (resolved.skipped.length) this.info(`not targeted: ${resolved.skipped.join(", ")}`);
        },
    };
    // With the check off there's no hook at all: even an empty one costs a call from Rust and a copy of each chunk
    if (options.check === false) return plugin;

    plugin.renderChunk = function (code, chunk) {
        // tsdown's declaration build runs the same plugins on TypeScript declarations
        if (/\.d\.[cm]?ts$/.test(chunk.fileName)) return null;
        const previous = lastCheckByChunk.get(chunk.fileName);
        let problems = previous?.code === code ? previous.problems : undefined;
        const key = !problems && checkCache ? checkCache.key(code, settings) : undefined;
        if (key) problems = checkCache!.get(key);
        if (!problems) {
            problems = checkCode(code, resolved.targets, {
                regexInFunction: regexInFunction !== "off",
                parse: (text) => this.parse(text) as unknown as Node,
                // Loading oxc-parser and compiling its lazy visitor costs about 11 ms once. Until that's paid, rolldown's
                // own parser, loaded already, checks a small chunk sooner; past about 250 KB, or in watch mode where
                // many checks follow, the lazy engine wins
                engine: !oxcLoaded() && !this.meta.watchMode && code.length < SMALL_CHUNK ? "estree" : undefined,
            });
            if (key) checkCache!.set(key, problems);
        }
        lastCheckByChunk.set(chunk.fileName, { code, problems });

        const where = (at: number) => `${chunk.fileName}:${lineColumn(code, at)}`;
        const warnOnly = regexInFunction === "warn";
        const failing = problems.filter((problem) => problem.kind === "unsupported" || !warnOnly);
        for (const problem of problems) {
            if (problem.kind === "regex in function" && warnOnly) this.warn(`${where(problem.at)}: ${problem.message}`);
        }
        if (failing.length) {
            const lines = failing.slice(0, SHOWN).map((problem) => `  ${where(problem.at)}: ${problem.message}`);
            if (failing.length > SHOWN) lines.push(`  and ${failing.length - SHOWN} more`);
            this.error(`${chunk.fileName} won't run well on every target:\n${lines.join("\n")}`);
        }
        return null;
    };
    return plugin;
}

/**
 * A Vite plugin that sets Vite's oxc target from the package's browserslist and engines, so Vitest runs code lowered
 * as the build lowers it. Node targets are left out: Vite targets the Node it runs on itself, and rejects a second
 * Node target.
 *
 * @param options - Where to read the targets from, or the targets' sources themselves; `cwd` defaults to Vite's `root`
 * @returns The plugin, for `plugins` in a Vite or Vitest config
 */
export function browserslistCompatVite(options: TargetOptions = {}): {
    name: string;
    config(config: { root?: string }): { oxc: { target: string } };
} {
    return {
        name: "browserslist-compat",
        config(config) {
            const { targets } = resolveTargets({ ...options, cwd: options.cwd ?? config.root });
            const notNode = targets.filter((target) => parseTarget(target)?.engine !== "node");
            // One string, because Vite merges config arrays by concatenating them, which repeats each target
            return { oxc: { target: notNode.join(",") } };
        },
    };
}

/**
 * @param given - The target rolldown was given, before this plugin sets its own
 * @param targets - The targets this plugin sets
 * @returns The given target if the user set one that differs from `targets`, or undefined. tsdown passes a target even
 *   when none is set, `node<version>` from `engines.node`, so a lone Node target that `targets` agrees with counts as
 *   unset.
 */
function setByUser(given: string | readonly string[] | undefined, targets: readonly string[]): string[] | undefined {
    const list = given === undefined ? [] : typeof given === "string" ? given.split(",") : [...given];
    const entries = list.map((target) => target.trim()).filter(Boolean);
    if (entries.length === 0) return undefined;
    const same = (a: string, b: string) => {
        const x = parseTarget(a);
        const y = parseTarget(b);
        return x !== undefined && y !== undefined && x.engine === y.engine && compare(x.version, y.version) === 0;
    };
    const agreed = entries.every((entry) => targets.some((target) => same(entry, target)));
    const tsdownDefault = entries.length === 1 && parseTarget(entries[0])?.engine === "node" && agreed;
    if (tsdownDefault || (agreed && entries.length === targets.length)) return undefined;
    return entries;
}

/**
 * @param text - A chunk's code
 * @param at - A UTF-16 offset into it
 * @returns The 1-based line and column of the offset
 */
function lineColumn(text: string, at: number): string {
    let line = 1;
    let start = 0;
    for (let i = text.indexOf("\n"); i !== -1 && i < at; i = text.indexOf("\n", i + 1)) {
        line++;
        start = i + 1;
    }
    return `${line}:${at - start + 1}`;
}
