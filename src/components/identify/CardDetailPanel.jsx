import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Plus, Minus, CheckSquare, Square, Trash2, Sparkles, Search, X } from 'lucide-react';
import { DOMAIN_COLORS, RARITY_STYLES, isFoilOnly } from '../../data/sampleCards.js';
import { getCardImageUrl, getMatcher } from '../../lib/cardMatcher.js';

/**
 * Build a card data object directly from the match entry.
 * The match entry now contains all card metadata from the JSON.
 */
function resolveCardData(activeMatch) {
  if (!activeMatch) return null;

  return {
    id: activeMatch.id,
    name: activeMatch.name,
    collectorNumber: activeMatch.collectorNumber || String(activeMatch.number || ''),
    code: activeMatch.code,
    set: activeMatch.set,
    setName: activeMatch.setName,
    domain: activeMatch.domain,
    domains: activeMatch.domains,
    rarity: activeMatch.rarity,
    type: activeMatch.type,
    energy: activeMatch.energy,
    might: activeMatch.might,
    tags: activeMatch.tags,
    illustrator: activeMatch.illustrator,
    text: activeMatch.text,
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
  onRemove,
  quantity,
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
  const [localQuantity, setLocalQuantity] = useState(1);
  const [localFoil, setLocalFoil] = useState(false);
  const [localPromo, setLocalPromo] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [manualCard, setManualCard] = useState(null);
  const searchInputRef = useRef(null);

  const matchResult = detection.matchResult;
  const hasMatch = matchResult && matchResult.similarity > 0.55;
  const top3 = matchResult?.top3 || [];

  // The active match is the one selected by the user, or a manually searched card
  const activeMatch = manualCard || top3[selectedMatchIdx] || top3[0];
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
  const foilOnly = cardData ? isFoilOnly(cardData) : false;

  // Reset foil and promo state when active match changes
  useEffect(() => {
    if (cardData) {
      setLocalFoil(isFoilOnly(cardData));
      setLocalPromo(false);
    }
  }, [activeCardId]);

  // Get local card image URL from card ID
  const originalImageUrl = activeMatch?.id ? getCardImageUrl(activeMatch.id) : null;

  const domainStyle = cardData?.domain ? (DOMAIN_COLORS[cardData.domain] || DOMAIN_COLORS.colorless) : null;
  const rarityStyle = cardData?.rarity ? (RARITY_STYLES[cardData.rarity] || RARITY_STYLES.common) : null;

  const confidenceColor = similarity >= 0.9 ? 'text-green-400 bg-green-400/10'
    : similarity >= 0.85 ? 'text-yellow-400 bg-yellow-400/10'
    : 'text-red-400 bg-red-400/10';

  const handleSelectMatch = (matchIdx) => {
    setManualCard(null);
    setSelectedMatchIdx(matchIdx);
  };

  const handleSearchSelect = (card) => {
    setManualCard(card);
    setSearchOpen(false);
    setSearchQuery('');
  };

  // Compute search results (filter all cards by name)
  const searchResults = searchOpen && searchQuery.length >= 2
    ? getMatcher().cards
        .filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
        .slice(0, 8)
    : [];

  // Auto-focus search input when opened and scroll into view
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
      // Small delay to let the mobile keyboard appear, then scroll
      setTimeout(() => {
        searchInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [searchOpen]);

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
      {/* Collapsed header - always visible, tap anywhere to expand */}
      <div
        className="flex items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Color indicator (clickable to match canvas) */}
        {color && (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
            className="w-3 self-stretch flex-shrink-0 transition-opacity hover:opacity-80"
            style={colorStyle}
            title={`Detection #${index + 1} — click to highlight on image`}
          />
        )}

        {/* Checkbox */}
        {hasMatch && onToggleCheck && (
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

        <div
          className={`flex-1 flex items-center gap-3 p-3 ${(!color || !hasMatch || !onToggleCheck) ? 'pl-4' : 'pl-1'}`}
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

          {/* Quantity badge */}
          {quantity > 1 && (
            <span className="text-[10px] font-mono text-rift-300 bg-rift-700/50 px-1.5 py-0.5 rounded-md flex-shrink-0">
              x{quantity}
            </span>
          )}

          {/* Confidence badge */}
          {activeMatch && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-lg flex-shrink-0 ${confidenceColor}`}>
              {activeMatch.sim}%
            </span>
          )}

          <ChevronDown className={`w-4 h-4 text-rift-400 transition-transform flex-shrink-0 ${
            isExpanded ? 'rotate-180' : ''
          }`} />
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 fade-in">
          {/* Side-by-side: detected crop vs original card */}
          <div className="flex items-start justify-center gap-4">
            {cropSrc && (
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-[10px] text-rift-400 uppercase tracking-wider">Detected</p>
                <div className="rounded-xl overflow-hidden border border-rift-600/30 shadow-lg w-[180px] aspect-[744/1039] bg-rift-700">
                  <img src={cropSrc} alt="" className="w-full h-full object-cover" />
                </div>
              </div>
            )}
            {originalImageUrl && (
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-[10px] text-rift-400 uppercase tracking-wider">Original</p>
                <div className="rounded-xl overflow-hidden border border-gold-400/30 shadow-lg w-[180px] aspect-[744/1039] bg-rift-700">
                  <img src={originalImageUrl} alt="" className="w-full h-full object-cover" />
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
                <p className="text-xs text-rift-400">
                  {cardData.setName} ({cardData.set}) · #{cardData.collectorNumber}
                  {cardData.code && <span className="text-rift-400 ml-1">· {cardData.code}</span>}
                </p>
              </div>

              {/* Properties grid */}
              <div className="grid grid-cols-3 gap-2">
                {cardData.domain && (
                  <div className="rounded-xl bg-rift-700/50 p-2.5 text-center">
                    <p className="text-[9px] text-rift-400 uppercase tracking-wider mb-1">
                      {cardData.domains && cardData.domains.length > 1 ? 'Domains' : 'Domain'}
                    </p>
                    {cardData.domains && cardData.domains.length > 1 ? (
                      <div className="flex items-center justify-center gap-1 min-h-[18px]">
                        {cardData.domains.map((d, i) => {
                          const ds = DOMAIN_COLORS[d] || DOMAIN_COLORS.colorless;
                          return (
                            <div key={i} className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ds.hex }} title={d} />
                              <span className={`text-[10px] font-semibold ${ds.text}`}>{d}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1.5 min-h-[18px]">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: domainStyle?.hex }} title={cardData.domain} />
                        <span className={`text-xs font-semibold ${domainStyle?.text || 'text-rift-200'}`}>
                          {cardData.domain}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <div className="rounded-xl bg-rift-700/50 p-2.5 text-center">
                  <p className="text-[9px] text-rift-400 uppercase tracking-wider mb-1">Rarity</p>
                  <div className="min-h-[18px] flex items-center justify-center">
                    <span className={`text-xs font-semibold ${rarityStyle?.color || 'text-rift-200'}`}>
                      {cardData.rarity}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl bg-rift-700/50 p-2.5 text-center">
                  <p className="text-[9px] text-rift-400 uppercase tracking-wider mb-1">Type</p>
                  <div className="min-h-[18px] flex items-center justify-center">
                    <span className="text-xs font-semibold text-rift-200">
                      {cardData.type}
                    </span>
                  </div>
                </div>
              </div>

              {/* Energy / Might stats */}
              {(cardData.energy != null || cardData.might != null) && (
                <div className="flex gap-2">
                  {cardData.energy != null && (
                    <div className="flex items-center gap-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1.5">
                      <span className="text-[9px] text-cyan-400 uppercase tracking-wider">Energy</span>
                      <span className="text-sm font-bold text-cyan-300">{cardData.energy}</span>
                    </div>
                  )}
                  {cardData.might != null && (
                    <div className="flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-2.5 py-1.5">
                      <span className="text-[9px] text-red-400 uppercase tracking-wider">Might</span>
                      <span className="text-sm font-bold text-red-300">{cardData.might}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Card text */}
              {cardData.text && (
                <div className="rounded-xl bg-rift-700/30 p-3">
                  <p className="text-[9px] text-rift-400 uppercase tracking-wider mb-1">Card Text</p>
                  <div className="h-[72px] overflow-y-auto">
                    <p className="text-xs text-rift-200 leading-relaxed" dangerouslySetInnerHTML={{ __html: cardData.text }} />
                  </div>
                </div>
              )}

              {/* Tags */}
              {cardData.tags && cardData.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-[52px] overflow-y-auto">
                  {cardData.tags.map((tag, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-rift-700/50 text-rift-300 border border-rift-600/30">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Illustrator */}
              {cardData.illustrator && (
                <p className="text-[10px] text-rift-400">
                  Illustrated by <span className="text-rift-300">{cardData.illustrator}</span>
                </p>
              )}

              {/* Confidence bar */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-rift-400 uppercase tracking-wider">Confidence</span>
                  <span className={`text-xs font-bold ${
                    similarity >= 0.9 ? 'text-green-400' :
                    similarity >= 0.85 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {(similarity * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-rift-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      similarity >= 0.9 ? 'bg-gradient-to-r from-green-500 to-green-400' :
                      similarity >= 0.85 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
                      'bg-gradient-to-r from-red-500 to-red-400'
                    }`}
                    style={{ width: `${similarity * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Search button when there's only 1 match */}
          {top3.length <= 1 && !searchOpen && !manualCard && cardData && (
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] text-rift-400 hover:text-rift-200 bg-rift-700/30 hover:bg-rift-700/50 border border-transparent hover:border-rift-600/30 transition-all"
            >
              <Search className="w-3 h-3" />
              Wrong card? Search manually
            </button>
          )}

          {/* Top 3 matches + search */}
          {top3.length > 1 && !searchOpen && !manualCard && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-rift-400 uppercase tracking-wider">
                  Best matches — tap to change
                </p>
                <button
                  onClick={() => setSearchOpen(true)}
                  className="text-[10px] text-rift-400 hover:text-rift-200 flex items-center gap-1 transition-colors"
                >
                  <Search className="w-3 h-3" />
                  Search
                </button>
              </div>
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

          {/* Manual card selected — show reset link */}
          {manualCard && !searchOpen && (
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-amber-400">
                Manually selected
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSearchOpen(true)}
                  className="text-[10px] text-rift-400 hover:text-rift-200 flex items-center gap-1 transition-colors"
                >
                  <Search className="w-3 h-3" />
                  Search again
                </button>
                <button
                  onClick={() => setManualCard(null)}
                  className="text-[10px] text-rift-400 hover:text-rift-200 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {/* Search panel */}
          {searchOpen && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rift-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search card name..."
                    className="w-full h-8 pl-8 pr-3 text-xs bg-rift-700 border border-rift-600/40 rounded-lg text-rift-100 placeholder-rift-400 focus:outline-none focus:border-gold-500/60"
                  />
                </div>
                <button
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                  className="w-8 h-8 rounded-lg bg-rift-700 border border-rift-600/40 flex items-center justify-center text-rift-400 hover:text-rift-200 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="max-h-[120px] sm:max-h-[200px] overflow-y-auto space-y-1 rounded-lg bg-rift-700/30 p-1.5">
                  {searchResults.map((card) => {
                    const ds = DOMAIN_COLORS[card.domain] || DOMAIN_COLORS.colorless;
                    return (
                      <button
                        key={card.id}
                        onClick={() => handleSearchSelect(card)}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left bg-rift-800/50 hover:bg-rift-600/50 transition-colors"
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ds.hex }} />
                        <span className="text-xs text-rift-100 truncate flex-1">{card.name}</span>
                        <span className="text-[10px] text-rift-400 flex-shrink-0">[{card.set}]</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {searchQuery.length >= 2 && searchResults.length === 0 && (
                <p className="text-[10px] text-rift-400 text-center py-2">No cards found</p>
              )}
              {searchQuery.length < 2 && (
                <p className="text-[10px] text-rift-400 text-center py-2">Type at least 2 characters</p>
              )}
            </div>
          )}

          {/* Quantity, Foil & Promo controls */}
          {cardData && (
            <div className="flex items-center gap-3">
              {/* Quantity */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-rift-400 uppercase tracking-wider mr-1">Qty</span>
                <button
                  onClick={() => setLocalQuantity(q => Math.max(1, q - 1))}
                  className="w-7 h-7 rounded-lg bg-rift-700 border border-rift-600/40 flex items-center justify-center text-rift-300 hover:bg-rift-600 transition-colors"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={localQuantity}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v)) setLocalQuantity(Math.min(99, Math.max(1, v)));
                  }}
                  className="w-10 h-7 text-center text-xs font-mono bg-rift-700 border border-rift-600/40 rounded-lg text-rift-100 focus:outline-none focus:border-gold-500/60"
                />
                <button
                  onClick={() => setLocalQuantity(q => Math.min(99, q + 1))}
                  className="w-7 h-7 rounded-lg bg-rift-700 border border-rift-600/40 flex items-center justify-center text-rift-300 hover:bg-rift-600 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              {/* Foil toggle */}
              <button
                onClick={() => !foilOnly && setLocalFoil(f => !f)}
                disabled={foilOnly}
                title={foilOnly ? 'Always foil (Rare/Epic)' : localFoil ? 'Foil' : 'Standard'}
                className={`h-7 min-w-[90px] rounded-lg border flex items-center justify-center gap-1 transition-all px-2.5 ${
                  localFoil || foilOnly
                    ? 'bg-purple-500/20 border-purple-400/50 text-purple-400 hover:bg-purple-500/30'
                    : 'bg-rift-700 border-rift-600/40 text-rift-500 hover:bg-rift-600 hover:text-rift-300'
                } ${foilOnly ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-[10px] font-medium leading-none">{localFoil || foilOnly ? 'Foil' : 'Standard'}</span>
              </button>

              {/* Promo toggle */}
              <button
                onClick={() => setLocalPromo(p => !p)}
                title={localPromo ? 'Promo' : 'Standard'}
                className={`h-7 min-w-[90px] rounded-lg border flex items-center justify-center transition-all px-2.5 text-[10px] font-medium cursor-pointer ${
                  localPromo
                    ? 'bg-amber-500/20 border-amber-400/50 text-amber-400 hover:bg-amber-500/30'
                    : 'bg-rift-700 border-rift-600/40 text-rift-500 hover:bg-rift-600 hover:text-rift-300'
                }`}
              >
                {localPromo ? 'Promo' : 'Standard'}
              </button>
            </div>
          )}

          {/* Action buttons */}
          {cardData && (
            <div className="flex gap-2">
              <button
                onClick={() => onAddToScanner({ cardData, quantity: localQuantity, foil: localFoil || foilOnly, promo: localPromo })}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all btn-primary"
              >
                <Plus className="w-4 h-4" />
                Add to collection
              </button>
              {onRemove && (
                <button
                  onClick={onRemove}
                  className="py-2.5 px-4 rounded-xl text-sm font-medium flex items-center justify-center transition-all btn-ghost text-red-400 hover:text-red-300 hover:bg-red-400/10 border border-red-400/20"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* No match message */}
          {!hasMatch && (
            <div className="text-center py-2">
              <p className="text-xs text-rift-400">
                No reliable match found for this detection.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
