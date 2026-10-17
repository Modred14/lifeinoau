import { defineConfig } from "tsup";

// Bundle the server into one ESM file. @campuslife/shared is TypeScript source,
// so it is bundled in; real npm dependencies stay external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: ["@campuslife/shared"],
});
