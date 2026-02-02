/**
 * Card Matcher - Identifies detected cards by comparing perceptual hashes.
 *
 * Uses dHash (difference hash) to match cropped card detections
 * against pre-computed hashes from the card database.
 */

const HASHES_URL = '/card-hashes.json';

class CardMatcher {
  constructor() {
    this.cards = [];
    this.hashSize = 16;
    this.ready = false;
  }

  async initialize() {
    const resp = await fetch(HASHES_URL);
    if (!resp.ok) throw new Error(`Failed to load card hashes: ${resp.status}`);
    const data = await resp.json();
    this.hashSize = data.hashSize;
    this.cards = data.cards.map(c => ({
      ...c,
      hashBytes: this._hexToBytes(c.hash),
    }));
    this.ready = true;
    console.log(`[CardMatcher] Loaded ${this.cards.length} card hashes`);
  }

  /**
   * Identify a card from a cropped canvas.
   * @param {HTMLCanvasElement} cropCanvas - De-rotated card crop
   * @returns {{ card: object, distance: number, confidence: number } | null}
   */
  identify(cropCanvas) {
    if (!this.ready || this.cards.length === 0) return null;

    const hash = this._computeDHash(cropCanvas);
    let bestDist = Infinity;
    let bestCard = null;

    for (const card of this.cards) {
      const dist = this._hammingDistance(hash, card.hashBytes);
      if (dist < bestDist) {
        bestDist = dist;
        bestCard = card;
      }
    }

    const totalBits = this.hashSize * this.hashSize;
    const confidence = 1 - (bestDist / totalBits);

    return {
      card: bestCard,
      distance: bestDist,
      confidence,
    };
  }

  /**
   * Compute dHash from a canvas element.
   */
  _computeDHash(canvas) {
    const size = this.hashSize;
    // Draw to a small temporary canvas for resizing
    const tmp = document.createElement('canvas');
    tmp.width = size + 1;
    tmp.height = size;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(canvas, 0, 0, size + 1, size);

    const imgData = ctx.getImageData(0, 0, size + 1, size);
    const data = imgData.data;

    // Convert to grayscale and compute horizontal differences
    const bits = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx1 = (y * (size + 1) + x) * 4;
        const idx2 = (y * (size + 1) + x + 1) * 4;
        const gray1 = data[idx1] * 0.299 + data[idx1 + 1] * 0.587 + data[idx1 + 2] * 0.114;
        const gray2 = data[idx2] * 0.299 + data[idx2 + 1] * 0.587 + data[idx2 + 2] * 0.114;
        bits.push(gray2 > gray1 ? 1 : 0);
      }
    }

    // Pack bits into bytes
    const bytes = new Uint8Array(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) {
      if (bits[i]) {
        bytes[i >> 3] |= (1 << (7 - (i & 7)));
      }
    }
    return bytes;
  }

  _hammingDistance(a, b) {
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
      let xor = a[i] ^ b[i];
      while (xor) {
        dist += xor & 1;
        xor >>= 1;
      }
    }
    return dist;
  }

  _hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }
}

let matcherInstance = null;

export function getMatcher() {
  if (!matcherInstance) {
    matcherInstance = new CardMatcher();
  }
  return matcherInstance;
}

export default CardMatcher;
