import React, { useEffect, useState, useRef } from 'react';
import { Camera, CameraOff, RotateCw, Zap, ZapOff, AlertCircle, ScanLine, Radar } from 'lucide-react';

export default function ScannerCamera({
  videoRef,
  isActive,
  error,
  isProcessing,
  lastDetection,
  onStartCamera,
  onStopCamera,
  onToggleFacing,
  onSnapScan,
  detectorState,
  hasTorch,
  torchOn,
  onToggleTorch,
  autoScanEnabled,
  onToggleAutoScan,
}) {
  const [dimensions, setDimensions] = useState({ w: 0, h: 0 });
  const [showDetection, setShowDetection] = useState(false);
  const detectionTimerRef = useRef(null);

  // Show detection state for 3 seconds then auto-clear
  useEffect(() => {
    if (lastDetection?.matched) {
      setShowDetection(true);
      if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);
      detectionTimerRef.current = setTimeout(() => setShowDetection(false), 3000);
    } else {
      setShowDetection(false);
    }
    return () => {
      if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);
    };
  }, [lastDetection]);

  useEffect(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    const updateDimensions = () => {
      setDimensions({ w: video.clientWidth, h: video.clientHeight });
    };

    video.addEventListener('loadedmetadata', updateDimensions);
    video.addEventListener('resize', updateDimensions);
    window.addEventListener('resize', updateDimensions);

    return () => {
      video.removeEventListener('loadedmetadata', updateDimensions);
      video.removeEventListener('resize', updateDimensions);
      window.removeEventListener('resize', updateDimensions);
    };
  }, [videoRef]);

  const cardAspect = 63 / 88;
  const guideH = dimensions.h * 0.6;
  const guideW = guideH * cardAspect;
  const guideX = (dimensions.w - guideW) / 2;
  const guideY = (dimensions.h - guideH) / 2;

  const hasDetection = showDetection;
  const isReady = detectorState === 'ready';

  return (
    <div className="absolute inset-0 bg-black">
      {/* Video feed */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {/* Tap to scan */}
      {isActive && (
        <div className="absolute inset-0" onClick={isProcessing ? undefined : onSnapScan}>
          <div className="absolute inset-0 bg-black/40" />

          {/* Processing indicator */}
          {isProcessing && (
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
              <div className="px-5 py-2.5 rounded-full bg-black/60 backdrop-blur-sm flex items-center gap-2">
                <ScanLine className="w-4 h-4 text-gold-400 animate-pulse" />
                <span className="text-sm font-medium text-gold-400">Scanning...</span>
              </div>
            </div>
          )}

          {/* Clear guide area */}
          <div
            className={`absolute rounded-xl border-2 transition-colors duration-300 ${
              hasDetection
                ? 'border-green-400 shadow-lg shadow-green-400/30'
                : isProcessing
                  ? 'guide-border border-gold-400/50'
                  : 'border-rift-400/30'
            }`}
            style={{
              left: guideX,
              top: guideY,
              width: guideW,
              height: guideH,
              boxShadow: hasDetection
                ? '0 0 0 9999px rgba(0, 0, 0, 0.4), 0 10px 15px -3px rgba(74, 222, 128, 0.3)'
                : '0 0 0 9999px rgba(0, 0, 0, 0.4)',
            }}
          >
            {/* Corner accents */}
            {[
              'top-0 left-0 border-t-2 border-l-2 rounded-tl-xl',
              'top-0 right-0 border-t-2 border-r-2 rounded-tr-xl',
              'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-xl',
              'bottom-0 right-0 border-b-2 border-r-2 rounded-br-xl',
            ].map((pos, i) => (
              <div
                key={i}
                className={`absolute w-7 h-7 transition-opacity duration-300 ${pos} ${
                  hasDetection ? 'border-green-400 opacity-0' : 'border-gold-400 opacity-100'
                }`}
              />
            ))}
          </div>

          {/* Detection indicator — centered on screen */}
          {hasDetection && (
            <div className="absolute left-0 right-0 flex justify-center fade-in" style={{ top: guideY + guideH + 12 }}>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/90 backdrop-blur-sm">
                <Zap className="w-3 h-3 text-white" />
                <span className="text-xs font-semibold text-white whitespace-nowrap">
                  Card detected
                </span>
              </div>
            </div>
          )}

          {/* Status chips */}
          <div className="absolute top-24 left-3 flex flex-col gap-2">
            {/* Detector status */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur-sm">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  isReady ? 'bg-green-400' :
                  detectorState === 'loading' || detectorState === 'warming' ? 'bg-yellow-400 animate-pulse' :
                  detectorState === 'error' ? 'bg-red-400' : 'bg-rift-500'
                }`}
                title={
                  isReady ? 'AI model ready' :
                  detectorState === 'loading' ? 'Loading AI model' :
                  detectorState === 'warming' ? 'Warming up AI model' :
                  detectorState === 'error' ? 'AI model error' : 'AI model inactive'
                }
              />
              <span className="text-[10px] font-medium text-white/80">
                {isReady ? 'AI Ready' :
                 detectorState === 'loading' ? 'Loading...' :
                 detectorState === 'warming' ? 'Warming...' :
                 detectorState === 'error' ? 'Error' : 'Inactive'}
              </span>
            </div>
            {autoScanEnabled && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-500/20 backdrop-blur-sm border border-green-400/30">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" title="Auto-scan active" />
                <span className="text-[10px] font-medium text-green-400">Auto</span>
              </div>
            )}
          </div>

          {/* Instructions */}
          {!hasDetection && !isProcessing && (
            <div className="absolute bottom-20 left-4 right-4 text-center">
              <p className="text-xs text-white/50 font-body">
                {autoScanEnabled ? 'Auto-scanning...' : 'Tap to scan card'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Inactive state */}
      {!isActive && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-rift-900/95">
          <div className="w-20 h-20 rounded-3xl bg-rift-800/80 border border-rift-600/30 flex items-center justify-center">
            <Camera className="w-9 h-9 text-rift-400" />
          </div>
          <div className="text-center px-8">
            <p className="text-base font-semibold text-rift-200 mb-1">
              Camera disabled
            </p>
            <p className="text-sm text-rift-500">
              Enable the camera to scan cards
            </p>
          </div>
          <button onClick={onStartCamera} className="btn-primary text-sm mt-1 px-6 py-3 rounded-xl">
            <Camera className="w-4 h-4" />
            Enable Camera
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-rift-900/95 px-8">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <p className="text-sm text-red-300 text-center font-body">{error}</p>
          <button onClick={onStartCamera} className="btn-secondary text-sm rounded-xl">
            Retry
          </button>
        </div>
      )}

      {/* Camera controls */}
      {isActive && (
        <div className="absolute top-3 right-3 flex flex-col gap-2 z-10" onClick={e => e.stopPropagation()}>
          <button
            onClick={onToggleFacing}
            className="w-11 h-11 rounded-xl bg-black/50 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white/80 hover:bg-black/70 transition-colors"
          >
            <RotateCw className="w-4.5 h-4.5" />
          </button>
          {hasTorch && (
            <button
              onClick={onToggleTorch}
              className={`w-11 h-11 rounded-xl backdrop-blur-sm border flex items-center justify-center transition-all ${
                torchOn
                  ? 'bg-yellow-500/30 border-yellow-400/50 text-yellow-400'
                  : 'bg-black/50 border-white/10 text-white/60'
              }`}
            >
              {torchOn ? <Zap className="w-4.5 h-4.5" /> : <ZapOff className="w-4.5 h-4.5" />}
            </button>
          )}
          <button
            onClick={onToggleAutoScan}
            className={`w-11 h-11 rounded-xl backdrop-blur-sm border flex items-center justify-center transition-all ${
              autoScanEnabled
                ? 'bg-green-500/30 border-green-400/50 text-green-400 animate-pulse'
                : 'bg-black/50 border-white/10 text-white/60'
            }`}
            title={autoScanEnabled ? 'Stop auto-scan' : 'Start auto-scan'}
          >
            <Radar className="w-4.5 h-4.5" />
          </button>
          <button
            onClick={onStopCamera}
            className="w-11 h-11 rounded-xl bg-black/50 backdrop-blur-sm border border-white/10 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <CameraOff className="w-4.5 h-4.5" />
          </button>
        </div>
      )}
    </div>
  );
}
