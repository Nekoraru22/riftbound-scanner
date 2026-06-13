/**
 * Shared CSV helpers used by every export format.
 */

/**
 * Escape a CSV field (handle commas, quotes, newlines).
 *
 * @param {*} value - Raw cell value, coerced to string.
 * @returns {string} CSV-safe field.
 */
export function escapeCSV(value) {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

/**
 * Title-case a single word ("MONSTER" -> "Monster").
 *
 * @param {*} value
 * @returns {string}
 */
export function titleCase(value) {
  if (!value) return '';
  return String(value).charAt(0).toUpperCase() + String(value).slice(1).toLowerCase();
}

/**
 * Shape of a scanned card passed to a format's `generate(cards)`:
 *
 * @typedef {Object} ScannedCard
 * @property {{ name: string, collectorNumber: string, set: string, setName?: string,
 *             domain?: string, domains?: string[], type?: string, rarity?: string }} cardData
 * @property {number} quantity
 * @property {string} [condition]
 * @property {string} [language]
 * @property {boolean} [foil]
 * @property {boolean} [promo]
 */

/**
 * Shape every format module must default-export:
 *
 * @typedef {Object} ExportFormat
 * @property {string} id              Stable identifier (e.g. "riftmana").
 * @property {string} label           Human-readable name shown in the export menu.
 * @property {string} description     Short column hint shown under the label.
 * @property {string} filenameSuffix  Appended to the download filename (e.g. "-riftmana").
 * @property {(cards: ScannedCard[]) => string} generate  Builds the CSV string.
 */
