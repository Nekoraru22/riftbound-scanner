import { useState, useRef, useCallback } from 'react';
import { getDetector, DetectorState } from '../lib/yoloDetector.js';
import { getMatcher } from '../lib/cardMatcher.js';

/**
 * Hook for single-frame card detection (tap to scan).
 *
 * Orchestrates:
 *   1. YOLO detection on a captured frame
 *   2. Card matching on detected crops (via CardMatcher)
 */
export function useCardDetection() {
  const [detectorState, setDetectorState] = useState(DetectorState.UNLOADED);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastDetection, setLastDetection] = useState(null);

  const detectorRef = useRef(null);

  // Min cosine similarity for a valid match
  const SIMILARITY_THRESHOLD = 0.60;

  /**
   * Initialize the YOLO detector
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
   * Identify a card from a crop canvas using the CardMatcher.
   */
  function identifyCard(cropCanvas, matcher) {
    return matcher.identify(cropCanvas);
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
   * Detect cards in a single frame (tap to scan).
   * Captures one frame, runs YOLO + matching, returns result.
   */
  const detectSingleFrame = useCallback(async (captureFrame) => {
    if (isProcessing) return null;
    if (!detectorRef.current || detectorRef.current.state !== DetectorState.READY) return null;

    const matcher = getMatcher();
    if (!matcher.ready) return null;

    const frame = captureFrame?.();
    if (!frame) return null;

    setIsProcessing(true);
    setLastDetection(null);

    try {
      // Step 1: YOLO detection
      const detections = await detectorRef.current.detect(frame);

      if (detections.length === 0) {
        setLastDetection(null);
        return null;
      }

      const bestDetection = detections[0];

      // Step 2: Ensure portrait orientation
      let crop = bestDetection.cropCanvas;
      crop = ensurePortrait(crop);

      // Step 3: Match using card matcher
      const matchResult = identifyCard(crop, matcher);

      if (!matchResult || matchResult.similarity < SIMILARITY_THRESHOLD) {
        setLastDetection({
          box: bestDetection.box,
          confidence: bestDetection.confidence,
          matched: false,
        });
        return null;
      }

      // Step 4: Resolve full card data
      const cardData = resolveCardData(matchResult.card);
      if (!cardData) return null;

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
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing]);

  return {
    detectorState,
    isProcessing,
    lastDetection,
    initDetector,
    detectSingleFrame,
  };
}
