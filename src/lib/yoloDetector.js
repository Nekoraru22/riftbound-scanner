/**
 * YOLO11 Small OBB Detector for RiftBound Cards
 *
 * This module provides the integration layer for a YOLO11 Small model
 * converted to TensorFlow.js / ONNX format for Oriented Bounding Box detection.
 *
 * In production, the model would be:
 *   1. Trained on card images using Ultralytics YOLO11s-obb
 *   2. Exported to ONNX (quantized int8 for web) and SavedModel formats
 *   3. Loaded at startup for "warming up"
 */

const MODEL_URLS = {
  normal: '/models/yolo11s-pose-riftbound.onnx',
  quantized: '/models/yolo11s-pose-riftbound-q8.onnx',
  tfjs: '/models/yolo11s-obb-riftbound/model.json', // Legacy OBB fallback (no pose tfjs model)
};

// Detection states
export const DetectorState = {
  UNLOADED: 'unloaded',
  LOADING: 'loading',
  WARMING: 'warming',
  READY: 'ready',
  ERROR: 'error',
};

class YOLODetector {
  constructor() {
    this.model = null;
    this.onnxSession = null;
    this.state = DetectorState.UNLOADED;
    this.inputSize = 768; // matches training imgsz
    this.confidenceThreshold = 0.6;
    this.iouThreshold = 0.45;
    // Minimum Laplacian variance for a crop to be considered "sharp enough"
    // to identify. Out-of-focus background cards typically score < 50;
    // well-focused cards score > 300. 100 is a conservative middle ground.
    this.sharpnessThreshold = 100;
    this.useSimulation = true; // Toggle for demo mode
    this.modelFormat = 'onnx'; // 'onnx' or 'tfjs'
    this.modelPreference = 'quantized'; // 'normal' or 'quantized'
    this._warmupComplete = false;
  }

