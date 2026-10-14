import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { transformSync } from "esbuild";
import { describe, expect, test } from "vitest";

import { browserslistToEsbuild } from "../src";

/** @returns A temporary folder holding a package.json with these fields */
function packageWith(fields: object): string {
    const dir = mkdtempSync(join(tmpdir(), "browserslist-compat-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", ...fields }));
    return dir;
}

describe("browserslistToEsbuild", () => {
    test("esbuild takes every target it gives, and lowers by them", () => {
        const target = browserslistToEsbuild(["fully supports es6-module"], {
            engines: { node: ">=18", deno: ">=1" },
        });
        expect(target).toEqual(
            expect.arrayContaining([
                "chrome61",
                "edge16",
                "firefox60",
                "ios11",
                "opera48",
                "safari11",
                "node18",
                "deno1",
            ]),
        );
        expect(transformSync("export const f = (a) => a?.b ?? 1;", { target, format: "esm" }).code).not.toContain("?.");
    });

    test("Samsung Internet, which esbuild has no target for, is left out", () => {
        expect(browserslistToEsbuild("samsung 8.2, chrome 61", { engines: {} })).toEqual(["chrome61"]);
    });

    test("Safari's Technology Preview doesn't set Safari's floor", () => {
        expect(browserslistToEsbuild("safari 17, safari TP", { engines: {} })).toEqual(["safari17"]);
    });

    test("with no query, the package's browserslist and engines", () => {
        const dir = packageWith({ browserslist: ["chrome 90"], engines: { node: ">=20" } });
        expect(browserslistToEsbuild(undefined, { cwd: dir, cache: false })).toEqual(["chrome90", "node20"]);
    });

    test("a query given replaces the package's browserslist, and engines: {} leaves engines out", () => {
        const dir = packageWith({ browserslist: ["chrome 90"], engines: { node: ">=20" } });
        expect(browserslistToEsbuild("firefox 100", { cwd: dir, cache: false })).toEqual(["firefox100", "node20"]);
        expect(browserslistToEsbuild("firefox 100", { cwd: dir, engines: {}, cache: false })).toEqual(["firefox100"]);
    });
});
