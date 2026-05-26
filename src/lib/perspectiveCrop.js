/**
 * 4-point perspective warp for manual OBB correction.
 *
 * When the user drags YOLO's 4 corners to fit a card precisely, the resulting
 * quadrilateral may no longer be a rectangle (e.g. a photo taken at an angle).
 * This module warps that arbitrary quad back to an axis-aligned rectangle so
 * the matcher sees the same view the DB images have.
 */

/**
 * Returns the 4 corners of an oriented bounding box in TL, TR, BR, BL order.
 * Uses the same convention as the OBB `{cx, cy, w, h, angle}` shape produced
 * by YOLO11-OBB: angle in radians, rotation around the box centre.
 */
export function obbToCorners(cx, cy, w, h, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = w / 2;
  const hh = h / 2;
  const local = [
    [-hw, -hh],  // TL
    [ hw, -hh],  // TR
    [ hw,  hh],  // BR
    [-hw,  hh],  // BL
  ];
  return local.map(([x, y]) => [
    cx + x * cos - y * sin,
    cy + x * sin + y * cos,
  ]);
}

/**
 * Solves the 3×3 perspective matrix that maps `dstPts` (rectangle corners)
 * to `srcPts` (arbitrary quad corners) in homogeneous coordinates.
 *
 * Returns a 9-element row-major matrix M such that:
 *   M · [x_dst, y_dst, 1]ᵀ = w · [x_src, y_src, 1]ᵀ
 *
 * Internally builds the 8×8 linear system from 4 point correspondences and
 * solves with Gaussian elimination + partial pivoting.
 */
export function solvePerspectiveMatrix(srcPts, dstPts) {
  const A = new Float64Array(64);
  const b = new Float64Array(8);
  for (let i = 0; i < 4; i++) {
    const [xd, yd] = dstPts[i];
    const [xs, ys] = srcPts[i];
    const r1 = 2 * i;
    const r2 = 2 * i + 1;
    A[r1 * 8 + 0] = xd; A[r1 * 8 + 1] = yd; A[r1 * 8 + 2] = 1;
    A[r1 * 8 + 6] = -xd * xs; A[r1 * 8 + 7] = -yd * xs;
    b[r1] = xs;
    A[r2 * 8 + 3] = xd; A[r2 * 8 + 4] = yd; A[r2 * 8 + 5] = 1;
    A[r2 * 8 + 6] = -xd * ys; A[r2 * 8 + 7] = -yd * ys;
    b[r2] = ys;
  }
  const h = _solveLinearSystem(A, b, 8);
  return new Float64Array([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]);
}

function _solveLinearSystem(A, b, n) {
  const M = new Float64Array(A);
  const v = new Float64Array(b);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    let maxVal = Math.abs(M[i * n + i]);
    for (let k = i + 1; k < n; k++) {
      const val = Math.abs(M[k * n + i]);
      if (val > maxVal) { maxVal = val; maxRow = k; }
    }
    if (maxRow !== i) {
      for (let j = 0; j < n; j++) {
        const t = M[i * n + j];
        M[i * n + j] = M[maxRow * n + j];
        M[maxRow * n + j] = t;
      }
      const tv = v[i]; v[i] = v[maxRow]; v[maxRow] = tv;
    }
    for (let k = i + 1; k < n; k++) {
      const factor = M[k * n + i] / M[i * n + i];
      for (let j = i; j < n; j++) M[k * n + j] -= factor * M[i * n + j];
      v[k] -= factor * v[i];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = v[i];
    for (let j = i + 1; j < n; j++) sum -= M[i * n + j] * x[j];
    x[i] = sum / M[i * n + i];
  }
  return x;
}

/**
 * Geometrically sorts 4 corners into visual TL → TR → BR → BL screen order,
 * regardless of how YOLO's rotated-box frame labels them.
 *
 * In image coords (Y pointing DOWN), atan2(dy, dx) gives:
 *   top-left     → angle in (-π, -π/2)  — most negative
 *   top-right    → angle in (-π/2,  0)
 *   bottom-right → angle in ( 0,   π/2)
 *   bottom-left  → angle in (π/2,  π)
 * Sorting ascending therefore yields [TL, TR, BR, BL]. ✓
 */
function _sortCornersVisually(corners) {
  const cx = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
  const cy = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
  return [...corners].sort(
    (a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx),
  );
}

