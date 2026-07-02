# Release checklist — v1.0.0

## 1. Rebuild WASM (required for v1 C++ APIs)

The JS layer ships with prebuilt WASM, but **new C++ methods** (`getMapPoints3D`, `findPlaneAt`, anchors, etc.) require a fresh Emscripten build.

### Local (WSL2)

```bash
npm run build:wasm:linux
# or from Windows when WSL is installed:
npm run build:wasm
```

### CI

Push to `feature/npm-library-v1` — GitHub Actions `build-wasm` job produces `packages/core/dist/alva_ar.js`. Download the artifact and commit, or merge after CI passes.

## 2. Verify

```bash
npm ci
node scripts/verify-api-version.js
npm pack -w @bluefish030/ahar-slam --pack-destination /tmp
npm pack -w @bluefish030/ahar-slam-three --pack-destination /tmp
npm run lint
npm run dev -w @bluefish030/ahar-slam-demo
```

## 3. iPhone manual test (HTTPS)

1. Run demo: `npm run dev -w @bluefish030/ahar-slam-demo`
2. Open `https://<your-lan-ip>:5173` on iPhone (accept self-signed cert)
3. Test each mode:
   - `?mode=camera` — tracking + feature dots
   - `?mode=mapTap` — tap floor/wall → cube placed
   - `?mode=mapPoints` — select 3+ points → plane + cube
   - `?mode=anchor` — place cube, cover camera 2–3 s, cube stays

## 4. Publish to npm

```bash
npm login
npm publish -w @bluefish030/ahar-slam --access public
npm publish -w @bluefish030/ahar-slam-three --access public
```

Set `NPM_TOKEN` in GitHub repo secrets for CI publish on tag.

## 5. GitHub release

```bash
git tag v1.0.0
git push origin v1.0.0
```

Release notes should include WASM checksum (from `npm pack` shasum) and changelog for v1 APIs.

### WASM checksum (pre-rebuild baseline)

```
npm pack -w @bluefish030/ahar-slam
# shasum shown in npm pack output — update after WASM rebuild
```

## Install snippet (post-publish)

```bash
npm install @bluefish030/ahar-slam @bluefish030/ahar-slam-three three
```
