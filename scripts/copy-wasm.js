/**
 * Copy built WASM bundle into packages/core/dist/
 */
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "dist", "alva_ar.js");
const destDir = join(root, "packages", "core", "dist");
const dest = join(destDir, "alva_ar.js");

if (!existsSync(src)) {
  console.warn("copy-wasm: dist/alva_ar.js not found — skipping (run build:wasm after Emscripten build)");
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("copy-wasm: copied to packages/core/dist/alva_ar.js");
