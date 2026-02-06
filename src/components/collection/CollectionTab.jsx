import React from 'react';
import { Download, Trash2, Layers } from 'lucide-react';
import ScannerCardRow from '../scanner/ScannerCardRow.jsx';

export default function CollectionTab({
  scannedCards,
  onUpdateCard,
  onRemoveCard,
  onClearAll,
  onExport,
}) {
  const totalCards = scannedCards.reduce((sum, c) => sum + c.quantity, 0);

  return (
    <div className="flex-1 overflow-y-auto pb-20">
      <div className="px-4 pt-5 pb-4 space-y-4">
        {/* Page title */}
        <div className="mb-2">
          <h1 className="text-xl font-display font-bold text-rift-100">Collection</h1>
          <p className="text-xs text-rift-400 mt-1">Your scanned cards ready for export</p>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-rift-100 mr-auto">
            {totalCards > 0
              ? `${totalCards} card${totalCards !== 1 ? 's' : ''} (${scannedCards.length} unique)`
              : 'No cards yet'
            }
          </span>
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

        {/* Card list */}
        {scannedCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Layers className="w-10 h-10 text-rift-600 mb-3" />
            <p className="text-sm text-rift-400">No cards in your collection</p>
            <p className="text-xs text-rift-500 mt-1">
              Use the Scan tab to detect and add cards
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {scannedCards.map((card, index) => (
              <ScannerCardRow
                key={`${card.cardData.id}-${card.scanTimestamp}`}
                card={card}
                index={index}
                onUpdate={onUpdateCard}
                onRemove={onRemoveCard}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
