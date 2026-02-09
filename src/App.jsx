import React, { useState, useEffect, useCallback, useRef } from 'react';
import AppShell from './components/AppShell.jsx';
import BottomTabBar from './components/BottomTabBar.jsx';
import ToastNotification from './components/ToastNotification.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import ScanTab from './components/scan/ScanTab.jsx';
import CollectionTab from './components/collection/CollectionTab.jsx';
import SettingsTab from './components/settings/SettingsTab.jsx';
import { useCamera } from './hooks/useCamera.js';
import { useCardDetection } from './hooks/useCardDetection.js';
import { useAutoScan } from './hooks/useAutoScan.js';
import { downloadCSV, validateForExport } from './lib/csvExporter.js';
import { getMatcher } from './lib/cardMatcher.js';
import { isFoilOnly } from './data/sampleCards.js';

// ─── State persistence helpers ──────────────────────────────
const STORAGE_KEYS = {
  SCANNED_CARDS: 'riftbound_scanned_cards',
  PENDING_CARDS: 'riftbound_pending_cards',
  BATCH_DEFAULTS: 'riftbound_batch_defaults',
  MODEL_PREFERENCE: 'riftbound_model_preference',
};

function saveToStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn('[Storage] Failed to save:', err);
  }
}

function loadFromStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (err) {
    console.warn('[Storage] Failed to load:', err);
    return fallback;
  }
}

