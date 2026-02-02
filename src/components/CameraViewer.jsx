import React, { useRef, useEffect, useState } from 'react';
import { Camera, CameraOff, RotateCw, Zap, ZapOff, AlertCircle } from 'lucide-react';

export default function CameraViewer({
  videoRef,
  isActive,
  error,
  isScanning,
  lastDetection,
  fps,
  onStartCamera,
  onStopCamera,
  onToggleFacing,
  onToggleScanning,
  scanEnabled,
}) {
  const overlayRef = useRef(null);
  const [dimensions, setDimensions] = useState({ w: 0, h: 0 });

  // Track video dimensions
  useEffect(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    const updateDimensions = () => {
      setDimensions({
        w: video.clientWidth,
        h: video.clientHeight,
      });
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

  // Card guide rectangle dimensions (63mm x 88mm aspect ratio ≈ 0.716)
  const cardAspect = 63 / 88;
  const guideH = dimensions.h * 0.65;
  const guideW = guideH * cardAspect;
  const guideX = (dimensions.w - guideW) / 2;
  const guideY = (dimensions.h - guideH) / 2;

  const hasDetection = lastDetection?.matched;

  return (
    <div className="relative flex-1 min-h-0 bg-black overflow-hidden">
      {/* Video feed */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {/* Scanning overlay */}
      {isActive && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Dim area outside guide */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Clear guide area */}
          <div
            className="absolute bg-transparent"
            style={{
              left: guideX,
              top: guideY,
              width: guideW,
              height: guideH,
              boxShadow: `0 0 0 9999px rgba(0, 0, 0, 0.4)`,
            }}
          >
            {/* Guide border */}
            <div className={`absolute inset-0 border-2 rounded-lg transition-colors duration-300 ${
              hasDetection
                ? 'border-green-400 shadow-lg shadow-green-400/30'
                : scanEnabled
                  ? 'guide-border border-gold-400/50'
                  : 'border-rift-400/40'
            }`}>
              {/* Corner accents */}
              {[
                'top-0 left-0 border-t-2 border-l-2 rounded-tl-lg',
                'top-0 right-0 border-t-2 border-r-2 rounded-tr-lg',
                'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
                'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
              ].map((pos, i) => (
                <div
                  key={i}
                  className={`absolute w-6 h-6 ${pos} ${
                    hasDetection ? 'border-green-400' : 'border-gold-400'
                  }`}
                />
              ))}

              {/* Scan line animation */}
              {scanEnabled && isScanning && !hasDetection && (
                <div className="absolute left-1 right-1 h-0.5 bg-gradient-to-r from-transparent via-gold-400 to-transparent scan-line opacity-60" />
              )}
            </div>

            {/* Detection indicator */}
            {hasDetection && (
              <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/90 backdrop-blur-sm fade-in">
                <Zap className="w-3 h-3 text-white" />
                <span className="text-xs font-semibold text-white whitespace-nowrap">
                  ¡Carta detectada!
                </span>
              </div>
            )}
          </div>

          {/* FPS & scan status */}
          <div className="absolute top-3 left-3 flex items-center gap-2">
            {scanEnabled && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/50 backdrop-blur-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <span className="text-[10px] font-mono text-white/80">
                  {fps > 0 ? `${fps} FPS` : 'SCAN'}
                </span>
              </div>
            )}
          </div>

          {/* Instructions */}
          {!hasDetection && scanEnabled && (
            <div className="absolute bottom-4 left-4 right-4 text-center">
              <p className="text-xs text-white/60 font-body">
                Coloca la carta dentro del marco · Fondo liso · Evita reflejos
              </p>
            </div>
          )}
        </div>
      )}

      {/* Inactive state */}
      {!isActive && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-rift-900/90">
          <div className="w-16 h-16 rounded-2xl bg-rift-700/60 border border-rift-500/30 flex items-center justify-center">
            <Camera className="w-8 h-8 text-rift-400" />
          </div>
          <div className="text-center px-6">
            <p className="text-sm font-body text-rift-300 mb-1">
              Cámara desactivada
            </p>
            <p className="text-xs text-rift-500">
              Activa la cámara para comenzar a escanear cartas
            </p>
          </div>
          <button onClick={onStartCamera} className="btn-primary text-sm mt-2">
            <Camera className="w-4 h-4" />
            Activar Cámara
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-rift-900/95 px-6">
          <AlertCircle className="w-12 h-12 text-red-400" />
          <p className="text-sm text-red-300 text-center font-body">{error}</p>
          <button onClick={onStartCamera} className="btn-secondary text-sm">
            Reintentar
          </button>
        </div>
      )}

      {/* Camera controls */}
      {isActive && (
        <div className="absolute top-3 right-3 flex flex-col gap-2 z-10">
          <button
            onClick={onToggleFacing}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white/80 hover:bg-black/70 transition-colors"
            title="Cambiar cámara"
          >
            <RotateCw className="w-4.5 h-4.5" />
          </button>
          <button
            onClick={onToggleScanning}
            className={`w-10 h-10 rounded-full backdrop-blur-sm border flex items-center justify-center transition-all ${
              scanEnabled
                ? 'bg-gold-500/30 border-gold-400/50 text-gold-400'
                : 'bg-black/50 border-white/10 text-white/60'
            }`}
            title={scanEnabled ? 'Pausar escaneo' : 'Reanudar escaneo'}
          >
            {scanEnabled ? <Zap className="w-4.5 h-4.5" /> : <ZapOff className="w-4.5 h-4.5" />}
          </button>
          <button
            onClick={onStopCamera}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors"
            title="Apagar cámara"
          >
            <CameraOff className="w-4.5 h-4.5" />
          </button>
        </div>
      )}
    </div>
  );
}
