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

// --- Card matching utilities ---

function computeColorGrid(canvas, gridSize) {
  const tmp = document.createElement('canvas');
  tmp.width = gridSize;
  tmp.height = gridSize;
  tmp.getContext('2d').drawImage(canvas, 0, 0, gridSize, gridSize);
  const data = tmp.getContext('2d').getImageData(0, 0, gridSize, gridSize).data;
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

function ensurePortrait(canvas) {
  if (canvas.width > canvas.height) return rotateCanvas90(canvas);
  return canvas;
}

function cropRotated(img, cx, cy, w, h, angle) {
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  const diag = Math.sqrt(imgW * imgW + imgH * imgH);
  const big = document.createElement('canvas');
  big.width = Math.ceil(diag);
  big.height = Math.ceil(diag);
  const bctx = big.getContext('2d');
  const bcx = big.width / 2;
  const bcy = big.height / 2;
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

function identifyCard(cropCanvas, matcher) {
  if (!matcher || !matcher.cards || matcher.cards.length === 0) return null;
  const featNormal = computeColorGrid(cropCanvas, matcher.gridSize);
  const rotated = rotateCanvas90(cropCanvas);
  const featRotated = computeColorGrid(rotated, matcher.gridSize);

  const scores = [];
  for (const c of matcher.cards) {
    const s1 = cosineSimilarity(featNormal, c.f);
    const s2 = cosineSimilarity(featRotated, c.f);
    scores.push({ card: c, similarity: Math.max(s1, s2) });
  }
  scores.sort((a, b) => b.similarity - a.similarity);

  return {
    card: scores[0]?.card || null,
    similarity: scores[0]?.similarity || 0,
    top3: scores.slice(0, 3).map(r => ({
      id: r.card.id,
      name: r.card.name,
      collectorNumber: String(r.card.number).padStart(3, '0'),
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
      sim: (r.similarity * 100).toFixed(1),
      similarity: r.similarity,
    })),
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
  resized.src = canvas.toDataURL('image/jpeg', 0.92);
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
  scanEnabled,
  onToggleScanning,
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

  // Stop camera when switching to upload mode
  const handleModeChange = useCallback((mode) => {
    setScanMode(mode);
    if (mode === 'upload' && camera.isActive) {
      camera.stopCamera();
    }
  }, [camera]);

  // Scroll to selected detection
  useEffect(() => {
    if (selectedDetection == null) return;
    for (const refs of [desktopDetectionRefs, mobileDetectionRefs]) {
      const el = refs.current[selectedDetection];
      if (el && el.offsetParent !== null) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  }, [selectedDetection]);

  // --- Upload mode handlers ---

  const handleImageSelected = useCallback((file) => {
    setFileName(file.name);
    setDetections([]);
    setSelectedDetection(null);
    setCheckedIndices(new Set());
    const img = new Image();
    img.onload = () => {
      // Resize large images to prevent mobile crashes
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

      const matcher = getMatcher();
      const results = [];
      for (const det of rawDetections) {
        let crop = det.cropCanvas;
        if (!crop) {
          crop = cropRotated(imageElement, det.box.cx, det.box.cy, det.box.w, det.box.h, det.box.angle);
        } else {
          crop = ensurePortrait(crop);
        }
        let matchResult = null;
        if (matcher.ready) matchResult = identifyCard(crop, matcher);
        results.push({
          cx: det.box.cx, cy: det.box.cy, w: det.box.w, h: det.box.h,
          angle: det.box.angle, confidence: det.confidence, cropCanvas: crop, matchResult,
        });
      }

      setDetections(results);
      showNotification(`${results.length} card${results.length !== 1 ? 's' : ''} detected`, 'success');
      if (results.length > 0) setSelectedDetection(0);
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
    <div className="flex gap-1 p-1 rounded-xl bg-rift-800/80 backdrop-blur-md border border-rift-600/30 w-fit">
      <button
        onClick={() => handleModeChange('camera')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
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
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
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
      <div className="flex-1 relative overflow-hidden lg:flex lg:flex-row">
        {/* Camera area */}
        <div className="absolute inset-0 lg:relative lg:flex-1">
          <ScannerCamera
            videoRef={camera.videoRef}
            isActive={camera.isActive}
            error={camera.error}
            isScanning={detection.isScanning}
            lastDetection={detection.lastDetection}
            fps={detection.fps}
            onStartCamera={camera.startCamera}
            onStopCamera={camera.stopCamera}
            onToggleFacing={camera.toggleFacing}
            onToggleScanning={onToggleScanning}
            scanEnabled={scanEnabled}
            detectorState={detection.detectorState}
            hasTorch={camera.hasTorch}
            torchOn={camera.torchOn}
            onToggleTorch={camera.toggleTorch}
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

        {/* ── Pending cards: mobile bottom overlay ── */}
        {pendingCards.length > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0 z-30 bg-rift-800/95 backdrop-blur-xl border-t border-rift-600/30 rounded-t-2xl transition-all duration-300 ease-out flex flex-col lg:hidden"
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
              <div className="flex items-center gap-2 mt-1">
                {checkedPendingIndices.size > 0 ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleConfirmCheckedPending(); }}
                    className="btn-primary text-[10px] py-1 px-2.5 rounded-lg"
                  >
                    <ChevronsRight className="w-3 h-3" />
                    Add ({checkedPendingIndices.size})
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onConfirmAllPending(); }}
                    className="btn-primary text-[10px] py-1 px-2.5 rounded-lg"
                  >
                    <ChevronsRight className="w-3 h-3" />
                    Add all
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onClearPending(); }}
                  className="btn-ghost text-[10px] py-1 px-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-400/10"
                >
                  <Trash2 className="w-3 h-3" />
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
                    onAddToScanner={() => onConfirmPending(index)}
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
        <div className="hidden lg:flex flex-col w-[400px] flex-shrink-0 border-l border-rift-600/30 bg-rift-800/95 backdrop-blur-xl">
          <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0 border-b border-rift-600/20">
            <h3 className="text-xs font-semibold text-gold-400 flex-1">
              Pending ({pendingCards.length})
            </h3>
            {pendingCards.length > 0 && (
              <>
                {checkedPendingIndices.size > 0 ? (
                  <button onClick={handleConfirmCheckedPending} className="btn-primary text-[10px] py-1 px-2.5 rounded-lg">
                    <ChevronsRight className="w-3 h-3" />
                    Add ({checkedPendingIndices.size})
                  </button>
                ) : (
                  <button onClick={onConfirmAllPending} className="btn-primary text-[10px] py-1 px-2.5 rounded-lg">
                    <ChevronsRight className="w-3 h-3" />
                    Add all
                  </button>
                )}
                <button onClick={onClearPending} className="btn-ghost text-[10px] py-1 px-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-400/10">
                  <Trash2 className="w-3 h-3" />
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
                  onAddToScanner={() => onConfirmPending(index)}
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
    <div className="flex-1 relative overflow-hidden lg:flex lg:flex-row">
      {/* Left column: upload + canvas + mobile results */}
      <div className={`h-full overflow-y-auto pb-4 lg:flex-1 lg:min-w-0 ${!uploadedImage ? 'flex flex-col' : ''}`}>
        <div className={`px-4 pt-4 pb-4 space-y-4 ${!uploadedImage ? 'flex-1 flex flex-col' : ''}`}>
          {/* Mode switcher */}
          {modeSwitcher}

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
      <div className="hidden lg:flex flex-col w-[420px] flex-shrink-0 border-l border-rift-600/30 bg-rift-800/95 backdrop-blur-xl">
        {desktopResultsContent}
      </div>
    </div>
  );
}
