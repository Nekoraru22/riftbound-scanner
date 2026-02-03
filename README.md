# RiftBound Scanner

A web application for scanning and cataloging RiftBound TCG cards using AI-powered image recognition.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        cards_scraper.py                         │
├─────────────────────────────────────────────────────────────────┤
│  1. Fetch gallery HTML                                          │
│  2. Extract card data from __NEXT_DATA__                        │
│  3. Normalize and save to SQLite                                │
│  4. Download card images (parallel)                             │
│  5. Rotate landscape images to portrait                         │
│  6. Generate color grid hashes ──────────────────────┐          │
└──────────────────────────────────────────────────────│──────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      card-hashes.json                           │
│  { "gridSize": 8, "cards": [{ id, name, f: [192 floats] }] }    │
└──────────────────────────────────────────────────────│──────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend Card Matcher                        │
│  Compares camera crops with hashes using cosine similarity      │
└─────────────────────────────────────────────────────────────────┘
```

## Card Color Grid Hashing

The scanner identifies cards using a **color grid fingerprinting** system. This approach is more robust than perceptual hashing for matching noisy camera crops.

### How It Works

Each card image is converted into a compact numerical fingerprint:

```
Original Card Image              Color Grid (8x8)           Feature Vector
┌──────────────────┐            ┌─┬─┬─┬─┬─┬─┬─┬─┐
│                  │            │ │ │ │ │ │ │ │ │          [0.12, 0.34, 0.56,  ← R,G,B cell 1
│   Card Artwork   │  ────────► ├─┼─┼─┼─┼─┼─┼─┼─┤           0.23, 0.45, 0.67,  ← R,G,B cell 2
│                  │  resize    │ │ │ │ │ │ │ │ │           ...
│                  │  8x8       ├─┼─┼─┼─┼─┼─┼─┼─┤           0.89, 0.12, 0.34]  ← R,G,B cell 64
│                  │            │ │ │ │ │ │ │ │ │
└──────────────────┘            └─┴─┴─┴─┴─┴─┴─┴─┘          192 values total
     744x1039 px                   64 cells                (64 × 3 RGB)
```

### Process Steps

1. **Resize**: The card image is resized to 8×8 pixels using area interpolation
2. **Color Extraction**: Each pixel's RGB values are normalized to 0-1 range
3. **Flatten**: The 8×8×3 grid is flattened into a 192-element vector
4. **Store**: Vectors are saved as JSON for fast frontend loading

### Why 8×8 Grid?

| Grid Size | Features | Precision | Speed | Use Case |
|-----------|----------|-----------|-------|----------|
| 4×4       | 48       | Low       | Fastest | Very fast matching, less accurate |
| **8×8**   | **192**  | **Good**  | **Fast** | **Best balance for card matching** |
| 16×16     | 768      | High      | Slower | More precision, higher memory |

The 8×8 grid captures enough color distribution to distinguish between cards while remaining compact enough for real-time matching.

### Card Matching (Frontend)

When a card is detected by YOLO, the frontend:

1. Extracts the card crop from the camera frame
2. Computes its 8×8 color grid
3. Calculates **cosine similarity** with all stored card hashes
4. Returns the best match (and top-3 candidates)

```javascript
// Cosine Similarity
similarity = (A · B) / (||A|| × ||B||)

// Values range from -1 to 1
// > 0.85 = confident match
// > 0.55 = probable match
```

### Orientation Handling

Cards can be scanned in any rotation. The matcher tests both orientations:

```
┌─────────┐      ┌───────────────┐
│         │      │               │
│  Card   │  vs  │     Card      │  (rotated 90°)
│         │      │               │
└─────────┘      └───────────────┘
   Normal           Landscape

Best similarity from both is used
```

## Running the Scraper

```bash
cd model
python cards_scraper.py
```

### Pipeline Output

```
Downloading gallery...
Cards found: 245
Cards in database: 245
Downloading images: 100%|██████████| 245/245
Rotated 12 landscape images to portrait
Generating hashes: 100%|██████████| 245/245
Hashes generated: 245 cards (0 skipped)
Scraping complete!
```

### Generated Files

| File | Description |
|------|-------------|
| `model/riftbound.db` | SQLite database with card metadata |
| `model/cards/*.png` | Downloaded card images |
| `public/card-hashes.json` | Color grid hashes for frontend matching |

## Dependencies

### Python (model/)
```
requests
tqdm
Pillow
opencv-python
numpy
```

### Frontend
```
React + Vite
TensorFlow.js (YOLO model)
IndexedDB (local storage)
```

## Project Structure

```
riftbound-scanner-src/
├── model/
│   ├── cards_scraper.py    # Main scraper + hash generator
│   ├── riftbound.db        # SQLite database
│   └── cards/              # Downloaded card images
├── public/
│   ├── card-hashes.json    # Color grid hashes
│   ├── models/             # YOLO model files
│   └── test.html           # Detection test page
└── src/
    └── lib/
        ├── cardMatcher.js  # Frontend matching logic
        └── cardDatabase.js # IndexedDB interface
```
