/** A version as its numbered parts, most significant first: `16.4` is `[16, 4]` */
export type Version = readonly number[];

/** An oxc or esbuild target split into its engine and version: `safari16.4` is `safari` and `[16, 4]` */
export type Target = { readonly engine: string; readonly version: Version };

/** What {@link minVersion} finds in a range: its lowest version, undefined if it allows none, or `unreadable` */
export type RangeFloor = Version | undefined | "unreadable";

/**
 * @param text - A version such as `16.4`
 * @returns Its parts, or undefined for `TP`, `all` and anything else that isn't a version
 */
export function parseVersion(text: string): Version | undefined {
    if (!/^\d+(\.\d+)*$/.test(text)) return undefined;
    return text.split(".").map(Number);
}

/**
 * @param target - An oxc or esbuild target, such as `chrome61` or `node22.18.0`
 * @returns Its engine and version, or undefined for one with no version, such as `esnext`
 */
export function parseTarget(target: string): Target | undefined {
    const match = /^([a-z_]+)(\d[\d.]*)$/.exec(target);
    const version = match && parseVersion(match[2]);
    return match && version ? { engine: match[1], version } : undefined;
}

/**
 * @param version - A version's parts
 * @returns It as oxc writes it in a target, trailing zeros dropped: `[18, 0, 0]` is `18`, `[16, 4]` is `16.4`
 */
export function formatVersion(version: Version): string {
    let end = version.length;
    while (end > 1 && version[end - 1] === 0) end--;
    return version.slice(0, end).join(".");
}

/**
 * @param a - A version
 * @param b - Another
 * @returns Negative, zero or positive as `a` is older than, the same as or newer than `b`
 */
export function compare(a: Version, b: Version): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
}

/**
 * The lowest version a semver range allows, for the ranges `engines` holds: comparators (`>=18.0.0`, `^22.18.0`,
 * `~1.2`, `18.x`), sets of them (`>=18 <23`), hyphen ranges (`18 - 20`) and `||`. It gives what semver's `minVersion`
 * does for each of these (the tests check it against semver), without depending on semver.
 *
 * @param range - A semver range, as in `engines`
 * @returns The version; undefined if the range allows none; `unreadable` for anything else, such as a prerelease
 */
export function minVersion(range: string): RangeFloor {
    let lowest: Version | undefined;
    for (const alternative of range.split("||")) {
        const low = lowestOf(alternative.trim());
        if (low === "unreadable") return low;
        if (low && (!lowest || compare(low, lowest) < 0)) lowest = low;
    }
    return lowest;
}

const COMPARATOR = /^(>=|<=|>|<|=|\^|~)?\s*v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/;

/**
 * @param set - One `||` alternative of a range: a hyphen range, or comparators separated by spaces
 * @returns The lowest version it allows, undefined if it allows none, or `unreadable`
 */
function lowestOf(set: string): RangeFloor {
    if (set === "" || set === "*" || set === "x" || set === "X") return [0, 0, 0];
    const hyphen = /^(\S+)\s+-\s+\S+$/.exec(set);
    // semver allows space between an operator and its version (`>= 18.1`)
    const comparators = hyphen ? [`>=${hyphen[1]}`] : set.replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1").split(/\s+/);
    let low: Version = [0, 0, 0];
    const uppers: { version: Version; inclusive: boolean }[] = [];
    for (const comparator of comparators) {
        const match = COMPARATOR.exec(comparator);
        if (!match) return "unreadable";
        const [, operator = "", ...parts] = match;
        const given = parts.filter((part) => part !== undefined && !/[xX*]/.test(part)).map(Number);
        const version = [given[0] ?? 0, given[1] ?? 0, given[2] ?? 0];
        if (operator === "<" || operator === "<=") uppers.push({ version, inclusive: operator === "<=" });
        else {
            // `>1.2` allows nothing in 1.2.x, `>1.2.3` nothing at 1.2.3
            const bound = operator === ">" ? justAbove(version, given.length) : version;
            if (compare(bound, low) > 0) low = bound;
        }
    }
    for (const { version, inclusive } of uppers) {
        const c = compare(low, version);
        if (c > 0 || (c === 0 && !inclusive)) return undefined;
    }
    return low;
}

/**
 * @param version - A version, padded to three parts
 * @param given - How many of its parts were written (`>1.2` is two)
 * @returns The lowest version above it at that precision: `>1.2` is `1.3.0`, `>1.2.3` is `1.2.4`
 */
function justAbove(version: Version, given: number): Version {
    if (given >= 3) return [version[0], version[1], version[2] + 1];
    if (given === 2) return [version[0], version[1] + 1, 0];
    return [version[0] + 1, 0, 0];
}
