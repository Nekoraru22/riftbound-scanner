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
└──────────────────────────────┬───────────────────────│──────────┘
                               │                       │
                               ▼                       ▼
┌────────────────────────────────────────┐  ┌─────────────────────┐
│           data_creator.py              │  │   card-hashes.json  │
├────────────────────────────────────────┤  └──────────┬──────────┘
│  1. Load card images from SQLite       │             │
│  2. Generate synthetic backgrounds     │             ▼
│  3. Place cards with random transforms │  ┌─────────────────────┐
│  4. Apply augmentation pipeline        │  │ Frontend Card Matcher│
│  5. Export YOLO OBB dataset            │  │ (cosine similarity) │
└──────────────────┬─────────────────────┘  └─────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────┐
│              train.py                  │
├────────────────────────────────────────┤
│  1. Upload dataset to Modal            │
│  2. Train YOLO11n-OBB on cloud GPU     │
│  3. Export to TensorFlow.js            │
│  4. Download model to public/models/   │
└────────────────────────────────────────┘
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

## Synthetic Dataset Generation

`data_creator.py` generates a synthetic YOLO OBB training dataset by compositing card images onto randomized backgrounds with heavy augmentation. The goal is to train a model that detects cards in real-world camera frames.

### Running the Generator

```bash
cd model
python data_creator.py
```

Generation is parallelized across all CPU cores using `ProcessPoolExecutor`.

### Augmentation Pipeline

Each training image goes through the following pipeline:

```
Background Generation          Card Placement              Global Augmentations
┌───────────────────┐        ┌──────────────────┐        ┌────────────────────┐
│ - Solid color     │        │ - Random scale   │        │ - Brightness       │
│ - Gradient        │  ───►  │ - Random rotation│  ───►  │ - Contrast         │
│ - Perlin noise    │        │ - Perspective    │        │ - Saturation       │
│ - Blurred noise   │        │ - Horizontal flip│        │ - Hue shift        │
│ - Two-tone split  │        │ - Shadow casting │        │ - Color jitter     │
│ - Real texture    │        │ - Overlap avoid  │        │ - Gaussian noise   │
│ + Lighting grad.  │        │ - 1-5 cards      │        │ - Motion blur      │
│ + Distractors     │        └──────────────────┘        │ - JPEG artifacts   │
└───────────────────┘                                     │ - Vignette         │
                                                          │ - Cutout           │
                                                          └────────────────────┘
```

Additionally, ~25% of training images use **mosaic augmentation** (YOLOv4+ style), which splits the image into 4 quadrants with independent scenes.

### Optional Assets

Place these in the `model/` directory before running the generator:

| Directory | Contents | Effect |
| --- | --- | --- |
| `textures/` | JPG/PNG photos of real surfaces (desks, mats, tables) | Used as backgrounds 40% of the time |
| `distractors/` | PNG objects with alpha (dice, tokens, sleeves) | Placed randomly to teach the model to ignore non-card objects |

### Configuration

Key settings at the top of `data_creator.py`:

| Setting | Default | Description |
|---------|---------|-------------|
| `IMAGES_PER_CARD` | 150 | Synthetic images generated per card |
| `OUTPUT_SIZE` | 640 | Image dimensions (640x640) |
| `MAX_CARDS_PER_IMAGE` | 5 | Maximum cards per scene |
| `TRAIN_RATIO` | 0.85 | Train/val split ratio |
| `CARD_SCALE_MIN/MAX` | 0.12 / 0.60 | Card size range relative to image |
| `ROTATION_RANGE` | -75 to 75 | Rotation angle range in degrees |
| `MOSAIC_PROB` | 0.25 | Probability of mosaic augmentation |

### Generated Dataset Structure

```
model/dataset/
├── data.yaml            # YOLO configuration
├── train/
│   ├── images/          # Training images (.jpg)
│   └── labels/          # OBB labels (.txt)
└── val/
    ├── images/          # Validation images (.jpg)
    └── labels/          # OBB labels (.txt)
```

Labels use YOLO OBB format: `class x1 y1 x2 y2 x3 y3 x4 y4` (normalized corner coordinates).

## Cloud Training

`train.py` handles training on [Modal](https://modal.com/) cloud GPUs:

```bash
modal run train.py                  # Upload dataset + train
modal run train.py --skip-upload    # Train only (dataset already uploaded)
modal run train.py --export-only    # Export and download (already trained)
```

Trains a YOLO11n-OBB model on a T4 GPU, exports to TensorFlow.js, and copies the model to `public/models/` for the web app.

## Dependencies

### Python (model/)
```
requests
tqdm
Pillow
opencv-python
numpy
modal        # Cloud training (train.py)
ultralytics  # YOLO training (train.py)
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
│   ├── cards_scraper.py    # Scraper + hash generator
│   ├── data_creator.py     # Synthetic dataset generator
│   ├── train.py            # Cloud training on Modal
│   ├── riftbound.db        # SQLite database
│   ├── cards/              # Downloaded card images
│   ├── dataset/            # Generated YOLO OBB dataset
│   ├── textures/           # (optional) Real background images
│   └── distractors/        # (optional) Non-card PNG objects
├── public/
│   ├── card-hashes.json    # Color grid hashes
│   ├── models/             # YOLO TF.js model files
│   └── test.html           # Detection test page
└── src/
    └── lib/
        ├── cardMatcher.js  # Frontend matching logic
        └── cardDatabase.js # IndexedDB interface
```
