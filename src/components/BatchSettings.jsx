import React, { useState, useEffect, useRef } from 'react';
import {
  X, Settings2, Globe, Shield, Sparkles, Save, RotateCcw, Search, Plus, Key
} from 'lucide-react';
import { CONDITIONS, LANGUAGES } from '../data/sampleCards.js';
import { searchCards } from '../lib/cardDatabase.js';

export default function BatchSettings({
  isOpen,
  onClose,
  batchDefaults,
  onUpdateDefaults,
  cards,
  onAddCard,
  activeTab: initialTab,
}) {
  const [tab, setTab] = useState(initialTab || 'batch');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [apiKey, setApiKey] = useState('');
  const searchRef = useRef(null);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (tab === 'search' && searchRef.current) {
      searchRef.current.focus();
    }
  }, [tab]);

  // Search cards
  useEffect(() => {
    if (searchQuery.length >= 2) {
      const results = searchCards(cards, searchQuery);
      setSearchResults(results.slice(0, 20));
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, cards]);

  const handleAddFromSearch = (cardData) => {
    onAddCard(cardData);
    setSearchQuery('');
    setSearchResults([]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md max-h-[85dvh] bg-rift-800 border border-rift-600/40 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-rift-600/30">
          <div className="flex items-center gap-2.5">
            <Settings2 className="w-5 h-5 text-gold-400" />
            <h2 className="text-base font-display font-semibold text-rift-100">
              Configuración
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-rift-600/30">
          {[
            { id: 'batch', label: 'Lote', icon: Settings2 },
            { id: 'search', label: 'Buscar', icon: Search },
            { id: 'api', label: 'API', icon: Key },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
                tab === id
                  ? 'text-gold-400 border-b-2 border-gold-400 bg-gold-400/5'
                  : 'text-rift-400 hover:text-rift-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Batch defaults tab */}
          {tab === 'batch' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs text-rift-400 mb-4">
                  Define valores por defecto para todas las cartas que escanees a continuación.
                  Los cambios se aplicarán solo a los nuevos escaneos.
                </p>
              </div>

              {/* Condition */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-rift-300 uppercase tracking-wider mb-1.5">
                  <Shield className="w-3.5 h-3.5 text-rift-400" />
                  Estado por defecto
                </label>
                <select
                  value={batchDefaults.condition}
                  onChange={(e) => onUpdateDefaults({ ...batchDefaults, condition: e.target.value })}
                  className="select-field"
                >
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Language */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-rift-300 uppercase tracking-wider mb-1.5">
                  <Globe className="w-3.5 h-3.5 text-rift-400" />
                  Idioma por defecto
                </label>
                <select
                  value={batchDefaults.language}
                  onChange={(e) => onUpdateDefaults({ ...batchDefaults, language: e.target.value })}
                  className="select-field"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              {/* Foil */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-rift-300 uppercase tracking-wider mb-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-rift-400" />
                  Foil por defecto
                </label>
                <button
                  onClick={() => onUpdateDefaults({ ...batchDefaults, foil: !batchDefaults.foil })}
                  className={`w-full rounded-lg border py-2.5 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
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
                className="btn-ghost w-full text-xs text-rift-400"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restaurar valores predeterminados
              </button>
            </div>
          )}

          {/* Search / Manual add tab */}
          {tab === 'search' && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-rift-400 mb-3">
                  Busca y añade cartas manualmente a la cola de revisión.
                </p>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rift-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Nombre o número de carta..."
                  className="input-field pl-9"
                />
              </div>

              {/* Results */}
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {searchResults.map((card) => (
                  <button
                    key={card.id}
                    onClick={() => handleAddFromSearch(card)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-rift-700/50 border border-rift-600/20 hover:bg-rift-700 hover:border-rift-500/30 transition-colors text-left"
                  >
                    <span className="text-xs font-mono text-rift-400 w-8">
                      #{card.collectorNumber}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-rift-100 truncate">{card.name}</p>
                      <p className="text-[10px] text-rift-500">{card.domain} · {card.rarity}</p>
                    </div>
                    <Plus className="w-4 h-4 text-gold-400 flex-shrink-0" />
                  </button>
                ))}

                {searchQuery.length >= 2 && searchResults.length === 0 && (
                  <p className="text-xs text-rift-500 text-center py-4">
                    No se encontraron cartas
                  </p>
                )}
              </div>
            </div>
          )}

          {/* API tab */}
          {tab === 'api' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs text-rift-400 mb-4">
                  Configura tu clave API de Riot Games para acceder a la base de datos completa
                  de cartas desde el endpoint de contenido de Riftbound.
                </p>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-rift-300 uppercase tracking-wider mb-1.5">
                  <Key className="w-3.5 h-3.5 text-rift-400" />
                  Riot API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="input-field font-mono text-xs"
                />
              </div>

              <div className="p-3 rounded-lg bg-rift-700/40 border border-rift-600/20">
                <p className="text-[11px] text-rift-400 leading-relaxed">
                  <strong className="text-rift-300">Nota:</strong> Obtén tu API key en{' '}
                  <a
                    href="https://developer.riotgames.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gold-400 hover:text-gold-300 underline underline-offset-2"
                  >
                    developer.riotgames.com
                  </a>.
                  La key se almacena solo localmente en tu navegador.
                </p>
              </div>

              <button className="btn-primary w-full text-sm" disabled={!apiKey}>
                <Save className="w-4 h-4" />
                Guardar y Sincronizar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
