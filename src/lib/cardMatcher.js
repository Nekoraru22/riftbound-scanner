/**
 * Card Matcher - Identifies detected cards using color grid features + cosine similarity.
 *
 * Each card in the DB has an 8x8 RGB color grid (192 features).
 * Detected crops are resized to the same grid and compared via cosine similarity.
 */

const HASHES_URL = '/card-hashes.json';

class CardMatcher {
  constructor() {
    this.cards = [];
    this.gridSize = 8;
    this.ready = false;
  }

  async initialize() {
    const resp = await fetch(HASHES_URL);
    if (!resp.ok) throw new Error(`Failed to load card DB: ${resp.status}`);
    const data = await resp.json();
    this.gridSize = data.gridSize;
    this.cards = data.cards.map(c => ({
      ...c,
      f: new Float32Array(c.f),
    }));
    this.ready = true;
    console.log(`[CardMatcher] Loaded ${this.cards.length} cards (${this.gridSize}x${this.gridSize} grid)`);
  }

  /**
   * Identify a card from a cropped canvas.
   * @param {HTMLCanvasElement} cropCanvas - De-rotated card crop
   * @returns {{ card: object, similarity: number } | null}
   */
  identify(cropCanvas) {
    if (!this.ready || this.cards.length === 0) return null;

    const features = this._computeColorGrid(cropCanvas);
    let bestSim = -1;
    let bestCard = null;

    for (const card of this.cards) {
      const sim = this._cosineSimilarity(features, card.f);
      if (sim > bestSim) {
        bestSim = sim;
        bestCard = card;
      }
    }

    return {
      card: bestCard,
      similarity: bestSim,
    };
  }

  _computeColorGrid(canvas) {
    const tmp = document.createElement('canvas');
    tmp.width = this.gridSize;
    tmp.height = this.gridSize;
    tmp.getContext('2d').drawImage(canvas, 0, 0, this.gridSize, this.gridSize);
    const data = tmp.getContext('2d').getImageData(0, 0, this.gridSize, this.gridSize).data;
    const features = new Float32Array(this.gridSize * this.gridSize * 3);
    for (let i = 0, j = 0; i < data.length; i += 4) {
      features[j++] = data[i] / 255;
      features[j++] = data[i + 1] / 255;
      features[j++] = data[i + 2] / 255;
    }
    return features;
  }

  _cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
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
