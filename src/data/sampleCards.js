// Domain color mapping for UI (matches lowercase domain IDs from the card database)
export const DOMAIN_COLORS = {
  fury:      { bg: 'bg-red-500/20',    text: 'text-red-400',    border: 'border-red-500/40',    hex: '#e74c3c' },
  order:     { bg: 'bg-blue-500/20',   text: 'text-blue-400',   border: 'border-blue-500/40',   hex: '#3498db' },
  chaos:     { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/40', hex: '#e67e22' },
  calm:      { bg: 'bg-cyan-500/20',   text: 'text-cyan-400',   border: 'border-cyan-500/40',   hex: '#00bcd4' },
  mind:      { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/40', hex: '#9b59b6' },
  body:      { bg: 'bg-green-500/20',  text: 'text-green-400',  border: 'border-green-500/40',  hex: '#2ecc71' },
  colorless: { bg: 'bg-gray-500/20',   text: 'text-gray-400',   border: 'border-gray-500/40',   hex: '#95a5a6' },
};

// Rarity indicators (lowercase keys match card-hashes.json values)
export const RARITY_STYLES = {
  common:   { label: 'C', color: 'text-gray-400' },
  uncommon: { label: 'U', color: 'text-green-400' },
  rare:     { label: 'R', color: 'text-blue-400' },
  epic:     { label: 'E', color: 'text-purple-400' },
  showcase: { label: 'S', color: 'text-amber-400' },
};

// Determines if a card is exclusively foil (no standard version exists)
export function isFoilOnly(card) {
  const rarity = (card.rarity || '').toLowerCase();
  const id = (card.id || '').toLowerCase();
  const code = (card.code || '');
  const collectorNumber = card.collectorNumber || '';

  // Star variants are always foil (id: "ogn-309-star-298", code: "OGN-309*/298")
  if (id.includes('star') || code.includes('*')) {
    return true;
  }

  // Overnumbered cards (collector number > set total) are showcase/foil
  const codeParts = code.split('/');
  if (codeParts.length === 2) {
    const num = parseInt(collectorNumber.replace(/\D/g, '')) || 0;
    const total = parseInt(codeParts[1]) || 0;
    if (num > 0 && total > 0 && num > total) {
      return true;
    }
  }

  // These rarities are exclusively foil
  const foilOnlyRarities = ['rare', 'epic', 'legendary', 'showcase', 'legend'];
  return foilOnlyRarities.includes(rarity);
}

// Condition options for CardNexus/PowerTools
export const CONDITIONS = [
  { value: 'Near Mint', label: 'Near Mint (NM)', short: 'NM' },
  { value: 'Lightly Played', label: 'Lightly Played (LP)', short: 'LP' },
  { value: 'Moderately Played', label: 'Moderately Played (MP)', short: 'MP' },
  { value: 'Heavily Played', label: 'Heavily Played (HP)', short: 'HP' },
  { value: 'Damaged', label: 'Damaged (D)', short: 'D' },
];

// Language options
export const LANGUAGES = [
  { value: 'English', label: 'English', short: 'ENG' },
  { value: 'Chinese', label: 'Chinese', short: 'CN' },
];
