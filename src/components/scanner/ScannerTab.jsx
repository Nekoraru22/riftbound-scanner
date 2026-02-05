import React, { useState } from 'react';
import ScannerCamera from './ScannerCamera.jsx';
import CardCounter from './CardCounter.jsx';
import ScannerBottomSheet from './ScannerBottomSheet.jsx';

export default function ScannerTab({
  camera,
  detection,
  scanEnabled,
  pendingCards,
  scannedCards,
  onToggleScanning,
  onConfirmPending,
  onConfirmAllPending,
  onRemovePending,
  onClearPending,
  onUpdateCard,
  onRemoveCard,
  onClearAll,
  onExport,
  batchDefaults,
  showNotification,
}) {
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const totalExport = scannedCards.reduce((sum, c) => sum + c.quantity, 0);
  const totalPending = pendingCards.reduce((sum, c) => sum + c.quantity, 0);

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
          count={totalPending + totalExport}
          uniqueCount={pendingCards.length + scannedCards.length}
          onTap={() => setSheetExpanded(true)}
        />
      )}

      {/* Bottom sheet with pending + export lists */}
      <ScannerBottomSheet
        pendingCards={pendingCards}
        scannedCards={scannedCards}
        onConfirmPending={onConfirmPending}
        onConfirmAllPending={onConfirmAllPending}
        onRemovePending={onRemovePending}
        onClearPending={onClearPending}
        onUpdateCard={onUpdateCard}
        onRemoveCard={onRemoveCard}
        onClearAll={onClearAll}
        onExport={onExport}
        isExpanded={sheetExpanded}
        onToggleExpand={() => setSheetExpanded(prev => !prev)}
      />
    </div>
  );
}
