import React, { useState } from 'react';
import ScannerCamera from './ScannerCamera.jsx';
import CardCounter from './CardCounter.jsx';
import ScannerBottomSheet from './ScannerBottomSheet.jsx';

export default function ScannerTab({
  camera,
  detection,
  scanEnabled,
  scannedCards,
  onToggleScanning,
  onUpdateCard,
  onRemoveCard,
  onClearAll,
  onExport,
  onAddCardFromSearch,
  cards,
  batchDefaults,
  showNotification,
}) {
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const totalCards = scannedCards.reduce((sum, c) => sum + c.quantity, 0);

  return (
    <div className="flex-1 relative overflow-hidden">
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
      />

      {/* Floating card counter */}
      {!sheetExpanded && (
        <CardCounter
          count={totalCards}
          uniqueCount={scannedCards.length}
          onTap={() => setSheetExpanded(true)}
        />
      )}

      {/* Bottom sheet with card list */}
      <ScannerBottomSheet
        scannedCards={scannedCards}
        onUpdateCard={onUpdateCard}
        onRemoveCard={onRemoveCard}
        onClearAll={onClearAll}
        onExport={onExport}
        cards={cards}
        onAddCardFromSearch={onAddCardFromSearch}
        isExpanded={sheetExpanded}
        onToggleExpand={() => setSheetExpanded(prev => !prev)}
      />
    </div>
  );
}
