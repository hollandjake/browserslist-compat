import { resolveTargets, type Query, type TargetOptions } from "./targets";
import { parseTarget } from "./version";

/** Engines oxc has a target for and esbuild doesn't */
const NOT_IN_ESBUILD = new Set(["samsung"]);

/** Where to read a package's `engines`, and whether to cache, for {@link browserslistToEsbuild} */
export type EsbuildTargetOptions = Omit<TargetOptions, "browserslist">;

/**
 * Turns a browserslist query, and the package's `engines`, into esbuild targets: {@link resolveTargets}, with the
 * engines esbuild has no target for left out (Samsung Internet). `engines.node` and `engines.deno` are included; pass
 * `engines: {}` to leave them out. For what was left out and why, use `resolveTargets`, whose `skipped` lists it.
 *
 * @param query - A browserslist query; with none, the package's own (`package.json`, `.browserslistrc` or browserslist's
 *   environment variables), found from `options.cwd`
 * @param options - Where to look, and `engines` to use instead of the package's
 * @returns esbuild's `target`, such as `["chrome61", "safari11", "node18"]`
 */
export function browserslistToEsbuild(query?: Query, options: EsbuildTargetOptions = {}): string[] {
    const { targets } = resolveTargets(query === undefined ? options : { ...options, browserslist: query });
    return targets.filter((target) => !NOT_IN_ESBUILD.has(parseTarget(target)?.engine ?? ""));
}