export default function App() {
  // ─── App State ─────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStage, setLoadStage] = useState('db');

  // Scanning
  const [pendingCards, setPendingCards] = useState(() =>
    loadFromStorage(STORAGE_KEYS.PENDING_CARDS, [])
  );
  const [scannedCards, setScannedCards] = useState(() =>
    loadFromStorage(STORAGE_KEYS.SCANNED_CARDS, [])
  );

  // UI
  const [activeTab, setActiveTab] = useState('scan');
  const [notification, setNotification] = useState(null);

  // Scan settings
  const [minConfidence, setMinConfidence] = useState(0.80);

  // Batch defaults
  const [batchDefaults, setBatchDefaults] = useState(() =>
    loadFromStorage(STORAGE_KEYS.BATCH_DEFAULTS, {
      condition: 'Near Mint',
      language: 'English',
      foil: false,
    })
  );

  // Model preference (normal or quantized)
  const [modelPreference, setModelPreference] = useState(() =>
    loadFromStorage(STORAGE_KEYS.MODEL_PREFERENCE, 'quantized')
  );

  // ─── Hooks ─────────────────────────────────────────────────
  const camera = useCamera();
  const detection = useCardDetection();

  // Restart camera when switching back to scan tab (video element was destroyed on unmount)
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    if (activeTab === 'scan' && prevTabRef.current !== 'scan' && camera.isActive) {
      camera.startCamera();
    }
    prevTabRef.current = activeTab;
  }, [activeTab, camera.isActive, camera.startCamera]);

  // ─── Notifications ─────────────────────────────────────────
  const notificationTimeoutRef = useRef(null);

  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, 2000);
  }, []);

  // ─── Initialization ────────────────────────────────────────
  const hasShownRestoreNotification = useRef(false);

  useEffect(() => {
    async function init() {
      try {
        // Stage 1: Initialize YOLO detector (warmup) with model preference
        setLoadStage('model');
        setLoadProgress(0.2);
        await detection.initDetector(modelPreference);
        setLoadProgress(0.5);

        // Stage 2: Initialize card matcher (loads card-hashes.json)
        setLoadStage('matcher');
        const matcher = getMatcher();
        await matcher.initialize();
        setLoadProgress(0.85);

        // Done
        setLoadStage('ready');
        setLoadProgress(1);
        await new Promise(r => setTimeout(r, 400));
        setIsLoading(false);
      } catch (error) {
        console.error('[App] Initialization error:', error);
        setIsLoading(false);
      }
    }
    init();
  }, [modelPreference]);

  // Show notification if state was restored from previous session
  useEffect(() => {
    if (!isLoading && !hasShownRestoreNotification.current) {
      const restoredCount = scannedCards.length + pendingCards.length;
      if (restoredCount > 0) {
        setTimeout(() => {
          showNotification(`Session restored — ${restoredCount} card${restoredCount !== 1 ? 's' : ''} recovered`, 'success');
        }, 500);
      }
      hasShownRestoreNotification.current = true;
    }
  }, [isLoading, scannedCards.length, pendingCards.length, showNotification]);

  // ─── State persistence ───────────────────────────────────
  useEffect(() => {
    saveToStorage(STORAGE_KEYS.SCANNED_CARDS, scannedCards);
  }, [scannedCards]);

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.PENDING_CARDS, pendingCards);
  }, [pendingCards]);

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.BATCH_DEFAULTS, batchDefaults);
  }, [batchDefaults]);

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.MODEL_PREFERENCE, modelPreference);
  }, [modelPreference]);

  // Force save on page visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveToStorage(STORAGE_KEYS.SCANNED_CARDS, scannedCards);
        saveToStorage(STORAGE_KEYS.PENDING_CARDS, pendingCards);
        saveToStorage(STORAGE_KEYS.BATCH_DEFAULTS, batchDefaults);
        saveToStorage(STORAGE_KEYS.MODEL_PREFERENCE, modelPreference);
      }
    };

    const handleBeforeUnload = () => {
      saveToStorage(STORAGE_KEYS.SCANNED_CARDS, scannedCards);
      saveToStorage(STORAGE_KEYS.PENDING_CARDS, pendingCards);
      saveToStorage(STORAGE_KEYS.BATCH_DEFAULTS, batchDefaults);
      saveToStorage(STORAGE_KEYS.MODEL_PREFERENCE, modelPreference);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [scannedCards, pendingCards, batchDefaults, modelPreference]);

  // ─── Refs for use in callbacks without stale closures ──
  const batchDefaultsRef = useRef(batchDefaults);
  useEffect(() => { batchDefaultsRef.current = batchDefaults; }, [batchDefaults]);
  const minConfidenceRef = useRef(minConfidence);
  useEffect(() => { minConfidenceRef.current = minConfidence; }, [minConfidence]);

  // ─── Card Detection Handler ────────────────────────────────
  const handleCardDetected = useCallback((result) => {
    const { cardData, confidence, similarity, timestamp } = result;

    // Skip detections below minimum confidence
    if (similarity < minConfidenceRef.current) return;

    setPendingCards(prev => {
      const existingIndex = prev.findIndex(c => c.cardData.id === cardData.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + 1,
        };
        showNotification(`${cardData.name} — qty +1`, 'success');
        return updated;
      } else {
        const defaults = batchDefaultsRef.current;
        showNotification(`+ ${cardData.name}`, 'success');
        return [...prev, {
          cardData,
          quantity: 1,
          condition: defaults.condition,
          language: defaults.language,
          foil: isFoilOnly(cardData) || defaults.foil,
          confidence,
          similarity,
          scanTimestamp: timestamp,
        }];
      }
    });

    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }, [showNotification]);

  // ─── Auto-Scan ────────────────────────────────────────────
  const autoScan = useAutoScan({
    cameraIsActive: camera.isActive,
    isProcessing: detection.isProcessing,
    detectSingleFrame: detection.detectSingleFrame,
    captureFrame: camera.captureFrame,
    onCardDetected: handleCardDetected,
  });

  // ─── Snap Scan (tap to capture single frame) ──────────────
  const handleSnapScan = useCallback(async () => {
    if (!camera.isActive || detection.isProcessing) return;

    const result = await detection.detectSingleFrame(camera.captureFrame);
    if (result && result.matched) {
      handleCardDetected(result);
      autoScan.setLastCardId(result.cardData.id);
    } else {
      showNotification('No card detected — try again', 'info');
    }
  }, [camera.isActive, camera.captureFrame, detection, handleCardDetected, showNotification, autoScan]);

  // ─── Pending → Export list handlers ──────────────────────────
  const handleConfirmPending = useCallback((index) => {
    setPendingCards(prev => {
      const card = prev[index];
      if (!card) return prev;

      setScannedCards(exportPrev => {
        const existingIndex = exportPrev.findIndex(c => c.cardData.id === card.cardData.id);
        if (existingIndex >= 0) {
          const updated = [...exportPrev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            quantity: updated[existingIndex].quantity + card.quantity,
          };
          return updated;
        }
        return [...exportPrev, { ...card }];
      });

      showNotification(`${card.cardData.name} added to export`, 'success');
      return prev.filter((_, i) => i !== index);
    });
  }, [showNotification]);

  const handleConfirmAllPending = useCallback(() => {
    setPendingCards(prev => {
      if (prev.length === 0) return prev;

      setScannedCards(exportPrev => {
        let updated = [...exportPrev];
        for (const card of prev) {
          const existingIndex = updated.findIndex(c => c.cardData.id === card.cardData.id);
          if (existingIndex >= 0) {
            updated[existingIndex] = {
              ...updated[existingIndex],
              quantity: updated[existingIndex].quantity + card.quantity,
            };
          } else {
            updated = [...updated, { ...card }];
          }
        }
        return updated;
      });

      showNotification(`${prev.length} card${prev.length !== 1 ? 's' : ''} added to export`, 'success');
      return [];
    });
  }, [showNotification]);

  const handleRemovePending = useCallback((index) => {
    setPendingCards(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleClearPending = useCallback(() => {
    setPendingCards([]);
  }, []);

  // ─── Card Management ───────────────────────────────────────
  const handleUpdateCard = useCallback((index, updatedCard) => {
    setScannedCards(prev => {
      const updated = [...prev];
      updated[index] = updatedCard;
      return updated;
    });
  }, []);

  const handleRemoveCard = useCallback((index) => {
    setScannedCards(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleClearAll = useCallback(() => {
    if (scannedCards.length === 0) return;
    if (!confirm('Delete all cards from export list?')) return;
    setScannedCards([]);
  }, [scannedCards.length]);

  // Add a single card to export list (from individual add button)
  const handleAddCardToExport = useCallback((cardData) => {
    setScannedCards(prev => {
      const existingIndex = prev.findIndex(c => c.cardData.id === cardData.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + 1,
        };
        return updated;
      } else {
        const defaults = batchDefaultsRef.current;
        return [...prev, {
          cardData,
          quantity: 1,
          condition: defaults.condition,
          language: defaults.language,
          foil: isFoilOnly(cardData) || defaults.foil,
          confidence: 1,
          scanTimestamp: Date.now(),
        }];
      }
    });
    showNotification(`+ ${cardData.name}`, 'success');
  }, [showNotification]);

  // Add multiple cards to export list at once
  const handleAddCardsToExport = useCallback((cardDataArray) => {
    setScannedCards(prev => {
      let updated = [...prev];
      for (const cardData of cardDataArray) {
        const existingIndex = updated.findIndex(c => c.cardData.id === cardData.id);
        if (existingIndex >= 0) {
          updated[existingIndex] = {
            ...updated[existingIndex],
            quantity: updated[existingIndex].quantity + 1,
          };
        } else {
          const defaults = batchDefaultsRef.current;
          updated = [...updated, {
            cardData,
            quantity: 1,
            condition: defaults.condition,
            language: defaults.language,
            foil: isFoilOnly(cardData) || defaults.foil,
            confidence: 1,
            scanTimestamp: Date.now(),
          }];
        }
      }
      return updated;
    });
    showNotification(`${cardDataArray.length} card${cardDataArray.length !== 1 ? 's' : ''} added to export`, 'success');
  }, [showNotification]);

  // ─── CSV Export ────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const { valid, errors } = validateForExport(scannedCards);
    if (!valid) {
      showNotification(`Error: ${errors[0]}`, 'error');
      return;
    }

    const success = downloadCSV(scannedCards);
    if (success) {
      showNotification(`CSV exported — ${scannedCards.length} cards`, 'success');
    }
  }, [scannedCards, showNotification]);

  // ─── Render ────────────────────────────────────────────────
  if (isLoading) {
    return <LoadingScreen progress={loadProgress} stage={loadStage} />;
  }

  return (
    <AppShell>
      {/* Tab content */}
      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'scan' && (
          <ScanTab
            camera={camera}
            detection={detection}
            onSnapScan={handleSnapScan}
            pendingCards={pendingCards}
            onConfirmPending={handleConfirmPending}
            onConfirmAllPending={handleConfirmAllPending}
            onRemovePending={handleRemovePending}
            onClearPending={handleClearPending}
            onAddCardToExport={handleAddCardToExport}
            onAddCardsToExport={handleAddCardsToExport}
            showNotification={showNotification}
            batchDefaults={batchDefaults}
            minConfidence={minConfidence}
            onUpdateMinConfidence={setMinConfidence}
            autoScanEnabled={autoScan.autoScanEnabled}
            onToggleAutoScan={autoScan.toggleAutoScan}
          />
        )}

        {activeTab === 'collection' && (
          <CollectionTab
            scannedCards={scannedCards}
            onUpdateCard={handleUpdateCard}
            onRemoveCard={handleRemoveCard}
            onClearAll={handleClearAll}
            onExport={handleExport}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            batchDefaults={batchDefaults}
            onUpdateDefaults={setBatchDefaults}
            modelPreference={modelPreference}
            onUpdateModelPreference={setModelPreference}
          />
        )}
      </div>

      {/* Bottom navigation */}
      <BottomTabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        scannedCount={scannedCards.reduce((sum, c) => sum + c.quantity, 0)}
      />

      {/* Toast */}
      <ToastNotification notification={notification} />
    </AppShell>
  );
}
