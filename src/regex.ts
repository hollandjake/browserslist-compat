import type { FeatureKey } from "./features";

/**
 * Reports a regex's features newer than ES2015: its flags, then what its pattern uses. The pattern is scanned, not
 * parsed: escapes are skipped two characters at a time, and groups only count outside a character class.
 *
 * @param pattern - The regex's source, as between a literal's slashes
 * @param flags - Its flags
 * @param report - Called with each feature found, possibly more than once
 */
export function regexFeatures(pattern: string, flags: string, report: (feature: FeatureKey) => void): void {
    if (flags.includes("s")) report("regexDotAll");
    if (flags.includes("d")) report("regexHasIndices");
    if (flags.includes("v")) report("regexUnicodeSets");
    // Most patterns have none of the syntax below: skip the scan when no `(?` or `\` can start any of it
    if (!pattern.includes("(?") && !pattern.includes("\\")) return;
    const unicode = flags.includes("u") || flags.includes("v");
    const nested = flags.includes("v");
    let names: Set<string> | undefined;
    let classDepth = 0;
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern.charCodeAt(i);
        if (c === 0x5c /* \ */) {
            const next = pattern[i + 1];
            if ((next === "p" || next === "P") && unicode && pattern[i + 2] === "{") report("regexPropertyEscapes");
            else if (next === "k" && pattern[i + 2] === "<") report("regexNamedGroups");
            i++;
        } else if (c === 0x5b /* [ */) {
            // The v flag nests classes; without it a `[` inside a class is an ordinary character
            if (classDepth === 0 || nested) classDepth++;
        } else if (c === 0x5d /* ] */) {
            if (classDepth > 0) classDepth--;
        } else if (c === 0x28 /* ( */ && classDepth === 0 && pattern.charCodeAt(i + 1) === 0x3f /* ? */) {
            const kind = pattern[i + 2];
            if (kind === "<") {
                const after = pattern[i + 3];
                if (after === "=" || after === "!") report("regexLookbehind");
                else {
                    report("regexNamedGroups");
                    const name = pattern.slice(i + 3, pattern.indexOf(">", i + 3));
                    names ??= new Set();
                    if (names.has(name)) report("regexDuplicateNamedGroups");
                    names.add(name);
                }
            } else if (kind === "i" || kind === "m" || kind === "s" || kind === "-") {
                if (/^[ims-]+:/.test(pattern.slice(i + 2, i + 8))) report("regexModifiers");
            }
        }
    }
}
