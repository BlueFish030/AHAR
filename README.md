# AHAR — AlvaAR SLAM for the Web

AHAR is a fork of [AlvaAR](https://github.com/alanross/AlvaAR) — realtime visual SLAM running as WebAssembly in the browser. It extends upstream with v1 APIs for 3D map points, tap-to-plane detection, session anchors, and a publishable npm library.

**Upstream:** [alanross/AlvaAR](https://github.com/alanross/AlvaAR) (GPLv3)  
**Maintainer:** [BlueFish030/AHAR](https://github.com/BlueFish030/AHAR)

See [ATTRIBUTION.md](ATTRIBUTION.md) for third-party credits.

![image](examples/public/assets/image.gif)

## npm packages

| Package | Description |
|---------|-------------|
| `@bluefish030/ahar-slam` | Core WASM bundle + coordinate utilities |
| `@bluefish030/ahar-slam-three` | `SlamSession` high-level API + Three.js connector |

### Install

```bash
npm install @bluefish030/ahar-slam @bluefish030/ahar-slam-three three
```

### Quick start

```javascript
import { SlamSession } from "@bluefish030/ahar-slam-three";
import * as THREE from "three";

const container = document.getElementById("ar");
const session = await SlamSession.create({
  container,
  width: 360,
  height: 640,
  fov: 60,
});

await session.startCamera();
await session.initializeSlam();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 360 / 640, 0.01, 1000);
camera.rotation.reorder("YXZ");
const renderer = new THREE.WebGLRenderer({ alpha: true });
container.appendChild(renderer.domElement);

session.startRenderLoop({ scene, camera, renderer });

// On tap:
const pose = session.findPlaneAtDisplay(tapX, tapY);
if (pose) {
  session.applyPoseToObject(pose, model);
  session.createAnchor(pose, 1);
}
```

## Demo app

Interactive Vite demo with HTTPS for mobile testing:

```bash
npm install
npm run build:wasm    # requires WSL2 + Emscripten (see Build)
npm run dev -w packages/demo
```

Open `https://<your-lan-ip>:5173` on iPhone. Modes via query param:

- `?mode=camera` — baseline tracking
- `?mode=mapTap` — tap to place object on surface
- `?mode=mapPoints` — select 3+ map points for plane
- `?mode=anchor` — anchor persistence during tracking loss

## v1 API surface

| Method | Description |
|--------|-------------|
| `getMapPoints3D()` | Sparse 3D SLAM landmarks |
| `findPlaneAt(x, y)` | Tap-to-surface via local map cluster |
| `findPlaneFromPoints(indices)` | Plane from selected map point indices |
| `createAnchor` / `getAnchorPose` / `clearAnchors` | Session-local anchor poses |
| `SlamSession` | Camera lifecycle, coordinate conversion, Three.js bridge |

`AlvaAR.API_VERSION` is `"1.0.0"`.

## Build WASM (WSL2 Ubuntu)

Emscripten does not run natively on Windows. Use WSL2:

```bash
# In WSL2 — repo at /mnt/c/Users/user/Documents/ME/AHAR
source ~/emsdk/emsdk_env.sh
cd src/libs && ./build.sh          # first run ~30–60 min
cd ../slam && mkdir -p build && cd build
emcmake cmake .. && emmake make install
cd ../../..
npm run copy:wasm
```

Or from Windows when WSL is installed:

```powershell
npm run build:wasm
```

Or with Docker:

```bash
npm run build:wasm:docker
```

Or push to GitHub — the `build-wasm` CI job produces the artifact automatically.

Outputs: `dist/alva_ar.js`, `packages/core/dist/alva_ar.js`

## Legacy examples

Static HTML demos remain in [`examples/`](examples/):

```bash
cd examples && npm install && npm start
```

## Known limitations

- GPLv3 copyleft — commercial apps must comply
- Sparse map, not dense mesh; plane quality depends on scene texture
- Monocular scale drift — no metric accuracy guarantee
- Anchors are session-local only
- iOS requires HTTPS, `playsinline`, and user gesture for camera
- WASM ~4 MB download on first use

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
