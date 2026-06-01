# Changelog

## [2.0.0] - 2026-06-02

### YOLO11s-pose — Corner Keypoint Detection

Switched the detection model from YOLO11s-OBB (oriented bounding boxes) to YOLO11s-pose, which regresses the 4 card corners as keypoints (TL, TR, BR, BL). This gives sub-pixel corner localization and enables a proper perspective-correct crop with no OBB angle approximation.

#### Model Changes

- **New model**: `yolo11s-pose-riftbound.onnx` / `yolo11s-pose-riftbound-q8.onnx` replace the OBB variants
- **Output format**: 13-channel tensor `[cx, cy, w, h, conf, kp0x, kp0y, …, kp3x, kp3y]` instead of 6-channel OBB
- **Keypoints** are mapped from letterbox space back to source image coords alongside the bounding box
- **Training**: YOLO11s-pose on an A100 at `imgsz=768`, `kpt_shape=[4,2]`, horizontal flips disabled (corner convention is fixed), `pose=25.0` loss weight for tight corner localization
- **Dataset**: labels converted from OBB rotation angle to 4-corner keypoint format; `--resume` flag added to `train.py` so interrupted runs can pick up from `last.pt` on the volume

#### Detection & Crop Pipeline

- **`_cropPerspective`** replaces `_cropRotated` — performs a perspective-correct warp using 48 horizontal affine strips, no per-pixel JS loop
- **`_solveAffine`** — closed-form 3-point affine solver (Cramer's rule) used per strip
- **`ScanTab`** — detection loop now calls `warpQuadToPortrait(originalImage, scaledKeypoints)` when keypoints are present; falls back to `cropRotated` for the simulation mode

#### Other

- **SettingsTab**: version bumped to `v2.0.0`; neko mascot now fades out when scrolling back up (fade-in / fade-out CSS transitions)
- **README**: architecture section and cloud-training docs updated; `--resume` usage documented

#### Files Modified

| File | What changed |
|------|-------------|
| `src/lib/yoloDetector.js` | Pose output parsing (13 ch), `_cropPerspective`, `_solveAffine`, removed `_cropRotated` |
| `src/components/scan/ScanTab.jsx` | `warpQuadToPortrait` crop from keypoints, `corners` in detection result instead of `angle` |
| `src/components/settings/SettingsTab.jsx` | Version 2.0.0, neko fade-out animation |
| `model/train.py` | Pose task, `--resume` flag |
| `model/data_creator.py` | Pose label format, no horizontal flips |
| `README.md` | Pose model docs, `--resume` command |

---

## [1.4.0] - 2026-05-26

### Dataset Overhaul, Sleeve Simulation & Improved Card Matching

Major improvements to synthetic data generation (close-ups, sleeves, larger grids), per-card artwork crop regions in the matcher, interactive corner correction, and richer CSV export.

#### New Features

- **Sleeve simulation** (`SLEEVE_PROB = 0.30`)
  - New `apply_sleeve_overlay()` augmentation: colored border, diagonal glare streak, and 0–3 specular highlights blended over the card before compositing
  - Applied in standard scenes, grid layouts, close-up scenes, and mosaic quadrants
  - Trains the detector to keep finding cards through plastic sleeves with reflections

- **Close-up scene mode** (`CLOSEUP_PROB = 0.15`)
  - New `generate_closeup_image()` — single card at 0.85×–1.30× of the frame height
  - When scale > 1.0 the card is intentionally clipped by the image edges, teaching the model to detect partially-visible cards
  - Addresses the previous failure mode where very large or edge-clipped cards were missed

- **Larger grid layouts**
  - Grid choices expanded from `{2×2, 2×3, 3×3}` to up to `5×6` (30 cards)
  - Smaller margins and gaps for dense grids (≥4 rows/cols)
  - Addresses the failure mode where very small cards in large grids were missed

- **Interactive corner correction** (DetectionCanvas)
  - Selected detections now show 4 draggable handles at the card corners
  - Dragging any handle deforms the quad freely — no rectangle constraint
  - On pointer-up: `warpQuadToPortrait` re-runs on the original full-res image and `identifyCard` is called with the corrected crop
  - New `perspectiveCrop.js`: `obbToCorners`, `solvePerspectiveMatrix`, `warpQuadToPortrait` (bilinear-interpolated perspective warp)

- **Per-card artwork crop in matcher**
  - `card-hashes.json` now carries `artBottom` per card (0.55 standard / 0.85 legend / 0.95 full-art)
  - Matcher pre-computes one query feature per distinct `artBottom` value and picks the matching one per candidate — fairer comparison between card types
  - Horizontal flip tested automatically for every crop (handles mirror-image photos); no additional identify calls needed

- **Richer CSV export**
  - Added `Runes`, `Type`, and `Rarity` columns to exported CSV
  - `Runes` is derived from the card's `domains` array (e.g. `Shadow/Noxus`)

#### Changes

- **Dataset image size**: `OUTPUT_SIZE` 640 → 768 (matches training `imgsz` and detector input size)
- **Card scale range**: `CARD_SCALE_MIN/MAX` widened to 0.10–0.95 (cards can now fill almost the entire frame)
- **Corner clipping threshold**: `inside < 3` → `inside < 2` (allows 2 corners off-frame for close-ups and large-grid edge cards)
- **Augmentation tuning**: `MOTION_BLUR_PROB` 0.15 → 0.05, `JPEG_ARTIFACT_PROB` 0.25 → 0.10 (edge-degrading augmentations reduced to preserve keypoint signal)
- **Pooled canvas in matcher**: `_flipCanvas`, `_eqCanvas`, `_tmpCanvas` reused across calls to avoid leaking canvas elements on multi-card uploads

#### Files Modified

| File | What changed |
|------|-------------|
| `model/data_creator.py` | `apply_sleeve_overlay`, `generate_closeup_image`, larger grids, widened scale, 768px, clipping threshold, augmentation tuning |
| `src/lib/perspectiveCrop.js` | **New** — `obbToCorners`, `solvePerspectiveMatrix`, `warpQuadToPortrait` |
| `src/components/identify/DetectionCanvas.jsx` | Draggable corner handles, pointer events, `onCornersChange` callback |
| `src/components/scan/ScanTab.jsx` | `onCornersChange` handler, re-identification on corner edit, `warpQuadToPortrait` integration |
| `src/lib/cardMatcher.js` | Per-card `artBottom`, query pre-computed per crop region, pooled flip canvas |
| `src/lib/csvExporter.js` | Added `Runes`, `Type`, `Rarity` columns |

---

## [1.3.0] - 2025-02-13

### Promo Cards Support & Manual Card Selection

Added promo card support with OGNX set export and manual card search for misidentified cards.

#### New Features

- **Promo toggle**
  - Added promo toggle button to both CardDetailPanel (scan results) and ScannerCardRow (collection)
  - When enabled, cards export with set "OGNX" instead of "OGN" in CSV

- **Manual card search & replace**
  - Added search functionality in CardDetailPanel for manually selecting cards
  - Click "Search" button (or "Wrong card? Search manually") to open search panel
  - Type-ahead search filters all 664 cards by name (minimum 2 characters)
  - Shows up to 8 results with domain color indicator, card name, and set
  - Selected cards show "Manually selected" banner with "Search again" and "Reset" options
  - Manually selected cards override scanner matches and persist through add-to-collection

- **Condition abbreviations legend**
  - Added legend at bottom of Collection tab: "NM = Near Mint · LP = Lightly Played · MP = Moderately Played · HP = Heavily Played · D = Damaged"
  - Condition dropdowns show abbreviations for space efficiency

#### Changes

- **Language options reduced** — Only English and Chinese remain (removed all other languages for being innecessary)
- **Improved text contrast** — Changed label colors from `text-rift-500` to `text-rift-400` throughout CardDetailPanel for better readability
- **Number input improvements** — Changed from `type="number"` to `type="text"` with `inputMode="numeric"` to hide browser arrows, added dynamic width in Collection rows

#### Files Modified

| File | What changed |
|------|-------------|
| `src/components/identify/CardDetailPanel.jsx` | Added search state/panel, promo toggle, manual card override, improved text contrast |
| `src/components/scanner/ScannerCardRow.jsx` | Added promo toggle, removed variant selector, condition dropdowns show abbreviations |
| `src/components/collection/CollectionTab.jsx` | Added condition abbreviations legend |
| `src/lib/csvExporter.js` | Changed promo export logic: set = "OGNX" when promo = true |
| `src/data/sampleCards.js` | Reduced LANGUAGES to English and Chinese only |

## [1.2.0] - 2025-02-09

### Card Identification Simplification & Quality Improvements

Removed the DCT re-ranking stage (which was hurting accuracy) and improved crop quality for multi-card images.

#### Changes

- **Removed DCT re-ranking** — The two-pass pipeline (color grid + DCT) was causing wrong cards to rank first because DCT similarity was unreliable on real photos. Reverted to pure color grid cosine similarity, which is more robust.

- **Full-resolution cropping** — When uploading a multi-card image, the app now crops each detected card from the **original full-resolution image** instead of the resized 2048px version. YOLO detection still runs on the resized image (640×640 internally), but coordinates are scaled back to original space for cropping. This gives each card more pixel detail for matching.

- **Optimized `cropRotated`** — The intermediate canvas now uses the card diagonal instead of the full image diagonal, reducing memory usage from ~2900×2900 to ~860×860 per card crop.

- **Removed dead code** — Deleted `phash.js` (DCT features), `cardDatabase.js` (unused IndexedDB interface), and `ensurePortrait` (redundant with `cropRotated`).

- **PNG for resize** — `resizeImage` now uses `toDataURL('image/png')` instead of JPEG at 92% quality, eliminating compression artifacts that affected color grid matching.

#### Files Modified

| File | What changed |
|------|-------------|
| `src/components/scan/ScanTab.jsx` | Removed DCT re-ranking from `identifyCard()`, added full-res cropping via `originalImageRef`, optimized `cropRotated` to use card diagonal, removed `ensurePortrait`, PNG resize |
| `src/lib/cardMatcher.js` | Removed DCT imports and re-ranking logic, pure color grid matching |
| `src/lib/phash.js` | **Deleted** — DCT feature extraction no longer used |
| `src/lib/cardDatabase.js` | **Deleted** — Dead code, never imported by any active module |
| `README.md` | Updated all pipeline docs to reflect single-pass color grid |

## [1.1.0] - 2025-02-08

### Card Identification Pipeline Overhaul

Replaced the single-pass 8×8 color grid matcher with a 16×16 color grid with histogram equalization, significantly improving card identification accuracy.

#### New Features

- **Artwork crop**
  - All feature extraction now operates only on the illustration region (5%-55% height, 5%-95% width)
  - Excludes shared card frame, name bar, text box, and stats (~60% of the card area)
  - Dramatically improves discrimination between cards that share similar frames

- **Histogram equalization**
  - Per-channel (R, G, B) brightness normalization before feature extraction
  - Dark photos now produce features comparable to well-lit reference images
  - Applied at full resolution before downscaling to preserve quality

#### Changes

- Color grid increased from 8×8 (192 features) to 16×16 (768 features)
- Added `--only-hashes` flag to `cards_scraper.py` (replaces `--skip-download`) — regenerates hashes without re-downloading images
- `cardMatcher.js` refactored with artwork crop and histogram equalization
- `ScanTab.jsx` upload mode updated to match (with rotation support)

#### Files Modified

| File | What changed |
|------|-------------|
| `model/cards_scraper.py` | Grid 16×16, `_crop_artwork()`, `_equalize_histogram()`, `--only-hashes` flag |
| `src/lib/cardMatcher.js` | Artwork crop, histogram equalization, full-res equalization before grid |
| `src/components/scan/ScanTab.jsx` | `cropArtwork()`, artwork crop in `identifyCard()` |
| `README.md` | Updated architecture diagrams, pipeline docs, project structure |
