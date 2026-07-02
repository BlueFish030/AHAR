import {
  AlvaAR,
  API_VERSION,
  Camera,
  onFrame,
  resize2cover,
  getSlamProcessingSize,
  displayToSlamPixel,
} from "@bluefish030/ahar-slam";
import { AlvaARConnectorTHREE } from "./connector.js";

const TRACKING_LOST_THRESHOLD = 30;

export class SlamSession {
  static async create({ container, width, height, fov = 60, useImu = false }) {
    const session = new SlamSession({ container, width, height, fov, useImu });
    return session;
  }

  constructor({ container, width, height, fov, useImu }) {
    this.container = container;
    this.displaySize = { width, height };
    this.fov = fov;
    this.useImu = useImu;

    this.alva = null;
    this.camera = null;
    this._videoCanvas = null;
    this._videoCtx = null;
    this._coverRect = null;
    this._slamCoverRect = null;
    this.slamSize = null;
    this.applyPose = null;

    this.lastPose = null;
    this.lostFrames = 0;
    this.trackingState = "initializing";
    this._running = false;
    this._placedObjects = new Map();
  }

  async startCamera() {
    this.camera = await Camera.Initialize({ facingMode: "environment" });

    this._videoCanvas = document.createElement("canvas");
    this._videoCtx = this._videoCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });

    this._updateCoverRect();
    return this.camera;
  }

  _updateCoverRect() {
    this._coverRect = resize2cover(
      this.camera.width,
      this.camera.height,
      this.displaySize.width,
      this.displaySize.height
    );
    if (this.slamSize) {
      this._slamCoverRect = resize2cover(
        this.camera.width,
        this.camera.height,
        this.slamSize.width,
        this.slamSize.height
      );
    }
  }

  async initializeSlam() {
    this.slamSize = getSlamProcessingSize(
      this.displaySize.width,
      this.displaySize.height
    );

    this._videoCanvas.width = this.slamSize.width;
    this._videoCanvas.height = this.slamSize.height;

    this.alva = await AlvaAR.Initialize(
      this.slamSize.width,
      this.slamSize.height,
      this.fov
    );

    this._updateCoverRect();
    this.trackingState = "initializing";
  }

  _captureFrame() {
    this._videoCtx.clearRect(0, 0, this.slamSize.width, this.slamSize.height);
    this._videoCtx.drawImage(
      this.camera.el,
      0,
      0,
      this.camera.width,
      this.camera.height,
      this._slamCoverRect.x,
      this._slamCoverRect.y,
      this._slamCoverRect.width,
      this._slamCoverRect.height
    );
    return this._videoCtx.getImageData(
      0,
      0,
      this.slamSize.width,
      this.slamSize.height
    );
  }

  startRenderLoop({ scene, camera, renderer, THREE, onPose, onTrackingLost, fps = 30 }) {
    if (!this.alva) throw new Error("Call initializeSlam() first");
    if (!THREE) throw new Error("Pass THREE namespace to startRenderLoop");

    this.applyPose = AlvaARConnectorTHREE.Initialize(THREE);
    this._three = THREE;
    this._running = true;
    this._threeCamera = camera;
    this._renderer = renderer;
    this._scene = scene;

    onFrame(async () => {
      if (!this._running || document.hidden) return true;

      const frame = this._captureFrame();
      const pose = this.alva.findCameraPose(frame);

      if (pose) {
        this.lastPose = pose;
        this.lostFrames = 0;
        this.trackingState = "tracking";
        this.applyPose(pose, camera.quaternion, camera.position);
        onPose?.(pose);
      } else {
        this.lostFrames++;
        if (this.lostFrames >= TRACKING_LOST_THRESHOLD) {
          this.trackingState = "lost";
          onTrackingLost?.();
        } else if (this.trackingState === "initializing") {
          // still initializing
        }
      }

      renderer.render(scene, camera);
      return true;
    }, fps);
  }

  getTrackingState() {
    return this.trackingState;
  }

  getMapPoints3D(maxPoints) {
    return this.alva?.getMapPoints3D(maxPoints) ?? [];
  }

  projectMapPointsToDisplay(threeCamera) {
    if (!this._three) return [];

    const points = this.getMapPoints3D();
    const projected = [];

    for (const p of points) {
      const v = new this._three.Vector3(p.x, -p.y, -p.z);
      v.project(threeCamera);
      if (v.z > 1) continue;

      projected.push({
        ...p,
        sx: (v.x * 0.5 + 0.5) * this.displaySize.width,
        sy: (-v.y * 0.5 + 0.5) * this.displaySize.height,
      });
    }

    return projected;
  }

  findPlaneAtDisplay(displayX, displayY) {
    const slam = displayToSlamPixel(displayX, displayY, {
      displaySize: this.displaySize,
      slamSize: this.slamSize,
      coverRect: this._coverRect,
    });
    return this.alva.findPlaneAt(~~slam.x, ~~slam.y);
  }

  findPlaneFromMapPointIndices(indices) {
    return this.alva.findPlaneFromPoints(indices);
  }

  applyPoseToObject(pose16, object) {
    if (!this._three) {
      throw new Error("startRenderLoop must be called before applyPoseToObject");
    }

    const m = new this._three.Matrix4().fromArray(pose16);
    object.position.setFromMatrixPosition(m);
    object.quaternion.setFromRotationMatrix(m);
    object.rotation.reorder("YXZ");
  }

  createAnchor(pose16, anchorId = 1) {
    return this.alva.createAnchor(pose16, anchorId);
  }

  getAnchorPose(anchorId) {
    return this.alva.getAnchorPose(anchorId);
  }

  clearAnchors() {
    this.alva?.clearAnchors();
    this._placedObjects.clear();
  }

  getFramePoints() {
    return this.alva?.getFramePoints() ?? [];
  }

  stop() {
    this._running = false;
    this.clearAnchors();
    this.camera?.stop();
    this.alva?.dispose();
    this.alva = null;
    this.camera = null;
  }
}

export { API_VERSION };
export { AlvaARConnectorTHREE } from "./connector.js";
