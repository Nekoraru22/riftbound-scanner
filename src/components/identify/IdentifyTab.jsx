import React, { useState, useCallback } from 'react';
import { Loader2, RotateCcw, ScanLine, Download, Plus, CheckSquare, Square } from 'lucide-react';
import ImageDropZone from './ImageDropZone.jsx';
import DetectionCanvas from './DetectionCanvas.jsx';
import CardDetailPanel from './CardDetailPanel.jsx';
import { getDetector } from '../../lib/yoloDetector.js';
import { getMatcher } from '../../lib/cardMatcher.js';
import { downloadCSV, validateForExport } from '../../lib/csvExporter.js';

// --- Card matching utilities (ported from test.html) ---

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
  if (canvas.width > canvas.height) {
    return rotateCanvas90(canvas);
  }
  return canvas;
}

function cropRotated(img, cx, cy, w, h, angle) {
  const diag = Math.sqrt(img.width * img.width + img.height * img.height);
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
    const sim = Math.max(s1, s2);
    scores.push({ card: c, similarity: sim });
  }
  scores.sort((a, b) => b.similarity - a.similarity);

  return {
    card: scores[0]?.card || null,
    similarity: scores[0]?.similarity || 0,
    top3: scores.slice(0, 3).map(r => ({
      id: r.card.id,
      name: r.card.name,
      set: r.card.set,
      sim: (r.similarity * 100).toFixed(1),
      similarity: r.similarity,
    })),
  };
}

// --- Component ---

