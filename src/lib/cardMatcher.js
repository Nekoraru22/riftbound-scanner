/**
 * Card Matcher - Identifies detected cards using color grid + DCT re-ranking.
 *
 * Two-pass pipeline:
 *   1. Color grid (RGB, gridSize×gridSize features) + cosine similarity → top 20 candidates
 *   2. DCT low-frequency features (189 floats) + cosine similarity → re-rank candidates
 */

import { dctFeaturesFromCanvas } from './phash.js';

const HASHES_URL = '/card-hashes.json';
const TOP_N_CANDIDATES = 20;
const COLOR_WEIGHT = 0.6;
const DCT_WEIGHT = 0.4;

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
      const d = c.d ? new Float32Array(c.d) : null;
      return { ...c, f, norm: Math.sqrt(normSq), d };
    });
    this._hasDCT = this.cards.some(c => c.d != null);
    this.ready = true;
    console.log(`[CardMatcher] Loaded ${this.cards.length} cards (${this.gridSize}x${this.gridSize} grid)`);
  }

  /**
   * Identify a card from a cropped canvas.
   *
   * Stage 1: Color grid cosine similarity → top N candidates.
   * Stage 2: DCT feature cosine similarity → re-rank candidates.
   *
   * @param {HTMLCanvasElement} cropCanvas - De-rotated card crop
   * @returns {{ card: object, similarity: number } | null}
   */
  identify(cropCanvas) {
    if (!this.ready || this.cards.length === 0) return null;

    // Crop to artwork region (excludes shared frame/text)
    const art = this._cropArtwork(cropCanvas);

    // Stage 1: Color grid → rank all cards
    const features = this._computeColorGrid(art);
    const scored = [];
    for (const card of this.cards) {
      scored.push({ card, colorSim: this._cosineSimilarity(features, card.f) });
    }
    scored.sort((a, b) => b.colorSim - a.colorSim);

    // Stage 2: DCT feature re-ranking of top candidates
    const candidates = scored.slice(0, TOP_N_CANDIDATES);

    if (this._hasDCT) {
      const queryDCT = dctFeaturesFromCanvas(art);
      for (const c of candidates) {
        c.dctSim = c.card.d ? this._cosineSimilarity(queryDCT, c.card.d) : c.colorSim;
        c.combined = c.colorSim * COLOR_WEIGHT + c.dctSim * DCT_WEIGHT;
      }
      candidates.sort((a, b) => b.combined - a.combined);
    }

    const best = candidates[0];
    return {
      card: best.card,
      similarity: best.colorSim,
    };
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

  /**
   * Per-channel histogram equalization on raw RGBA pixel data (in-place).
   * Normalizes brightness so dark photos match well-lit reference images.
   */
  _equalizeHistogram(data) {
    for (let ch = 0; ch < 3; ch++) {
      // Build histogram
      const hist = new Uint32Array(256);
      for (let i = ch; i < data.length; i += 4) hist[data[i]]++;

      // Cumulative distribution
      const cdf = new Uint32Array(256);
      cdf[0] = hist[0];
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];

      // Find first non-zero CDF value
      let cdfMin = 0;
      for (let i = 0; i < 256; i++) {
        if (cdf[i] > 0) { cdfMin = cdf[i]; break; }
      }

      // Map pixels
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
    // Equalize at full resolution first (matches Python pipeline)
    const w = canvas.width, h = canvas.height;
    if (!this._eqCanvas) this._eqCanvas = document.createElement('canvas');
    this._eqCanvas.width = w;
    this._eqCanvas.height = h;
    const eqCtx = this._eqCanvas.getContext('2d');
    eqCtx.drawImage(canvas, 0, 0);
    const fullData = eqCtx.getImageData(0, 0, w, h);
    this._equalizeHistogram(fullData.data);
    eqCtx.putImageData(fullData, 0, 0);

    // Resize equalized image to grid
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
