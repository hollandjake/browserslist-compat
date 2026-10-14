import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import pkg from "../package.json" with { type: "json" };
import { cacheDir, findUp, writeQuietly } from "./files";
import { compare, formatVersion, minVersion, parseVersion, type Version } from "./version";

/** A browserslist query: one string, or several, as browserslist takes them */
export type Query = string | readonly string[];

/** Where to read a package's `browserslist` and `engines`, or the values themselves */
export type TargetOptions = {
    /** The folder to start looking for `package.json` (and browserslist's own config files) from; `process.cwd()` by default */
    readonly cwd?: string;
    /** A browserslist query to use instead of the package's */
    readonly browserslist?: Query;
    /** Engines to use instead of the package's `engines`: `node` and `deno` become targets */
    readonly engines?: Readonly<Record<string, string>>;
    /**
     * Keep resolved targets in `node_modules/.cache` for a day, so a build needn't load browserslist, and (in the plugin)
     * each chunk's check result, so an unchanged chunk isn't checked again; on by default
     */
    readonly cache?: boolean;
};

/** The targets for oxc (tsdown, rolldown and Vite), and what couldn't become one */
export type Targets = {
    /** One per engine, at its oldest version, such as `chrome61` or `node18` */
    readonly targets: readonly string[];
    /** Each browser or engine left out, with why, such as `kaios 3.0-3.1 (oxc has no kaios target)` */
    readonly skipped: readonly string[];
};

type Browserslist = typeof import("browserslist");

/**
 * browserslist's names for the engines oxc has a target for. The Android browsers are the desktop engine at the same
 * version: Chrome for Android and the Android WebView (from 37) are Chrome, Firefox for Android is Firefox.
 */
const ENGINE: Readonly<Record<string, string>> = {
    chrome: "chrome",
    and_chr: "chrome",
    android: "chrome",
    edge: "edge",
    firefox: "firefox",
    and_ff: "firefox",
    safari: "safari",
    ios_saf: "ios",
    opera: "opera",
    samsung: "samsung",
    ie: "ie",
};

/** `engines` entries that become a target */
const RUNTIME: Readonly<Record<string, string>> = { node: "node", deno: "deno" };

/** How long a cached result is used: queries such as `last 2 years` move with the date */
const CACHE_LIFE = 24 * 60 * 60 * 1000;

const require = createRequire(import.meta.url);

/** browserslist, loaded only when a query isn't cached: loading it and its data takes about 15 ms */
let loaded: Browserslist | undefined;
const browserslist = (): Browserslist => (loaded ??= require("browserslist") as Browserslist);

/** Targets already resolved in this process, by cache key */
const resolvedThisProcess = new Map<string, Targets>();

/**
 * Resolves a package's targets: each browser its browserslist query matches, and each runtime in its `engines`, at
 * the oldest version.
 *
 * Each engine's lowest version is found by comparing versions, not by its place in browserslist's list (which puts
 * Safari's Technology Preview after the numbered versions). Preview and `all` rows are left out rather than setting the
 * floor, Chrome and Firefox for Android and the Android WebView count as their desktop engines, and whatever can't be
 * targeted is reported.
 *
 * A query in `package.json` (or given) is cached by its text, the engines, and the versions of browserslist and its
 * data, for a day, so most builds don't load browserslist at all. One in a `.browserslistrc`, or set through
 * browserslist's environment variables, is resolved every time.
 *
 * @param options - Where to read from, or the values to use
 * @returns The targets, and what was skipped
 */
export function resolveTargets(options: TargetOptions = {}): Targets {
    const cwd = options.cwd ?? process.cwd();
    const manifest = options.engines && options.browserslist ? undefined : nearestManifest(cwd);
    const engines = options.engines ?? manifest?.engines ?? {};
    const declared = options.browserslist ?? manifest?.browserslist;
    const fromEnvironment = ["BROWSERSLIST", "BROWSERSLIST_CONFIG", "BROWSERSLIST_ENV"].some(
        (name) => process.env[name],
    );
    const cacheable = options.cache !== false && !fromEnvironment && isQuery(declared);

    if (!cacheable) {
        // browserslist's environment variables, a .browserslistrc, and an object in package.json (one query per
        // browserslist environment) are all its own config: let it pick, as it would with no query given
        const query = options.browserslist ?? (browserslist().loadConfig({ path: cwd }) as Query | undefined);
        return resolve(query, engines, cwd);
    }

    const key = JSON.stringify([pkg.version, dataVersions(), declared, engines]);
    const known = resolvedThisProcess.get(key);
    if (known) return known;
    const file = targetsFile(cwd);
    const cache = file ? readTargetsCache(file) : {};
    const hit = cache[key];
    if (hit && Date.now() - hit.at < CACHE_LIFE) {
        resolvedThisProcess.set(key, hit.result);
        return hit.result;
    }
    const result = resolve(declared, engines, cwd);
    resolvedThisProcess.set(key, result);
    if (file) writeTargetsCache(file, cache, key, result);
    return result;
}

