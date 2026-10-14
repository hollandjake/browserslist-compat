import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import pkg from "../package.json" with { type: "json" };
import type { Problem } from "./check";
import { writeQuietly } from "./files";

/** How long an unused result is kept: a library's output usually changes within days, and then its key does too */
const KEEP = 14 * 24 * 60 * 60 * 1000;

/**
 * What the check found in each chunk it has checked, one small file per result in `node_modules/.cache`, so a build
 * whose output hasn't changed since the last one checks nothing: a hit costs a hash of the chunk and a file read
 * (under a millisecond on 343 KB), and never loads oxc-parser, where a fresh check costs 12 to 25 ms.
 */
export class CheckCache {
    private readonly dir: string;
    private pruned = false;

    /** @param cache - This package's folder in `node_modules/.cache` */
    constructor(cache: string) {
        this.dir = join(cache, "checks");
    }

    /**
     * @param code - A chunk
     * @param settings - Everything else the result depends on: the targets and the check's options
     * @returns The key the chunk's result is kept under
     */
    key(code: string, settings: string): string {
        return createHash("sha256")
            .update(pkg.version)
            .update("\0")
            .update(settings)
            .update("\0")
            .update(code)
            .digest("hex");
    }

    /**
     * @param key - From {@link CheckCache.key}
     * @returns The problems found before for this key, or undefined if it hasn't been checked
     */
    get(key: string): Problem[] | undefined {
        try {
            return JSON.parse(readFileSync(join(this.dir, `${key}.json`), "utf8")) as Problem[];
        } catch {
            return undefined;
        }
    }

    /**
     * Keeps a result
     *
     * @param key - From {@link CheckCache.key}
     * @param problems - What the check found
     */
    set(key: string, problems: readonly Problem[]): void {
        writeQuietly(join(this.dir, `${key}.json`), JSON.stringify(problems));
        if (!this.pruned) this.prune();
    }

    /** Drops results not written for two weeks, once per process */
    private prune(): void {
        this.pruned = true;
        const now = Date.now();
        let names: string[];
        try {
            names = readdirSync(this.dir);
        } catch {
            return;
        }
        for (const name of names) {
            const file = join(this.dir, name);
            try {
                if (now - statSync(file).mtimeMs > KEEP) unlinkSync(file);
            } catch {
                // Another build may have removed it
            }
        }
    }
}
