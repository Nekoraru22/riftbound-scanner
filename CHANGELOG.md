# Changelog

## [1.1.0] - 2025-02-08

### Card Identification Pipeline Overhaul

Replaced the single-pass 8×8 color grid matcher with a two-pass pipeline that significantly improves card identification accuracy, especially for visually similar cards and poor lighting conditions.

#### New Features

- **Two-pass matching pipeline**
  - Stage 1: 16×16 color grid + cosine similarity filters all cards down to top 20 candidates
  - Stage 2: DCT frequency features (189 floats) re-ranks those 20 candidates
  - Final score: `color × 0.6 + DCT × 0.4`

- **Artwork crop**
  - All feature extraction now operates only on the illustration region (5%-55% height, 5%-95% width)
  - Excludes shared card frame, name bar, text box, and stats (~60% of the card area)
  - Dramatically improves discrimination between cards that share similar frames

- **Histogram equalization**
  - Per-channel (R, G, B) brightness normalization before feature extraction
  - Dark photos now produce features comparable to well-lit reference images
  - Applied at full resolution before downscaling to preserve quality

- **DCT feature vector** (`phash.js`)
  - 189-float vector (63 low-frequency DCT coefficients × 3 RGB channels)
  - Captures texture and structural patterns beyond color distribution
  - Computed identically in Python (reference) and JavaScript (query)

#### Changes

- Color grid increased from 8×8 (192 features) to 16×16 (768 features)
- `cards_scraper.py` now stores both `f` (color grid) and `d` (DCT features) per card in `card-hashes.json`
- Added `--only-hashes` flag to `cards_scraper.py` (replaces `--skip-download`) — regenerates hashes without re-downloading images
- `cardMatcher.js` refactored to two-pass pipeline with artwork crop
- `ScanTab.jsx` upload mode updated to match (with rotation support)
- `useCardDetection.js` unchanged — delegates to `cardMatcher.js`

#### Files Modified

| File | What changed |
|------|-------------|
| `model/cards_scraper.py` | Grid 16×16, `_crop_artwork()`, `_equalize_histogram()`, `_compute_dct_features()`, `--only-hashes` flag |
| `src/lib/phash.js` | Added `equalizeHistogram()`, `computeDCTFeatures()`, `dctFeaturesFromCanvas()` |
| `src/lib/cardMatcher.js` | Two-pass pipeline, `_cropArtwork()`, `_equalizeHistogram()`, full-res equalization |
| `src/components/scan/ScanTab.jsx` | `cropArtwork()`, artwork crop in `identifyCard()`, DCT re-ranking on cropped artwork |
| `README.md` | Updated architecture diagrams, pipeline docs, project structure |
