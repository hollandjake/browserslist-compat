import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rolldown } from "rolldown";
import { describe, expect, test } from "vitest";

import { browserslistCompat, browserslistCompatVite } from "../src";

/** @returns A temporary package with an entry file holding `code` */
function fixture(
    code: string,
    fields: object = { browserslist: ["chrome 61", "safari 11"], engines: { node: ">=18" } },
): string {
    const dir = mkdtempSync(join(tmpdir(), "browserslist-compat-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", ...fields }));
    writeFileSync(join(dir, "index.js"), code);
    return dir;
}

/** @returns The output of building a fixture with the plugin, and any warnings */
async function build(
    dir: string,
    options: Parameters<typeof browserslistCompat>[0] = {},
    target?: string | string[],
): Promise<{ code: string; warnings: string[] }> {
    const warnings: string[] = [];
    const bundle = await rolldown({
        input: join(dir, "index.js"),
        cwd: dir,
        transform: target === undefined ? undefined : { target },
        plugins: [browserslistCompat(options)],
        onLog(level, log) {
            if (level === "warn") warnings.push(log.message);
        },
    });
    const { output } = await bundle.generate({ format: "esm" });
    return { code: output[0].code, warnings };
}

describe("browserslistCompat", () => {
    test("lowers to the package's targets", async () => {
        const { code } = await build(fixture("export const f = (a) => a?.b ?? 1;"));
        expect(code).not.toContain("?.");
        expect(code).not.toContain("??");
    });

    test("fails the build on what the targets can't run, saying where and why", async () => {
        await expect(build(fixture("export const big = 10n ** 20n;"))).rejects.toThrow(
            /index\.js:\d+:\d+: BigInt literals: not supported by chrome61 \(needs chrome67\), safari11 \(needs safari14\)/,
        );
    });

    test("finds a regex the build rewrote as new RegExp", async () => {
        await expect(build(fixture("export const r = /(?<=a)b/;"))).rejects.toThrow(/regex lookbehind/);
    });

    test("fails on a rewritten regex compiled on every call, or warns if told to", async () => {
        const dir = fixture("export function f(s) { return /\\u{1F600}/u.test(s); }");
        await expect(build(dir)).rejects.toThrow(/compiles on every call/);
        const { warnings } = await build(dir, { regexInFunction: "warn" });
        expect(warnings.join("\n")).toMatch(/compiles on every call/);
        expect((await build(dir, { regexInFunction: "off" })).warnings).toEqual([]);
    });

    test("passes code its targets run", async () => {
        const { code, warnings } = await build(
            fixture("const r = /\\u{1F600}/u;\nexport function f(s) { return r.test(s); }"),
        );
        expect(code).toContain("RegExp");
        expect(warnings).toEqual([]);
    });
});

describe("a target set in the build config", () => {
    test("is replaced, with a warning naming both", async () => {
        const { code, warnings } = await build(fixture("export const f = (a) => a?.b;"), {}, "es2022");
        expect(code).not.toContain("?.");
        expect(warnings.join("\n")).toMatch(/the target es2022 is replaced by chrome61, safari11, node18/);
    });

    test("tsdown's own, a Node target from engines.node, is replaced quietly", async () => {
        expect((await build(fixture("export const f = 1;"), {}, ["node18.0.0"])).warnings).toEqual([]);
    });

    test("none, or one that's the same as the plugin's, gives no warning", async () => {
        expect((await build(fixture("export const f = 1;"))).warnings).toEqual([]);
        expect((await build(fixture("export const f = 1;"), {}, "safari11,chrome61.0,node18")).warnings).toEqual([]);
    });
});

describe("the result cache", () => {
    test("an unchanged chunk's result is read back, not checked again", async () => {
        const dir = fixture("export const f = (a) => a + 1;");
        mkdirSync(join(dir, "node_modules"));
        await build(dir);
        const checks = join(dir, "node_modules", ".cache", "browserslist-compat", "checks");
        const [entry] = readdirSync(checks);
        // Plant a problem in the kept result: the next build reports it, so it read the cache and didn't check
        const planted = [{ kind: "unsupported", feature: "bigint", at: 0, message: "planted in the cache" }];
        writeFileSync(join(checks, entry), JSON.stringify(planted));
        await expect(build(dir)).rejects.toThrow(/planted in the cache/);
    });

    test("cache: false keeps nothing", async () => {
        const dir = fixture("export const f = (a) => a + 1;");
        mkdirSync(join(dir, "node_modules"));
        await build(dir, { cache: false });
        expect(readdirSync(join(dir, "node_modules"))).toEqual([]);
    });
});

describe("check: false", () => {
    test("adds no renderChunk hook at all", () => {
        expect(browserslistCompat({ check: false }).renderChunk).toBeUndefined();
        expect(browserslistCompat().renderChunk).toBeTypeOf("function");
    });
});

describe("browserslistCompatVite", () => {
    test("sets Vite's oxc target, without Node, as one string", () => {
        const dir = fixture("", { browserslist: ["chrome 61", "safari 11"], engines: { node: ">=18" } });
        expect(browserslistCompatVite().config({ root: dir })).toEqual({ oxc: { target: "chrome61,safari11" } });
    });
});
