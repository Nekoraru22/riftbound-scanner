// Domain color mapping for UI
export const DOMAIN_COLORS = {
  Fury: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/40', hex: '#e74c3c' },
  Order: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/40', hex: '#3498db' },
  Growth: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/40', hex: '#2ecc71' },
  Shadow: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/40', hex: '#9b59b6' },
  Wisdom: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/40', hex: '#f39c12' },
};

// Rarity indicators (both cased for card-hashes.json compatibility)
export const RARITY_STYLES = {
  Common: { label: 'C', color: 'text-gray-400' },
  common: { label: 'C', color: 'text-gray-400' },
  Uncommon: { label: 'U', color: 'text-green-400' },
  uncommon: { label: 'U', color: 'text-green-400' },
  Rare: { label: 'R', color: 'text-blue-400' },
  rare: { label: 'R', color: 'text-blue-400' },
  Epic: { label: 'E', color: 'text-purple-400' },
  epic: { label: 'E', color: 'text-purple-400' },
};

// Rare and Epic cards are always foil; Common and Uncommon have both versions
export function isFoilOnly(rarity) {
  const r = (rarity || '').toLowerCase();
  return r === 'rare' || r === 'epic';
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
  { value: 'Spanish', label: 'Español', short: 'SPA' },
  { value: 'French', label: 'Français', short: 'FRE' },
  { value: 'German', label: 'Deutsch', short: 'GER' },
  { value: 'Italian', label: 'Italiano', short: 'ITA' },
  { value: 'Portuguese', label: 'Português', short: 'POR' },
  { value: 'Japanese', label: '日本語', short: 'JPN' },
  { value: 'Korean', label: '한국어', short: 'KOR' },
  { value: 'Chinese', label: '中文', short: 'CHN' },
];
