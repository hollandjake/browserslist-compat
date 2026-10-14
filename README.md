# browserslist-compat

Build for the browsers and runtimes your package says it supports, and find out at build time if the output won't run on them.

It reads `browserslist` and `engines` from your `package.json` and turns them into build targets for [tsdown](https://tsdown.dev), [rolldown](https://rolldown.rs), [Vite](https://vite.dev) and [esbuild](https://esbuild.github.io). The tsdown/rolldown plugin then checks every output chunk: a build tool lowers what it can to your targets, but leaves some syntax untouched, and that syntax fails in an older browser. BigInt literals are one example; regex lookbehind, which gets rewritten to `new RegExp(…)`, is another. This plugin fails the build instead, saying where and which targets lack it.

```sh
npm install --save-dev browserslist-compat
```

## tsdown and rolldown

```ts
// tsdown.config.ts
import { browserslistCompat } from "browserslist-compat";
import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["./src/index.ts"],
    plugins: [browserslistCompat()],
});
```

```json
// package.json
{
    "browserslist": ["fully supports es6-module"],
    "engines": { "node": ">=18" }
}
```

The plugin sets the build's target from them. A `target` in your tsdown or rolldown config is replaced, with a warning naming both, so the targets live in one place:

```
targets: chrome61, firefox60, edge16, ios11, opera48, safari11, samsung8.2, node18
```

Then it checks each chunk. Given `2n ** 64n` and `/(?<=\$)\d+/` in the source, the build fails with:

```
index.js won't run well on every target:
  index.js:2:13: BigInt literals: not supported by chrome61 (needs chrome67), firefox60 (needs firefox68), edge16 (needs edge79), ios11 (needs ios14), opera48 (needs opera54), safari11 (needs safari14), samsung8.2 (needs samsung9)
  index.js:2:19: BigInt literals: not supported by chrome61 (needs chrome67), firefox60 (needs firefox68), edge16 (needs edge79), ios11 (needs ios14), opera48 (needs opera54), safari11 (needs safari14), samsung8.2 (needs samsung9)
  index.js:3:15: regex lookbehind: not supported by chrome61 (needs chrome62), firefox60 (needs firefox78), edge16 (needs edge79), ios11 (needs ios16.4), opera48 (needs opera49), safari11 (needs safari16.4)
```

It works the same as a plain rolldown plugin: `rolldown({ input, plugins: [browserslistCompat()] })`.

## Vite and Vitest

`browserslistCompatVite()` sets Vite's oxc target from the same fields, so Vitest runs your code lowered the way the build lowers it. Node targets are left out, since Vite targets the Node it runs on itself:

```ts
// vitest.config.ts
import { browserslistCompatVite } from "browserslist-compat";
import { defineConfig } from "vitest/config";

export default defineConfig({ plugins: [browserslistCompatVite()] });
```

## esbuild

`browserslistToEsbuild()` gives esbuild's targets:

```ts
import { browserslistToEsbuild } from "browserslist-compat";
import { build } from "esbuild";

await build({ entryPoints: ["src/index.ts"], bundle: true, target: browserslistToEsbuild() });
```

With no arguments it uses your package's query and `engines`; pass a query to use that instead. It's `resolveTargets()` without Samsung Internet, which esbuild has no target for. This only sets targets: the output check is the rolldown plugin's.

## How the targets are chosen

The query comes from `package.json`'s `browserslist`, a `.browserslistrc`, or browserslist's environment variables, as browserslist finds it. Each engine gets one target, at the oldest version the query matches. `engines.node` and `engines.deno` become targets too.

A few details matter:

- **Safari's Technology Preview never sets Safari's floor.** browserslist lists TP after the numbered versions; it's a preview, so it's left out rather than counted as a version.
- **The oldest version is found by comparing versions,** not by where it sits in the list.
- **Chrome and Firefox for Android, and the Android WebView, count as Chrome and Firefox,** and Samsung Internet is kept for tools that have a target for it (oxc does, esbuild doesn't).
- **`engines` is read,** so Node and Deno needn't be added by hand. Pass `engines: {}` to leave them out.
- **Nothing is dropped silently.** The plugin logs what it couldn't target, such as `kaios 3.0-3.1` or `op_mini all`, and `resolveTargets()` returns it in `skipped`.

## The check

The plugin looks for syntax and regex features newer than ES2015 that any target lacks:

- syntax: `**`, async functions and generators, object rest and spread, optional catch binding, `?.`, `??`, logical assignment, numeric separators, class fields, private methods, `#x in obj`, static blocks, `using`, `import.meta`, `import()`, top-level await, a hashbang, and BigInt literals;
- regexes: the `s`, `d` and `v` flags, lookbehind, named and duplicate named groups, `\p{…}` and modifiers, in literals and in `RegExp("…")` calls with string arguments, which is how the build rewrites a regex its targets can't parse.

Support data comes from [`@babel/compat-data`](https://www.npmjs.com/package/@babel/compat-data), the data oxc lowers by, for every feature it covers. For the features no tool can lower, it comes from [MDN's browser-compat-data](https://github.com/mdn/browser-compat-data). Electron isn't covered. The check reads syntax only: a built-in a target lacks, such as `Object.hasOwn`, isn't found. Type-check your source against an older `lib` for that.

It also fails the build on a `RegExp` built from string literals inside a function. The build turns a regex literal its oldest targets can't parse into `new RegExp(…)`, and inside a function that compiles the regex again on every call. Move the literal to a module-level constant. Set `regexInFunction` to `"warn"` or `"off"` to allow it.

## Options

Every function takes these, except that `browserslistToEsbuild()` takes the query as its first argument rather than as `browserslist`.

| Option | For | Default | |
|---|---|---|---|
| `cwd` | all | rolldown's `cwd` in the plugin, Vite's `root` in the Vite plugin, `process.cwd()` otherwise | Where to look for `package.json` |
| `browserslist` | all | the package's | A query to use instead |
| `engines` | all | the package's | Engines to use instead; `{}` for none |
| `cache` | all | `true` | Keep resolved targets and check results in `node_modules/.cache/browserslist-compat` |
| `check` | plugin | `true` | Check the output; `false` only sets the target |
| `regexInFunction` | plugin | `"error"` | `"warn"` or `"off"` for a regex compiled on every call |

## Speed

A build pays for the check once per chunk, so it's built to cost little the first time:

- Resolved targets are cached for a day, keyed by the query, the engines and the versions of browserslist and caniuse-lite, so a build doesn't usually load browserslist.
- Each chunk's result is cached, keyed by a hash of the chunk, the targets and the options, so an unchanged chunk isn't checked again. A hit takes under a millisecond.
- A chunk is parsed once. On Node, oxc-parser's lazy raw transfer builds JavaScript objects only for the node types that could hold a feature the targets lack. Once oxc-parser is loaded, a 343 KB chunk takes about 2.4 ms that way. While oxc-parser isn't loaded yet, a small first chunk goes through rolldown's own parser, which is already loaded. On Bun, which has no raw transfer, it parses to ESTree and walks the whole tree.

## API

- `browserslistCompat(options?)`: the tsdown/rolldown plugin.
- `browserslistCompatVite(options?)`: the Vite/Vitest plugin.
- `browserslistToEsbuild(query?, options?)`: esbuild's targets, as an array.
- `resolveTargets(options?)`: `{ targets, skipped }` in oxc's names (tsdown, rolldown, Vite).

## Requirements

Node `^22.18.0 || >=24.11.0` (the versions `@babel/compat-data` 8 supports), or Bun 1.0 or later. On Node the check uses raw transfer; on Bun it parses to ESTree, with the same results, only slower. ESM only, though Node can `require()` it.

## License

[MIT](./LICENSE)
