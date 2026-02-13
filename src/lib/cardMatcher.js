/**
 * Card Matcher — Identifies detected cards using color grid cosine similarity.
 * Used by both camera mode (useCardDetection) and upload mode (ScanTab).
 */

const HASHES_URL = `/card-hashes.json?v=${__BUILD_TIME__}`;

// Artwork crop region (portrait card) — excludes frame, name bar, text/stats
const ART_TOP = 0.05;
const ART_BOTTOM = 0.55;
const ART_LEFT = 0.05;
const ART_RIGHT = 0.95;

/**
 * Get the local image URL for a card by its ID.
 * @param {string} cardId - The card ID (e.g., "ogn-001-298")
 * @returns {string} - Local image path (e.g., "/cards/ogn-001-298.webp")
 */
export function getCardImageUrl(cardId) {
  return `/cards/${cardId}.webp`;
}

class CardMatcher {
  constructor() {
    this.cards = [];
    this.gridSize = 8;
    this.ready = false;
    this._tmpCanvas = null;
  }

  async initialize() {
    const resp = await fetch(HASHES_URL);
    if (!resp.ok) throw new Error(`Failed to load card DB: ${resp.status}`);
    const data = await resp.json();
    this.gridSize = data.gridSize;
    this.cards = data.cards.map(c => {
      const f = new Float32Array(c.f);
      let normSq = 0;
      for (let i = 0; i < f.length; i++) normSq += f[i] * f[i];
      return { ...c, f, norm: Math.sqrt(normSq) };
    });
    this.ready = true;
    console.log(`[CardMatcher] Loaded ${this.cards.length} cards (${this.gridSize}x${this.gridSize} grid)`);
  }

  /**
   * Identify a card from a cropped canvas using color grid similarity.
   *
   * @param {HTMLCanvasElement} cropCanvas - De-rotated card crop
   * @returns {{ card: object, similarity: number } | null}
   */
  identify(cropCanvas) {
    if (!this.ready || this.cards.length === 0) return null;

    const art = this._cropArtwork(cropCanvas);
    const features = this._computeColorGrid(art);

    let bestCard = null;
    let bestSim = -1;
    for (const card of this.cards) {
      const sim = this._cosineSimilarity(features, card.f);
      if (sim > bestSim) {
        bestSim = sim;
        bestCard = card;
      }
    }
    return bestCard ? { card: bestCard, similarity: bestSim } : null;
  }

  _cropArtwork(canvas) {
    const w = canvas.width, h = canvas.height;
    const sx = Math.round(w * ART_LEFT);
    const sy = Math.round(h * ART_TOP);
    const sw = Math.round(w * (ART_RIGHT - ART_LEFT));
    const sh = Math.round(h * (ART_BOTTOM - ART_TOP));
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return c;
  }

  _equalizeHistogram(data) {
    for (let ch = 0; ch < 3; ch++) {
      const hist = new Uint32Array(256);
      for (let i = ch; i < data.length; i += 4) hist[data[i]]++;
      const cdf = new Uint32Array(256);
      cdf[0] = hist[0];
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
      let cdfMin = 0;
      for (let i = 0; i < 256; i++) {
        if (cdf[i] > 0) { cdfMin = cdf[i]; break; }
      }
      const totalPixels = data.length / 4;
      const denom = totalPixels - cdfMin;
      if (denom > 0) {
        for (let i = ch; i < data.length; i += 4) {
          data[i] = ((cdf[data[i]] - cdfMin) * 255 / denom + 0.5) | 0;
        }
      }
    }
  }

  _computeColorGrid(canvas) {
    const w = canvas.width, h = canvas.height;
    if (!this._eqCanvas) this._eqCanvas = document.createElement('canvas');
    this._eqCanvas.width = w;
    this._eqCanvas.height = h;
    const eqCtx = this._eqCanvas.getContext('2d');
    eqCtx.drawImage(canvas, 0, 0);
    const fullData = eqCtx.getImageData(0, 0, w, h);
    this._equalizeHistogram(fullData.data);
    eqCtx.putImageData(fullData, 0, 0);

    if (!this._tmpCanvas) {
      this._tmpCanvas = document.createElement('canvas');
      this._tmpCanvas.width = this.gridSize;
      this._tmpCanvas.height = this.gridSize;
    }
    const ctx = this._tmpCanvas.getContext('2d');
    ctx.drawImage(this._eqCanvas, 0, 0, this.gridSize, this.gridSize);
    const data = ctx.getImageData(0, 0, this.gridSize, this.gridSize).data;
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
