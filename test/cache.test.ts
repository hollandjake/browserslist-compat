import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

/** @returns A temporary package with a node_modules folder, so the cache has somewhere to go */
function packageWith(fields: object): string {
    const dir = mkdtempSync(join(tmpdir(), "browserslist-compat-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", ...fields }));
    mkdirSync(join(dir, "node_modules"));
    return dir;
}

const cacheFile = (dir: string) => join(dir, "node_modules", ".cache", "browserslist-compat", "targets.json");

/** @returns A fresh copy of the module, as a new build process would load it */
async function fresh(): Promise<typeof import("../src/targets")> {
    vi.resetModules();
    return import("../src/targets");
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe("the target cache", () => {
    test("a resolved query is written to node_modules/.cache, and read back by the next process", async () => {
        const dir = packageWith({ browserslist: ["chrome 90"], engines: { node: ">=20" } });
        const first = (await fresh()).resolveTargets({ cwd: dir });
        expect(first.targets).toEqual(["chrome90", "node20"]);
        const cache = JSON.parse(readFileSync(cacheFile(dir), "utf8"));
        const [key] = Object.keys(cache);
        // Mark the cached result, so reading it back shows it came from the file and not from browserslist
        cache[key].result = { targets: ["chrome1"], skipped: ["from the cache"] };
        writeFileSync(cacheFile(dir), JSON.stringify(cache));
        expect((await fresh()).resolveTargets({ cwd: dir })).toEqual({
            targets: ["chrome1"],
            skipped: ["from the cache"],
        });
    });

    test("an entry older than a day is resolved again", async () => {
        const dir = packageWith({ browserslist: ["chrome 90"] });
        (await fresh()).resolveTargets({ cwd: dir });
        const cache = JSON.parse(readFileSync(cacheFile(dir), "utf8"));
        const [key] = Object.keys(cache);
        cache[key] = { at: Date.now() - 25 * 60 * 60 * 1000, result: { targets: ["chrome1"], skipped: [] } };
        writeFileSync(cacheFile(dir), JSON.stringify(cache));
        expect((await fresh()).resolveTargets({ cwd: dir }).targets).toEqual(["chrome90"]);
    });

    test("a query from browserslist's environment variables isn't cached", async () => {
        const dir = packageWith({ browserslist: ["chrome 90"] });
        vi.stubEnv("BROWSERSLIST", "chrome 100");
        expect((await fresh()).resolveTargets({ cwd: dir }).targets).toEqual(["chrome100"]);
        expect(() => readFileSync(cacheFile(dir))).toThrow();
    });

    test("cache: false skips it", async () => {
        const dir = packageWith({ browserslist: ["chrome 90"] });
        (await fresh()).resolveTargets({ cwd: dir, cache: false });
        expect(() => readFileSync(cacheFile(dir))).toThrow();
    });
});