/**
 * @param query - The browserslist query, if there is one
 * @param engines - The package's `engines`, or the ones given
 * @param cwd - Where browserslist looks for its own config
 * @returns The targets, worked out with browserslist
 */
function resolve(query: Query | undefined, engines: Readonly<Record<string, string>>, cwd: string): Targets {
    const lowest = new Map<string, Version>();
    const skipped: string[] = [];
    const add = (engine: string, version: Version) => {
        const known = lowest.get(engine);
        if (!known || compare(version, known) < 0) lowest.set(engine, version);
    };

    if (query) {
        for (const entry of browserslist()(query as string | string[], { path: cwd })) {
            const [name, range] = entry.split(" ");
            // `11.0-11.2` is a range of versions that support the same; its first is the oldest
            const version = parseVersion(range.split("-")[0]);
            // The Android browser before 37 isn't Chrome, and oxc has no target for it
            const legacy = name === "android" && version !== undefined && version[0] < 37;
            const engine = legacy ? undefined : ENGINE[name];
            if (!version) skipped.push(`${entry} (not a version)`);
            else if (!engine) skipped.push(`${entry} (oxc has no ${legacy ? "Android browser" : name} target)`);
            else add(engine, version);
        }
    }
    for (const [name, range] of Object.entries(engines)) {
        const engine = RUNTIME[name];
        const version = engine ? minVersion(range) : undefined;
        if (!engine) skipped.push(`${name} ${range} (oxc has no ${name} target)`);
        else if (version === "unreadable") {
            skipped.push(`${name} ${range} (not a range this reads; write it as >=X.Y.Z)`);
        } else if (!version) skipped.push(`${name} ${range} (allows no version)`);
        else if (version.every((part) => part === 0)) skipped.push(`${name} ${range} (any version)`);
        else add(engine, version);
    }

    const targets = [...lowest].map(([engine, version]) => engine + formatVersion(version));
    return { targets, skipped };
}

/**
 * @param value - A `browserslist` value from package.json
 * @returns Whether it's a query, rather than one query per browserslist environment
 */
function isQuery(value: unknown): value is Query {
    return typeof value === "string" || Array.isArray(value);
}

/** The versions of browserslist and caniuse-lite, read once: they can't change while a process runs */
let versions: string | undefined;

/** @returns The versions of browserslist and caniuse-lite, its data, which a cached result is only good for */
function dataVersions(): string {
    if (versions === undefined) {
        const browserslistPackage = require.resolve("browserslist/package.json");
        const caniusePackage = createRequire(browserslistPackage).resolve("caniuse-lite/package.json");
        const version = (path: string) => (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
        versions = `${version(browserslistPackage)}/${version(caniusePackage)}`;
    }
    return versions;
}

type TargetsCache = Record<string, { readonly at: number; readonly result: Targets }>;

/**
 * @param from - The folder to start looking in
 * @returns The targets cache file, or undefined if there's no `node_modules`
 */
function targetsFile(from: string): string | undefined {
    const dir = cacheDir(from);
    return dir && join(dir, "targets.json");
}

/**
 * @param file - The targets cache file
 * @returns Its entries, or none if it's missing or unreadable
 */
function readTargetsCache(file: string): TargetsCache {
    try {
        return JSON.parse(readFileSync(file, "utf8")) as TargetsCache;
    } catch {
        return {};
    }
}

/**
 * Adds a result to the targets cache, dropping entries past their day
 *
 * @param file - The targets cache file
 * @param cache - Its entries, as read
 * @param key - The new entry's key
 * @param result - The new entry
 */
function writeTargetsCache(file: string, cache: TargetsCache, key: string, result: Targets): void {
    const now = Date.now();
    const next: TargetsCache = {};
    for (const [k, entry] of Object.entries(cache)) if (now - entry.at < CACHE_LIFE) next[k] = entry;
    next[key] = { at: now, result };
    writeQuietly(file, JSON.stringify(next));
}

type Manifest = { readonly engines?: Record<string, string>; readonly browserslist?: unknown };

/**
 * @param from - The folder to start looking in
 * @returns The nearest `package.json` at or above it, or undefined if there is none
 */
function nearestManifest(from: string): Manifest | undefined {
    return findUp(from, (dir) => {
        try {
            return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            return undefined;
        }
    });
}
