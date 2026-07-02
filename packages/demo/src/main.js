import * as THREE from "three";
import { SlamSession } from "@bluefish030/ahar-slam-three";

const MODES = {
  camera: "Baseline tracking + feature dots",
  mapTap: "Tap to place cube on surface",
  mapPoints: "Select 3+ map points for plane",
  anchor: "Anchor survives tracking loss",
};

const params = new URLSearchParams(location.search);
const mode = params.get("mode") || "camera";

const $container = document.getElementById("container");
const $overlay = document.getElementById("overlay");
const $startBtn = document.getElementById("start-btn");
const $spinner = document.getElementById("spinner");
const $error = document.getElementById("error");
const $status = document.getElementById("status");
const $modeLabel = document.getElementById("mode-label");

$modeLabel.textContent = MODES[mode] || mode;

function showError(msg) {
  $error.textContent = msg;
  $error.classList.remove("hidden");
  $startBtn.disabled = false;
  $spinner.classList.add("hidden");
}

function setStatus(state) {
  $status.textContent = state.charAt(0).toUpperCase() + state.slice(1);
  $status.className = state;
}

function makeCube() {
  const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.reorder("YXZ");
  return mesh;
}

async function run() {
  $startBtn.disabled = true;
  $spinner.classList.remove("hidden");
  $error.classList.add("hidden");

  const width = $container.clientWidth;
  const height = $container.clientHeight;

  let session;
  try {
    session = await SlamSession.create({ container: $container, width, height, fov: 60 });
    await session.startCamera();

    if (session.camera?.el) {
      $container.prepend(session.camera.el);
    }

    setStatus("initializing");
    await session.initializeSlam();
  } catch (err) {
    showError(err.message || String(err));
    return;
  }

  $overlay.classList.add("hidden");
  $spinner.classList.add("hidden");

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 1000);
  camera.rotation.reorder("YXZ");

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  $container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));

  let anchorId = 1;
  const selectedIndices = new Set();
  let mapPointOverlay = null;

  function refreshMapPointOverlay(threeCam) {
    if (mode !== "mapPoints") return;
    mapPointOverlay?.remove();
    mapPointOverlay = document.createElement("div");
    mapPointOverlay.style.cssText = "position:absolute;inset:0;z-index:4;pointer-events:none;";
    $container.appendChild(mapPointOverlay);

    const projected = session.projectMapPointsToDisplay(threeCam);
    projected.slice(0, 200).forEach((p, idx) => {
      const dot = document.createElement("div");
      dot.className = "map-point-dot" + (selectedIndices.has(idx) ? " selected" : "");
      dot.style.left = `${p.sx}px`;
      dot.style.top = `${p.sy}px`;
      dot.style.pointerEvents = "auto";
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        if (selectedIndices.has(idx)) selectedIndices.delete(idx);
        else selectedIndices.add(idx);
        dot.classList.toggle("selected");
        if (selectedIndices.size >= 3) {
          const pose = session.findPlaneFromMapPointIndices([...selectedIndices]);
          if (pose) placeObject(pose);
        }
      });
      mapPointOverlay.appendChild(dot);
    });
  }

  function placeObject(pose) {
    const cube = makeCube();
    session.applyPoseToObject(pose, cube);
    scene.add(cube);
    session.createAnchor(pose, anchorId++);
    return cube;
  }

  session.startRenderLoop({
    scene,
    camera,
    renderer,
    THREE,
    onPose: () => setStatus("tracking"),
    onTrackingLost: () => setStatus("lost"),
  });

  if (mode === "camera") {
    const dotsCanvas = document.createElement("canvas");
    dotsCanvas.width = width;
    dotsCanvas.height = height;
    dotsCanvas.style.pointerEvents = "none";
    $container.appendChild(dotsCanvas);
    const dotsCtx = dotsCanvas.getContext("2d");

    const dotLoop = () => {
      if (!session._running) return;
      dotsCtx.clearRect(0, 0, width, height);
      if (session.getTrackingState() !== "tracking") {
        for (const p of session.getFramePoints()) {
          dotsCtx.fillStyle = "#fff";
          dotsCtx.fillRect(
            p.x * (width / session.slamSize.width),
            p.y * (height / session.slamSize.height),
            2,
            2
          );
        }
      }
      requestAnimationFrame(dotLoop);
    };
    dotLoop();
  }

  if (mode === "mapTap" || mode === "anchor") {
    $container.addEventListener(
      "click",
      (e) => {
        const rect = $container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const pose = session.findPlaneAtDisplay(x, y);
        if (pose) placeObject(pose);
      },
      { passive: true }
    );
  }

  if (mode === "mapPoints") {
    setInterval(() => refreshMapPointOverlay(camera), 500);
  }

  window.addEventListener("resize", () => {
    const w = $container.clientWidth;
    const h = $container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    session.displaySize.width = w;
    session.displaySize.height = h;
  });
}

$startBtn.addEventListener("click", () => run(), { once: true });
