import { useState, useRef, useCallback, useEffect } from 'react';
import { getDetector, DetectorState } from '../lib/yoloDetector.js';
import { getMatcher } from '../lib/cardMatcher.js';

/**
 * Hook for continuous card detection and identification
 *
 * Orchestrates:
 *   1. YOLO detection on each frame
 *   2. Color grid matching on detected crops (via CardMatcher)
 *   3. Deduplication (prevents re-scanning the same card)
 */
export function useCardDetection({ enabled = false }) {
  const [detectorState, setDetectorState] = useState(DetectorState.UNLOADED);
  const [isScanning, setIsScanning] = useState(false);
  const [lastDetection, setLastDetection] = useState(null);
  const [fps, setFps] = useState(0);

  const detectorRef = useRef(null);
  const scanLoopRef = useRef(null);
  const lastMatchIdRef = useRef(null);
  const candidateIdRef = useRef(null);
  const candidateCountRef = useRef(0);
  const noCardCountRef = useRef(0);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef(Date.now());

  // Refs to avoid stale closures in scan loop
  const enabledRef = useRef(enabled);
  const captureFrameRef = useRef(null);
  const onCardDetectedRef = useRef(null);

  // Keep refs synced with latest values
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Min time between scans (ms)
  const SCAN_INTERVAL = 150;
  // Min cosine similarity for a valid match
  const SIMILARITY_THRESHOLD = 0.60;
  // Consecutive frames with same card before accepting
  const STABILITY_FRAMES = 3;
  // Frames without any card before allowing re-scan of same card
  const NO_CARD_RESET_FRAMES = 5;

  /**
   * Initialize the YOLO detector
   * @param {string} modelPreference - 'normal' or 'quantized'
   */
  const initDetector = useCallback(async (modelPreference = 'normal') => {
    try {
      const detector = getDetector();
      detectorRef.current = detector;
      setDetectorState(DetectorState.LOADING);

      await detector.initialize(modelPreference);
      setDetectorState(detector.state);
    } catch (error) {
      console.error('[Detection] Init failed:', error);
      setDetectorState(DetectorState.ERROR);
    }
  }, []);

  /**
   * Ensure canvas is in portrait orientation
   */
  function ensurePortrait(canvas) {
    if (canvas.width <= canvas.height) return canvas;
    const rot = document.createElement('canvas');
    rot.width = canvas.height;
    rot.height = canvas.width;
    const rctx = rot.getContext('2d');
    rctx.translate(rot.width / 2, rot.height / 2);
    rctx.rotate(Math.PI / 2);
    rctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return rot;
  }

  /**
   * Compute color grid features from a canvas
   */
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

  /**
   * Cosine similarity between two feature vectors
   */
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

  /**
   * Identify a card from a crop canvas using the CardMatcher database.
   * Crop is already portrait-oriented by ensurePortrait().
   */
  function identifyCard(cropCanvas, matcher) {
    if (!matcher || !matcher.cards || matcher.cards.length === 0) return null;

    const features = computeColorGrid(cropCanvas, matcher.gridSize);

    let bestCard = null;
    let bestSim = -1;

    for (const c of matcher.cards) {
      const sim = cosineSimilarity(features, c.f);
      if (sim > bestSim) {
        bestSim = sim;
        bestCard = c;
      }
    }

    return { card: bestCard, similarity: bestSim };
  }

  /**
   * Resolve card data from a matcher card to full card format.
   */
  function resolveCardData(matcherCard) {
    if (!matcherCard) return null;

    const collectorNumber = String(matcherCard.number).padStart(3, '0');
    return {
      id: matcherCard.id,
      name: matcherCard.name,
      collectorNumber,
      code: matcherCard.code,
      set: matcherCard.set,
      setName: matcherCard.setName,
      domain: matcherCard.domain,
      domains: matcherCard.domains,
      rarity: matcherCard.rarity,
      type: matcherCard.type,
      energy: matcherCard.energy,
      might: matcherCard.might,
      tags: matcherCard.tags,
      illustrator: matcherCard.illustrator,
      text: matcherCard.text,
    };
  }

  /**
   * Process a single video frame
   */
  const processFrame = useCallback(async (frameCanvas) => {
    if (!detectorRef.current || detectorRef.current.state !== DetectorState.READY) {
      return null;
    }

    const matcher = getMatcher();
    if (!matcher.ready) return null;

    try {
      // Step 1: YOLO detection
      const detections = await detectorRef.current.detect(frameCanvas);

      if (detections.length === 0) {
        setLastDetection(null);
        noCardCountRef.current++;
        if (noCardCountRef.current >= NO_CARD_RESET_FRAMES) {
          lastMatchIdRef.current = null;
          candidateIdRef.current = null;
          candidateCountRef.current = 0;
        }
        return null;
      }

      noCardCountRef.current = 0;
      const bestDetection = detections[0];

      // Step 2: Ensure portrait orientation
      let crop = bestDetection.cropCanvas;
      crop = ensurePortrait(crop);

      // Step 3: Match using color grid + cosine similarity
      const matchResult = identifyCard(crop, matcher);

      if (!matchResult || matchResult.similarity < SIMILARITY_THRESHOLD) {
        setLastDetection({
          box: bestDetection.box,
          confidence: bestDetection.confidence,
          matched: false,
        });
        return null;
      }

      // Step 4: Deduplication
      const matchId = matchResult.card.id;
      if (matchId === lastMatchIdRef.current) {
        return null;
      }

      // Step 5: Stability check
      if (matchId === candidateIdRef.current) {
        candidateCountRef.current++;
      } else {
        candidateIdRef.current = matchId;
        candidateCountRef.current = 1;
      }
      if (candidateCountRef.current < STABILITY_FRAMES) {
        return null;
      }

      // Step 6: Resolve full card data
      const cardData = resolveCardData(matchResult.card);
      if (!cardData) return null;

      lastMatchIdRef.current = matchId;
      candidateIdRef.current = null;
      candidateCountRef.current = 0;

      const result = {
        cardData,
        similarity: matchResult.similarity,
        confidence: bestDetection.confidence,
        box: bestDetection.box,
        matched: true,
        timestamp: Date.now(),
      };

      setLastDetection(result);
      return result;
    } catch (error) {
      console.error('[Detection] Frame processing error:', error);
      return null;
    }
  }, []);

  /**
   * Start continuous scanning loop
   */
  const startScanning = useCallback((captureFrame, onCardDetected) => {
    if (scanLoopRef.current) return;

    captureFrameRef.current = captureFrame;
    onCardDetectedRef.current = onCardDetected;
    setIsScanning(true);

    const scanLoop = async () => {
      if (!enabledRef.current) {
        scanLoopRef.current = setTimeout(scanLoop, SCAN_INTERVAL);
        return;
      }

      const frame = captureFrameRef.current?.();
      if (frame) {
        const result = await processFrame(frame);
        if (result && result.matched) {
          onCardDetectedRef.current?.(result);
        }
      }

      // Update FPS counter
      frameCountRef.current++;
      const now = Date.now();
      const elapsed = now - fpsTimerRef.current;
      if (elapsed >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        fpsTimerRef.current = now;
      }

      scanLoopRef.current = setTimeout(scanLoop, SCAN_INTERVAL);
    };

    scanLoop();
  }, [processFrame]);

  /**
   * Stop scanning loop
   */
  const stopScanning = useCallback(() => {
    if (scanLoopRef.current) {
      clearTimeout(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    setIsScanning(false);
    setLastDetection(null);
  }, []);

  /**
   * Reset match cooldown (allows re-scanning the same card)
   */
  const resetCooldown = useCallback(() => {
    lastMatchIdRef.current = null;
    candidateIdRef.current = null;
    candidateCountRef.current = 0;
    noCardCountRef.current = 0;
    setLastDetection(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanLoopRef.current) {
        clearTimeout(scanLoopRef.current);
      }
    };
  }, []);

  /**
   * Update stored callbacks (call when handlers change)
   */
  const updateCallbacks = useCallback((captureFrame, onCardDetected) => {
    if (captureFrame) captureFrameRef.current = captureFrame;
    if (onCardDetected) onCardDetectedRef.current = onCardDetected;
  }, []);

  return {
    detectorState,
    isScanning,
    lastDetection,
    fps,
    initDetector,
    processFrame,
    startScanning,
    stopScanning,
    resetCooldown,
    updateCallbacks,
  };
}
