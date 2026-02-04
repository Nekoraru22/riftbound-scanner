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
import { initializeDatabase } from './lib/cardDatabase.js';
import { downloadCSV, validateForExport } from './lib/csvExporter.js';
import { getMatcher } from './lib/cardMatcher.js';

export default function App() {
  // ─── App State ─────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStage, setLoadStage] = useState('db');

  // Card database
  const [cards, setCards] = useState([]);
  const [referenceHashes, setReferenceHashes] = useState([]);


  // Scanning
  const [scanEnabled, setScanEnabled] = useState(true);
  const [scannedCards, setScannedCards] = useState([]);

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
    referenceHashes,
    cards,
    enabled: scanEnabled && camera.isActive && activeTab === 'scanner',
  });

  // ─── Initialization ────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        // Stage 1: Load card database
        setLoadStage('db');
        const { cards: loadedCards, hashes } = await initializeDatabase({
          onProgress: (p) => setLoadProgress(p * 0.5),
        });
        setCards(loadedCards);
        setReferenceHashes(hashes);


        // Stage 2: Initialize YOLO detector (warmup)
        setLoadStage('model');
        setLoadProgress(0.5);
        await detection.initDetector();
        setLoadProgress(0.75);

        // Stage 3: Initialize card matcher
        setLoadStage('matcher');
        try {
          await getMatcher().initialize();
        } catch (e) {
          console.warn('[App] CardMatcher init failed (identify tab will be limited):', e);
        }
        setLoadProgress(0.95);

        // Done
        setLoadStage('ready');
        setLoadProgress(1);
        await new Promise(r => setTimeout(r, 500));
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
  // Uses functional setState to avoid stale closure on scannedCards
  const handleCardDetected = useCallback((result) => {
    const { cardData, confidence, distance, timestamp } = result;

    setScannedCards(prev => {
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
          foil: defaults.foil,
          confidence,
          matchDistance: distance,
          scanTimestamp: timestamp,
        }];
      }
    });

    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
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
      if (prev.length > 0 && confirm('Delete all scanned cards?')) {
        detection.resetCooldown();
        return [];
      }
      return prev;
    });
  }, []);

  // Uses functional setState to avoid stale closure — fixes "add all adds only 1"
  const handleAddCardFromSearch = useCallback((cardData) => {
    setScannedCards(prev => {
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
          foil: defaults.foil,
          confidence: 1,
          matchDistance: 0,
          scanTimestamp: Date.now(),
        }];
      }
    });
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
            scannedCards={scannedCards}
            onToggleScanning={toggleScanning}
            onUpdateCard={handleUpdateCard}
            onRemoveCard={handleRemoveCard}
            onClearAll={handleClearAll}
            onExport={handleExport}
            onAddCardFromSearch={handleAddCardFromSearch}
            cards={cards}
            batchDefaults={batchDefaults}
            showNotification={showNotification}
          />
        )}

        {activeTab === 'identify' && (
          <IdentifyTab
            cards={cards}
            scannedCards={scannedCards}
            onAddToScanner={handleAddCardFromSearch}
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
