/**
 * YOLO11 Nano OBB Detector for RiftBound Cards
 *
 * This module provides the integration layer for a YOLO11 Nano model
 * converted to TensorFlow.js format for Oriented Bounding Box detection.
 *
 * In production, the model would be:
 *   1. Trained on card images using Ultralytics YOLO11n-obb
 *   2. Exported to SavedModel format
 *   3. Converted to TF.js using tensorflowjs_converter
 *   4. Loaded at startup for "warming up"
 *
 * For development/demo, this provides a simulated detector that uses
 * basic image analysis to detect card-like rectangles.
 */

const MODEL_URL = '/models/yolo11n-obb-riftbound/model.json';

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
    this.state = DetectorState.UNLOADED;
    this.inputSize = 640; // YOLO11 default input size
    this.confidenceThreshold = 0.6;
    this.iouThreshold = 0.45;
    this.useSimulation = true; // Toggle for demo mode
    this._warmupComplete = false;
  }

  /**
   * Load the YOLO model and perform warmup inference
   */
  async initialize() {
    this.state = DetectorState.LOADING;

    try {
      // Attempt to load real TF.js model
      if (typeof window !== 'undefined' && window.tf) {
        try {
          this.model = await window.tf.loadGraphModel(MODEL_URL);
          this.useSimulation = false;
          console.log('[YOLO] Model loaded from', MODEL_URL);
        } catch (e) {
          console.warn('[YOLO] Could not load model, using simulation mode:', e.message);
          this.useSimulation = true;
        }
      } else {
        console.log('[YOLO] TensorFlow.js not available, using simulation mode');
        this.useSimulation = true;
      }

      // Warmup: run a dummy inference to eliminate first-run lag
      this.state = DetectorState.WARMING;
      await this._warmup();

      this.state = DetectorState.READY;
      console.log('[YOLO] Detector ready (mode:', this.useSimulation ? 'simulation' : 'model', ')');
    } catch (error) {
      this.state = DetectorState.ERROR;
      console.error('[YOLO] Initialization failed:', error);
      throw error;
    }
  }

  async _warmup() {
    if (!this.useSimulation && this.model) {
      // Real warmup: create dummy tensor and run inference
      const dummyInput = window.tf.zeros([1, this.inputSize, this.inputSize, 3]);
      await this.model.predict(dummyInput);
      dummyInput.dispose();
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
   *   box: { cx, cy, w, h, angle },  // Oriented bounding box
   *   confidence: number,
   *   cropCanvas: HTMLCanvasElement   // Cropped & de-rotated card image
   * }
   */
  async detect(source) {
    if (this.state !== DetectorState.READY) {
      return [];
    }

    if (this.useSimulation) {
      return this._simulatedDetect(source);
    }

    return this._modelDetect(source);
  }

  /**
   * Real model inference pipeline
   */
  async _modelDetect(source) {
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

    // Post-process OBB outputs
    // YOLO11 OBB output shape: [1, 6, 8400] (transposed)
    // 6 channels = [cx, cy, w, h, class_score, angle] (nc=1)
    // 8400 = number of candidate detections
    const outputData = await predictions.data();
    predictions.dispose();

    const detections = [];
    const numDetections = 8400;

    for (let i = 0; i < numDetections; i++) {
      // Data is laid out as [ch0_det0, ch0_det1, ..., ch1_det0, ch1_det1, ...]
      // Channel 4 = class score (already sigmoid in model), Channel 5 = angle (already radians)
      const conf = outputData[4 * numDetections + i];

      if (conf >= this.confidenceThreshold) {
        // Map from letterbox space back to original image coords
        const cx = (outputData[0 * numDetections + i] - padX) / scale;
        const cy = (outputData[1 * numDetections + i] - padY) / scale;
        const w = outputData[2 * numDetections + i] / scale;
        const h = outputData[3 * numDetections + i] / scale;
        const angle = outputData[5 * numDetections + i];

        const cropCanvas = this._cropRotated(source, cx, cy, w, h, angle);

        detections.push({
          box: { cx, cy, w, h, angle },
          confidence: conf,
          cropCanvas,
        });
      }
    }

    return this._nmsOBB(detections);
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
          box: { cx: guideCx, cy: guideCy, w: guideW, h: guideH, angle: 0 },
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
   * Crop and de-rotate a detected card from the source
   */
  _cropRotated(source, cx, cy, w, h, angle) {
    // Rotate full image so card is axis-aligned, then crop card region
    const diag = Math.sqrt(source.width * source.width + source.height * source.height);
    const big = document.createElement('canvas');
    big.width = Math.ceil(diag);
    big.height = Math.ceil(diag);
    const bctx = big.getContext('2d');
    const bcx = big.width / 2;
    const bcy = big.height / 2;
    bctx.translate(bcx, bcy);
    bctx.rotate(-angle);
    bctx.drawImage(source, -cx, -cy);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    canvas.getContext('2d').drawImage(big, bcx - w / 2, bcy - h / 2, w, h, 0, 0, w, h);

    // If landscape, rotate to portrait (cards are portrait by default)
    if (w > h) {
      const rot = document.createElement('canvas');
      rot.width = Math.round(h);
      rot.height = Math.round(w);
      const rctx = rot.getContext('2d');
      rctx.translate(rot.width / 2, rot.height / 2);
      rctx.rotate(Math.PI / 2);
      rctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      return rot;
    }
    return canvas;
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
