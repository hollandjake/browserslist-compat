import { parseAst } from "rolldown/parseAst";
import { describe, expect, test } from "vitest";

import { checkCode, checkProgram, type Problem } from "../src/check";
import type { Node } from "../src/estree";
import type { FeatureKey } from "../src/features";
import { lazySupported } from "../src/lazy";

const ES6 = ["chrome61", "edge16", "firefox60", "ios11", "opera48", "safari11", "samsung8.2", "node18", "deno1"];
const MODERN = ["chrome130", "edge130", "firefox130", "ios18", "safari18", "node22"];

// The lazy engine runs only where oxc-parser has raw transfer (Node 22+); elsewhere only the fallback is tested
const ENGINES = lazySupported() ? (["lazy", "estree"] as const) : (["estree"] as const);
type Engine = (typeof ENGINES)[number];

/** @returns What the check finds in some code, with one engine */
function check(code: string, targets: readonly string[], engine: Engine): Problem[] {
    return checkCode(code, targets, { engine, parse: (text) => parseAst(text) as unknown as Node });
}

describe.each(ENGINES)("checkCode (%s)", (engine) => {
    /** @returns The features the check finds in some code, for some targets */
    function features(code: string, targets: readonly string[] = ES6): FeatureKey[] {
        return check(code, targets, engine).flatMap((problem) => (problem.feature ? [problem.feature] : []));
    }

    test.each<[string, FeatureKey]>([
        ["const a = 1n;", "bigint"],
        ["a?.b;", "optionalChaining"],
        ["a ?? b;", "nullishCoalescing"],
        ["a ??= b;", "logicalAssignment"],
        ["a ||= b;", "logicalAssignment"],
        ["const n = 1_000;", "numericSeparators"],
        ["const o = { ...a };", "objectRestSpread"],
        ["const { a, ...rest } = o;", "objectRestSpread"],
        ["try {} catch {}", "optionalCatchBinding"],
        ["async function* g() {}", "asyncIteration"],
        ["async function f() { for await (const x of y) {} }", "asyncIteration"],
        ["class C { x = 1; }", "classFields"],
        ["class C { #m() {} }", "privateMethods"],
        ["class C { static { } }", "staticBlocks"],
        ["const u = import.meta.url;", "importMeta"],
        ["import('x');", "dynamicImport"],
        ["await x;", "topLevelAwait"],
        ["/a(?<=b)c/;", "regexLookbehind"],
        ["/a(?<!b)c/;", "regexLookbehind"],
        ["/(?<year>\\d{4})/;", "regexNamedGroups"],
        ["/\\p{L}/u;", "regexPropertyEscapes"],
        ["/a.b/s;", "regexDotAll"],
        ["/a/d;", "regexHasIndices"],
        ["/[\\p{L}--a]/v;", "regexUnicodeSets"],
        ["/(?i:a)b/;", "regexModifiers"],
        ["new RegExp('(?<=a)b', 'u');", "regexLookbehind"],
        ["RegExp('a.b', 's');", "regexDotAll"],
    ])("finds %s as %s for ES6 targets", (code, feature) => {
        expect(features(code)).toContain(feature);
    });

    test("ES2017 code holds nothing ES6 targets lack", () => {
        const code = `
            async function f(a, ...rest) { const [x, y] = rest; return \`\${await a} \${x ** 2}\`; }
            class C extends Array { constructor() { super(); this.x = 1; } static s() {} get g() { return 1; } }
            const r = /[\\u{1F600}]/u, s = /x/y, t = /[(?<=]\\(?<=/;
            for (const k of [1]) {}
            export { f, C };`;
        expect(features(code)).toEqual([]);
    });

    test("a feature every target has isn't reported", () => {
        expect(features("a?.b ?? /(?<=x)/s;", MODERN)).toEqual([]);
    });

    test("names each target that lacks a feature, and the version it needs", () => {
        const [problem] = check("/(?<=x)/;", ["chrome61", "safari16.4", "firefox60"], engine);
        expect(problem.message).toBe(
            "regex lookbehind: not supported by chrome61 (needs chrome62), firefox60 (needs firefox78)",
        );
    });

    test("an engine with no version that has a feature says so", () => {
        const [problem] = check("a?.b;", ["ie11"], engine);
        expect(problem.message).toBe("optional chaining (?.): not supported by ie11 (no version has it)");
    });

    test("escapes and character classes are read, not taken for groups", () => {
        expect(features(String.raw`/\(?<=a\)/;`)).toEqual([]);
        expect(features(String.raw`/[(?<=a)]/;`)).toEqual([]);
        expect(features(String.raw`/\p{L}/;`)).toEqual([]); // no u flag: \p is just p
        expect(features(String.raw`/\k<a>/;`)).toContain("regexNamedGroups");
    });

    test("a repeated group name is a duplicate named group", () => {
        expect(features("/(?<a>x)|(?<a>y)/;", ["chrome120"])).toEqual(["regexDuplicateNamedGroups"]);
    });

    test("a RegExp built from literals inside a function is reported, at module level it isn't", () => {
        const inFunction = check("function f() { return new RegExp('a', 'u'); }", ES6, engine);
        expect(inFunction.map((problem) => problem.kind)).toEqual(["regex in function"]);
        const arrow = check("const f = () => [new RegExp('a', 'u')];", ES6, engine);
        expect(arrow.map((problem) => problem.kind)).toEqual(["regex in function"]);
        expect(check("const r = new RegExp('a', 'u');", ES6, engine)).toEqual([]);
        // A pattern from a variable is the code's choice, not tsdown's rewrite
        expect(check("function f(p) { return new RegExp(p); }", ES6, engine)).toEqual([]);
    });

    test("a hashbang line", () => {
        expect(features("#!/usr/bin/env node\nconst a = 1;", ["chrome61"])).toEqual(["hashbang"]);
    });

    test("es targets are ignored, since an ES version isn't an engine", () => {
        expect(features("a?.b;", ["es2017"])).toEqual([]);
    });

    test("offsets are UTF-16, after text outside ASCII too", () => {
        const code = 'const s = "é€\u{1F600}"; const t = "😀😀"; a?.b; /(?<=x)/;';
        expect(check(code, ES6, engine).map((problem) => problem.at)).toEqual([
            code.indexOf("a?.b"),
            code.indexOf("/(?<="),
        ]);
    });

    test("a RegExp call's flags are found, though the text has no regex literal with them", () => {
        expect(features("const r = new RegExp('a.b', 's');")).toEqual(["regexDotAll"]);
    });

    test("a feature in a string or comment alone is no problem", () => {
        expect(features("const s = 'a ?? b, a?.b, 1n, #x, ...'; // class C { x = 1 }")).toEqual([]);
    });
});

describe("checkProgram and checkCode agree", () => {
    test("on every sample, with both engines", () => {
        const samples = [
            "const a = 1n, b = /(?<=x)y/su, c = a?.b ?? 1, d = { ...a }; let e; e ??= 1; const f = 1_000;",
            "class C { x = 1; #y = 2; static { } m() { return #y in this; } #p() {} }",
            "async function* g() { for await (const x of y) {} } try {} catch {}",
            "const h = import.meta.url; import('x'); await 1; const i = 2 ** 3; function q() { return RegExp('(?<a>x)', 'd'); }",
        ];
        for (const code of samples) {
            const reference = checkProgram(parseAst(code) as unknown as Node, ES6);
            expect(reference.length).toBeGreaterThan(0);
            for (const engine of ENGINES) expect(check(code, ES6, engine)).toEqual(reference);
        }
    });
});
