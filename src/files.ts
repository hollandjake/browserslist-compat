import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * @param from - The folder to start in
 * @param look - Checks one folder: returns what it found, or undefined to keep looking
 * @returns What `look` found in the nearest folder at or above `from`, or undefined if it found nothing
 */
export function findUp<T>(from: string, look: (dir: string) => T | undefined): T | undefined {
    for (let dir = from; ; dir = dirname(dir)) {
        const found = look(dir);
        if (found !== undefined) return found;
        if (dirname(dir) === dir) return undefined;
    }
}

/**
 * @param from - The folder to start in
 * @returns This package's folder in the nearest `node_modules/.cache`, or undefined if there's no `node_modules`
 */
export function cacheDir(from: string): string | undefined {
    return findUp(from, (dir) => {
        const modules = join(dir, "node_modules");
        return existsSync(modules) ? join(modules, ".cache", "browserslist-compat") : undefined;
    });
}

/**
 * Writes a file through a temporary one and a rename, so a build running alongside never reads it half-written, and
 * says nothing if it can't: a cache that isn't written only costs the next build its time
 *
 * @param file - Where to write
 * @param text - What to write
 */
export function writeQuietly(file: string, text: string): void {
    try {
        mkdirSync(dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        writeFileSync(temporary, text);
        renameSync(temporary, file);
    } catch {
        // Nothing to do: see above
    }
}
