import React, { useRef, useEffect } from 'react';
import { ListChecks, Download, Trash2, ChevronUp, ChevronDown, Search } from 'lucide-react';
import CardItem from './CardItem.jsx';

export default function ReviewQueue({
  scannedCards,
  onUpdateCard,
  onRemoveCard,
  onClearAll,
  onExport,
  isExpanded,
  onToggleExpand,
  onManualAdd,
}) {
  const listRef = useRef(null);

  // Auto-scroll to latest card
  useEffect(() => {
    if (listRef.current && scannedCards.length > 0) {
      const list = listRef.current;
      // Scroll to bottom where newest cards are
      list.scrollTop = list.scrollHeight;
    }
  }, [scannedCards.length]);

  const totalCards = scannedCards.reduce((sum, c) => sum + c.quantity, 0);
  const uniqueCards = scannedCards.length;

  return (
    <div className={`flex flex-col bg-rift-800/95 backdrop-blur-md border-t border-rift-600/30 transition-all duration-300 ${
      isExpanded ? 'flex-1 min-h-0' : 'h-auto'
    }`}>
      {/* Queue header - always visible */}
      <button
        onClick={onToggleExpand}
        className="flex items-center justify-between px-4 py-2.5 hover:bg-rift-700/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <ListChecks className="w-4.5 h-4.5 text-gold-400" />
            {scannedCards.length > 0 && (
              <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 rounded-full bg-gold-500 text-rift-900 text-[10px] font-bold flex items-center justify-center px-1">
                {uniqueCards}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-rift-100">Cola de Revisión</span>
            {scannedCards.length > 0 && (
              <span className="text-xs text-rift-400">
                {totalCards} carta{totalCards !== 1 ? 's' : ''} · {uniqueCards} única{uniqueCards !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-rift-400" />
        ) : (
          <ChevronUp className="w-4 h-4 text-rift-400" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Action bar */}
          {scannedCards.length > 0 && (
            <div className="flex items-center gap-2 px-4 pb-2">
              <button onClick={onExport} className="btn-primary text-xs flex-1 py-2">
                <Download className="w-3.5 h-3.5" />
                Exportar CSV
              </button>
              <button onClick={onManualAdd} className="btn-secondary text-xs py-2">
                <Search className="w-3.5 h-3.5" />
                Añadir
              </button>
              <button
                onClick={onClearAll}
                className="btn-ghost text-xs py-2 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                title="Limpiar todo"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Card list */}
          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-2"
          >
            {scannedCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-12 h-12 rounded-xl bg-rift-700/40 border border-rift-600/20 flex items-center justify-center mb-3">
                  <ListChecks className="w-6 h-6 text-rift-500" />
                </div>
                <p className="text-sm text-rift-400 font-body">
                  Las cartas escaneadas aparecerán aquí
                </p>
                <p className="text-xs text-rift-500 mt-1">
                  Apunta la cámara a una carta para comenzar
                </p>
              </div>
            ) : (
              scannedCards.map((card, index) => (
                <CardItem
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
