/**
 * Card Matcher — Identifies detected cards using color grid cosine similarity.
 * Used by both camera mode (useCardDetection) and upload mode (ScanTab).
 */

const HASHES_URL = `/card-hashes.json?v=${__BUILD_TIME__}`;

// Artwork crop region (portrait card) — excludes frame, name bar, text/stats.
// The bottom edge is per-card: standard cards = 0.55, legends = 0.85,
// full-art / battlefields = 0.95. See cards_scraper.py `_resolve_art_region`.
const ART_TOP = 0.05;
const ART_LEFT = 0.05;
const ART_RIGHT = 0.95;
const ART_BOTTOM_DEFAULT = 0.55;

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
      const artBottom = typeof c.artBottom === 'number' ? c.artBottom : ART_BOTTOM_DEFAULT;
      return { ...c, f, norm: Math.sqrt(normSq), artBottom };
    });
    // Unique crop bottoms across the DB (e.g. [0.55, 0.85, 0.95]).
    // We compute one query feature per distinct bottom and pick the matching one per card.
    this.uniqueArtBottoms = [...new Set(this.cards.map(c => c.artBottom))];
    this.ready = true;
    console.log(`[CardMatcher] Loaded ${this.cards.length} cards (${this.gridSize}x${this.gridSize} grid, ${this.uniqueArtBottoms.length} crop regions)`);
  }

  /**
   * Identify a card from a cropped canvas using color grid similarity.
   *
   * @param {HTMLCanvasElement} cropCanvas - De-rotated card crop
   * @returns {{ card: object, similarity: number } | null}
   */
  identify(cropCanvas) {
    if (!this.ready || this.cards.length === 0) return null;

    // Pre-compute query features per (artBottom × orientation). The DB only
    // has one feature per card, but cards in real photos can appear mirrored
    // (selfie cameras, scans behind glass), so we test the horizontal flip
    // too and keep the best similarity per candidate.
    const flipped = this._getFlippedCanvas(cropCanvas);
    const featNormal = new Map();
    const featFlipped = new Map();
    for (const bottom of this.uniqueArtBottoms) {
      featNormal.set(bottom, this._cropAndComputeGrid(cropCanvas, bottom));
      featFlipped.set(bottom, this._cropAndComputeGrid(flipped, bottom));
    }
    const fallback = featNormal.get(ART_BOTTOM_DEFAULT) ?? featNormal.values().next().value;
    const fallbackFlipped = featFlipped.get(ART_BOTTOM_DEFAULT) ?? featFlipped.values().next().value;

    let bestCard = null;
    let bestSim = -1;
    for (const card of this.cards) {
      const qn = featNormal.get(card.artBottom) ?? fallback;
      const qf = featFlipped.get(card.artBottom) ?? fallbackFlipped;
      const sim = Math.max(this._cosineSimilarity(qn, card.f), this._cosineSimilarity(qf, card.f));
      if (sim > bestSim) {
        bestSim = sim;
        bestCard = card;
      }
    }
    return bestCard ? { card: bestCard, similarity: bestSim } : null;
  }

  /**
   * Returns a horizontally mirrored copy of the source canvas, drawn into a
   * pooled canvas (resized in place). Used by identify() to test mirror
   * orientation without leaking a fresh canvas per call.
   */
  _getFlippedCanvas(srcCanvas) {
    if (!this._flipCanvas) this._flipCanvas = document.createElement('canvas');
    if (this._flipCanvas.width !== srcCanvas.width || this._flipCanvas.height !== srcCanvas.height) {
      this._flipCanvas.width = srcCanvas.width;
      this._flipCanvas.height = srcCanvas.height;
    }
    const ctx = this._flipCanvas.getContext('2d');
    ctx.setTransform(-1, 0, 0, 1, srcCanvas.width, 0);
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return this._flipCanvas;
  }

  /**
   * Combined crop + equalize + downsample to grid. Uses pooled `_eqCanvas`
   * and `_tmpCanvas` (resized in place) so identify() doesn't leak canvas
   * elements when called multiple times with different crop bottoms.
   */
  _cropAndComputeGrid(canvas, bottom) {
    const sw = Math.round(canvas.width * (ART_RIGHT - ART_LEFT));
    const sh = Math.round(canvas.height * (bottom - ART_TOP));
    const sx = Math.round(canvas.width * ART_LEFT);
    const sy = Math.round(canvas.height * ART_TOP);

    if (!this._eqCanvas) this._eqCanvas = document.createElement('canvas');
    if (this._eqCanvas.width !== sw || this._eqCanvas.height !== sh) {
      this._eqCanvas.width = sw;
      this._eqCanvas.height = sh;
    }
    const eqCtx = this._eqCanvas.getContext('2d');
    eqCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const fullData = eqCtx.getImageData(0, 0, sw, sh);
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