/**
 * Warps a 4-point quadrilateral region of an image to an axis-aligned canvas
 * with bilinear interpolation.
 *
 * Corners can be passed in any order — they are geometrically sorted to visual
 * TL → TR → BR → BL before solving the perspective matrix, so the output is
 * always correctly oriented regardless of the YOLO OBB angle convention.
 *
 * @param {HTMLImageElement|HTMLCanvasElement} srcImage
 * @param {Array<[number,number]>} srcCorners - 4 corners in any order
 * @returns {HTMLCanvasElement} the warped crop
 */
export function warpQuadToPortrait(srcImage, srcCorners) {
  // Get visually sorted corners
  const [tl, tr, br, bl] = _sortCornersVisually(srcCorners);
  
  const topW = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
  const botW = Math.hypot(br[0] - bl[0], br[1] - bl[1]);
  const leftH = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
  const rightH = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
  
  let dstW = Math.round((topW + botW) / 2);
  let dstH = Math.round((leftH + rightH) / 2);
  
  // IMPORTANT: Use the sorted corners for the matrix
  const cornersForSolve = [tl, tr, br, bl];
  let dstCorners;

  // Force Portrait orientation if the image is landscape
  if (dstW > dstH) {
    // Swap width and height cleanly
    [dstW, dstH] = [dstH, dstW];

    // Clamp output to a reasonable range
    dstW = Math.max(64, Math.min(2048, dstW));
    dstH = Math.max(64, Math.min(2048, dstH));

    // Map corners to rotate the content 90 degrees clockwise
    dstCorners = [
      [dstW, 0],       // original tl moves to top-right
      [dstW, dstH],    // original tr moves to bottom-right
      [0, dstH],       // original br moves to bottom-left
      [0, 0]           // original bl moves to top-left
    ];
  } else {
    // Clamp output to a reasonable range
    dstW = Math.max(64, Math.min(2048, dstW));
    dstH = Math.max(64, Math.min(2048, dstH));

    // Standard mapping if it's already portrait
    dstCorners = [
      [0, 0],          // original tl
      [dstW, 0],       // original tr
      [dstW, dstH],    // original br
      [0, dstH]        // original bl
    ];
  }

  const srcW = srcImage.naturalWidth || srcImage.width;
  const srcH = srcImage.naturalHeight || srcImage.height;
  
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  
  // Optimization: Add 'willReadFrequently' flag for faster getImageData extraction
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.drawImage(srcImage, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

  // Now 'cornersForSolve' matches 'dstCorners' perfectly
  const m = solvePerspectiveMatrix(cornersForSolve, dstCorners);

  const dst = document.createElement('canvas');
  dst.width = dstW;
  dst.height = dstH;
  const dstCtx = dst.getContext('2d');
  const dstImage = dstCtx.createImageData(dstW, dstH);
  const dstData = dstImage.data;

  // Cache matrix entries
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;
  
  // Optimization: Cache row byte size
  const srcRowBytes = srcW * 4;

  for (let y = 0; y < dstH; y++) {
    // Optimization: Pre-calculate the Y-dependent parts of the matrix outside the inner loop
    const m1y_plus_m2 = m1 * y + m2;
    const m4y_plus_m5 = m4 * y + m5;
    const m7y_plus_m8 = m7 * y + m8;
    
    // Optimization: Track the destination index linearly instead of multiplying every iteration
    let dstIdx = y * dstW * 4;

    for (let x = 0; x < dstW; x++) {
      const w = m6 * x + m7y_plus_m8;
      const sx = (m0 * x + m1y_plus_m2) / w;
      const sy = (m3 * x + m4y_plus_m5) / w;
      
      // Optimization: Use Math.trunc for truncation
      const x0 = Math.trunc(sx);
      const y0 = Math.trunc(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      
      if (x0 < 0 || y0 < 0 || x1 >= srcW || y1 >= srcH) {
        dstData[dstIdx + 3] = 255; // opaque black for out-of-bounds
        dstIdx += 4;
        continue;
      }
      
      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      
      // Optimization: Reduce redundant multiplications when finding pixel indices
      const i00 = y0 * srcRowBytes + x0 * 4;
      const i10 = i00 + 4;
      const i01 = y1 * srcRowBytes + x0 * 4;
      const i11 = i01 + 4;
      
      dstData[dstIdx]     = srcData[i00]     * w00 + srcData[i10]     * w10 + srcData[i01]     * w01 + srcData[i11]     * w11;
      dstData[dstIdx + 1] = srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11;
      dstData[dstIdx + 2] = srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11;
      dstData[dstIdx + 3] = 255;
      
      // Advance the destination index for the next pixel
      dstIdx += 4;
    }
  }
  
  dstCtx.putImageData(dstImage, 0, 0);
  return dst;
}
