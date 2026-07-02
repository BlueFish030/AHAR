/**
 * Replaces the extern-post-js section in dist/alva_ar.js with src/system.js.
 * Run after editing src/system.js or after emmake make install.
 */
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = join(root, "dist", "alva_ar.js");
const systemJs = readFileSync(join(root, "src", "system.js"), "utf8");
const wasm = readFileSync(wasmPath, "utf8");

const marker = "export default AlvaARWasm;";
const idx = wasm.indexOf(marker);

if (idx === -1) {
  console.error("sync-post-js: marker not found in dist/alva_ar.js");
  process.exit(1);
}

const head = wasm.slice(0, idx + marker.length);
const out = `${head}\n${systemJs}\n`;
writeFileSync(wasmPath, out);

const assetsPath = join(root, "examples", "public", "assets", "alva_ar.js");
copyFileSync(wasmPath, assetsPath);

console.log("sync-post-js: updated dist/alva_ar.js and examples/public/assets/alva_ar.js");