export default function IdentifyTab({
  cards,
  scannedCards,
  onAddToScanner,
  showNotification,
  batchDefaults,
}) {
  const [uploadedImage, setUploadedImage] = useState(null);
  const [fileName, setFileName] = useState('');
  const [detections, setDetections] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState(null);
  const [checkedIndices, setCheckedIndices] = useState(new Set());

  const handleImageSelected = useCallback((file) => {
    setFileName(file.name);
    setDetections([]);
    setSelectedDetection(null);
    setCheckedIndices(new Set());

    const img = new Image();
    img.onload = () => {
      setUploadedImage(img);
      runDetection(img);
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
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imageElement, 0, 0);

      const detector = getDetector();
      let rawDetections;

      if (detector.state === 'ready') {
        rawDetections = await detector.detect(canvas);
      } else {
        showNotification('El detector no esta listo', 'error');
        setIsProcessing(false);
        return;
      }

      if (!rawDetections || rawDetections.length === 0) {
        showNotification('No se detectaron cartas en la imagen', 'info');
        setIsProcessing(false);
        return;
      }

      const matcher = getMatcher();
      const results = [];

      for (const det of rawDetections) {
        let crop = det.cropCanvas;
        if (!crop) {
          crop = cropRotated(
            imageElement,
            det.box.cx, det.box.cy,
            det.box.w, det.box.h,
            det.box.angle
          );
        } else {
          // Ensure portrait orientation for detector-provided crops
          crop = ensurePortrait(crop);
        }

        let matchResult = null;
        if (matcher.ready) {
          matchResult = identifyCard(crop, matcher);
        }

        results.push({
          cx: det.box.cx,
          cy: det.box.cy,
          w: det.box.w,
          h: det.box.h,
          angle: det.box.angle,
          confidence: det.confidence,
          cropCanvas: crop,
          matchResult,
        });
      }

      setDetections(results);
      showNotification(`${results.length} carta${results.length !== 1 ? 's' : ''} detectada${results.length !== 1 ? 's' : ''}`, 'success');

      if (results.length > 0) {
        setSelectedDetection(0);
      }
    } catch (error) {
      console.error('[IdentifyTab] Detection error:', error);
      showNotification('Error durante la deteccion', 'error');
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

  const handleAddToScanner = useCallback((cardData) => {
    onAddToScanner(cardData);
    showNotification(`+ ${cardData.name}`, 'success');
  }, [onAddToScanner, showNotification]);

  // Toggle checkbox for a detection
  const toggleCheck = useCallback((idx) => {
    setCheckedIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  // Select/deselect all matched detections
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

  // Add all checked detections to the scanner
  const addCheckedToScanner = useCallback(() => {
    let added = 0;
    for (const idx of checkedIndices) {
      const det = detections[idx];
      if (!det?.matchResult?.card) continue;
      // Use the panel's selected match (stored in detection state)
      const cardId = det.activeCardId || det.matchResult.card.id;
      const fullCard = cards.find(c => c.id === cardId);
      if (fullCard) {
        onAddToScanner(fullCard);
        added++;
      }
    }
    if (added > 0) {
      showNotification(`${added} carta${added !== 1 ? 's' : ''} anadida${added !== 1 ? 's' : ''}`, 'success');
    }
    setCheckedIndices(new Set());
  }, [checkedIndices, detections, cards, onAddToScanner, showNotification]);

  // Export checked detections as CSV
  const exportCheckedCSV = useCallback(() => {
    const exportCards = [];
    for (const idx of checkedIndices) {
      const det = detections[idx];
      if (!det?.matchResult?.card) continue;
      const cardId = det.activeCardId || det.matchResult.card.id;
      const fullCard = cards.find(c => c.id === cardId);
      if (fullCard) {
        exportCards.push({
          cardData: fullCard,
          quantity: 1,
          condition: batchDefaults.condition,
          language: batchDefaults.language,
          foil: batchDefaults.foil,
        });
      }
    }
    if (exportCards.length === 0) {
      showNotification('Selecciona al menos una carta', 'error');
      return;
    }
    const { valid, errors } = validateForExport(exportCards);
    if (!valid) {
      showNotification(`Error: ${errors[0]}`, 'error');
      return;
    }
    downloadCSV(exportCards);
    showNotification(`CSV exportado — ${exportCards.length} cartas`, 'success');
  }, [checkedIndices, detections, cards, batchDefaults, showNotification]);

  // Called by CardDetailPanel when user switches the active match
  const handleMatchChange = useCallback((detectionIndex, cardId) => {
    setDetections(prev => {
      const updated = [...prev];
      updated[detectionIndex] = { ...updated[detectionIndex], activeCardId: cardId };
      return updated;
    });
  }, []);

  const isCardInScanner = (cardId) => {
    return scannedCards.some(c => c.cardData.id === cardId);
  };

  const matchedCount = detections.filter(d => d.matchResult && d.matchResult.similarity > 0.55).length;
  const allChecked = matchedCount > 0 && checkedIndices.size === matchedCount;

  return (
    <div className="flex-1 overflow-y-auto pb-20">
      <div className="px-4 pt-5 pb-4 space-y-4">
        {/* Page title */}
        <div className="mb-2">
          <h1 className="text-xl font-display font-bold text-rift-100">Identificar</h1>
          <p className="text-xs text-rift-400 mt-1">Sube una imagen para detectar e identificar cartas</p>
        </div>

        {/* Upload area or canvas */}
        {!uploadedImage ? (
          <ImageDropZone onImageSelected={handleImageSelected} isProcessing={isProcessing} />
        ) : (
          <div className="space-y-3">
            {/* Image info + reset */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <ScanLine className="w-4 h-4 text-gold-400 flex-shrink-0" />
                <span className="text-xs text-rift-300 truncate">{fileName}</span>
              </div>
              <button
                onClick={handleReset}
                className="btn-ghost text-xs py-1.5 px-3 rounded-xl flex-shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Nueva
              </button>
            </div>

            {/* Detection canvas */}
            <DetectionCanvas
              image={uploadedImage}
              detections={detections}
              selectedIndex={selectedDetection}
              onSelectDetection={setSelectedDetection}
            />

            {/* Processing indicator */}
            {isProcessing && (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="w-5 h-5 text-gold-400 animate-spin" />
                <span className="text-sm text-rift-300">Detectando cartas...</span>
              </div>
            )}
          </div>
        )}

        {/* Detection results */}
        {detections.length > 0 && (
          <div className="space-y-3">
            {/* Results header */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-rift-100">
                Resultados ({detections.length})
              </h2>
              <button
                onClick={() => runDetection(uploadedImage)}
                disabled={isProcessing}
                className="btn-ghost text-xs py-1 px-2 rounded-lg"
              >
                <RotateCcw className="w-3 h-3" />
                Redetectar
              </button>
            </div>

            {/* Bulk actions bar */}
            {matchedCount > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleSelectAll}
                  className="btn-ghost text-xs py-1.5 px-2.5 rounded-xl"
                >
                  {allChecked ? (
                    <CheckSquare className="w-3.5 h-3.5 text-gold-400" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                  {allChecked ? 'Deseleccionar' : 'Seleccionar todo'}
                </button>
                <div className="flex-1" />
                {checkedIndices.size > 0 && (
                  <>
                    <button
                      onClick={addCheckedToScanner}
                      className="btn-primary text-xs py-1.5 px-3 rounded-xl"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Anadir ({checkedIndices.size})
                    </button>
                    <button
                      onClick={exportCheckedCSV}
                      className="btn-secondary text-xs py-1.5 px-3 rounded-xl"
                    >
                      <Download className="w-3.5 h-3.5" />
                      CSV
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Detection cards */}
            <div className="space-y-2">
              {detections.map((det, idx) => {
                const activeCardId = det.activeCardId || det.matchResult?.card?.id;
                return (
                  <CardDetailPanel
                    key={idx}
                    detection={det}
                    index={idx}
                    onAddToScanner={handleAddToScanner}
                    isInScannerList={activeCardId ? isCardInScanner(activeCardId) : false}
                    cards={cards}
                    isChecked={checkedIndices.has(idx)}
                    onToggleCheck={() => toggleCheck(idx)}
                    onMatchChange={handleMatchChange}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {uploadedImage && !isProcessing && detections.length === 0 && (
          <div className="text-center py-6">
            <p className="text-sm text-rift-400">
              No se detectaron cartas en esta imagen
            </p>
            <p className="text-xs text-rift-500 mt-1">
              Prueba con una imagen mas clara o con mejor iluminacion
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
