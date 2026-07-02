export function resize2cover(srcW, srcH, dstW, dstH) {
  const rect = {};

  if (dstW / dstH > srcW / srcH) {
    const scale = dstW / srcW;
    rect.width = ~~(scale * srcW);
    rect.height = ~~(scale * srcH);
    rect.x = 0;
    rect.y = ~~((dstH - rect.height) * 0.5);
  } else {
    const scale = dstH / srcH;
    rect.width = ~~(scale * srcW);
    rect.height = ~~(scale * srcH);
    rect.x = ~~((dstW - rect.width) * 0.5);
    rect.y = 0;
  }

  return rect;
}

/**
 * Compute SLAM processing resolution (max 640×960, preserve aspect).
 */
export function getSlamProcessingSize(displayW, displayH, opts = {}) {
  const maxW = opts.maxWidth ?? 640;
  const maxH = opts.maxHeight ?? 960;

  let w = displayW;
  let h = displayH;

  if (w > maxW || h > maxH) {
    const scale = Math.min(maxW / w, maxH / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  w = w - (w % 2);
  h = h - (h % 2);

  return { width: w, height: h };
}

export function displayToSlamPixel(displayX, displayY, { slamSize, coverRect }) {
  const nx = (displayX - coverRect.x) / coverRect.width;
  const ny = (displayY - coverRect.y) / coverRect.height;
  return {
    x: nx * slamSize.width,
    y: ny * slamSize.height,
  };
}

export function slamPixelToDisplay(slamX, slamY, { slamSize, coverRect }) {
  const nx = slamX / slamSize.width;
  const ny = slamY / slamSize.height;
  return {
    x: coverRect.x + nx * coverRect.width,
    y: coverRect.y + ny * coverRect.height,
  };
}

export function onFrame(frameTickFn, fps = 30) {
  const fpsInterval = ~~(1000 / fps);
  let t1 = performance.now();

  const loop = async () => {
    const t2 = performance.now();
    const td = t2 - t1;

    if (td > fpsInterval) {
      t1 = t2 - (td % fpsInterval);
      if ((await frameTickFn(t2)) === false) return;
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.platform);
}

export function isMobile() {
  try {
    document.createEvent("TouchEvent");
    return true;
  } catch {
    return false;
  }
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export class Camera {
  static async Initialize(constraints = { facingMode: "environment" }) {
    if ("facingMode" in constraints && "deviceId" in constraints) {
      throw new Error("Camera settings 'deviceId' and 'facingMode' are mutually exclusive.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        ...constraints,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("Failed to access camera: no video track.");

    const video = document.createElement("video");
    video.setAttribute("autoplay", "autoplay");
    video.setAttribute("playsinline", "playsinline");
    video.setAttribute("webkit-playsinline", "webkit-playsinline");
    video.srcObject = stream;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("Failed to load camera stream."));
    });

    video.play();
    return new Camera(video);
  }

  constructor(videoElement) {
    this.el = videoElement;
    this.width = videoElement.videoWidth;
    this.height = videoElement.videoHeight;
    this._canvas = createCanvas(this.width, this.height);
    this._ctx = this._canvas.getContext("2d", { willReadFrequently: true });
    this._stream = videoElement.srcObject;
  }

  getImageData() {
    this._ctx.clearRect(0, 0, this.width, this.height);
    this._ctx.drawImage(this.el, 0, 0, this.width, this.height);
    return this._ctx.getImageData(0, 0, this.width, this.height);
  }

  stop() {
    if (this._stream) {
      for (const track of this._stream.getTracks()) track.stop();
    }
    this.el.srcObject = null;
  }
}
