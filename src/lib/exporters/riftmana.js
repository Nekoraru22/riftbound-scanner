/**
 * Riftmana deckbuilder import format.
 *
 * Columns: Card ID, Normal, Foil
 *
 * Notes:
 *   - Card ID is `${set}-${collectorNumber}` (e.g. "OGN-001", "OGN-003a", "OGN-299*").
 *     The collector number is kept verbatim, so letter suffixes and "*" star variants
 *     are preserved (unlike the CardNexus format, which strips the "*").
 *   - Cards are grouped by Card ID; Normal/Foil hold the summed copy counts so a card
 *     scanned as both standard and foil collapses into a single row.
 *   - Promo cards export under the "OGNX" set, matching the CardNexus convention.
 */

import { escapeCSV } from './csvUtils.js';

const HEADERS = ['Card ID', 'Normal', 'Foil'];

/**
 * @param {import('./csvUtils.js').ScannedCard[]} cards
 * @returns {string} CSV content
 */
function generate(cards) {
  const byId = new Map();

  for (const card of cards) {
    const set = card.promo ? 'OGNX' : (card.cardData.set || 'OGN');
    const collector = card.cardData.collectorNumber || '';
    const cardId = `${set}-${collector}`;
    const qty = card.quantity || 1;

    let entry = byId.get(cardId);
    if (!entry) {
      entry = { normal: 0, foil: 0 };
      byId.set(cardId, entry);
    }
    if (card.foil) entry.foil += qty;
    else entry.normal += qty;
  }

  const lines = [HEADERS.join(',')];
  for (const [cardId, { normal, foil }] of byId) {
    lines.push([escapeCSV(cardId), normal, foil].join(','));
  }

  return lines.join('\r\n');
}

/** @type {import('./csvUtils.js').ExportFormat} */
export default {
  id: 'riftmana',
  label: 'Riftmana',
  description: 'Card ID, Normal, Foil',
  filenameSuffix: '-riftmana',
  generate,
};
