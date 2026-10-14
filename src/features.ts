import { createRequire } from "node:module";

/**
 * Babel's data, loaded from the user's install rather than bundled in, so newer browser data arrives with their next
 * install, as caniuse-lite does for browserslist. `require` rather than a JSON import, which some Node versions warn about.
 */
const plugins = createRequire(import.meta.url)("@babel/compat-data/plugins") as Readonly<Record<string, Support>>;

/** The oldest version of each engine that has a feature; an engine that isn't listed has never had it */
export type Support = Readonly<Partial<Record<string, string>>>;

/** A syntax or regex feature newer than ES2015, which the check finds in output */
export type Feature = {
    /** What the error names it */
    readonly name: string;
    /** Where each engine first has it */
    readonly support: Support;
};

/** @returns Babel's support data for one of its plugins, the same data oxc lowers by */
function babel(plugin: string): Support {
    const support = plugins[plugin];
    if (!support) throw new Error(`@babel/compat-data has no data for ${plugin}`);
    return support;
}

/** A feature's key */
export type FeatureKey =
    | "exponentiation"
    | "asyncFunctions"
    | "objectRestSpread"
    | "asyncIteration"
    | "optionalCatchBinding"
    | "optionalChaining"
    | "nullishCoalescing"
    | "logicalAssignment"
    | "numericSeparators"
    | "classFields"
    | "privateMethods"
    | "privateIn"
    | "staticBlocks"
    | "explicitResourceManagement"
    | "regexDotAll"
    | "regexNamedGroups"
    | "regexDuplicateNamedGroups"
    | "regexPropertyEscapes"
    | "regexUnicodeSets"
    | "regexModifiers"
    | "bigint"
    | "regexLookbehind"
    | "regexHasIndices"
    | "importMeta"
    | "dynamicImport"
    | "topLevelAwait"
    | "hashbang";

/**
 * Every feature the check looks for, by key.
 *
 * Where Babel has a plugin for a feature, its data (`@babel/compat-data`) says where the feature is: it's what oxc
 * decides what to lower by, and it marks an engine as lacking a feature it ships with bugs. Features no tool can
 * lower have no Babel plugin; their versions are from MDN's browser-compat-data 8.1.5, each the first release without
 * a flag or a partial implementation (Android WebView follows Chrome, so it isn't listed).
 *
 * ES2015's own syntax isn't checked: Babel marks Safari 10 and 11 as lacking the `u` flag and template literals for
 * bugs in corner cases only (case folding, tagged template caching), and every engine that runs ES modules has the
 * rest.
 */
export const FEATURES: Readonly<Record<FeatureKey, Feature>> = {
    exponentiation: { name: "the ** operator", support: babel("transform-exponentiation-operator") },
    asyncFunctions: { name: "async functions", support: babel("transform-async-to-generator") },
    objectRestSpread: { name: "object rest and spread", support: babel("transform-object-rest-spread") },
    asyncIteration: { name: "async generators and for await", support: babel("transform-async-generator-functions") },
    optionalCatchBinding: { name: "catch with no binding", support: babel("transform-optional-catch-binding") },
    optionalChaining: { name: "optional chaining (?.)", support: babel("transform-optional-chaining") },
    nullishCoalescing: { name: "the ?? operator", support: babel("transform-nullish-coalescing-operator") },
    logicalAssignment: {
        name: "logical assignment (??=, ||=, &&=)",
        support: babel("transform-logical-assignment-operators"),
    },
    numericSeparators: { name: "numeric separators (1_000)", support: babel("transform-numeric-separator") },
    classFields: { name: "class fields", support: babel("transform-class-properties") },
    privateMethods: { name: "private methods", support: babel("transform-private-methods") },
    privateIn: { name: "#field in object", support: babel("transform-private-property-in-object") },
    staticBlocks: { name: "class static blocks", support: babel("transform-class-static-block") },
    explicitResourceManagement: {
        name: "using declarations",
        support: babel("transform-explicit-resource-management"),
    },
    regexDotAll: { name: "the regex s flag", support: babel("transform-dotall-regex") },
    regexNamedGroups: { name: "regex named groups", support: babel("transform-named-capturing-groups-regex") },
    regexDuplicateNamedGroups: {
        name: "regex duplicate named groups",
        support: babel("transform-duplicate-named-capturing-groups-regex"),
    },
    regexPropertyEscapes: { name: "regex \\p{…} escapes", support: babel("transform-unicode-property-regex") },
    regexUnicodeSets: { name: "the regex v flag", support: babel("transform-unicode-sets-regex") },
    regexModifiers: { name: "regex modifiers ((?i:…))", support: babel("transform-regexp-modifiers") },
    bigint: {
        name: "BigInt literals",
        support: {
            chrome: "67",
            edge: "79",
            firefox: "68",
            safari: "14",
            ios: "14",
            opera: "54",
            samsung: "9",
            node: "10.4",
            deno: "1",
        },
    },
    regexLookbehind: {
        name: "regex lookbehind",
        support: {
            chrome: "62",
            edge: "79",
            firefox: "78",
            safari: "16.4",
            ios: "16.4",
            opera: "49",
            samsung: "8",
            node: "8.10",
            deno: "1",
        },
    },
    regexHasIndices: {
        name: "the regex d flag",
        support: {
            chrome: "90",
            edge: "90",
            firefox: "88",
            safari: "15",
            ios: "15",
            opera: "76",
            samsung: "15",
            node: "16",
            deno: "1.8",
        },
    },
    importMeta: {
        name: "import.meta",
        support: {
            chrome: "64",
            edge: "79",
            firefox: "62",
            safari: "11.1",
            ios: "12",
            opera: "51",
            samsung: "9",
            node: "10.4",
            deno: "1",
        },
    },
    dynamicImport: {
        name: "import()",
        support: {
            chrome: "63",
            edge: "79",
            firefox: "67",
            safari: "11.1",
            ios: "11.3",
            opera: "50",
            samsung: "8",
            node: "13.2",
            deno: "1",
        },
    },
    topLevelAwait: {
        name: "top-level await",
        support: {
            chrome: "89",
            edge: "89",
            firefox: "89",
            safari: "27",
            ios: "27",
            opera: "75",
            samsung: "15",
            node: "14.8",
            deno: "1",
        },
    },
    hashbang: {
        name: "a hashbang (#!) line",
        support: {
            chrome: "74",
            edge: "79",
            firefox: "67",
            safari: "13.1",
            ios: "13.4",
            opera: "62",
            samsung: "11",
            node: "0.10",
            deno: "1",
        },
    },
};
