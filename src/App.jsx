import React, { useState, useEffect, useCallback, useRef } from 'react';
import AppShell from './components/AppShell.jsx';
import BottomTabBar from './components/BottomTabBar.jsx';
import ToastNotification from './components/ToastNotification.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import ScannerTab from './components/scanner/ScannerTab.jsx';
import IdentifyTab from './components/identify/IdentifyTab.jsx';
import SettingsTab from './components/settings/SettingsTab.jsx';
import { useCamera } from './hooks/useCamera.js';
import { useCardDetection } from './hooks/useCardDetection.js';
import { downloadCSV, validateForExport } from './lib/csvExporter.js';
import { getMatcher } from './lib/cardMatcher.js';
import { isFoilOnly } from './data/sampleCards.js';

export default function App() {
  // ─── App State ─────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStage, setLoadStage] = useState('db');

  // Scanning
  const [scanEnabled, setScanEnabled] = useState(true);
  const [pendingCards, setPendingCards] = useState([]);   // detected, not yet confirmed
  const [scannedCards, setScannedCards] = useState([]);   // confirmed export list

  // UI
  const [activeTab, setActiveTab] = useState('scanner');
  const [notification, setNotification] = useState(null);

  // Batch defaults
  const [batchDefaults, setBatchDefaults] = useState({
    condition: 'Near Mint',
    language: 'English',
    foil: false,
  });

  // ─── Hooks ─────────────────────────────────────────────────
  const camera = useCamera();

  const detection = useCardDetection({
    enabled: scanEnabled && camera.isActive && activeTab === 'scanner',
  });

  // ─── Initialization ────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        // Stage 1: Initialize YOLO detector (warmup)
        setLoadStage('model');
        setLoadProgress(0.2);
        await detection.initDetector();
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
  }, []);

  // ─── Batch defaults ref (for use in callbacks without stale closures) ──
  const batchDefaultsRef = useRef(batchDefaults);
  useEffect(() => { batchDefaultsRef.current = batchDefaults; }, [batchDefaults]);

  // ─── Card Detection Handler ────────────────────────────────
  // Scanned cards go to pendingCards first (not directly to export list)
  const handleCardDetected = useCallback((result) => {
    const { cardData, confidence, similarity, timestamp } = result;

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
          foil: isFoilOnly(cardData.rarity) || defaults.foil,
          confidence,
          similarity,
          scanTimestamp: timestamp,
        }];
      }
    });

    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }, []);

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
  }, []);

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
  }, []);

  const handleRemovePending = useCallback((index) => {
    setPendingCards(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleClearPending = useCallback(() => {
    setPendingCards([]);
    detection.resetCooldown();
  }, []);

  // ─── Start scanning when camera is active ──────────────────
  useEffect(() => {
    if (camera.isActive && detection.detectorState === 'ready' && activeTab === 'scanner') {
      detection.startScanning(camera.captureFrame, handleCardDetected);
    }
    return () => {
      detection.stopScanning();
    };
  }, [camera.isActive, detection.detectorState, activeTab]);

  // Keep scan loop callbacks up-to-date
  useEffect(() => {
    detection.updateCallbacks(camera.captureFrame, handleCardDetected);
  }, [camera.captureFrame, handleCardDetected]);

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
    setScannedCards(prev => {
      if (prev.length > 0 && confirm('Delete all cards from export list?')) {
        detection.resetCooldown();
        return [];
      }
      return prev;
    });
  }, []);

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
          foil: isFoilOnly(cardData.rarity) || defaults.foil,
          confidence: 1,
          scanTimestamp: Date.now(),
        }];
      }
    });
    showNotification(`+ ${cardData.name}`, 'success');
  }, []);

  // Add multiple cards to export list at once (from IdentifyTab bulk add)
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
            foil: isFoilOnly(cardData.rarity) || defaults.foil,
            confidence: 1,
            scanTimestamp: Date.now(),
          }];
        }
      }
      return updated;
    });
    showNotification(`${cardDataArray.length} card${cardDataArray.length !== 1 ? 's' : ''} added to export`, 'success');
  }, []);

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
  }, [scannedCards]);

  // ─── Notifications ─────────────────────────────────────────
  const notificationTimeoutRef = useRef(null);

  function showNotification(message, type = 'info') {
    setNotification({ message, type });
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, 2000);
  }

  // ─── Toggle scanning ──────────────────────────────────────
  const toggleScanning = useCallback(() => {
    setScanEnabled(prev => !prev);
  }, []);

  // ─── Render ────────────────────────────────────────────────
  if (isLoading) {
    return <LoadingScreen progress={loadProgress} stage={loadStage} />;
  }

  return (
    <AppShell>
      {/* Tab content */}
      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'scanner' && (
          <ScannerTab
            camera={camera}
            detection={detection}
            scanEnabled={scanEnabled}
            pendingCards={pendingCards}
            scannedCards={scannedCards}
            onToggleScanning={toggleScanning}
            onConfirmPending={handleConfirmPending}
            onConfirmAllPending={handleConfirmAllPending}
            onRemovePending={handleRemovePending}
            onClearPending={handleClearPending}
            onUpdateCard={handleUpdateCard}
            onRemoveCard={handleRemoveCard}
            onClearAll={handleClearAll}
            onExport={handleExport}
            batchDefaults={batchDefaults}
            showNotification={showNotification}
          />
        )}

        {activeTab === 'identify' && (
          <IdentifyTab
            scannedCards={scannedCards}
            onAddToScanner={handleAddCardToExport}
            onAddBatchToScanner={handleAddCardsToExport}
            onUpdateCard={handleUpdateCard}
            onRemoveCard={handleRemoveCard}
            onClearAll={handleClearAll}
            onExport={handleExport}
            showNotification={showNotification}
            batchDefaults={batchDefaults}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            batchDefaults={batchDefaults}
            onUpdateDefaults={setBatchDefaults}
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
