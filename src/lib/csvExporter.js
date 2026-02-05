/**
 * CSV Exporter for CardNexus / PowerTools format
 *
 * Generates a .csv file with the exact columns required:
 *   Quantity, Card Name, Collector Number, Expansion, Condition, Language, Foil
 *
 * IMPORTANT:
 *   - Collector Number is treated as STRING to preserve leading zeros (e.g., "009")
 *   - Default condition: "Near Mint"
 *   - Default language: "English"
 */

const CSV_HEADERS = [
  'Quantity',
  'Card Name',
  'Collector Number',
  'Expansion',
  'Condition',
  'Language',
  'Finish',
];

/**
 * Escape a CSV field (handle commas, quotes, newlines)
 */
function escapeCSV(value) {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate CSV content from scanned cards
 *
 * @param {Array<ScannedCard>} cards - Array of scanned cards with metadata
 * @returns {string} CSV content as string
 *
 * ScannedCard shape:
 * {
 *   cardData: { name, collectorNumber, set, setName },
 *   quantity: number,
 *   condition: string,
 *   language: string,
 *   foil: boolean,
 * }
 */
export function generateCSV(cards) {
  const lines = [CSV_HEADERS.join(',')];

  for (const card of cards) {
    const row = [
      card.quantity || 1,
      escapeCSV(card.cardData.name),
      // CRITICAL: Collector number as string with leading zeros preserved
      escapeCSV(card.cardData.collectorNumber),
      escapeCSV(card.cardData.set || 'OGN'),
      escapeCSV(card.condition || 'Near Mint'),
      escapeCSV(card.language || 'English'),
      card.foil ? 'Foil' : 'Standard',
    ];
    lines.push(row.join(','));
  }

  return lines.join('\r\n');
}

/**
 * Trigger a CSV download in the browser
 *
 * @param {Array<ScannedCard>} cards
 * @param {string} filename
 */
export function downloadCSV(cards, filename = null) {
  if (!cards || cards.length === 0) {
    console.warn('[CSV] No cards to export');
    return false;
  }

  const csvContent = generateCSV(cards);

  // Use BOM for proper UTF-8 encoding in Excel
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().slice(0, 10);
  const finalFilename = filename || `riftbound-scan-${timestamp}.csv`;

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
    document.body.removeChild(link);
  }, 100);

  return true;
}

/**
 * Generate a preview of the CSV content (first N rows)
 */
export function previewCSV(cards, maxRows = 5) {
  const preview = cards.slice(0, maxRows);
  return generateCSV(preview);
}

/**
 * Validate that all required fields are present
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
