/**
 * CardNexus / PowerTools export format.
 *
 * Columns: Quantity, Card Name, Collector Number, Expansion, Condition, Language,
 *          Finish, Runes, Type, Rarity
 *
 * Notes:
 *   - Collector Number is a STRING to preserve leading zeros (e.g. "009"); the "*"
 *     star marker is stripped because CardNexus does not use it.
 *   - Defaults: condition "Near Mint", language "English".
 *   - Promo cards export under the "OGNX" expansion.
 *   - Runes are the card's domain(s), title-cased and "/"-joined (e.g. "Fury/Order").
 */

import { escapeCSV, titleCase } from './csvUtils.js';

const HEADERS = [
  'Quantity',
  'Card Name',
  'Collector Number',
  'Expansion',
  'Condition',
  'Language',
  'Finish',
  'Runes',
  'Type',
  'Rarity',
];

function formatRunes(cardData) {
  let list = [];
  if (Array.isArray(cardData?.domains) && cardData.domains.length > 0) {
    list = cardData.domains;
  } else if (cardData?.domain) {
    list = [cardData.domain];
  }
  return list.map(titleCase).join('/');
}

/**
 * @param {import('./csvUtils.js').ScannedCard[]} cards
 * @returns {string} CSV content
 */
function generate(cards) {
  const lines = [HEADERS.join(',')];

  for (const card of cards) {
    const exportName = card.cardData.name;
    const exportCollector = (card.cardData.collectorNumber || '').replaceAll('*', '');
    const exportSet = card.promo ? 'OGNX' : (card.cardData.set || 'OGN');

    const row = [
      card.quantity || 1,
      escapeCSV(exportName),
      escapeCSV(exportCollector),
      escapeCSV(exportSet),
      escapeCSV(card.condition || 'Near Mint'),
      escapeCSV(card.language || 'English'),
      card.foil ? 'Foil' : 'Standard',
      escapeCSV(formatRunes(card.cardData)),
      escapeCSV(titleCase(card.cardData.type)),
      escapeCSV(titleCase(card.cardData.rarity)),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\r\n');
}

/** @type {import('./csvUtils.js').ExportFormat} */
export default {
  id: 'cardnexus',
  label: 'CardNexus / PowerTools',
  description: 'Quantity, Name, Set, Condition…',
  filenameSuffix: '',
  generate,
};
