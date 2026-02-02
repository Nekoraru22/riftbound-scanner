import { useState, useRef, useCallback, useEffect } from 'react';
import { getDetector, DetectorState } from '../lib/yoloDetector.js';
import { computePHash, findBestMatch } from '../lib/phash.js';

/**
 * Hook for continuous card detection and identification
 *
 * Orchestrates:
 *   1. YOLO detection on each frame
 *   2. pHash computation on detected crops
 *   3. Matching against reference database
 *   4. Deduplication (prevents re-scanning the same card)
 */
export function useCardDetection({ referenceHashes = [], cards = [], enabled = false }) {
  const [detectorState, setDetectorState] = useState(DetectorState.UNLOADED);
  const [isScanning, setIsScanning] = useState(false);
  const [lastDetection, setLastDetection] = useState(null);
  const [fps, setFps] = useState(0);

  const detectorRef = useRef(null);
  const scanLoopRef = useRef(null);
  const lastMatchTimeRef = useRef(0);
  const lastMatchIdRef = useRef(null);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef(Date.now());

  // Cooldown between matching the same card (ms)
  const MATCH_COOLDOWN = 2000;
  // Min time between scans (ms) - controls scan rate
  const SCAN_INTERVAL = 150;
  // Max Hamming distance for a valid match
  const MATCH_THRESHOLD = 6;

  /**
   * Initialize the YOLO detector
   */
  const initDetector = useCallback(async () => {
    try {
      const detector = getDetector();
      detectorRef.current = detector;
      setDetectorState(DetectorState.LOADING);

      await detector.initialize();
      setDetectorState(detector.state);
    } catch (error) {
      console.error('[Detection] Init failed:', error);
      setDetectorState(DetectorState.ERROR);
    }
  }, []);

  /**
   * Process a single video frame
   * @param {HTMLCanvasElement} frameCanvas - Current frame from camera
   * @returns {Object|null} Detection result or null
   */
  const processFrame = useCallback(async (frameCanvas) => {
    if (!detectorRef.current || detectorRef.current.state !== DetectorState.READY) {
      return null;
    }
    if (!referenceHashes.length) return null;

    try {
      // Step 1: YOLO detection
      const detections = await detectorRef.current.detect(frameCanvas);

      if (detections.length === 0) {
        setLastDetection(null);
        return null;
      }

      // Take the highest confidence detection
      const bestDetection = detections[0];

      // Step 2: Compute pHash on the cropped card
      const crop = bestDetection.cropCanvas;
      const ctx = crop.getContext('2d');
      const imageData = ctx.getImageData(0, 0, crop.width, crop.height);
      const queryHash = computePHash(imageData.data, crop.width, crop.height);

      // Step 3: Match against reference database
      const { match, distance } = findBestMatch(queryHash, referenceHashes, MATCH_THRESHOLD);

      if (!match) {
        setLastDetection({
          box: bestDetection.box,
          confidence: bestDetection.confidence,
          matched: false,
        });
        return null;
      }

      // Step 4: Deduplication - prevent rapid re-scans of same card
      const now = Date.now();
      if (match.cardId === lastMatchIdRef.current &&
          now - lastMatchTimeRef.current < MATCH_COOLDOWN) {
        return null; // Same card, within cooldown
      }

      // Find the full card data
      const cardData = cards.find(c => c.id === match.cardId);
      if (!cardData) return null;

      // Update tracking
      lastMatchIdRef.current = match.cardId;
      lastMatchTimeRef.current = now;

      const result = {
        cardData,
        hash: queryHash,
        distance,
        confidence: bestDetection.confidence,
        box: bestDetection.box,
        matched: true,
        timestamp: now,
      };

      setLastDetection(result);

      // Update FPS counter
      frameCountRef.current++;
      const elapsed = now - fpsTimerRef.current;
      if (elapsed >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / elapsed));
        frameCountRef.current = 0;
        fpsTimerRef.current = now;
      }

      return result;
    } catch (error) {
      console.error('[Detection] Frame processing error:', error);
      return null;
    }
  }, [referenceHashes, cards]);

  /**
   * Start continuous scanning loop
   * @param {function} captureFrame - Function that returns current camera frame as canvas
   * @param {function} onCardDetected - Callback when a new card is detected
   */
  const startScanning = useCallback((captureFrame, onCardDetected) => {
    if (scanLoopRef.current) return;
    setIsScanning(true);

    const scanLoop = async () => {
      if (!enabled) {
        scanLoopRef.current = setTimeout(scanLoop, SCAN_INTERVAL);
        return;
      }

      const frame = captureFrame();
      if (frame) {
        const result = await processFrame(frame);
        if (result && result.matched) {
          onCardDetected(result);
        }
      }

      scanLoopRef.current = setTimeout(scanLoop, SCAN_INTERVAL);
    };

    scanLoop();
  }, [enabled, processFrame]);

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
    lastMatchTimeRef.current = 0;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanLoopRef.current) {
        clearTimeout(scanLoopRef.current);
      }
    };
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
  };
}
