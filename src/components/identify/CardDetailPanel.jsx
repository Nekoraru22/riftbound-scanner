import React, { useState, useEffect } from 'react';
import { ChevronDown, Plus, CheckSquare, Square } from 'lucide-react';
import { DOMAIN_COLORS, RARITY_STYLES } from '../../data/sampleCards.js';
import { getCardImageUrl } from '../../lib/cardMatcher.js';

/**
 * Build a card data object directly from the match entry.
 * The match entry now contains all card metadata from the JSON.
 */
function resolveCardData(activeMatch) {
  if (!activeMatch) return null;

  return {
    id: activeMatch.id,
    name: activeMatch.name,
    collectorNumber: activeMatch.collectorNumber,
    set: activeMatch.set,
    setName: activeMatch.setName,
    domain: activeMatch.domain,
    rarity: activeMatch.rarity,
    type: activeMatch.type,
  };
}

export default function CardDetailPanel({
  detection,
  index,
  onAddToScanner,
  isChecked,
  onToggleCheck,
  onMatchChange,
  color,
  isSelected,
  onSelect,
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-expand when selected from canvas click
  useEffect(() => {
    if (isSelected && !isExpanded) {
      setIsExpanded(true);
    }
  }, [isSelected]);
  const [cropSrc, setCropSrc] = useState(null);
  const [selectedMatchIdx, setSelectedMatchIdx] = useState(0);

  const matchResult = detection.matchResult;
  const hasMatch = matchResult && matchResult.similarity > 0.55;
  const top3 = matchResult?.top3 || [];

  // The active match is the one selected by the user (defaults to #1)
  const activeMatch = top3[selectedMatchIdx] || top3[0];
  const similarity = activeMatch ? activeMatch.similarity : 0;
  const activeCardId = activeMatch?.id;

  // Convert cropCanvas to data URL
  useEffect(() => {
    if (detection.cropCanvas) {
      setCropSrc(detection.cropCanvas.toDataURL('image/jpeg', 0.85));
    }
  }, [detection.cropCanvas]);

  // Notify parent when selected match changes
  useEffect(() => {
    if (activeCardId && onMatchChange) {
      onMatchChange(index, activeCardId);
    }
  }, [activeCardId, index]);

  // Resolve card data directly from match entry (contains all metadata)
  const cardData = resolveCardData(activeMatch);

  // Get local card image URL from card ID
  const originalImageUrl = activeMatch?.id ? getCardImageUrl(activeMatch.id) : null;

  const domainStyle = cardData?.domain ? (DOMAIN_COLORS[cardData.domain] || DOMAIN_COLORS.Fury) : null;
  const rarityStyle = cardData?.rarity ? (RARITY_STYLES[cardData.rarity] || RARITY_STYLES.Common) : null;

  const confidenceColor = similarity >= 0.85 ? 'text-green-400 bg-green-400/10'
    : 'text-yellow-400 bg-yellow-400/10';

  const handleSelectMatch = (matchIdx) => {
    setSelectedMatchIdx(matchIdx);
  };

  // Build color style from prop
  const colorStyle = color
    ? { backgroundColor: `rgb(${color.r}, ${color.g}, ${color.b})` }
    : { backgroundColor: '#888' };
  const borderColorStyle = color
    ? `rgba(${color.r}, ${color.g}, ${color.b}, ${isSelected ? 0.7 : 0.3})`
    : 'rgba(136, 136, 136, 0.3)';

  return (
    <div
      className={`rounded-2xl border-2 transition-all duration-200 overflow-hidden ${
        isExpanded
          ? 'bg-rift-800/80'
          : 'bg-rift-800/50'
      }`}
      style={{ borderColor: borderColorStyle }}
    >
      {/* Collapsed header - always visible */}
      <div className="flex items-center">
        {/* Color indicator (clickable to match canvas) */}
        <button
          onClick={onSelect}
          className="w-3 self-stretch flex-shrink-0 transition-opacity hover:opacity-80"
          style={colorStyle}
          title={`Detection #${index + 1} — click to highlight on image`}
        />

        {/* Checkbox */}
        {hasMatch && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleCheck(); }}
            className="pl-2 pr-1 py-3 flex-shrink-0"
          >
            {isChecked ? (
              <CheckSquare className="w-4 h-4 text-gold-400" />
            ) : (
              <Square className="w-4 h-4 text-rift-500" />
            )}
          </button>
        )}

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex-1 flex items-center gap-3 p-3 text-left ${!hasMatch ? 'pl-4' : 'pl-1'}`}
        >
          {/* Thumbnails: detected crop + original card */}
          <div className="flex gap-1.5 flex-shrink-0">
            {cropSrc && (
              <div className="w-9 h-12 rounded-lg overflow-hidden bg-rift-700 border border-rift-600/30">
                <img src={cropSrc} alt="Detected" className="w-full h-full object-cover" />
              </div>
            )}
            {originalImageUrl && (
              <div className="w-9 h-12 rounded-lg overflow-hidden bg-rift-700 border border-gold-400/40">
                <img src={originalImageUrl} alt="Original" className="w-full h-full object-cover" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-rift-100 truncate">
              {activeMatch ? activeMatch.name : `Detection #${index + 1}`}
            </p>
            {cardData && (
              <p className="text-[10px] text-rift-400 truncate">
                {cardData.set} · #{cardData.collectorNumber}
              </p>
            )}
          </div>

          {/* Confidence badge */}
          {activeMatch && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg flex-shrink-0 ${confidenceColor}`}>
              {activeMatch.sim}%
            </span>
          )}

          <ChevronDown className={`w-4 h-4 text-rift-400 transition-transform flex-shrink-0 ${
            isExpanded ? 'rotate-180' : ''
          }`} />
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 fade-in">
          {/* Side-by-side: detected crop vs original card */}
          <div className="flex items-start justify-center gap-4">
            {cropSrc && (
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-[10px] text-rift-500 uppercase tracking-wider">Detected</p>
                <div className="rounded-xl overflow-hidden border border-rift-600/30 shadow-lg w-[180px]">
                  <img src={cropSrc} alt="" className="w-full h-auto" />
                </div>
              </div>
            )}
            {originalImageUrl && (
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-[10px] text-rift-500 uppercase tracking-wider">Original</p>
                <div className="rounded-xl overflow-hidden border border-gold-400/30 shadow-lg w-[180px]">
                  <img src={originalImageUrl} alt="" className="w-full h-auto" />
                </div>
              </div>
            )}
          </div>

          {/* Card details */}
          {cardData && (
            <div className="space-y-3">
              {/* Name and set */}
              <div>
                <h3 className="text-base font-bold text-rift-100">{cardData.name}</h3>
                <p className="text-xs text-rift-400">{cardData.setName} ({cardData.set}) · #{cardData.collectorNumber}</p>
              </div>

              {/* Properties grid — only when metadata is available */}
              {cardData.domain && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-rift-700/50 p-2.5 text-center">
                    <p className="text-[9px] text-rift-500 uppercase tracking-wider mb-1">Domain</p>
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: domainStyle?.hex }} />
                      <span className={`text-xs font-semibold ${domainStyle?.text || 'text-rift-200'}`}>
                        {cardData.domain}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-rift-700/50 p-2.5 text-center">
                    <p className="text-[9px] text-rift-500 uppercase tracking-wider mb-1">Rarity</p>
                    <span className={`text-xs font-semibold ${rarityStyle?.color || 'text-rift-200'}`}>
                      {cardData.rarity}
                    </span>
                  </div>
                  <div className="rounded-xl bg-rift-700/50 p-2.5 text-center">
                    <p className="text-[9px] text-rift-500 uppercase tracking-wider mb-1">Type</p>
                    <span className="text-xs font-semibold text-rift-200">
                      {cardData.type}
                    </span>
                  </div>
                </div>
              )}

              {/* Confidence bar */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-rift-500 uppercase tracking-wider">Confidence</span>
                  <span className={`text-xs font-bold ${
                    similarity >= 0.85 ? 'text-green-400' : 'text-yellow-400'
                  }`}>
                    {(similarity * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-rift-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      similarity >= 0.85 ? 'bg-gradient-to-r from-green-500 to-green-400' :
                      'bg-gradient-to-r from-yellow-500 to-yellow-400'
                    }`}
                    style={{ width: `${similarity * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Top 3 matches - clickable to switch */}
          {top3.length > 0 && (
            <div>
              <p className="text-[10px] text-rift-500 uppercase tracking-wider mb-2">
                Best matches — tap to change
              </p>
              <div className="space-y-1.5">
                {top3.map((match, i) => {
                  const isActive = i === selectedMatchIdx;
                  return (
                    <button
                      key={i}
                      onClick={() => handleSelectMatch(i)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl transition-all text-left ${
                        isActive
                          ? 'bg-gold-400/10 border border-gold-400/30'
                          : 'bg-rift-700/30 border border-transparent hover:bg-rift-700/50'
                      }`}
                    >
                      <span className={`text-[10px] font-mono w-4 ${isActive ? 'text-gold-400' : 'text-rift-500'}`}>
                        #{i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs truncate ${isActive ? 'text-gold-300 font-semibold' : 'text-rift-200'}`}>
                            {match.name}
                          </span>
                          <span className="text-[10px] text-rift-500">[{match.set}]</span>
                        </div>
                        <div className="h-1 rounded-full bg-rift-700 overflow-hidden mt-0.5">
                          <div
                            className={`h-full rounded-full ${isActive ? 'bg-gold-400/70' : 'bg-rift-400/40'}`}
                            style={{ width: `${match.sim}%` }}
                          />
                        </div>
                      </div>
                      <span className={`text-[10px] font-mono flex-shrink-0 w-10 text-right ${
                        isActive ? 'text-gold-400 font-bold' : 'text-rift-400'
                      }`}>
                        {match.sim}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add to scanner button */}
          {cardData && (
            <button
              onClick={() => onAddToScanner(cardData)}
              className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all btn-primary"
            >
              <Plus className="w-4 h-4" />
              Add to scanner
            </button>
          )}

          {/* No match message */}
          {!hasMatch && (
            <div className="text-center py-2">
              <p className="text-xs text-rift-500">
                No reliable match found for this detection.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
