import { defineConfig } from "tsup";

// ESM and CommonJS, so `require("@sendandretain/sdk")` works in a CJS app as
// well as `import`. Node 20 is the floor (`AbortSignal.any`, global fetch).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  treeshake: true,
  target: "node20",
  clean: true,
});
