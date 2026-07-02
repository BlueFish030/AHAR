import { API_VERSION } from "../packages/core/src/index.js";

if (API_VERSION !== "1.0.0") {
  console.error(`verify-api-version: expected 1.0.0, got ${API_VERSION}`);
  process.exit(1);
}

console.log("verify-api-version: OK (1.0.0)");
