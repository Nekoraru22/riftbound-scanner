import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Download, Trash2, Search, ChevronUp, X } from 'lucide-react';
import ScannerCardRow from './ScannerCardRow.jsx';
import { searchCards } from '../../lib/cardDatabase.js';

const PEEK_HEIGHT = 56;

export default function ScannerBottomSheet({
  scannedCards,
  onUpdateCard,
  onRemoveCard,
  onClearAll,
  onExport,
  cards,
  onAddCardFromSearch,
  isExpanded,
  onToggleExpand,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const listRef = useRef(null);
  const searchRef = useRef(null);

  const totalCards = scannedCards.reduce((sum, c) => sum + c.quantity, 0);
  const uniqueCards = scannedCards.length;

  // Auto-scroll to latest card
  useEffect(() => {
    if (listRef.current && scannedCards.length > 0 && isExpanded) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [scannedCards.length, isExpanded]);

  // Search cards
  useEffect(() => {
    if (searchQuery.length >= 2) {
      const results = searchCards(cards, searchQuery);
      setSearchResults(results.slice(0, 15));
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, cards]);

  // Focus search input
  useEffect(() => {
    if (showSearch && searchRef.current) {
      searchRef.current.focus();
    }
  }, [showSearch]);

  const handleAddFromSearch = useCallback((cardData) => {
    onAddCardFromSearch(cardData);
    setSearchQuery('');
    setSearchResults([]);
  }, [onAddCardFromSearch]);

  return (
    <div
      className={`absolute bottom-16 left-0 right-0 z-30 bg-rift-800/95 backdrop-blur-xl border-t border-rift-600/30 rounded-t-2xl transition-all duration-300 ease-out flex flex-col ${
        isExpanded ? 'h-[65dvh]' : ''
      }`}
      style={!isExpanded ? { height: PEEK_HEIGHT } : undefined}
    >
      {/* Drag handle + header */}
      <button
        onClick={onToggleExpand}
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
      >
        <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-rift-500/60" />
        <div className="flex items-center gap-2.5 mt-1">
          <span className="text-sm font-semibold text-rift-100">
            {totalCards > 0
              ? `${totalCards} carta${totalCards !== 1 ? 's' : ''}`
              : 'Sin cartas'
            }
          </span>
          {uniqueCards > 0 && (
            <span className="text-xs text-rift-400">
              {uniqueCards} unica{uniqueCards !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <ChevronUp className={`w-4 h-4 text-rift-400 transition-transform duration-300 mt-1 ${
          isExpanded ? 'rotate-180' : ''
        }`} />
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Action bar */}
          <div className="flex items-center gap-2 px-4 pb-3 flex-shrink-0">
            <button
              onClick={onExport}
              disabled={scannedCards.length === 0}
              className="btn-primary text-xs flex-1 py-2 rounded-xl"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV
            </button>
            <button
              onClick={() => setShowSearch(!showSearch)}
              className={`btn-secondary text-xs py-2 rounded-xl ${showSearch ? 'border-gold-400/40 text-gold-400' : ''}`}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClearAll}
              disabled={scannedCards.length === 0}
              className="btn-ghost text-xs py-2 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-xl disabled:opacity-30"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Inline search */}
          {showSearch && (
            <div className="px-4 pb-3 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rift-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar carta por nombre o numero..."
                  className="input-field pl-9 pr-8 rounded-xl text-xs"
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-rift-500 hover:text-rift-300"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {searchResults.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => handleAddFromSearch(card)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-rift-700/50 border border-rift-600/20 hover:bg-rift-700 transition-colors text-left"
                    >
                      <span className="text-[10px] font-mono text-rift-400 w-8">
                        #{card.collectorNumber}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-rift-100 truncate">{card.name}</p>
                        <p className="text-[9px] text-rift-500">{card.domain} · {card.rarity}</p>
                      </div>
                      <span className="text-[10px] text-gold-400 font-medium">+ Anadir</span>
                    </button>
                  ))}
                </div>
              )}

              {searchQuery.length >= 2 && searchResults.length === 0 && (
                <p className="text-[10px] text-rift-500 text-center py-3">
                  No se encontraron cartas
                </p>
              )}
            </div>
          )}

          {/* Card list */}
          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-2"
          >
            {scannedCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <p className="text-sm text-rift-400">
                  Las cartas escaneadas apareceran aqui
                </p>
                <p className="text-xs text-rift-500 mt-1">
                  Apunta la camara a una carta para comenzar
                </p>
              </div>
            ) : (
              scannedCards.map((card, index) => (
                <ScannerCardRow
                  key={`${card.cardData.id}-${card.scanTimestamp}`}
                  card={card}
                  index={index}
                  onUpdate={onUpdateCard}
                  onRemove={onRemoveCard}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
