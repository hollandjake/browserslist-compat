import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { resolveTargets } from "../src";

/** @returns A temporary folder holding a package.json with these fields */
function packageWith(fields: object): string {
    const dir = mkdtempSync(join(tmpdir(), "browserslist-compat-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", ...fields }));
    return dir;
}

describe("resolveTargets", () => {
    test("each engine at its oldest version, from the browserslist query and engines", () => {
        const { targets } = resolveTargets({
            browserslist: ["fully supports es6-module"],
            engines: { node: ">=18.0.0", deno: ">=1.0.0" },
        });
        expect(targets).toEqual(
            expect.arrayContaining([
                "chrome61",
                "edge16",
                "firefox60",
                "ios11",
                "opera48",
                "safari11",
                "samsung8.2",
                "node18",
                "deno1",
            ]),
        );
        expect(targets).toHaveLength(9);
    });

    test("Safari's Technology Preview never sets the floor", () => {
        // browserslist lists TP after the numbered versions, so taking the last row as the oldest would give TP
        const { targets, skipped } = resolveTargets({ browserslist: "safari 17, safari TP", engines: {} });
        expect(targets).toEqual(["safari17"]);
        expect(skipped).toEqual(["safari TP (not a version)"]);
    });

    test("a version range counts from its first version", () => {
        expect(resolveTargets({ browserslist: "ios_saf 11.0-11.2", engines: {} }).targets).toEqual(["ios11"]);
    });

    test("the lowest version wins by comparing them, not by where it's listed", () => {
        expect(resolveTargets({ browserslist: "chrome 100, chrome 61, chrome 99", engines: {} }).targets).toEqual([
            "chrome61",
        ]);
    });

    test("Chrome and Firefox for Android, and the Android WebView, are their desktop engines", () => {
        // browserslist knows only the newest version of each Android browser
        const { targets, skipped } = resolveTargets({
            browserslist: "last 1 and_chr version, last 1 and_ff version, last 1 android version",
            engines: {},
        });
        expect(targets.map((target) => target.replace(/[\d.]+$/, "")).sort()).toEqual(["chrome", "firefox"]);
        expect(skipped).toEqual([]);
    });

    test("what oxc can't target is reported, not dropped silently", () => {
        const { targets, skipped } = resolveTargets({
            browserslist: "kaios 3.0-3.1, op_mini all, android 4.4.3-4.4.4, chrome 100",
            engines: { node: ">=20", bun: ">=1.0.0" },
        });
        expect(targets).toEqual(["chrome100", "node20"]);
        for (const reason of [
            "op_mini all (not a version)",
            "kaios 3.0-3.1 (oxc has no kaios target)",
            "android 4.4.3-4.4.4 (oxc has no Android browser target)",
            "bun >=1.0.0 (oxc has no bun target)",
        ]) {
            expect(skipped).toContain(reason);
        }
    });

    test("an engines range it can't read is reported, not guessed", () => {
        const { targets, skipped } = resolveTargets({ browserslist: "chrome 100", engines: { node: ">=22.0.0-rc.1" } });
        expect(targets).toEqual(["chrome100"]);
        expect(skipped).toEqual(["node >=22.0.0-rc.1 (not a range this reads; write it as >=X.Y.Z)"]);
    });

    test("reads browserslist and engines from the nearest package.json", () => {
        const dir = packageWith({ browserslist: ["chrome 90"], engines: { node: "^20.19.0 || >=22" } });
        const nested = join(dir, "src", "deep");
        mkdirSync(nested, { recursive: true });
        expect(resolveTargets({ cwd: nested }).targets).toEqual(["chrome90", "node20.19"]);
    });

    test("a package with no browserslist targets its engines only", () => {
        expect(resolveTargets({ cwd: packageWith({ engines: { node: ">=18.0.0" } }) }).targets).toEqual(["node18"]);
    });
});
