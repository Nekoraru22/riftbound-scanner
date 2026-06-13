/**
 * Export format registry.
 *
 * To add a new export format:
 *   1. Create `./<name>.js` that default-exports an ExportFormat descriptor
 *      (see the `ExportFormat` typedef in `./csvUtils.js`).
 *   2. Import it below and add it to `EXPORT_FORMATS`.
 * The export menu in the Collection tab is rendered from this list, so it picks
 * up new formats automatically.
 */

import cardnexus from './cardnexus.js';
import riftmana from './riftmana.js';

/**
 * Ordered list of available formats. Also drives the export menu UI.
 * @type {import('./csvUtils.js').ExportFormat[]}
 */
export const EXPORT_FORMATS = [cardnexus, riftmana];

/** Default format id used when none is specified. */
export const DEFAULT_FORMAT = cardnexus.id;

const FORMAT_BY_ID = new Map(EXPORT_FORMATS.map((f) => [f.id, f]));

/**
 * Resolve a format by id, falling back to the default for unknown ids.
 * @param {string} formatId
 * @returns {import('./csvUtils.js').ExportFormat}
 */
export function getFormat(formatId) {
  return FORMAT_BY_ID.get(formatId) || FORMAT_BY_ID.get(DEFAULT_FORMAT);
}

/**
 * Generate CSV content for the given format.
 * @param {import('./csvUtils.js').ScannedCard[]} cards
 * @param {string} [formatId]
 * @returns {string}
 */
export function generateCSV(cards, formatId = DEFAULT_FORMAT) {
  return getFormat(formatId).generate(cards);
}

/**
 * Trigger a CSV download in the browser.
 * @param {import('./csvUtils.js').ScannedCard[]} cards
 * @param {string} [formatId]
 * @param {string|null} [filename]
 * @returns {boolean} true if a download was triggered
 */
export function downloadCSV(cards, formatId = DEFAULT_FORMAT, filename = null) {
  if (!cards || cards.length === 0) {
    console.warn('[CSV] No cards to export');
    return false;
  }

  const format = getFormat(formatId);
  const csvContent = format.generate(cards);

  // Use BOM for proper UTF-8 encoding in Excel
  const BOM = '﻿';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().slice(0, 10);
  const finalFilename = filename || `riftbound-scan${format.filenameSuffix}-${timestamp}.csv`;

  // Create download link
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = finalFilename;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();

  // Cleanup
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 100);

  return true;
}

/**
 * Generate a preview of the CSV content (first N rows).
 * @param {import('./csvUtils.js').ScannedCard[]} cards
 * @param {string} [formatId]
 * @param {number} [maxRows]
 * @returns {string}
 */
export function previewCSV(cards, formatId = DEFAULT_FORMAT, maxRows = 5) {
  return generateCSV(cards.slice(0, maxRows), formatId);
}

/**
 * Validate that all required fields are present. Shared across formats: every
 * format keys off the card name, collector number, and quantity.
 * @param {import('./csvUtils.js').ScannedCard[]} cards
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateForExport(cards) {
  const errors = [];

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card.cardData?.name) {
      errors.push(`Row ${i + 1}: Missing card name`);
    }
    if (!card.cardData?.collectorNumber) {
      errors.push(`Row ${i + 1}: Missing collector number`);
    }
    if (!card.quantity || card.quantity < 1) {
      errors.push(`Row ${i + 1}: Invalid quantity`);
    }
  }

  return { valid: errors.length === 0, errors };
}
