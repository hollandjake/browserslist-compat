import { defineConfig } from "tsdown";

// Plain JavaScript, loaded with `--config-loader native` (see the build script), so any Node loads it: tsdown otherwise
// picks its loader by Node version, and below 22.18, which strips types, it needs the optional unrun package
//
// A build tool, run by Node or Bun inside tsdown and Vite, so it builds for the Node in `engines` (tsdown's default)
// rather than for browsers
export default defineConfig({
    entry: ["./src/index.ts"],
    platform: "node",
    dts: true,
    clean: true,
});
