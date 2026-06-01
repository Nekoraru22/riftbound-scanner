import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Camera, Upload, Loader2, RotateCcw, ScanLine, Download, Plus, CheckSquare, Square, Trash2, ChevronsRight } from 'lucide-react';
import ScannerCamera from '../scanner/ScannerCamera.jsx';
import CardCounter from '../scanner/CardCounter.jsx';
import ImageDropZone from '../identify/ImageDropZone.jsx';
import DetectionCanvas, { DETECTION_COLORS } from '../identify/DetectionCanvas.jsx';
import CardDetailPanel from '../identify/CardDetailPanel.jsx';
import { getDetector } from '../../lib/yoloDetector.js';
import { getMatcher } from '../../lib/cardMatcher.js';
import { downloadCSV, validateForExport } from '../../lib/csvExporter.js';
import { warpQuadToPortrait } from '../../lib/perspectiveCrop.js';

// --- Card matching utilities ---

function equalizeHistogram(data) {
  for (let ch = 0; ch < 3; ch++) {
    const hist = new Uint32Array(256);
    for (let i = ch; i < data.length; i += 4) hist[data[i]]++;
    const cdf = new Uint32Array(256);
    cdf[0] = hist[0];
    for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
    let cdfMin = 0;
    for (let i = 0; i < 256; i++) { if (cdf[i] > 0) { cdfMin = cdf[i]; break; } }
    const denom = data.length / 4 - cdfMin;
    if (denom > 0) {
      for (let i = ch; i < data.length; i += 4) {
        data[i] = ((cdf[data[i]] - cdfMin) * 255 / denom + 0.5) | 0;
      }
    }
  }
}

// Pooled work canvases — reused across every identifyCard / computeColorGrid call.
// Allocating fresh canvases per crop ate hundreds of MB on multi-card uploads and
// killed the tab. We resize these in place instead.
let _eqCanvas = null;
let _tmpCanvas = null;
let _flipCanvas = null;

function _getEqCanvas() {
  if (!_eqCanvas) _eqCanvas = document.createElement('canvas');
  return _eqCanvas;
}

function _getTmpCanvas(size) {
  if (!_tmpCanvas) {
    _tmpCanvas = document.createElement('canvas');
  }
  if (_tmpCanvas.width !== size || _tmpCanvas.height !== size) {
    _tmpCanvas.width = size;
    _tmpCanvas.height = size;
  }
  return _tmpCanvas;
}

