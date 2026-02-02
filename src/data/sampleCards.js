// Sample card database from RiftBound Origins (OGN) set
// In production, this would be fetched from the Riot Riftbound Content API
// and cached in IndexedDB

export const SETS = {
  OGN: { id: 'OGN', name: 'Origins', totalCards: 298 },
  OGS: { id: 'OGS', name: 'Proving Grounds', totalCards: 24 },
};

export const SAMPLE_CARDS = [
  { id: 'ogn-001-298', name: 'Blazing Scorcher', collectorNumber: '001', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Fury', type: 'Unit', imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/15ed971e4029a92b362a81ccadf309fb81e40b81-744x1039.png' },
  { id: 'ogn-002-298', name: 'Brazen Buccaneer', collectorNumber: '002', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Fury', type: 'Unit', imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/placeholder.png' },
  { id: 'ogn-003-298', name: 'Crimson Disciple', collectorNumber: '003', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Fury', type: 'Unit', imageUrl: '' },
  { id: 'ogn-004-298', name: 'Draven, Glorious Executioner', collectorNumber: '004', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Fury', type: 'Unit', imageUrl: '' },
  { id: 'ogn-005-298', name: 'Ember Maiden', collectorNumber: '005', set: 'OGN', setName: 'Origins', rarity: 'Uncommon', domain: 'Fury', type: 'Unit', imageUrl: '' },
  { id: 'ogn-006-298', name: 'Fiora, Grand Duelist', collectorNumber: '006', set: 'OGN', setName: 'Origins', rarity: 'Rare', domain: 'Fury', type: 'Unit', imageUrl: '' },
  { id: 'ogn-007-298', name: 'Flame Chompers!', collectorNumber: '007', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Fury', type: 'Spell', imageUrl: '' },
  { id: 'ogn-008-298', name: 'Furnace Golem', collectorNumber: '008', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Fury', type: 'Unit', imageUrl: '' },
  { id: 'ogn-009-298', name: 'Get Excited!', collectorNumber: '009', set: 'OGN', setName: 'Origins', rarity: 'Uncommon', domain: 'Fury', type: 'Spell', imageUrl: '' },
  { id: 'ogn-010-298', name: 'Jinx, Loose Cannon', collectorNumber: '010', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Fury', type: 'Unit', imageUrl: '' },
  { id: 'ogn-011-298', name: 'Legion Saboteur', collectorNumber: '011', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Fury', type: 'Unit', imageUrl: '' },
  { id: 'ogn-012-298', name: 'Might of the Vanguard', collectorNumber: '012', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Fury', type: 'Spell', imageUrl: '' },
  { id: 'ogn-013-298', name: 'Noxian Fervor', collectorNumber: '013', set: 'OGN', setName: 'Origins', rarity: 'Rare', domain: 'Fury', type: 'Spell', imageUrl: '' },
  { id: 'ogn-014-298', name: 'Piltover Peacemaker', collectorNumber: '014', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Fury', type: 'Spell', imageUrl: '' },
  { id: 'ogn-015-298', name: 'Reckless Trifarian', collectorNumber: '015', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Fury', type: 'Unit', imageUrl: '' },
  { id: 'ogn-050-298', name: 'Cithria of Cloudfield', collectorNumber: '050', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Order', type: 'Unit', imageUrl: '' },
  { id: 'ogn-051-298', name: 'Garen, Might of Demacia', collectorNumber: '051', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Order', type: 'Unit', imageUrl: '' },
  { id: 'ogn-052-298', name: 'Lux, Lady of Luminosity', collectorNumber: '052', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Order', type: 'Unit', imageUrl: '' },
  { id: 'ogn-100-298', name: 'Teemo, Swift Scout', collectorNumber: '100', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Growth', type: 'Unit', imageUrl: '' },
  { id: 'ogn-101-298', name: 'Sapling Toss', collectorNumber: '101', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Growth', type: 'Spell', imageUrl: '' },
  { id: 'ogn-150-298', name: 'Elise, Spider Queen', collectorNumber: '150', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Shadow', type: 'Unit', imageUrl: '' },
  { id: 'ogn-151-298', name: 'Vile Feast', collectorNumber: '151', set: 'OGN', setName: 'Origins', rarity: 'Common', domain: 'Shadow', type: 'Spell', imageUrl: '' },
  { id: 'ogn-200-298', name: 'Heimerdinger, Revered Inventor', collectorNumber: '200', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Wisdom', type: 'Unit', imageUrl: '' },
  { id: 'ogn-201-298', name: 'Flash of Brilliance', collectorNumber: '201', set: 'OGN', setName: 'Origins', rarity: 'Uncommon', domain: 'Wisdom', type: 'Spell', imageUrl: '' },
  { id: 'ogn-250-298', name: 'Viktor, Machine Herald', collectorNumber: '250', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Wisdom', type: 'Unit', imageUrl: '' },
  { id: 'ogn-260-298', name: 'Lee Sin, Dragon\'s Rage', collectorNumber: '260', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Order', type: 'Unit', imageUrl: '' },
  { id: 'ogn-270-298', name: 'Annie, Fiery', collectorNumber: '270', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Fury', type: 'Unit', imageUrl: '' },
  { id: 'ogn-280-298', name: 'Master Yi, Wuju Bladesman', collectorNumber: '280', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Growth', type: 'Unit', imageUrl: '' },
  { id: 'ogn-290-298', name: 'Kai\'Sa, Daughter of the Void', collectorNumber: '290', set: 'OGN', setName: 'Origins', rarity: 'Epic', domain: 'Shadow', type: 'Unit', imageUrl: '' },
  { id: 'ogn-298-298', name: 'Nexus Blitz', collectorNumber: '298', set: 'OGN', setName: 'Origins', rarity: 'Rare', domain: 'Wisdom', type: 'Spell', imageUrl: '' },
];

// Domain color mapping for UI
export const DOMAIN_COLORS = {
  Fury: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/40', hex: '#e74c3c' },
  Order: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/40', hex: '#3498db' },
  Growth: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/40', hex: '#2ecc71' },
  Shadow: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/40', hex: '#9b59b6' },
  Wisdom: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/40', hex: '#f39c12' },
};

// Rarity indicators
export const RARITY_STYLES = {
  Common: { label: 'C', color: 'text-gray-400' },
  Uncommon: { label: 'U', color: 'text-green-400' },
  Rare: { label: 'R', color: 'text-blue-400' },
  Epic: { label: 'E', color: 'text-purple-400' },
};

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
