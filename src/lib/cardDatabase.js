/**
 * Card Database Manager
 *
 * Handles fetching card data from the Riftcodex / Riot API,
 * building the pHash reference database, and caching everything
 * in IndexedDB for offline use.
 *
 * Flow:
 *   1. Check IndexedDB for cached data
 *   2. If stale or missing, fetch from API
 *   3. For each card image, compute pHash
 *   4. Store cards + hashes in IndexedDB
 */

import { SAMPLE_CARDS } from '../data/sampleCards.js';
import { storeCards, storeHashes, getCards, getHashes, getHashCount } from './indexedDB.js';
import { computePHash, hashToHex } from './phash.js';

// Riot API endpoint (requires API key in production)
const RIOT_API_BASE = 'https://americas.api.riotgames.com';
const RIFTBOUND_CONTENT_ENDPOINT = '/riftbound/content/v1/content';

/**
 * Initialize the card database
 * Uses cached data if available, otherwise loads sample data
 *
 * @param {Object} options
 * @param {string} options.riotApiKey - Riot API key (optional)
 * @param {function} options.onProgress - Progress callback (0-1)
 * @returns {{ cards: Array, hashes: Array, source: string }}
 */
export async function initializeDatabase({ riotApiKey = null, onProgress = () => {} } = {}) {
  onProgress(0);

  // Check for cached data first
  let cards = await getCards();
  let hashes = await getHashes();

  if (cards.length > 0 && hashes.length > 0) {
    onProgress(1);
    return { cards, hashes, source: 'cache' };
  }

  // Try fetching from Riot API if key provided
  if (riotApiKey) {
    try {
      onProgress(0.1);
      cards = await fetchFromRiotAPI(riotApiKey);
      onProgress(0.3);
    } catch (error) {
      console.warn('[CardDB] Riot API fetch failed, using sample data:', error.message);
      cards = SAMPLE_CARDS;
    }
  } else {
    // Use sample data for demo
    cards = SAMPLE_CARDS;
  }

  onProgress(0.4);

  // Store cards in IndexedDB
  await storeCards(cards);
  onProgress(0.5);

  // Build pHash reference database
  // In production, this would download each card image and compute its hash
  // For demo, we generate placeholder hashes
  hashes = await buildHashDatabase(cards, onProgress);

  onProgress(1);
  return { cards, hashes, source: riotApiKey ? 'api' : 'sample' };
}

/**
 * Fetch card data from Riot's Riftbound Content API
 */
async function fetchFromRiotAPI(apiKey) {
  const response = await fetch(`${RIOT_API_BASE}${RIFTBOUND_CONTENT_ENDPOINT}`, {
    headers: {
      'X-Riot-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Riot API returned ${response.status}`);
  }

  const data = await response.json();

  // Transform API response to our card format
  const cards = [];
  for (const set of (data.sets || [])) {
    for (const card of (set.cards || [])) {
      cards.push({
        id: card.id,
        name: card.name,
        // CRITICAL: Keep collector number as string to preserve leading zeros
        collectorNumber: String(card.collectorNumber).padStart(3, '0'),
        set: set.id,
        setName: set.name,
        rarity: card.rarity?.label || 'Common',
        domain: card.domains?.[0]?.label || 'Unknown',
        type: card.cardType?.[0]?.label || 'Unknown',
        imageUrl: card.cardImage?.url || '',
      });
    }
  }

  return cards;
}

/**
 * Build the pHash reference database from card images
 *
 * In production: downloads each card image, computes pHash, stores result
 * In demo mode: generates deterministic placeholder hashes based on card ID
 */
async function buildHashDatabase(cards, onProgress) {
  const hashes = [];
  const total = cards.length;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];

    let hash;
    if (card.imageUrl && card.imageUrl.length > 10) {
      // In production: download and hash the image
      try {
        hash = await hashCardImage(card.imageUrl);
      } catch {
        hash = generateDeterministicHash(card.id);
      }
    } else {
      // Generate a deterministic hash from the card ID for demo
      hash = generateDeterministicHash(card.id);
    }

    hashes.push({
      cardId: card.id,
      hash: hash,
      set: card.set,
      hexHash: hashToHex(hash),
    });

    // Report progress (0.5 to 0.95 range)
    onProgress(0.5 + (i / total) * 0.45);
  }

  // Store in IndexedDB
  await storeHashes(hashes);
  return hashes;
}

/**
 * Download a card image and compute its pHash
 */
async function hashCardImage(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hash = computePHash(imageData.data, canvas.width, canvas.height);
        resolve(hash);
      } catch (e) {
        reject(e);
      }
    };

    img.onerror = () => reject(new Error('Image load failed'));
    img.src = imageUrl;
  });
}

/**
 * Generate a deterministic hash from a string (for demo/fallback)
 * Uses a simple FNV-1a-like hash truncated to 24 bits
 */
function generateDeterministicHash(str) {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Truncate to 24 bits
  return (hash >>> 0) & 0xFFFFFF;
}

/**
 * Search cards by name (fuzzy)
 */
export function searchCards(cards, query) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  return cards.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.collectorNumber.includes(q) ||
    c.id.includes(q)
  );
}
