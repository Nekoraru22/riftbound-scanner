/**
 * Perceptual Hash (pHash) Implementation - 24-bit RGB-aware
 *
 * Uses a DCT-based approach per channel (R, G, B) producing an 8-bit hash
 * per channel = 24 bits total. This allows distinguishing cards that differ
 * only in color (e.g., different rune domain color variants).
 *
 * Pipeline:
 *   1. Resize image to 32x32
 *   2. Convert to per-channel grayscale
 *   3. Apply 2D DCT on each channel
 *   4. Extract top-left 8x8 low-frequency block
 *   5. Compute median and threshold to produce 8-bit hash per channel
 *   6. Combine into 24-bit hash
 */

// Precomputed DCT-II coefficients for 32-point transform
const DCT_SIZE = 32;
const HASH_BLOCK = 8;
const BITS_PER_CHANNEL = 8;

let dctCoeffs = null;

function initDCTCoeffs() {
  if (dctCoeffs) return dctCoeffs;
  dctCoeffs = new Float64Array(DCT_SIZE * DCT_SIZE);
  for (let k = 0; k < DCT_SIZE; k++) {
    for (let n = 0; n < DCT_SIZE; n++) {
      dctCoeffs[k * DCT_SIZE + n] =
        Math.cos((Math.PI / DCT_SIZE) * (n + 0.5) * k);
    }
  }
  return dctCoeffs;
}

/**
 * Apply 1D DCT-II to a row of data
 */
function dct1d(input, output, length) {
  const coeffs = initDCTCoeffs();
  for (let k = 0; k < length; k++) {
    let sum = 0;
    for (let n = 0; n < length; n++) {
      sum += input[n] * coeffs[k * DCT_SIZE + n];
    }
    output[k] = sum;
  }
}

/**
 * Apply 2D DCT on a 32x32 matrix (stored as flat Float64Array)
 */
function dct2d(matrix) {
  const N = DCT_SIZE;
  const temp = new Float64Array(N);
  const result = new Float64Array(N * N);

  // DCT on rows
  for (let row = 0; row < N; row++) {
    const rowData = matrix.slice(row * N, (row + 1) * N);
    dct1d(rowData, temp, N);
    for (let col = 0; col < N; col++) {
      result[row * N + col] = temp[col];
    }
  }

  // DCT on columns
  const colInput = new Float64Array(N);
  for (let col = 0; col < N; col++) {
    for (let row = 0; row < N; row++) {
      colInput[row] = result[row * N + col];
    }
    dct1d(colInput, temp, N);
    for (let row = 0; row < N; row++) {
      result[row * N + col] = temp[row];
    }
  }

  return result;
}

/**
 * Extract an 8-bit hash from a 2D DCT result
 * Uses the low-frequency 8x8 block (excluding DC component at [0,0])
 */
function extractHash(dctResult) {
  // Collect low-frequency coefficients (skip DC at [0,0])
  const values = [];
  for (let row = 0; row < HASH_BLOCK; row++) {
    for (let col = 0; col < HASH_BLOCK; col++) {
      if (row === 0 && col === 0) continue; // skip DC
      values.push(dctResult[row * DCT_SIZE + col]);
    }
  }

  // We have 63 values, we need 8 bits
  // Take the first 8 significant low-frequency coefficients
  // (zigzag order approximation: just use the first 8 after DC)
  const selected = values.slice(0, BITS_PER_CHANNEL);
  const median = [...selected].sort((a, b) => a - b)[Math.floor(selected.length / 2)];

  let hash = 0;
  for (let i = 0; i < BITS_PER_CHANNEL; i++) {
    if (selected[i] > median) {
      hash |= (1 << (BITS_PER_CHANNEL - 1 - i));
    }
  }
  return hash;
}

/**
 * Resize image data to 32x32 using bilinear interpolation
 * Returns { r, g, b } each as Float64Array of length 1024
 */
