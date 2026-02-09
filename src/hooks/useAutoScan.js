import { useState, useRef, useCallback, useEffect } from 'react';

const AUTO_SCAN_INTERVAL = 1500;
const NO_CARD_RESET_COUNT = 2;

/**
 * Hook for continuous auto-scan mode.
 *
 * Runs detectSingleFrame on an interval, skipping duplicates
 * (same card as last added) and resetting after a gap (no card in frame).
 */
export function useAutoScan({
  cameraIsActive,
  isProcessing,
  detectSingleFrame,
  captureFrame,
  onCardDetected,
}) {
  const [enabled, setEnabled] = useState(false);

  // Refs for stable interval callback (never recreates the interval)
  const lastAddedCardIdRef = useRef(null);
  const noCardStreakRef = useRef(0);
  const intervalRef = useRef(null);

  const isProcessingRef = useRef(isProcessing);
  const detectRef = useRef(detectSingleFrame);
  const captureRef = useRef(captureFrame);
  const onCardDetectedRef = useRef(onCardDetected);

  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);
  useEffect(() => { detectRef.current = detectSingleFrame; }, [detectSingleFrame]);
  useEffect(() => { captureRef.current = captureFrame; }, [captureFrame]);
  useEffect(() => { onCardDetectedRef.current = onCardDetected; }, [onCardDetected]);

  // Start/stop interval — only depends on enabled + cameraIsActive
  useEffect(() => {
    if (!enabled || !cameraIsActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(async () => {
      if (isProcessingRef.current) return;

      const result = await detectRef.current(captureRef.current);

      if (!result || !result.matched) {
        noCardStreakRef.current++;
        if (noCardStreakRef.current >= NO_CARD_RESET_COUNT) {
          lastAddedCardIdRef.current = null;
        }
        return;
      }

      // Card detected — reset streak
      noCardStreakRef.current = 0;

      // Skip if same card as last added
      if (result.cardData.id === lastAddedCardIdRef.current) return;

      // New/different card — add it
      lastAddedCardIdRef.current = result.cardData.id;
      onCardDetectedRef.current(result);
    }, AUTO_SCAN_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, cameraIsActive]);

  // Auto-disable when camera stops
  useEffect(() => {
    if (!cameraIsActive && enabled) {
      setEnabled(false);
    }
  }, [cameraIsActive, enabled]);

  const toggleAutoScan = useCallback(() => {
    setEnabled(prev => {
      if (!prev) {
        lastAddedCardIdRef.current = null;
        noCardStreakRef.current = 0;
      }
      return !prev;
    });
  }, []);

  const setLastCardId = useCallback((cardId) => {
    lastAddedCardIdRef.current = cardId;
    noCardStreakRef.current = 0;
  }, []);

  return {
    autoScanEnabled: enabled,
    toggleAutoScan,
    setLastCardId,
  };
}
