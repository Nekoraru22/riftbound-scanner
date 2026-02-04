import React from 'react';
import { Shield, Sparkles, RotateCcw, Info, Zap } from 'lucide-react';
import { CONDITIONS, LANGUAGES } from '../../data/sampleCards.js';

export default function SettingsTab({
  batchDefaults,
  onUpdateDefaults,
}) {
  return (
    <div className="flex-1 overflow-y-auto pb-20">
      <div className="px-4 pt-5 pb-4 space-y-4">
        {/* Page title */}
        <div className="mb-2">
          <h1 className="text-xl font-display font-bold text-rift-100">Ajustes</h1>
          <p className="text-xs text-rift-400 mt-1">Configura los valores por defecto y opciones de la app</p>
        </div>

        {/* Batch Defaults Section */}
        <section className="rounded-2xl bg-rift-800/60 border border-rift-600/20 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-rift-100 flex items-center gap-2">
            <Shield className="w-4 h-4 text-gold-400" />
            Valores por defecto
          </h2>
          <p className="text-xs text-rift-400">
            Se aplicaran automaticamente a las nuevas cartas escaneadas.
          </p>

          {/* Condition */}
          <div>
            <label className="text-[11px] font-medium text-rift-300 uppercase tracking-wider mb-1.5 block">
              Estado
            </label>
            <select
              value={batchDefaults.condition}
              onChange={(e) => onUpdateDefaults({ ...batchDefaults, condition: e.target.value })}
              className="select-field rounded-xl"
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Language */}
          <div>
            <label className="text-[11px] font-medium text-rift-300 uppercase tracking-wider mb-1.5 block">
              Idioma
            </label>
            <select
              value={batchDefaults.language}
              onChange={(e) => onUpdateDefaults({ ...batchDefaults, language: e.target.value })}
              className="select-field rounded-xl"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          {/* Foil */}
          <div>
            <label className="text-[11px] font-medium text-rift-300 uppercase tracking-wider mb-1.5 block">
              Foil
            </label>
            <button
              onClick={() => onUpdateDefaults({ ...batchDefaults, foil: !batchDefaults.foil })}
              className={`w-full rounded-xl border py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                batchDefaults.foil
                  ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 border-purple-400/50 text-purple-300'
                  : 'bg-rift-700 border-rift-600/40 text-rift-400'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              {batchDefaults.foil ? 'Todas Foil' : 'No Foil'}
            </button>
          </div>

          {/* Reset */}
          <button
            onClick={() => onUpdateDefaults({
              condition: 'Near Mint',
              language: 'English',
              foil: false,
            })}
            className="btn-ghost w-full text-xs text-rift-400 rounded-xl"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restaurar valores predeterminados
          </button>
        </section>

        {/* About Section */}
        <section className="rounded-2xl bg-rift-800/60 border border-rift-600/20 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-rift-100 flex items-center gap-2">
            <Info className="w-4 h-4 text-gold-400" />
            Acerca de
          </h2>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-400 to-gold-500 flex items-center justify-center shadow-lg shadow-gold-500/20">
              <Zap className="w-5 h-5 text-rift-900" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-sm font-display font-bold text-gold-400">RiftBound Scanner</p>
              <p className="text-[10px] text-rift-500">v1.0.0</p>
            </div>
          </div>

          <p className="text-xs text-rift-400 leading-relaxed">
            Escaner de cartas RiftBound TCG con reconocimiento visual en tiempo real
            mediante inteligencia artificial (YOLO11 + pHash).
          </p>

          <div className="p-3 rounded-xl bg-rift-700/40 border border-rift-600/20">
            <p className="text-[10px] text-rift-500 leading-relaxed">
              Creado bajo la politica "Legal Jibber Jabber" de Riot Games.
              Riot Games no respalda ni patrocina este proyecto.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
