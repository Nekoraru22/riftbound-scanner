import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header.jsx';
import CameraViewer from './components/CameraViewer.jsx';
import ReviewQueue from './components/ReviewQueue.jsx';
import BatchSettings from './components/BatchSettings.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import { useCamera } from './hooks/useCamera.js';
import { useCardDetection } from './hooks/useCardDetection.js';
import { initializeDatabase } from './lib/cardDatabase.js';
import { downloadCSV, validateForExport } from './lib/csvExporter.js';
import { getHashCount } from './lib/indexedDB.js';

export default function App() {
  // ─── App State ─────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStage, setLoadStage] = useState('db');

  // Card database
  const [cards, setCards] = useState([]);
  const [referenceHashes, setReferenceHashes] = useState([]);
  const [hashCount, setHashCount] = useState(0);

  // Scanning
  const [scanEnabled, setScanEnabled] = useState(true);
  const [scannedCards, setScannedCards] = useState([]);

  // UI
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('batch');
  const [queueExpanded, setQueueExpanded] = useState(true);
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
    enabled: scanEnabled && camera.isActive,
  });

  // ─── Initialization ────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        // Stage 1: Load card database
        setLoadStage('db');
        const { cards: loadedCards, hashes } = await initializeDatabase({
          onProgress: (p) => setLoadProgress(p * 0.6),
        });
        setCards(loadedCards);
        setReferenceHashes(hashes);
        setHashCount(hashes.length);

        // Stage 2: Initialize YOLO detector (warmup)
        setLoadStage('model');
        setLoadProgress(0.6);
        await detection.initDetector();
        setLoadProgress(0.9);

        // Done
        setLoadStage('ready');
        setLoadProgress(1);
        await new Promise(r => setTimeout(r, 600));
        setIsLoading(false);
      } catch (error) {
        console.error('[App] Initialization error:', error);
        // Continue anyway with available data
        setIsLoading(false);
      }
    }
    init();
  }, []);

  // ─── Start scanning when camera is active ──────────────────
  useEffect(() => {
    if (camera.isActive && detection.detectorState === 'ready') {
      detection.startScanning(camera.captureFrame, handleCardDetected);
    }
    return () => {
      detection.stopScanning();
    };
  }, [camera.isActive, detection.detectorState]);

  // ─── Card Detection Handler ────────────────────────────────
  const handleCardDetected = useCallback((result) => {
    const { cardData, confidence, distance, timestamp } = result;

    // Check if this card is already in the queue
    const existingIndex = scannedCards.findIndex(
      c => c.cardData.id === cardData.id
    );

    if (existingIndex >= 0) {
      // Increment quantity of existing card
      setScannedCards(prev => {
        const updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + 1,
        };
        return updated;
      });
      showNotification(`${cardData.name} — cantidad +1`, 'success');
    } else {
      // Add new card with batch defaults
      const newEntry = {
        cardData,
        quantity: 1,
        condition: batchDefaults.condition,
        language: batchDefaults.language,
        foil: batchDefaults.foil,
        confidence,
        matchDistance: distance,
        scanTimestamp: timestamp,
      };

      setScannedCards(prev => [...prev, newEntry]);
      showNotification(`✓ ${cardData.name}`, 'success');

      // Auto-expand queue if collapsed
      if (!queueExpanded) {
        setQueueExpanded(true);
      }
    }

    // Haptic feedback (mobile)
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }, [scannedCards, batchDefaults, queueExpanded]);

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
    if (scannedCards.length > 0 && confirm('¿Eliminar todas las cartas escaneadas?')) {
      setScannedCards([]);
      detection.resetCooldown();
    }
  }, [scannedCards.length]);

  const handleManualAdd = useCallback(() => {
    setSettingsTab('search');
    setSettingsOpen(true);
  }, []);

  const handleAddCardFromSearch = useCallback((cardData) => {
    const newEntry = {
      cardData,
      quantity: 1,
      condition: batchDefaults.condition,
      language: batchDefaults.language,
      foil: batchDefaults.foil,
      confidence: 1,
      matchDistance: 0,
      scanTimestamp: Date.now(),
    };
    setScannedCards(prev => [...prev, newEntry]);
    showNotification(`+ ${cardData.name}`, 'success');
  }, [batchDefaults]);

  // ─── CSV Export ────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const { valid, errors } = validateForExport(scannedCards);
    if (!valid) {
      showNotification(`Error: ${errors[0]}`, 'error');
      return;
    }

    const success = downloadCSV(scannedCards);
    if (success) {
      showNotification(`CSV exportado — ${scannedCards.length} cartas`, 'success');
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
    <div className="flex flex-col h-full bg-rift-900 overflow-hidden">
      {/* Header */}
      <Header
        detectorState={detection.detectorState}
        dbStatus="loaded"
        cardCount={cards.length}
        hashCount={hashCount}
        onOpenSettings={() => { setSettingsTab('batch'); setSettingsOpen(true); }}
      />

      {/* Camera */}
      <CameraViewer
        videoRef={camera.videoRef}
        isActive={camera.isActive}
        error={camera.error}
        isScanning={detection.isScanning}
        lastDetection={detection.lastDetection}
        fps={detection.fps}
        onStartCamera={camera.startCamera}
        onStopCamera={camera.stopCamera}
        onToggleFacing={camera.toggleFacing}
        onToggleScanning={toggleScanning}
        scanEnabled={scanEnabled}
      />

      {/* Review Queue */}
      <ReviewQueue
        scannedCards={scannedCards}
        onUpdateCard={handleUpdateCard}
        onRemoveCard={handleRemoveCard}
        onClearAll={handleClearAll}
        onExport={handleExport}
        isExpanded={queueExpanded}
        onToggleExpand={() => setQueueExpanded(prev => !prev)}
        onManualAdd={handleManualAdd}
      />

      {/* Batch Settings Modal */}
      <BatchSettings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        batchDefaults={batchDefaults}
        onUpdateDefaults={setBatchDefaults}
        cards={cards}
        onAddCard={handleAddCardFromSearch}
        activeTab={settingsTab}
      />

      {/* Toast notification */}
      {notification && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full text-sm font-medium shadow-lg fade-in ${
          notification.type === 'success'
            ? 'bg-green-500/90 text-white backdrop-blur-sm'
            : notification.type === 'error'
              ? 'bg-red-500/90 text-white backdrop-blur-sm'
              : 'bg-rift-700/90 text-rift-100 backdrop-blur-sm border border-rift-500/30'
        }`}>
          {notification.message}
        </div>
      )}
    </div>
  );
}