function resizeAndSplit(imageData, srcWidth, srcHeight) {
  const dst = DCT_SIZE;
  const r = new Float64Array(dst * dst);
  const g = new Float64Array(dst * dst);
  const b = new Float64Array(dst * dst);

  const xRatio = srcWidth / dst;
  const yRatio = srcHeight / dst;

  for (let y = 0; y < dst; y++) {
    for (let x = 0; x < dst; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);
      const xFrac = srcX - x0;
      const yFrac = srcY - y0;

      const idx00 = (y0 * srcWidth + x0) * 4;
      const idx10 = (y0 * srcWidth + x1) * 4;
      const idx01 = (y1 * srcWidth + x0) * 4;
      const idx11 = (y1 * srcWidth + x1) * 4;

      const w00 = (1 - xFrac) * (1 - yFrac);
      const w10 = xFrac * (1 - yFrac);
      const w01 = (1 - xFrac) * yFrac;
      const w11 = xFrac * yFrac;

      const dstIdx = y * dst + x;
      r[dstIdx] = imageData[idx00] * w00 + imageData[idx10] * w10 + imageData[idx01] * w01 + imageData[idx11] * w11;
      g[dstIdx] = imageData[idx00 + 1] * w00 + imageData[idx10 + 1] * w10 + imageData[idx01 + 1] * w01 + imageData[idx11 + 1] * w11;
      b[dstIdx] = imageData[idx00 + 2] * w00 + imageData[idx10 + 2] * w10 + imageData[idx01 + 2] * w01 + imageData[idx11 + 2] * w11;
    }
  }

  return { r, g, b };
}

/**
 * Compute 24-bit perceptual hash from image data
 * @param {Uint8ClampedArray} imageData - RGBA pixel data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {number} 24-bit hash (R=bits 23-16, G=bits 15-8, B=bits 7-0)
 */
export function computePHash(imageData, width, height) {
  initDCTCoeffs();

  // Step 1: Resize to 32x32 and split channels
  const { r, g, b } = resizeAndSplit(imageData, width, height);

  // Step 2: Apply 2D DCT on each channel
  const dctR = dct2d(r);
  const dctG = dct2d(g);
  const dctB = dct2d(b);

  // Step 3: Extract 8-bit hash from each channel
  const hashR = extractHash(dctR);
  const hashG = extractHash(dctG);
  const hashB = extractHash(dctB);

  // Step 4: Combine into 24-bit hash
  return (hashR << 16) | (hashG << 8) | hashB;
}

/**
 * Compute Hamming distance between two 24-bit hashes
 * @returns {number} Number of differing bits (0-24)
 */
export function hammingDistance(hash1, hash2) {
  let xor = hash1 ^ hash2;
  let count = 0;
  while (xor) {
    count += xor & 1;
    xor >>= 1;
  }
  return count;
}

/**
 * Find the best matching card from a reference hash database
 * @param {number} queryHash - 24-bit hash of the scanned card
 * @param {Array<{id: string, hash: number}>} referenceHashes - Database of reference hashes
 * @param {number} threshold - Max Hamming distance to accept (default: 6)
 * @returns {{ match: object|null, distance: number }}
 */
export function findBestMatch(queryHash, referenceHashes, threshold = 6) {
  let bestMatch = null;
  let bestDistance = Infinity;

  for (const ref of referenceHashes) {
    const dist = hammingDistance(queryHash, ref.hash);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = ref;
    }
  }

  if (bestDistance <= threshold) {
    return { match: bestMatch, distance: bestDistance };
  }
  return { match: null, distance: bestDistance };
}

/**
 * Hash a card image from a canvas/image element
 * Useful for building the reference database
 */
export function hashFromCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return computePHash(imageData.data, canvas.width, canvas.height);
}

/**
 * Convert a 24-bit hash to a hex string for storage
 */
export function hashToHex(hash) {
  return hash.toString(16).padStart(6, '0');
}

/**
 * Parse a hex string back to a 24-bit hash
 */
export function hexToHash(hex) {
  return parseInt(hex, 16);
}