function _getFlippedCanvas(srcCanvas) {
  if (!_flipCanvas) _flipCanvas = document.createElement('canvas');
  if (_flipCanvas.width !== srcCanvas.width || _flipCanvas.height !== srcCanvas.height) {
    _flipCanvas.width = srcCanvas.width;
    _flipCanvas.height = srcCanvas.height;
  }
  const ctx = _flipCanvas.getContext('2d');
  ctx.setTransform(-1, 0, 0, 1, srcCanvas.width, 0);
  ctx.drawImage(srcCanvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return _flipCanvas;
}

/**
 * Crops the artwork region from `srcCanvas` (using the per-card `bottom`),
 * equalizes the per-channel histogram in place, and returns the gridSize × gridSize
 * color grid feature vector. Uses pooled canvases to avoid leaking memory.
 */
function cropAndComputeGrid(srcCanvas, bottom, gridSize) {
  const sw = Math.round(srcCanvas.width * (ART_RIGHT - ART_LEFT));
  const sh = Math.round(srcCanvas.height * (bottom - ART_TOP));
  const sx = Math.round(srcCanvas.width * ART_LEFT);
  const sy = Math.round(srcCanvas.height * ART_TOP);

  const eq = _getEqCanvas();
  if (eq.width !== sw || eq.height !== sh) {
    eq.width = sw;
    eq.height = sh;
  }
  const eqCtx = eq.getContext('2d');
  eqCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const fullData = eqCtx.getImageData(0, 0, sw, sh);
  equalizeHistogram(fullData.data);
  eqCtx.putImageData(fullData, 0, 0);

  const tmp = _getTmpCanvas(gridSize);
  const tctx = tmp.getContext('2d');
  tctx.drawImage(eq, 0, 0, gridSize, gridSize);
  const data = tctx.getImageData(0, 0, gridSize, gridSize).data;
  const features = new Float32Array(gridSize * gridSize * 3);
  for (let i = 0, j = 0; i < data.length; i += 4) {
    features[j++] = data[i] / 255;
    features[j++] = data[i + 1] / 255;
    features[j++] = data[i + 2] / 255;
  }
  return features;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function rotateCanvas90(canvas) {
  const rot = document.createElement('canvas');
  rot.width = canvas.height;
  rot.height = canvas.width;
  const rctx = rot.getContext('2d');
  rctx.translate(rot.width / 2, rot.height / 2);
  rctx.rotate(Math.PI / 2);
  rctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return rot;
}

function cropRotated(img, cx, cy, w, h, angle) {
  // Use card diagonal (not image diagonal) for intermediate canvas — saves memory
  const cardDiag = Math.sqrt(w * w + h * h);
  const size = Math.ceil(cardDiag) + 4;
  const big = document.createElement('canvas');
  big.width = size;
  big.height = size;
  const bctx = big.getContext('2d');
  const bcx = size / 2;
  const bcy = size / 2;
  bctx.translate(bcx, bcy);
  bctx.rotate(-angle);
  bctx.drawImage(img, -cx, -cy);

  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  c.getContext('2d').drawImage(big, bcx - w / 2, bcy - h / 2, w, h, 0, 0, w, h);

  if (w > h) {
    const rot = document.createElement('canvas');
    rot.width = Math.round(h);
    rot.height = Math.round(w);
    const rctx = rot.getContext('2d');
    rctx.translate(rot.width / 2, rot.height / 2);
    rctx.rotate(Math.PI / 2);
    rctx.drawImage(c, -c.width / 2, -c.height / 2);
    return rot;
  }
  return c;
}

// Artwork crop region (portrait card) — excludes frame, name bar, text/stats.
// `bottom` is per-card (0.55 standard / 0.85 legend / 0.95 full-art).
const ART_TOP = 0.05;
const ART_LEFT = 0.05;
const ART_RIGHT = 0.95;
const ART_BOTTOM_DEFAULT = 0.55;

function identifyCard(cropCanvas, matcher) {
  if (!matcher || !matcher.cards || matcher.cards.length === 0) return null;

  const rotated = rotateCanvas90(cropCanvas);
  const flipped = _getFlippedCanvas(cropCanvas);
  const bottoms = matcher.uniqueArtBottoms?.length
    ? matcher.uniqueArtBottoms
    : [ART_BOTTOM_DEFAULT];

  // Precompute one query feature per distinct artBottom across 3 orientations:
  //   normal, 90° rotated (landscape battlefields), horizontal flip (mirror photos).
  // Each candidate card is matched against the query that matches its layout,
  // and we keep the max similarity across orientations. Pooled canvases inside.
  const featNormal = new Map();
  const featRotated = new Map();
  const featFlipped = new Map();
  for (const b of bottoms) {
    featNormal.set(b, cropAndComputeGrid(cropCanvas, b, matcher.gridSize));
    featRotated.set(b, cropAndComputeGrid(rotated, b, matcher.gridSize));
    featFlipped.set(b, cropAndComputeGrid(flipped, b, matcher.gridSize));
  }
  const fallback = bottoms[0];

  const ranked = [];
  for (const c of matcher.cards) {
    const b = typeof c.artBottom === 'number' ? c.artBottom : fallback;
    const qn = featNormal.get(b) ?? featNormal.get(fallback);
    const qr = featRotated.get(b) ?? featRotated.get(fallback);
    const qf = featFlipped.get(b) ?? featFlipped.get(fallback);
    const s1 = cosineSimilarity(qn, c.f);
    const s2 = cosineSimilarity(qr, c.f);
    const s3 = cosineSimilarity(qf, c.f);
    ranked.push({ card: c, sim: Math.max(s1, s2, s3) });
  }
  ranked.sort((a, b) => b.sim - a.sim);

  const toCardData = (r) => ({
    id: r.card.id,
    name: r.card.name,
    collectorNumber: ((r.card.code || '').split('/')[0].includes('-')
      ? (r.card.code || '').split('/')[0].split('-').slice(1).join('-')
      : String(r.card.number).padStart(3, '0')),
    code: r.card.code,
    set: r.card.set,
    setName: r.card.setName,
    domain: r.card.domain,
    domains: r.card.domains,
    rarity: r.card.rarity,
    type: r.card.type,
    energy: r.card.energy,
    might: r.card.might,
    tags: r.card.tags,
    illustrator: r.card.illustrator,
    text: r.card.text,
    sim: (r.sim * 100).toFixed(1),
    similarity: r.sim,
  });

  return {
    card: ranked[0]?.card || null,
    similarity: ranked[0]?.sim || 0,
    top3: ranked.slice(0, 3).map(toCardData),
  };
}

function resolveMatchCardData(det) {
  const cardId = det.activeCardId || det.matchResult?.card?.id;
  if (!cardId) return null;
  const matchEntry = det.matchResult?.top3?.find(m => m.id === cardId);
  if (!matchEntry) return null;
  return {
    id: matchEntry.id,
    name: matchEntry.name,
    collectorNumber: matchEntry.collectorNumber,
    code: matchEntry.code,
    set: matchEntry.set,
    setName: matchEntry.setName,
    domain: matchEntry.domain,
    domains: matchEntry.domains,
    rarity: matchEntry.rarity,
    type: matchEntry.type,
    energy: matchEntry.energy,
    might: matchEntry.might,
    tags: matchEntry.tags,
    illustrator: matchEntry.illustrator,
    text: matchEntry.text,
  };
}

/** Resize image to fit within maxDim, returns a new Image element */
const MAX_IMAGE_DIM = 2048;
function resizeImage(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w <= MAX_IMAGE_DIM && h <= MAX_IMAGE_DIM) return img;
  const scale = MAX_IMAGE_DIM / Math.max(w, h);
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  canvas.getContext('2d').drawImage(img, 0, 0, nw, nh);
  const resized = new Image();
  resized.src = canvas.toDataURL('image/png');
  resized.width = nw;
  resized.height = nh;
  return resized;
}

/** Convert a pending card to CardDetailPanel's detection format */
function pendingToDetection(card) {
  const sim = card.similarity || card.confidence || 1;
  return {
    matchResult: {
      card: { id: card.cardData.id },
      similarity: sim,
      top3: [{
        id: card.cardData.id,
        name: card.cardData.name,
        collectorNumber: card.cardData.collectorNumber,
        code: card.cardData.code,
        set: card.cardData.set,
        setName: card.cardData.setName,
        domain: card.cardData.domain,
        domains: card.cardData.domains,
        rarity: card.cardData.rarity,
        type: card.cardData.type,
        energy: card.cardData.energy,
        might: card.cardData.might,
        tags: card.cardData.tags,
        illustrator: card.cardData.illustrator,
        text: card.cardData.text,
        sim: (sim * 100).toFixed(1),
        similarity: sim,
      }],
    },
    cropCanvas: null,
    confidence: card.confidence || 1,
  };
}

// --- Component ---

export default function ScanTab({
  camera,
  detection,
  onSnapScan,
  pendingCards,
  onConfirmPending,
  onConfirmAllPending,
  onRemovePending,
  onClearPending,
  onAddCardToExport,
  onAddCardsToExport,
  showNotification,
  batchDefaults,
  minConfidence,
  onUpdateMinConfidence,
  autoScanEnabled,
  onToggleAutoScan,
}) {
  const [scanMode, setScanMode] = useState('camera');
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [checkedPendingIndices, setCheckedPendingIndices] = useState(new Set());

  // Upload mode state
  const [uploadedImage, setUploadedImage] = useState(null);
  const [fileName, setFileName] = useState('');
  const [detections, setDetections] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState(null);
  const [checkedIndices, setCheckedIndices] = useState(new Set());

  const mobileDetectionRefs = useRef([]);
  const desktopDetectionRefs = useRef([]);
  const originalImageRef = useRef(null);

  const totalPending = pendingCards.reduce((sum, c) => sum + c.quantity, 0);

  // Clear checked pending indices when pending cards change
  useEffect(() => {
    setCheckedPendingIndices(prev => {
      if (prev.size === 0) return prev;
      // Remove indices that no longer exist
      const next = new Set([...prev].filter(i => i < pendingCards.length));
      return next.size === prev.size ? prev : next;
    });
  }, [pendingCards.length]);

  const togglePendingCheck = useCallback((idx) => {
    setCheckedPendingIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleConfirmCheckedPending = useCallback(() => {
    // Confirm checked cards in reverse order so indices stay valid
    const sorted = [...checkedPendingIndices].sort((a, b) => b - a);
    for (const idx of sorted) {
      onConfirmPending(idx);
    }
    setCheckedPendingIndices(new Set());
  }, [checkedPendingIndices, onConfirmPending]);

  // Clean switch between modes
  const handleModeChange = useCallback((mode) => {
    const wasActive = camera.isActive;
    camera.stopCamera();
    setScanMode(mode);
    if (mode === 'camera' && wasActive) {
      camera.startCamera();
    }
  }, [camera]);

  // Scroll to selected detection (delayed to allow card expansion first)
  useEffect(() => {
    if (selectedDetection == null) return;
    const timer = setTimeout(() => {
      for (const refs of [desktopDetectionRefs, mobileDetectionRefs]) {
        const el = refs.current[selectedDetection];
        if (el && el.offsetParent !== null) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [selectedDetection]);

  // --- Upload mode handlers ---

  const handleImageSelected = useCallback((file) => {
    setFileName(file.name);
    setDetections([]);
    setSelectedDetection(null);
    setCheckedIndices(new Set());
    const img = new Image();
    img.onload = () => {
      originalImageRef.current = img;
      const resized = resizeImage(img);
      if (resized === img) {
        setUploadedImage(img);
        runDetection(img);
      } else {
        resized.onload = () => {
          setUploadedImage(resized);
          runDetection(resized);
        };
      }
    };
    img.src = URL.createObjectURL(file);
  }, []);

  const runDetection = async (imageElement) => {
    setIsProcessing(true);
    setDetections([]);
    setCheckedIndices(new Set());
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imageElement.naturalWidth;
      canvas.height = imageElement.naturalHeight;
      canvas.getContext('2d').drawImage(imageElement, 0, 0);

      const detector = getDetector();
      if (detector.state !== 'ready') {
        showNotification('Detector not ready', 'error');
        setIsProcessing(false);
        return;
      }
      const rawDetections = await detector.detect(canvas);
      if (!rawDetections || rawDetections.length === 0) {
        showNotification('No cards detected in the image', 'info');
        setIsProcessing(false);
        return;
      }

      // Crop from original full-resolution image for better matching quality
      const originalImage = originalImageRef.current || imageElement;
      const origW = originalImage.naturalWidth || originalImage.width;
      const dispW = imageElement.naturalWidth || imageElement.width;
      const cropScale = origW / dispW;

      const matcher = getMatcher();
      const results = [];
      for (const det of rawDetections) {
        let crop;
        if (det.keypoints?.length === 4) {
          const scaledKps = det.keypoints.map(([x, y]) => [x * cropScale, y * cropScale]);
          crop = warpQuadToPortrait(originalImage, scaledKps);
        } else {
          crop = cropRotated(
            originalImage,
            det.box.cx * cropScale,
            det.box.cy * cropScale,
            det.box.w * cropScale,
            det.box.h * cropScale,
            det.box.angle ?? 0
          );
        }
        let matchResult = null;
        if (matcher.ready) matchResult = identifyCard(crop, matcher);
        results.push({
          cx: det.box.cx, cy: det.box.cy, w: det.box.w, h: det.box.h,
          corners: det.keypoints || null,
          confidence: det.confidence, cropCanvas: crop, matchResult,
        });
      }

      const matched = matcher.ready
        ? results.filter(r => r.matchResult && r.matchResult.similarity >= minConfidence)
        : results;
      setDetections(matched);
      if (matched.length > 0) {
        showNotification(`${matched.length} card${matched.length !== 1 ? 's' : ''} detected`, 'success');
        setSelectedDetection(0);
      }
    } catch (error) {
      console.error('[ScanTab] Detection error:', error);
      showNotification('Error during detection', 'error');
    }
    setIsProcessing(false);
  };

  const handleReset = () => {
    setUploadedImage(null);
    setFileName('');
    setDetections([]);
    setSelectedDetection(null);
    setCheckedIndices(new Set());
    originalImageRef.current = null;
  };

  const handleAddToExport = useCallback((cardData) => {
    onAddCardToExport(cardData);
  }, [onAddCardToExport]);

  const toggleCheck = useCallback((idx) => {
    setCheckedIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const matchedIndices = detections
      .map((det, i) => (det.matchResult && det.matchResult.similarity > 0.55) ? i : -1)
      .filter(i => i >= 0);
    if (checkedIndices.size === matchedIndices.length) {
      setCheckedIndices(new Set());
    } else {
      setCheckedIndices(new Set(matchedIndices));
    }
  }, [detections, checkedIndices]);

  const addCheckedToExport = useCallback(() => {
    const cardDataArray = [];
    for (const idx of checkedIndices) {
      const det = detections[idx];
      if (!det?.matchResult?.card) continue;
      const cardData = resolveMatchCardData(det);
      if (cardData) cardDataArray.push(cardData);
    }
    if (cardDataArray.length > 0) onAddCardsToExport(cardDataArray);
    setCheckedIndices(new Set());
  }, [checkedIndices, detections, onAddCardsToExport]);

  const exportCheckedCSV = useCallback(() => {
    const exportCards = [];
    for (const idx of checkedIndices) {
      const det = detections[idx];
      if (!det?.matchResult?.card) continue;
      const cardData = resolveMatchCardData(det);
      if (cardData) {
        exportCards.push({
          cardData, quantity: 1,
          condition: batchDefaults.condition,
          language: batchDefaults.language,
          foil: batchDefaults.foil,
        });
      }
    }
    if (exportCards.length === 0) { showNotification('Select at least one card', 'error'); return; }
    const { valid, errors } = validateForExport(exportCards);
    if (!valid) { showNotification(`Error: ${errors[0]}`, 'error'); return; }
    downloadCSV(exportCards);
    showNotification(`CSV exported — ${exportCards.length} cards`, 'success');
  }, [checkedIndices, detections, batchDefaults, showNotification]);

  const handleMatchChange = useCallback((detectionIndex, cardId) => {
    setDetections(prev => {
      const updated = [...prev];
      updated[detectionIndex] = { ...updated[detectionIndex], activeCardId: cardId };
      return updated;
    });
  }, []);

  // The user dragged the 4 corners of a detection. Re-warp the original
  // full-resolution image through those corners and re-run the matcher with
  // the new crop. Updates the detection in place so the side panel refreshes.
  const handleCornersChange = useCallback((detectionIndex, newCorners) => {
    const original = originalImageRef.current || uploadedImage;
    if (!original) return;
    setDetections(prev => {
      const det = prev[detectionIndex];
      if (!det) return prev;
      // The canvas reports coords in the resized-image space (uploadedImage),
      // but the warp samples from the original full-res image — scale corners.
      const origW = original.naturalWidth || original.width;
      const dispW = uploadedImage.naturalWidth || uploadedImage.width;
      const scale = origW / dispW;
      const srcCorners = newCorners.map(([x, y]) => [x * scale, y * scale]);
      let crop;
      try {
        crop = warpQuadToPortrait(original, srcCorners);
      } catch (err) {
        console.error('[ScanTab] Perspective warp failed:', err);
        return prev;
      }
      const matcher = getMatcher();
      const matchResult = matcher.ready ? identifyCard(crop, matcher) : null;
      const updated = [...prev];
      updated[detectionIndex] = {
        ...det,
        // Store the edited corners so the canvas keeps drawing the new shape.
        corners: newCorners,
        cropCanvas: crop,
        matchResult,
        // Drop any previously selected manual override — let the new top-1 win.
        activeCardId: undefined,
      };
      return updated;
    });
  }, [uploadedImage]);

  // --- Shared JSX ---

  const matchedCount = detections.filter(d => d.matchResult && d.matchResult.similarity > 0.55).length;
  const allChecked = matchedCount > 0 && checkedIndices.size === matchedCount;

  const bulkActionsBar = matchedCount > 0 && (
    <div className="flex items-center gap-2">
      <button onClick={toggleSelectAll} className="btn-ghost text-xs py-1.5 px-2.5 rounded-xl">
        {allChecked ? <CheckSquare className="w-3.5 h-3.5 text-gold-400" /> : <Square className="w-3.5 h-3.5" />}
        {allChecked ? 'Deselect' : 'Select all'}
      </button>
      <div className="flex-1" />
      {checkedIndices.size > 0 && (
        <>
          <button onClick={addCheckedToExport} className="btn-primary text-xs py-1.5 px-3 rounded-xl">
            <Plus className="w-3.5 h-3.5" />
            Add ({checkedIndices.size})
          </button>
          <button onClick={exportCheckedCSV} className="btn-secondary text-xs py-1.5 px-3 rounded-xl">
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </>
      )}
    </div>
  );

  const renderDetectionCards = (refsArray) => (
    <div className="space-y-2">
      {detections.map((det, idx) => {
        const color = DETECTION_COLORS[idx % DETECTION_COLORS.length];
        return (
          <div key={idx} ref={el => { if (refsArray) refsArray.current[idx] = el; }}>
            <CardDetailPanel
              detection={det}
              index={idx}
              onAddToScanner={handleAddToExport}
              isChecked={checkedIndices.has(idx)}
              onToggleCheck={() => toggleCheck(idx)}
              onMatchChange={handleMatchChange}
              color={color}
              isSelected={selectedDetection === idx}
              onSelect={() => setSelectedDetection(selectedDetection === idx ? null : idx)}
            />
          </div>
        );
      })}
    </div>
  );

  // --- Mode switcher ---

  const modeSwitcher = (
    <div className="flex gap-1 p-1 rounded-xl bg-rift-800/80 backdrop-blur-md border border-rift-600/30 w-fit flex-shrink-0">
      <button
        onClick={() => handleModeChange('camera')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          scanMode === 'camera'
            ? 'bg-gold-400/20 text-gold-400 border border-gold-400/30'
            : 'text-rift-400 hover:text-rift-200 border border-transparent'
        }`}
      >
        <Camera className="w-3.5 h-3.5" />
        Camera
      </button>
      <button
        onClick={() => handleModeChange('upload')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          scanMode === 'upload'
            ? 'bg-gold-400/20 text-gold-400 border border-gold-400/30'
            : 'text-rift-400 hover:text-rift-200 border border-transparent'
        }`}
      >
        <Upload className="w-3.5 h-3.5" />
        Upload
      </button>
    </div>
  );

  // ═══════════════════════════════════════════
  // CAMERA MODE
  // ═══════════════════════════════════════════
  if (scanMode === 'camera') {
    return (
      <div key="camera" className="flex-1 relative overflow-hidden lg:flex lg:flex-row">
        {/* Camera area */}
        <div className="absolute inset-0 lg:relative lg:flex-1">
          <ScannerCamera
            videoRef={camera.videoRef}
            isActive={camera.isActive}
            error={camera.error}
            isProcessing={detection.isProcessing}
            lastDetection={detection.lastDetection}
            onStartCamera={camera.startCamera}
            onStopCamera={camera.stopCamera}
            onToggleFacing={camera.toggleFacing}
            onSnapScan={onSnapScan}
            detectorState={detection.detectorState}
            hasTorch={camera.hasTorch}
            torchOn={camera.torchOn}
            onToggleTorch={camera.toggleTorch}
            autoScanEnabled={autoScanEnabled}
            onToggleAutoScan={onToggleAutoScan}
          />

          {/* Mode switcher + confidence slider floating on camera */}
          <div className="absolute top-3 left-3 right-16 z-10 flex flex-col gap-2">
            {modeSwitcher}
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-rift-800/80 backdrop-blur-md border border-rift-600/30">
              <span className="text-xs text-rift-400 flex-shrink-0">Min</span>
              <input
                type="range"
                min="50"
                max="100"
                value={Math.round(minConfidence * 100)}
                onChange={(e) => onUpdateMinConfidence(Number(e.target.value) / 100)}
                className="range-slider"
              />
              <span className="text-xs font-mono text-gold-400 w-10 text-right flex-shrink-0">{Math.round(minConfidence * 100)}%</span>
            </div>
          </div>

          {/* Floating card counter (mobile only) */}
          {!sheetExpanded && totalPending > 0 && (
            <CardCounter
              count={totalPending}
              uniqueCount={pendingCards.length}
              onTap={() => setSheetExpanded(true)}
            />
          )}
        </div>

        {/* ── Backdrop to close sheet on mobile ── */}
        {pendingCards.length > 0 && sheetExpanded && (
          <div
            className="absolute inset-0 bg-black/40 z-20 backdrop-blur-sm lg:hidden transition-opacity duration-300 fade-in"
            onClick={() => setSheetExpanded(false)}
          />
        )}

        {/* ── Pending cards: mobile bottom overlay ── */}
        {pendingCards.length > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0 z-30 bg-rift-800/95 backdrop-blur-xl border-t border-rift-600/30 rounded-t-2xl transition-[height] duration-300 ease-out flex flex-col lg:hidden"
            style={{ height: sheetExpanded ? '50dvh' : 56 }}
          >
            <button
              onClick={() => setSheetExpanded(prev => !prev)}
              className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            >
              <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-rift-500/60" />
              <span className="text-sm font-semibold text-gold-400 mt-1">
                {totalPending} pending
              </span>
              <div className="flex items-center gap-4 mt-1">
                {checkedPendingIndices.size > 0 ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleConfirmCheckedPending(); }}
                    className="btn-primary text-xs py-2 px-4 rounded-lg"
                  >
                    <ChevronsRight className="w-4 h-4" />
                    Add ({checkedPendingIndices.size})
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onConfirmAllPending(); }}
                    className="btn-primary text-xs py-2 px-4 rounded-lg"
                  >
                    <ChevronsRight className="w-4 h-4" />
                    Add all
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onClearPending(); }}
                  className="btn-ghost text-xs py-2 px-3 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-400/10"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </button>

            {sheetExpanded && (
              <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-2">
                {pendingCards.map((card, index) => (
                  <CardDetailPanel
                    key={`${card.cardData.id}-${card.scanTimestamp}`}
                    detection={pendingToDetection(card)}
                    index={index}
                    onAddToScanner={(payload) => onConfirmPending({ index, ...payload })}
                    onRemove={() => onRemovePending(index)}
                    quantity={card.quantity}
                    isChecked={checkedPendingIndices.has(index)}
                    onToggleCheck={() => togglePendingCheck(index)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Pending cards: desktop side panel ── */}
        <div className="hidden lg:flex flex-col w-[450px] flex-shrink-0 border-l border-rift-600/30 bg-rift-800/95 backdrop-blur-xl">
          <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0 border-b border-rift-600/20">
            <h3 className="text-xs font-semibold text-gold-400 flex-1">
              Pending ({pendingCards.length})
            </h3>
            {pendingCards.length > 0 && (
              <>
                {checkedPendingIndices.size > 0 ? (
                  <button onClick={handleConfirmCheckedPending} className="btn-primary text-xs py-2 px-4 rounded-lg">
                    <ChevronsRight className="w-4 h-4" />
                    Add ({checkedPendingIndices.size})
                  </button>
                ) : (
                  <button onClick={onConfirmAllPending} className="btn-primary text-xs py-2 px-4 rounded-lg">
                    <ChevronsRight className="w-4 h-4" />
                    Add all
                  </button>
                )}
                <button onClick={onClearPending} className="btn-ghost text-xs py-2 px-3 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-400/10">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
            {pendingCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-rift-400">No pending cards</p>
                <p className="text-xs text-rift-500 mt-1">Point the camera at a card to start</p>
              </div>
            ) : (
              pendingCards.map((card, index) => (
                <CardDetailPanel
                  key={`${card.cardData.id}-${card.scanTimestamp}`}
                  detection={pendingToDetection(card)}
                  index={index}
                  onAddToScanner={(payload) => onConfirmPending({ index, ...payload })}
                  onRemove={() => onRemovePending(index)}
                  quantity={card.quantity}
                  isChecked={checkedPendingIndices.has(index)}
                  onToggleCheck={() => togglePendingCheck(index)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // UPLOAD MODE
  // ═══════════════════════════════════════════

  const desktopResultsContent = detections.length > 0 ? (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-rift-100">Results ({detections.length})</h2>
        <button onClick={() => runDetection(uploadedImage)} disabled={isProcessing} className="btn-ghost text-xs py-1 px-2 rounded-lg">
          <RotateCcw className="w-3 h-3" />
          Re-detect
        </button>
      </div>
      {bulkActionsBar}
      {renderDetectionCards(desktopDetectionRefs)}
    </div>
  ) : (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center py-12">
        <p className="text-sm text-rift-400">No results yet</p>
        <p className="text-xs text-rift-500 mt-1">Upload an image to detect cards</p>
      </div>
    </div>
  );

  return (
    <div key="upload" className="flex-1 relative overflow-hidden lg:flex lg:flex-row">
      {/* Left column: upload + canvas + mobile results */}
      {/* Mode switcher - absolutely positioned to match camera mode */}
      <div className="absolute top-3 left-3 z-10">
        {modeSwitcher}
      </div>

      {/* Left column: upload + canvas + mobile results */}
      <div className={`h-full overflow-y-auto pb-4 lg:flex-1 lg:min-w-0 ${!uploadedImage ? 'flex flex-col' : ''}`}>
        <div className={`px-4 pt-14 pb-4 space-y-4 ${!uploadedImage ? 'flex-1 flex flex-col' : ''}`}>
          {/* Upload area or canvas */}
          {!uploadedImage ? (
            <div className="flex-1 flex items-center justify-center">
              <ImageDropZone onImageSelected={handleImageSelected} isProcessing={isProcessing} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <ScanLine className="w-4 h-4 text-gold-400 flex-shrink-0" />
                  <span className="text-xs text-rift-300 truncate">{fileName}</span>
                </div>
                <button onClick={handleReset} className="btn-ghost text-xs py-1.5 px-3 rounded-xl flex-shrink-0">
                  <RotateCcw className="w-3.5 h-3.5" />
                  New
                </button>
              </div>

              <DetectionCanvas
                image={uploadedImage}
                detections={detections}
                selectedIndex={selectedDetection}
                onSelectDetection={(idx) => setSelectedDetection(idx)}
                onCornersChange={handleCornersChange}
              />

              {isProcessing && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="w-5 h-5 text-gold-400 animate-spin" />
                  <span className="text-sm text-rift-300">Detecting cards...</span>
                </div>
              )}
            </div>
          )}

          {/* Detection results — mobile only */}
          {detections.length > 0 && (
            <div className="space-y-3 lg:hidden">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-rift-100">Results ({detections.length})</h2>
                <button onClick={() => runDetection(uploadedImage)} disabled={isProcessing} className="btn-ghost text-xs py-1 px-2 rounded-lg">
                  <RotateCcw className="w-3 h-3" />
                  Re-detect
                </button>
              </div>
              {bulkActionsBar}
              {renderDetectionCards(mobileDetectionRefs)}
            </div>
          )}

          {/* Empty detection state */}
          {uploadedImage && !isProcessing && detections.length === 0 && (
            <div className="text-center py-6">
              <p className="text-sm text-rift-400">No cards detected in this image</p>
              <p className="text-xs text-rift-500 mt-1">Try with a clearer image or better lighting</p>
            </div>
          )}
        </div>
      </div>

      {/* Desktop results panel */}
      <div className="hidden lg:flex flex-col w-[450px] flex-shrink-0 border-l border-rift-600/30 bg-rift-800/95 backdrop-blur-xl">
        {desktopResultsContent}
      </div>
    </div>
  );
}
