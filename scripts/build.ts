import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const entrypoints = [
  "src/index.ts",
  "src/formats/ttml/index.ts",
  "src/formats/lrc.ts",
  "src/formats/lyl.ts",
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

if (types.exitCode !== 0) {
  process.exit(types.exitCode);
}

// tsgo emits "@/..." specifiers verbatim since it has no notion of the dist
// layout; matching only "from"/"import(" keeps prose and other strings intact
await Promise.all(
  (await readdir("dist", { recursive: true }))
    .filter((name) => name.endsWith(".d.ts"))
    .map(async (name) => {
      const path = join("dist", name);
      const text = await readFile(path, "utf8");
      const rewritten = text.replace(
        /((?:from|import)\s*\(?\s*["'])@\/([^"']+)(["'])/g,
        (_match, prefix: string, alias: string, suffix: string) => {
          const steps = relative(dirname(path), join("dist", alias))
            .split("\\")
            .join("/");
          return `${prefix}${steps.startsWith(".") ? steps : `./${steps}`}${suffix}`;
        }
      );
      if (rewritten !== text) {
        await writeFile(path, rewritten, "utf8");
      }
    })
);

process.exit(0);
