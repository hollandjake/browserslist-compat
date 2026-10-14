import { FEATURES, type FeatureKey } from "./features";
import { compare, parseTarget, parseVersion, type Target } from "./version";

/** Each feature some target lacks, with the sentence the error gives for it */
export type Lacking = ReadonlyMap<FeatureKey, string>;

/** By targets joined with commas: a build checks every chunk against the same targets */
const cache = new Map<string, Lacking>();

/**
 * @param targets - oxc targets, such as `chrome61`; `es` targets and engines with no data are ignored
 * @returns Each feature at least one target lacks, and the message naming those targets and the versions they need
 */
export function lackingFeatures(targets: readonly string[]): Lacking {
    const key = targets.join(",");
    let lacking = cache.get(key);
    if (lacking) return lacking;
    const engines: (Target & { target: string })[] = [];
    for (const target of targets) {
        const parsed = parseTarget(target);
        if (parsed && parsed.engine !== "es") engines.push({ target, ...parsed });
    }
    const map = new Map<FeatureKey, string>();
    for (const feature of Object.keys(FEATURES) as FeatureKey[]) {
        const support = FEATURES[feature].support as Readonly<Record<string, string | undefined>>;
        const missing: string[] = [];
        for (const { target, engine, version } of engines) {
            const since = support[engine];
            if (since === undefined) missing.push(`${target} (no version has it)`);
            else if (compare(version, parseVersion(since) ?? [Infinity]) < 0)
                missing.push(`${target} (needs ${engine}${since})`);
        }
        if (missing.length) map.set(feature, `${FEATURES[feature].name}: not supported by ${missing.join(", ")}`);
    }
    lacking = map;
    cache.set(key, lacking);
    return lacking;
}
