/**
 * Verify v1 SLAM API methods are registered on the Emscripten System class.
 * String search in the minified WASM head is unreliable under -Oz; load the
 * module and inspect embind bindings instead.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = join(root, "dist", "alva_ar.js");

const REQUIRED_SYSTEM_METHODS = [
  "reset",
  "configure",
  "findCameraPose",
  "getFramePoints",
  "getMapPoints3D",
  "findPlaneAt",
  "findPlaneFromPoints",
  "createAnchor",
  "getAnchorPose",
  "removeAnchor",
  "clearAnchors",
];

const REQUIRED_JS_WRAPPERS = [
  "getMapPoints3D(",
  "findPlaneAt(",
  "createAnchor(",
  'API_VERSION = "1.0.0"',
];

const bundle = readFileSync(wasmPath, "utf8");

for (const snippet of REQUIRED_JS_WRAPPERS) {
  if (!bundle.includes(snippet)) {
    console.error(`verify-wasm-exports: missing JS wrapper snippet: ${snippet}`);
    process.exit(1);
  }
}

const AlvaARWasm = (await import(pathToFileURL(wasmPath).href)).default;
const wasm = await AlvaARWasm();
const system = new wasm.System();

for (const name of REQUIRED_SYSTEM_METHODS) {
  if (typeof system[name] !== "function") {
    console.error(`verify-wasm-exports: System.${name} is not a function`);
    process.exit(1);
  }
}

system.delete?.();
console.log("verify-wasm-exports: OK");