  /**
   * Load the YOLO model and perform warmup inference
   * @param {string} modelPreference - 'normal' or 'quantized'
   */
  async initialize(modelPreference = 'normal') {
    this.state = DetectorState.LOADING;
    this.modelPreference = modelPreference;

    try {
      // Try to load ONNX model first (preferred)
      if (typeof window !== 'undefined' && window.ort) {
        try {
          const modelUrl = MODEL_URLS[modelPreference];
          console.log('[YOLO] Loading ONNX model:', modelUrl);

          this.onnxSession = await window.ort.InferenceSession.create(modelUrl, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
          });

          this.modelFormat = 'onnx';
          this.useSimulation = false;
          console.log('[YOLO] ONNX model loaded:', modelPreference);
        } catch (e) {
          console.warn('[YOLO] Could not load ONNX model, trying TF.js fallback:', e.message);

          // Fallback to TF.js if ONNX fails
          if (window.tf) {
            try {
              this.model = await window.tf.loadGraphModel(MODEL_URLS.tfjs);
              this.modelFormat = 'tfjs';
              this.useSimulation = false;
              console.log('[YOLO] TF.js model loaded (fallback)');
            } catch (tfjsError) {
              console.warn('[YOLO] TF.js also failed, using simulation mode:', tfjsError.message);
              this.useSimulation = true;
            }
          } else {
            console.log('[YOLO] ONNX Runtime not available, using simulation mode');
            this.useSimulation = true;
          }
        }
      } else if (typeof window !== 'undefined' && window.tf) {
        // No ONNX Runtime, try TF.js
        try {
          this.model = await window.tf.loadGraphModel(MODEL_URLS.tfjs);
          this.modelFormat = 'tfjs';
          this.useSimulation = false;
          console.log('[YOLO] TF.js model loaded');
        } catch (e) {
          console.warn('[YOLO] Could not load model, using simulation mode:', e.message);
          this.useSimulation = true;
        }
      } else {
        console.log('[YOLO] No model runtime available, using simulation mode');
        this.useSimulation = true;
      }

      // Warmup: run a dummy inference to eliminate first-run lag
      this.state = DetectorState.WARMING;
      await this._warmup();

      this.state = DetectorState.READY;
      const mode = this.useSimulation ? 'simulation' : `${this.modelFormat} (${modelPreference})`;
      console.log('[YOLO] Detector ready (mode:', mode, ')');
    } catch (error) {
      this.state = DetectorState.ERROR;
      console.error('[YOLO] Initialization failed:', error);
      throw error;
    }
  }

  async _warmup() {
    if (!this.useSimulation) {
      if (this.modelFormat === 'onnx' && this.onnxSession) {
        // ONNX warmup: create dummy tensor and run inference
        const dummyData = new Float32Array(this.inputSize * this.inputSize * 3).fill(0.5);
        const dummyTensor = new window.ort.Tensor('float32', dummyData, [1, 3, this.inputSize, this.inputSize]);
        await this.onnxSession.run({ images: dummyTensor });
      } else if (this.modelFormat === 'tfjs' && this.model) {
        // TF.js warmup: create dummy tensor and run inference
        const dummyInput = window.tf.zeros([1, this.inputSize, this.inputSize, 3]);
        await this.model.predict(dummyInput);
        dummyInput.dispose();
      }
    } else {
      // Simulated warmup: small delay to mimic
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    this._warmupComplete = true;
  }

  /**
   * Detect cards in a video frame
   * @param {HTMLCanvasElement|HTMLVideoElement} source - Input frame
   * @returns {Array<Detection>} Array of detected cards with OBB coordinates
   *
   * Detection shape:
   * {
   *   box: { cx, cy, w, h },         // Axis-aligned bounding box
   *   confidence: number,
   *   cropCanvas: HTMLCanvasElement,  // Perspective-corrected card image
   *   keypoints: [[x,y]×4]           // TL, TR, BR, BL corners (pose model only)
   * }
   */
  async detect(source) {
    if (this.state !== DetectorState.READY) {
      return [];
    }

    if (this.useSimulation) {
      return this._simulatedDetect(source);
    }

    if (this.modelFormat === 'onnx') {
      return this._onnxDetect(source);
    }

    return this._tfjsDetect(source);
  }

  /**
   * ONNX model inference pipeline
   */
  async _onnxDetect(source) {
    const srcW = source.width || source.videoWidth;
    const srcH = source.height || source.videoHeight;

    // Letterbox preprocess: maintain aspect ratio, pad with 114/255 gray
    const scale = Math.min(this.inputSize / srcW, this.inputSize / srcH);
    const newW = Math.round(srcW * scale);
    const newH = Math.round(srcH * scale);
    const padX = (this.inputSize - newW) / 2;
    const padY = (this.inputSize - newH) / 2;

    // Create canvas for preprocessing
    const canvas = document.createElement('canvas');
    canvas.width = this.inputSize;
    canvas.height = this.inputSize;
    const ctx = canvas.getContext('2d');

    // Fill with gray (114)
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, this.inputSize, this.inputSize);

    // Draw resized image
    ctx.drawImage(source, 0, 0, srcW, srcH, padX, padY, newW, newH);

    // Get image data and convert to NCHW format (channels first)
    const imageData = ctx.getImageData(0, 0, this.inputSize, this.inputSize);
    const data = imageData.data;
    const inputData = new Float32Array(3 * this.inputSize * this.inputSize);

    // Convert RGBA to RGB and normalize to [0, 1], channels first
    for (let i = 0; i < this.inputSize * this.inputSize; i++) {
      inputData[i] = data[i * 4] / 255.0; // R
      inputData[this.inputSize * this.inputSize + i] = data[i * 4 + 1] / 255.0; // G
      inputData[2 * this.inputSize * this.inputSize + i] = data[i * 4 + 2] / 255.0; // B
    }

    // Create ONNX tensor
    const tensor = new window.ort.Tensor('float32', inputData, [1, 3, this.inputSize, this.inputSize]);

    // Run inference
    const results = await this.onnxSession.run({ images: tensor });
    const output = results.output0 || results[Object.keys(results)[0]];
    const outputData = output.data;

    // Post-process pose outputs.
    // YOLO11 pose single-class output shape: [1, 13, N]
    // Channels: cx, cy, w, h, conf, kp0x, kp0y, kp1x, kp1y, kp2x, kp2y, kp3x, kp3y
    // Keypoint order: TL, TR, BR, BL (card-art corners)
    const detections = [];
    const numDetections = output.dims ? output.dims[output.dims.length - 1] : outputData.length / 13;

    for (let i = 0; i < numDetections; i++) {
      const conf = outputData[4 * numDetections + i];

      if (conf >= this.confidenceThreshold) {
        // Map box from letterbox space back to original image coords
        const cx = (outputData[0 * numDetections + i] - padX) / scale;
        const cy = (outputData[1 * numDetections + i] - padY) / scale;
        const w = outputData[2 * numDetections + i] / scale;
        const h = outputData[3 * numDetections + i] / scale;

        // Map keypoints from letterbox space back to original image coords
        const kps = [];
        for (let k = 0; k < 4; k++) {
          const kx = (outputData[(5 + k * 2) * numDetections + i] - padX) / scale;
          const ky = (outputData[(6 + k * 2) * numDetections + i] - padY) / scale;
          kps.push([kx, ky]);
        }

        const cropCanvas = this._cropPerspective(source, kps);

        detections.push({
          box: { cx, cy, w, h },
          confidence: conf,
          cropCanvas,
          keypoints: kps,
        });
      }
    }

    return this._filterByFocus(this._nmsOBB(detections));
  }

  /**
   * TensorFlow.js model inference pipeline
   */
  async _tfjsDetect(source) {
    const tf = window.tf;

    const srcW = source.width || source.videoWidth;
    const srcH = source.height || source.videoHeight;

    // Letterbox preprocess: maintain aspect ratio, pad with 114/255 gray
    const scale = Math.min(this.inputSize / srcW, this.inputSize / srcH);
    const newW = Math.round(srcW * scale);
    const newH = Math.round(srcH * scale);
    const padX = (this.inputSize - newW) / 2;
    const padY = (this.inputSize - newH) / 2;

    const tensor = tf.tidy(() => {
      let img = tf.browser.fromPixels(source);
      img = tf.image.resizeBilinear(img, [newH, newW]);
      img = img.toFloat().div(255.0);
      const padTop = Math.floor(padY);
      const padBottom = this.inputSize - newH - padTop;
      const padLeft = Math.floor(padX);
      const padRight = this.inputSize - newW - padLeft;
      img = tf.pad(img, [[padTop, padBottom], [padLeft, padRight], [0, 0]], 0.4470588);
      return img.expandDims(0);
    });

    // Run inference
    const predictions = await this.model.predict(tensor);
    tensor.dispose();

    // Post-process pose outputs.
    // YOLO11 pose single-class output shape: [1, 13, N]
    // Channels: cx, cy, w, h, conf, kp0x, kp0y, kp1x, kp1y, kp2x, kp2y, kp3x, kp3y
    // Keypoint order: TL, TR, BR, BL (card-art corners)
    const predShape = predictions.shape;
    const outputData = await predictions.data();
    predictions.dispose();

    const detections = [];
    const numDetections = predShape ? predShape[predShape.length - 1] : outputData.length / 13;

    for (let i = 0; i < numDetections; i++) {
      const conf = outputData[4 * numDetections + i];

      if (conf >= this.confidenceThreshold) {
        // Map box from letterbox space back to original image coords
        const cx = (outputData[0 * numDetections + i] - padX) / scale;
        const cy = (outputData[1 * numDetections + i] - padY) / scale;
        const w = outputData[2 * numDetections + i] / scale;
        const h = outputData[3 * numDetections + i] / scale;

        // Map keypoints from letterbox space back to original image coords
        const kps = [];
        for (let k = 0; k < 4; k++) {
          const kx = (outputData[(5 + k * 2) * numDetections + i] - padX) / scale;
          const ky = (outputData[(6 + k * 2) * numDetections + i] - padY) / scale;
          kps.push([kx, ky]);
        }

        const cropCanvas = this._cropPerspective(source, kps);

        detections.push({
          box: { cx, cy, w, h },
          confidence: conf,
          cropCanvas,
          keypoints: kps,
        });
      }
    }

    return this._filterByFocus(this._nmsOBB(detections));
  }

  /**
   * Simulated detection using basic image analysis
   * Detects a card-like region in the center of the frame
   */
  _simulatedDetect(source) {
    const canvas = source instanceof HTMLCanvasElement ? source : this._videoToCanvas(source);
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    // Analyze the center region for card-like content
    // A card is roughly 63mm x 88mm = aspect ratio ~0.716
    const cardAspect = 0.716;
    const guideW = width * 0.55;
    const guideH = guideW / cardAspect;
    const guideCx = width / 2;
    const guideCy = height / 2;

    // Sample the guide region and check for sufficient variance (=card present)
    const sampleX = Math.floor(guideCx - guideW / 2);
    const sampleY = Math.floor(guideCy - guideH / 2);
    const sampleW = Math.floor(guideW);
    const sampleH = Math.floor(guideH);

    if (sampleW <= 0 || sampleH <= 0) return [];

    try {
      const imgData = ctx.getImageData(
        Math.max(0, sampleX),
        Math.max(0, sampleY),
        Math.min(sampleW, width - sampleX),
        Math.min(sampleH, height - sampleY)
      );

      // Compute color variance to determine if there's a card
      const { variance, edgeDensity } = this._analyzeRegion(imgData);

      // Threshold: if sufficient texture/edges, consider it a card
      if (variance > 800 && edgeDensity > 0.05) {
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = sampleW;
        cropCanvas.height = sampleH;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.putImageData(imgData, 0, 0);

        return [{
          box: { cx: guideCx, cy: guideCy, w: guideW, h: guideH },
          confidence: Math.min(0.95, 0.5 + (variance / 5000) + (edgeDensity * 2)),
          cropCanvas,
        }];
      }
    } catch (e) {
      // Canvas security error in cross-origin scenarios
    }

    return [];
  }

  /**
   * Analyze a region for card-like characteristics
   */
  _analyzeRegion(imageData) {
    const data = imageData.data;
    const pixelCount = data.length / 4;

    let sumR = 0, sumG = 0, sumB = 0;
    for (let i = 0; i < data.length; i += 4) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
    }
    const meanR = sumR / pixelCount;
    const meanG = sumG / pixelCount;
    const meanB = sumB / pixelCount;

    let variance = 0;
    for (let i = 0; i < data.length; i += 4) {
      variance += (data[i] - meanR) ** 2;
      variance += (data[i + 1] - meanG) ** 2;
      variance += (data[i + 2] - meanB) ** 2;
    }
    variance /= (pixelCount * 3);

    // Simple edge detection (horizontal gradient)
    const w = imageData.width;
    let edgeCount = 0;
    const step = 4; // sample every 4th pixel for speed
    for (let y = 0; y < imageData.height; y += step) {
      for (let x = 1; x < w; x += step) {
        const idx = (y * w + x) * 4;
        const prevIdx = (y * w + x - 1) * 4;
        const diff = Math.abs(data[idx] - data[prevIdx]) +
                    Math.abs(data[idx + 1] - data[prevIdx + 1]) +
                    Math.abs(data[idx + 2] - data[prevIdx + 2]);
        if (diff > 80) edgeCount++;
      }
    }
    const sampledPixels = Math.ceil(imageData.height / step) * Math.ceil((w - 1) / step);
    const edgeDensity = edgeCount / sampledPixels;

    return { variance, edgeDensity };
  }

  /**
   * Perspective-correct crop of a card using its 4 corner keypoints.
   * kps: [[TLx,TLy],[TRx,TRy],[BRx,BRy],[BLx,BLy]] in source image pixels.
   * Uses horizontal strip affine decomposition — O(STRIPS) canvas operations,
   * no per-pixel JS loop needed.
   */
  _cropPerspective(source, kps) {
    const STRIPS = 48;
    // Estimate card width/height from keypoints to set output canvas size
    const [tl, tr, br, bl] = kps;
    const topW = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
    const botW = Math.hypot(br[0] - bl[0], br[1] - bl[1]);
    const leftH = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
    const rightH = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
    const cardW = Math.max(1, Math.round((topW + botW) / 2));
    const cardH = Math.max(1, Math.round((leftH + rightH) / 2));

    const dst = document.createElement('canvas');
    dst.width = cardW;
    dst.height = cardH;
    const ctx = dst.getContext('2d');

    for (let i = 0; i < STRIPS; i++) {
      const t0 = i / STRIPS;
      const t1 = (i + 1) / STRIPS;

      // Interpolate along left edge (TL→BL) and right edge (TR→BR)
      const lx0 = tl[0] + (bl[0] - tl[0]) * t0, ly0 = tl[1] + (bl[1] - tl[1]) * t0;
      const rx0 = tr[0] + (br[0] - tr[0]) * t0, ry0 = tr[1] + (br[1] - tr[1]) * t0;
      const lx1 = tl[0] + (bl[0] - tl[0]) * t1, ly1 = tl[1] + (bl[1] - tl[1]) * t1;

      const dy0 = cardH * t0;
      const dy1 = cardH * t1;

      // Affine from 3 source→dest correspondences:
      //   (lx0,ly0)→(0,dy0), (rx0,ry0)→(cardW,dy0), (lx1,ly1)→(0,dy1)
      const [a, b, c, d, e, f] = this._solveAffine(
        [lx0, ly0], [rx0, ry0], [lx1, ly1],
        [0, dy0],   [cardW, dy0], [0, dy1]
      );

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, dy0, cardW, dy1 - dy0);
      ctx.clip();
      ctx.setTransform(a, b, c, d, e, f);
      ctx.drawImage(source, 0, 0);
      ctx.restore();
    }

    return dst;
  }

  /**
   * Solve affine transform mapping 3 source points to 3 destination points.
   * Returns [a, b, c, d, e, f] for ctx.setTransform(a, b, c, d, e, f) such that
   * source pixel (sx, sy) maps to canvas pixel (a*sx+c*sy+e, b*sx+d*sy+f).
   */
  _solveAffine(p0, p1, p2, q0, q1, q2) {
    const [x0, y0] = p0, [x1, y1] = p1, [x2, y2] = p2;
    const [u0, v0] = q0, [u1, v1] = q1, [u2, v2] = q2;
    const det = x0 * (y1 - y2) - y0 * (x1 - x2) + (x1 * y2 - x2 * y1);
    if (Math.abs(det) < 1e-10) return [1, 0, 0, 1, 0, 0];
    const a = (u0 * (y1 - y2) - y0 * (u1 - u2) + (u1 * y2 - u2 * y1)) / det;
    const c = (x0 * (u1 - u2) - u0 * (x1 - x2) + (x1 * u2 - x2 * u1)) / det;
    const e = (x0 * (y1 * u2 - y2 * u1) - y0 * (x1 * u2 - x2 * u1) + u0 * (x1 * y2 - x2 * y1)) / det;
    const b = (v0 * (y1 - y2) - y0 * (v1 - v2) + (v1 * y2 - v2 * y1)) / det;
    const d = (x0 * (v1 - v2) - v0 * (x1 - x2) + (x1 * v2 - x2 * v1)) / det;
    const f = (x0 * (y1 * v2 - y2 * v1) - y0 * (x1 * v2 - x2 * v1) + v0 * (x1 * y2 - x2 * y1)) / det;
    return [a, b, c, d, e, f];
  }

  /**
   * Drop detections whose crop is too out-of-focus to identify reliably.
   * Uses Laplacian variance on a 64×64 grayscale downsample — cheap and a
   * reliable proxy for "how much edge detail is in this image".
   */
  _filterByFocus(detections) {
    if (this.sharpnessThreshold <= 0) return detections;
    return detections.filter(d => this._laplacianVariance(d.cropCanvas) >= this.sharpnessThreshold);
  }

  _laplacianVariance(cropCanvas) {
    if (!this._sharpCanvas) this._sharpCanvas = document.createElement('canvas');
    const N = 64;
    this._sharpCanvas.width = N;
    this._sharpCanvas.height = N;
    const ctx = this._sharpCanvas.getContext('2d');
    ctx.drawImage(cropCanvas, 0, 0, N, N);
    const data = ctx.getImageData(0, 0, N, N).data;

    // Grayscale (Rec. 601 luma)
    const gray = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }

    // 3×3 Laplacian kernel: [0,1,0; 1,-4,1; 0,1,0]
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        const lap = -4 * gray[y * N + x]
                  + gray[(y - 1) * N + x]
                  + gray[(y + 1) * N + x]
                  + gray[y * N + x - 1]
                  + gray[y * N + x + 1];
        sum += lap;
        sumSq += lap * lap;
        count++;
      }
    }
    const mean = sum / count;
    return sumSq / count - mean * mean;
  }

  /**
   * Non-Maximum Suppression for Oriented Bounding Boxes
   */
  _nmsOBB(detections) {
    if (detections.length <= 1) return detections;

    detections.sort((a, b) => b.confidence - a.confidence);
    const kept = [];

    for (const det of detections) {
      let dominated = false;
      for (const kept_det of kept) {
        const iou = this._computeOBBIoU(det.box, kept_det.box);
        if (iou > this.iouThreshold) {
          dominated = true;
          break;
        }
      }
      if (!dominated) kept.push(det);
    }

    return kept;
  }

  /**
   * Approximate IoU for OBBs (using axis-aligned approximation)
   */
  _computeOBBIoU(box1, box2) {
    const x1 = Math.max(box1.cx - box1.w / 2, box2.cx - box2.w / 2);
    const y1 = Math.max(box1.cy - box1.h / 2, box2.cy - box2.h / 2);
    const x2 = Math.min(box1.cx + box1.w / 2, box2.cx + box2.w / 2);
    const y2 = Math.min(box1.cy + box1.h / 2, box2.cy + box2.h / 2);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = box1.w * box1.h;
    const area2 = box2.w * box2.h;
    const union = area1 + area2 - intersection;

    return union > 0 ? intersection / union : 0;
  }

  _videoToCanvas(video) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    return canvas;
  }

  dispose() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    if (this.onnxSession) {
      // ONNX sessions don't have a dispose method, just set to null
      this.onnxSession = null;
    }
    this.state = DetectorState.UNLOADED;
  }
}

// Singleton instance
let detectorInstance = null;

export function getDetector() {
  if (!detectorInstance) {
    detectorInstance = new YOLODetector();
  }
  return detectorInstance;
}

export default YOLODetector;
