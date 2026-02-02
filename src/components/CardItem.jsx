import React, { memo } from 'react';
import { Trash2, Plus, Minus, Sparkles } from 'lucide-react';
import { CONDITIONS, LANGUAGES, DOMAIN_COLORS, RARITY_STYLES } from '../data/sampleCards.js';

const CardItem = memo(function CardItem({
  card,
  index,
  onUpdate,
  onRemove,
}) {
  const { cardData, quantity, condition, language, foil } = card;
  const domainStyle = DOMAIN_COLORS[cardData.domain] || DOMAIN_COLORS.Fury;
  const rarityStyle = RARITY_STYLES[cardData.rarity] || RARITY_STYLES.Common;

  const handleFieldChange = (field, value) => {
    onUpdate(index, { ...card, [field]: value });
  };

  return (
    <div className="card-entry fade-in group">
      {/* Card header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {/* Domain color indicator */}
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: domainStyle.hex }}
            />
            {/* Rarity badge */}
            <span className={`text-[10px] font-mono font-bold ${rarityStyle.color}`}>
              {rarityStyle.label}
            </span>
            {/* Collector number */}
            <span className="text-[10px] font-mono text-rift-400">
              #{cardData.collectorNumber}
            </span>
          </div>

          {/* Card name */}
          <h4 className="text-sm font-semibold text-rift-100 truncate leading-tight">
            {cardData.name}
          </h4>

          <p className="text-[11px] text-rift-400 mt-0.5">
            {cardData.setName} · {cardData.type}
          </p>
        </div>

        {/* Remove button */}
        <button
          onClick={() => onRemove(index)}
          className="p-1.5 rounded-md text-rift-500 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
          title="Eliminar"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Editable fields */}
      <div className="grid grid-cols-2 gap-2">
        {/* Quantity */}
        <div>
          <label className="text-[10px] font-body text-rift-500 uppercase tracking-wider mb-0.5 block">
            Cantidad
          </label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleFieldChange('quantity', Math.max(1, quantity - 1))}
              className="w-7 h-7 rounded-md bg-rift-800 border border-rift-600/40 flex items-center justify-center text-rift-300 hover:bg-rift-700 hover:border-rift-500/40 transition-colors"
            >
              <Minus className="w-3 h-3" />
            </button>
            <input
              type="number"
              min="1"
              max="99"
              value={quantity}
              onChange={(e) => handleFieldChange('quantity', Math.max(1, parseInt(e.target.value) || 1))}
              className="w-10 h-7 text-center text-sm font-mono bg-rift-800 border border-rift-600/40 rounded-md text-rift-100 focus:outline-none focus:border-gold-500/60"
            />
            <button
              onClick={() => handleFieldChange('quantity', Math.min(99, quantity + 1))}
              className="w-7 h-7 rounded-md bg-rift-800 border border-rift-600/40 flex items-center justify-center text-rift-300 hover:bg-rift-700 hover:border-rift-500/40 transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Foil toggle */}
        <div>
          <label className="text-[10px] font-body text-rift-500 uppercase tracking-wider mb-0.5 block">
            Foil
          </label>
          <button
            onClick={() => handleFieldChange('foil', !foil)}
            className={`h-7 w-full rounded-md border flex items-center justify-center gap-1.5 text-xs font-medium transition-all ${
              foil
                ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 border-purple-400/50 text-purple-300'
                : 'bg-rift-800 border-rift-600/40 text-rift-400'
            }`}
          >
            <Sparkles className={`w-3 h-3 ${foil ? 'text-purple-400' : ''}`} />
            {foil ? 'Sí' : 'No'}
          </button>
        </div>

        {/* Condition */}
        <div>
          <label className="text-[10px] font-body text-rift-500 uppercase tracking-wider mb-0.5 block">
            Estado
          </label>
          <select
            value={condition}
            onChange={(e) => handleFieldChange('condition', e.target.value)}
            className="select-field h-7 text-xs py-0"
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.short}</option>
            ))}
          </select>
        </div>

        {/* Language */}
        <div>
          <label className="text-[10px] font-body text-rift-500 uppercase tracking-wider mb-0.5 block">
            Idioma
          </label>
          <select
            value={language}
            onChange={(e) => handleFieldChange('language', e.target.value)}
            className="select-field h-7 text-xs py-0"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
});

export default CardItem;
