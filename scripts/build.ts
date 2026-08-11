import { rm } from "node:fs/promises";

const entrypoints = [
  "src/index.ts",
  "src/formats/ttml/index.ts",
  "src/formats/lrc.ts",
  "src/formats/eslrc.ts",
  "src/formats/qrc.ts",
  "src/formats/yrc.ts",
  "src/formats/lys/index.ts",
  "src/formats/lqe.ts",
];

await rm("dist", { force: true, recursive: true });

const bundle = await Bun.build({
  entrypoints,
  format: "esm",
  minify: true,
  outdir: "dist",
  target: "browser",
});

if (!bundle.success) {
  for (const log of bundle.logs) {
    console.error(log);
  }
  process.exit(1);
}

// declarations come from tsgo; Bun.build does not emit them
const types = Bun.spawnSync(["tsgo", "-p", "tsconfig.build.json"], {
  stderr: "inherit",
  stdout: "inherit",
});

process.exit(types.exitCode);
