import semver from "semver";
import { describe, expect, test } from "vitest";

import { minVersion } from "../src/version";

/** Ranges as `engines` writes them, and the edge cases of each form */
const READABLE = [
    ">=18.0.0",
    ">=18",
    ">= 18.1",
    "18",
    "18.x",
    "18.2.x",
    "^22.18.0",
    "^0.5.1",
    "~1.2.3",
    "~1",
    "=18.0.0",
    "v18.2.0",
    ">18",
    ">18.1",
    ">18.1.2",
    "^22.18.0 || >=24.11.0",
    ">=24 || ^22.18.0",
    ">=18 <23",
    ">=18.0.0 <=18.0.0",
    "18 - 20",
    "1.2 - 2",
    "*",
    "x",
    "",
    ">=5 <3",
    "<3",
    "<=1.2.3",
    ">=1.2.3 <1.2.3",
];

describe("minVersion", () => {
    test.each(READABLE)("%j as semver's minVersion has it", (range) => {
        const expected = semver.minVersion(range);
        expect(minVersion(range)).toEqual(expected ? [expected.major, expected.minor, expected.patch] : undefined);
    });

    test.each([">=1.2.3-beta", "~1.2.3-rc.1", ">=1.2.3+build", "latest"])("%j is unreadable, not guessed", (range) => {
        expect(minVersion(range)).toBe("unreadable");
    });
});
