import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Download, Trash2, ChevronUp, X, Check, ChevronsRight } from 'lucide-react';
import ScannerCardRow from './ScannerCardRow.jsx';
import { getMatcher } from '../../lib/cardMatcher.js';

const PEEK_HEIGHT = 56;

/**
 * Renders an 8×8 color grid thumbnail from the matcher's feature array.
 * Each cell is a colored square representing the average color of that grid region.
 */
function ColorGridThumb({ cardId, size = 32 }) {
  const gridCanvas = useMemo(() => {
    const matcher = getMatcher();
    if (!matcher.ready) return null;

    const card = matcher.cards.find(c => c.id === cardId);
    if (!card || !card.f) return null;

    const gridSize = matcher.gridSize || 8;
    const canvas = document.createElement('canvas');
    canvas.width = gridSize;
    canvas.height = gridSize;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(gridSize, gridSize);

    for (let i = 0, j = 0; i < card.f.length; i += 3, j += 4) {
      imgData.data[j] = Math.round(card.f[i] * 255);
      imgData.data[j + 1] = Math.round(card.f[i + 1] * 255);
      imgData.data[j + 2] = Math.round(card.f[i + 2] * 255);
      imgData.data[j + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL();
  }, [cardId]);

  if (!gridCanvas) return null;

  return (
    <img
      src={gridCanvas}
      alt=""
      className="rounded-sm flex-shrink-0"
      style={{ width: size, height: Math.round(size * 1.4), imageRendering: 'pixelated' }}
    />
  );
}

export default function ScannerBottomSheet({
  pendingCards,
  scannedCards,
  onConfirmPending,
  onConfirmAllPending,
  onRemovePending,
  onClearPending,
  onUpdateCard,
  onRemoveCard,
  onClearAll,
  onExport,
  isExpanded,
  onToggleExpand,
}) {
  const listRef = useRef(null);

  const totalExport = scannedCards.reduce((sum, c) => sum + c.quantity, 0);
  const totalPending = pendingCards.reduce((sum, c) => sum + c.quantity, 0);
  const totalAll = totalExport + totalPending;

  // Auto-scroll export list to latest card
  useEffect(() => {
    if (listRef.current && scannedCards.length > 0 && isExpanded) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [scannedCards.length, isExpanded]);

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
            {totalAll > 0
              ? `${totalAll} card${totalAll !== 1 ? 's' : ''}`
              : 'No cards'
            }
          </span>
          {totalPending > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gold-400/20 text-gold-400 font-medium">
              {totalPending} pending
            </span>
          )}
          {totalExport > 0 && (
            <span className="text-xs text-rift-400">
              {totalExport} to export
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

          {/* ═══ Pending section ═══ */}
          {pendingCards.length > 0 && (
            <div className="flex-shrink-0 border-b border-rift-600/20 pb-2">
              {/* Pending header */}
              <div className="flex items-center gap-2 px-4 pb-2">
                <h3 className="text-xs font-semibold text-gold-400 flex-1">
                  Detected ({pendingCards.length})
                </h3>
                <button
                  onClick={onConfirmAllPending}
                  className="btn-primary text-[10px] py-1 px-2.5 rounded-lg"
                >
                  <ChevronsRight className="w-3 h-3" />
                  Add all
                </button>
                <button
                  onClick={onClearPending}
                  className="btn-ghost text-[10px] py-1 px-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-400/10"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* Pending cards (compact) */}
              <div className="px-3 space-y-1 max-h-40 overflow-y-auto">
                {pendingCards.map((card, index) => (
                  <div
                    key={`${card.cardData.id}-${card.scanTimestamp}`}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-gold-400/5 border border-gold-400/15 fade-in"
                  >
                    {/* Color grid thumbnail */}
                    <ColorGridThumb cardId={card.cardData.id} size={24} />

                    <span className="text-[10px] font-mono text-rift-400 w-8">
                      #{card.cardData.collectorNumber}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-rift-100 truncate">{card.cardData.name}</p>
                    </div>
                    {card.quantity > 1 && (
                      <span className="text-[10px] font-mono text-rift-300">
                        x{card.quantity}
                      </span>
                    )}
                    {card.similarity != null && (
                      <span className={`text-[9px] font-mono ${
                        card.similarity >= 0.8 ? 'text-green-400' :
                        card.similarity >= 0.65 ? 'text-yellow-400' : 'text-orange-400'
                      }`}>
                        {(card.similarity * 100).toFixed(0)}%
                      </span>
                    )}
                    <button
                      onClick={() => onConfirmPending(index)}
                      className="p-1 rounded-lg text-gold-400 hover:bg-gold-400/20 transition-colors"
                      title="Add to export list"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onRemovePending(index)}
                      className="p-1 rounded-lg text-rift-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ Export list section ═══ */}
          {/* Action bar */}
          <div className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0">
            <h3 className="text-xs font-semibold text-rift-300 mr-auto">
              Export ({scannedCards.length})
            </h3>
            <button
              onClick={onExport}
              disabled={scannedCards.length === 0}
              className="btn-primary text-xs py-1.5 px-3 rounded-xl"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            <button
              onClick={onClearAll}
              disabled={scannedCards.length === 0}
              className="btn-ghost text-xs py-1.5 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-xl disabled:opacity-30"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Export card list */}
          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-2"
          >
            {scannedCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-sm text-rift-400">
                  No cards in export list
                </p>
                <p className="text-xs text-rift-500 mt-1">
                  {pendingCards.length > 0
                    ? 'Confirm detected cards above to add them here'
                    : 'Point the camera at a card to start'
                  }
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
