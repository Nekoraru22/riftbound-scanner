# Changelog

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
