import React from 'react';
import { Zap, Settings, Database, Wifi, WifiOff } from 'lucide-react';

export default function Header({
  detectorState,
  dbStatus,
  cardCount,
  hashCount,
  onOpenSettings,
}) {
  const isReady = detectorState === 'ready';

  return (
    <header className="relative z-30 flex items-center justify-between px-4 py-2.5 bg-rift-800/95 backdrop-blur-md border-b border-rift-600/30">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-gold-400 to-gold-500 shadow-lg shadow-gold-500/20">
          <Zap className="w-5 h-5 text-rift-900" strokeWidth={2.5} />
          <div className="absolute inset-0 rounded-lg bg-white/10" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-display font-bold text-gold-400 tracking-wider leading-none">
            RIFTBOUND
          </span>
          <span className="text-[10px] font-body text-rift-400 tracking-widest uppercase leading-none mt-0.5">
            Scanner
          </span>
        </div>
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-3">
        {/* DB Status */}
        <div className="flex items-center gap-1.5" title={`${cardCount} cartas · ${hashCount} hashes`}>
          <Database className="w-3.5 h-3.5 text-rift-400" />
          <span className="text-xs font-mono text-rift-400">{cardCount}</span>
        </div>

        {/* Detector Status */}
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${
            isReady ? 'bg-green-400 shadow-sm shadow-green-400/50' :
            detectorState === 'loading' || detectorState === 'warming' ? 'bg-yellow-400 animate-pulse' :
            detectorState === 'error' ? 'bg-red-400' :
            'bg-rift-500'
          }`} />
          <span className="text-xs font-body text-rift-400 hidden sm:inline">
            {isReady ? 'Listo' :
             detectorState === 'loading' ? 'Cargando...' :
             detectorState === 'warming' ? 'Calentando...' :
             detectorState === 'error' ? 'Error' :
             'Inactivo'}
          </span>
        </div>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="btn-ghost p-2 -mr-1"
          aria-label="Configuración"
        >
          <Settings className="w-4.5 h-4.5" />
        </button>
      </div>
    </header>
  );
}
