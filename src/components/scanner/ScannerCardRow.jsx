import React, { memo } from 'react';
import { Trash2, Plus, Minus, Sparkles } from 'lucide-react';
import { CONDITIONS, LANGUAGES, DOMAIN_COLORS, RARITY_STYLES } from '../../data/sampleCards.js';

const ScannerCardRow = memo(function ScannerCardRow({ card, index, onUpdate, onRemove }) {
  const { cardData, quantity, condition, language, foil } = card;
  const domainStyle = DOMAIN_COLORS[cardData.domain] || DOMAIN_COLORS.Fury;
  const rarityStyle = RARITY_STYLES[cardData.rarity] || RARITY_STYLES.Common;

  const handleFieldChange = (field, value) => {
    onUpdate(index, { ...card, [field]: value });
  };

  return (
    <div className="rounded-xl bg-rift-700/50 border border-rift-600/20 p-3 fade-in">
      {/* Top row: name + delete */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: domainStyle.hex }}
        />
        <span className={`text-[10px] font-mono font-bold ${rarityStyle.color}`}>
          {rarityStyle.label}
        </span>
        <span className="text-[10px] font-mono text-rift-500">
          #{cardData.collectorNumber}
        </span>
        <h4 className="flex-1 text-sm font-semibold text-rift-100 truncate">
          {cardData.name}
        </h4>
        <button
          onClick={() => onRemove(index)}
          className="p-1 rounded-lg text-rift-500 hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bottom row: qty, condition, language, foil */}
      <div className="flex items-center gap-2">
        {/* Quantity */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => handleFieldChange('quantity', Math.max(1, quantity - 1))}
            className="w-6 h-6 rounded-lg bg-rift-800 border border-rift-600/40 flex items-center justify-center text-rift-300 hover:bg-rift-600 transition-colors"
          >
            <Minus className="w-2.5 h-2.5" />
          </button>
          <input
            type="number"
            min="1"
            max="99"
            value={quantity}
            onChange={(e) => handleFieldChange('quantity', Math.max(1, parseInt(e.target.value) || 1))}
            className="w-8 h-6 text-center text-xs font-mono bg-rift-800 border border-rift-600/40 rounded-lg text-rift-100 focus:outline-none focus:border-gold-500/60"
          />
          <button
            onClick={() => handleFieldChange('quantity', Math.min(99, quantity + 1))}
            className="w-6 h-6 rounded-lg bg-rift-800 border border-rift-600/40 flex items-center justify-center text-rift-300 hover:bg-rift-600 transition-colors"
          >
            <Plus className="w-2.5 h-2.5" />
          </button>
        </div>

        {/* Condition */}
        <select
          value={condition}
          onChange={(e) => handleFieldChange('condition', e.target.value)}
          className="h-6 text-[10px] bg-rift-800 border border-rift-600/40 rounded-lg text-rift-200 px-1.5 focus:outline-none focus:border-gold-500/60 appearance-none cursor-pointer"
        >
          {CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>{c.short}</option>
          ))}
        </select>

        {/* Language */}
        <select
          value={language}
          onChange={(e) => handleFieldChange('language', e.target.value)}
          className="h-6 text-[10px] bg-rift-800 border border-rift-600/40 rounded-lg text-rift-200 px-1.5 focus:outline-none focus:border-gold-500/60 appearance-none cursor-pointer"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.short}</option>
          ))}
        </select>

        {/* Foil toggle */}
        <button
          onClick={() => handleFieldChange('foil', !foil)}
          className={`h-6 w-6 rounded-lg border flex items-center justify-center transition-all flex-shrink-0 ${
            foil
              ? 'bg-purple-500/20 border-purple-400/50 text-purple-400'
              : 'bg-rift-800 border-rift-600/40 text-rift-500'
          }`}
        >
          <Sparkles className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
});

export default ScannerCardRow;
