import React from 'react';
import { Zap, Database, Brain, ScanLine, CheckCircle2 } from 'lucide-react';

export default function LoadingScreen({ progress, stage }) {
  const stages = [
    { key: 'db', label: 'Cargando base de datos...', icon: Database },
    { key: 'model', label: 'Calentando modelo de IA...', icon: Brain },
    { key: 'matcher', label: 'Preparando identificador...', icon: ScanLine },
    { key: 'ready', label: 'Listo para escanear!', icon: CheckCircle2 },
  ];

  const currentIndex = stages.findIndex(s => s.key === stage);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-rift-900 px-8">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div className="relative flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-gold-400 to-gold-500 shadow-xl shadow-gold-500/20">
          <Zap className="w-8 h-8 text-rift-900" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col">
          <span className="text-2xl font-display font-bold text-gold-400 tracking-wider">
            RIFTBOUND
          </span>
          <span className="text-xs font-body text-rift-400 tracking-[0.3em] uppercase">
            Scanner
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xs mb-8">
        <div className="h-1.5 rounded-full bg-rift-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-400 transition-all duration-500 ease-out"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <p className="text-xs font-mono text-rift-500 text-center mt-2">
          {Math.round(progress * 100)}%
        </p>
      </div>

      {/* Stage indicators */}
      <div className="space-y-3">
        {stages.map((s, i) => {
          const Icon = s.icon;
          const isActive = s.key === stage;
          const isDone = i < currentIndex;

          return (
            <div
              key={s.key}
              className={`flex items-center gap-3 transition-all duration-300 ${
                isActive ? 'opacity-100' : isDone ? 'opacity-50' : 'opacity-20'
              }`}
            >
              <Icon className={`w-4 h-4 ${
                isDone ? 'text-green-400' : isActive ? 'text-gold-400' : 'text-rift-500'
              } ${isActive ? 'animate-pulse' : ''}`} />
              <span className={`text-sm font-body ${
                isActive ? 'text-rift-200' : 'text-rift-400'
              }`}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Disclaimer */}
      <p className="absolute bottom-6 text-[10px] text-rift-600 text-center px-8 max-w-sm">
        Creado bajo la política "Legal Jibber Jabber" de Riot Games.
        Riot Games no respalda ni patrocina este proyecto.
      </p>
    </div>
  );
}
