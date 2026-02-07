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
│  4. Download + optimize + rotate images (parallel WebP)         │
│  5. Generate color grid hashes ──────────────────────┐          │
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

## How Detection Works

The scanner uses a **dual-layer approach** to scan cards in real time:

| Layer | Model | Question it answers | Details |
|-------|-------|---------------------|---------|
| **Detection** | YOLO11n-OBB | *Where* is there a card? | Locates cards in the camera frame with oriented bounding boxes (handles any rotation). Single class (`card`), trained on synthetic data. |
| **Identification** | Color grid + cosine similarity | *Which* card is it? | Crops the detected region, reduces it to an 8×8 color grid, and matches it against stored fingerprints of all ~245 cards. |

YOLO alone doesn't know which card it's looking at — it only finds rectangular card-shaped objects. The color grid matcher then takes each crop and identifies the specific card by comparing color distributions.

```
Camera Frame ──► YOLO detects card positions ──► Crop each card ──► 8×8 color grid ──► Cosine similarity ──► Card identified
                 (bounding box + rotation)        from frame          fingerprint          vs stored hashes      (name, set, rarity)
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
Cards found: 664
Cards in database: 664
Downloading and optimizing: 100%|██████████| 664/664
Download complete. Total: 664, Failed: 0
Generating hashes: 100%|██████████| 664/664
Hashes generated: 664 cards (0 skipped)
Scraping complete!
```

### Generated Files

| File | Description |
|------|-------------|
| `model/riftbound.db` | SQLite database with card metadata |
| `public/cards/*.webp` | Optimized card images (WebP format) |
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
├── data.yaml
├── train/
│   ├── images/
│   │   └── synth_000000.jpg, synth_000005.jpg, ...
│   └── labels/
│       └── synth_000000.txt, synth_000005.txt, ...
└── val/
    ├── images/
    └── labels/
```

| File/Folder | Description |
| --- | --- |
| `data.yaml` | YOLO config file. Points to train/val paths, defines class count (`nc: 1`) and class names (`['card']`). Rewritten by `train.py` with remote paths during cloud training. |
| `train/` | 85% of the dataset. Used by YOLO to learn during training. |
| `val/` | 15% of the dataset. Used by YOLO during training to measure progress and pick the best checkpoint. |
| `images/` | Synthetic 640x640 JPG images generated by `data_creator.py`. Each contains 1-9 cards on randomized backgrounds. |
| `labels/` | One `.txt` per image (same name). Each line is one card detection in YOLO OBB format. |

The numbers in the filenames (`synth_000000`, `synth_000005`, etc.) are sequential IDs assigned during generation. They're not consecutive within a split because images are randomly shuffled between train/val — e.g. `synth_000001` might be in val while `synth_000000` and `synth_000002` are in train.

### Label Format (YOLO OBB)

Labels are generated automatically by `data_creator.py` alongside each image. Since the cards are placed synthetically, the script knows the exact position, rotation, and scale of every card it composites — so it writes the corresponding label file with the precise corner coordinates. No manual annotation is needed.

Each line in a label file describes one card with its 4 rotated corner coordinates:

```
class x1 y1 x2 y2 x3 y3 x4 y4
```

Example: `0 0.288 0.399 0.508 0.138 0.935 0.434 0.705 0.721`

| Field | Meaning |
| --- | --- |
| `0` | Class ID (always `0` = card, since there's only one class) |
| `x1 y1` ... `x4 y4` | The 4 corners of the oriented bounding box, normalized to 0-1 relative to image dimensions. These form a rotated rectangle around the card. |

## Cloud Training

`train.py` handles training on [Modal](https://modal.com/) cloud GPUs:

```bash
modal run train.py                  # Upload dataset + train
modal run train.py --skip-upload    # Train only (dataset already uploaded)
modal run train.py --export-only    # Export and download (already trained)
```

Trains a YOLO11n-OBB model on an A10G GPU, exports to TensorFlow.js, and copies the model to `public/models/` for the web app.

Use `--detach` to run training in the background (you can close your terminal or shut down your PC):

```bash
modal run --detach train.py          # Launch and disconnect
modal run train.py --export-only     # Download results later
```

### Known Issues and Fixes

**Poor detection on dark/black backgrounds:**
The model struggled to detect cards on dark surfaces because the card borders are black and blended into the background. The synthetic dataset generator (`data_creator.py`) was only creating backgrounds with colors in the 20-240 range, rarely producing truly dark scenes.

**Solution implemented:**
1. **Dataset augmentation** (`data_creator.py`):
   - Added 40% probability of dark backgrounds (0-50 color range) to train on black-on-black scenarios
   - Added 15% probability of grid layout generation (`GRID_PROB = 0.15`) where cards are arranged in organized 2x2, 2x3, or 3x3 grids, simulating how users typically scan multiple cards at once
2. **Training parameters** (`train.py`):
   - Increased brightness augmentation: `hsv_v=0.6` (from default 0.4)
   - Added mixup augmentation: `mixup=0.2` for better generalization
   - Expanded rotation range: `degrees=15` (from default 0)

These changes significantly improved detection accuracy on dark surfaces and organized card layouts.

## Model Quantization

`quantize.py` converts the trained YOLO model to int8 quantized ONNX format for faster inference on web browsers and mobile devices.

```bash
modal run quantize.py
```

### Benefits

| Metric | Float32 (Normal) | Int8 (Quantized) | Improvement |
|--------|------------------|------------------|-------------|
| **Model Size** | ~6 MB | ~1.5 MB | 75% smaller |
| **Inference Speed** | ~60-80ms/frame | ~30-50ms/frame | 2-4x faster |
| **Memory Usage** | ~200 MB | ~100 MB | 50% less |
| **Accuracy Loss** | - | <1% mAP | Negligible |

### How It Works

The quantization pipeline runs on Modal cloud and consists of three steps:

1. **Export to ONNX (float32)**: Converts the PyTorch model to ONNX format
2. **Quantize to int8**: Applies dynamic quantization using ONNX Runtime
3. **Download & Deploy**: Copies the quantized model to `public/models/yolo11n-obb-riftbound-q8.onnx`

```
best.pt ──► best.onnx (float32) ──► best_quantized.onnx (int8) ──► public/models/
 6 MB           5.5 MB                     1.4 MB                      ready for web
```

### Using Quantized Models in the Web App

The web app automatically supports both model formats via ONNX Runtime Web:

**Settings UI**: Users can choose between:
- **Normal (Float32)**: Best accuracy, ~6 MB
- **Fast (Int8 Quantized)**: 2-4x faster, ~1.5 MB, <1% accuracy loss

The model preference is saved to localStorage and persists across sessions. The app automatically loads the selected model on startup.

### Technical Details

**ONNX Runtime Web vs TensorFlow.js:**
- ONNX Runtime Web is 1.5-3x faster for inference
- Native int8 quantization support (TF.js only supports float32)
- Smaller runtime size (~2.5 MB vs ~4-5 MB)
- Direct export path from Ultralytics YOLO

The detector uses ONNX as the primary format and falls back to TensorFlow.js for backward compatibility with older deployed models.

## Model & Dataset

| Resource | URL |
|----------|-----|
| YOLO11n-OBB Model | <https://platform.ultralytics.com/nekoraru22/yolo11n-obb-riftbound> |
| Training Dataset | <https://platform.ultralytics.com/nekoraru22/datasets/dataset-obb-riftbound> |

## Project Structure

```
riftbound-scanner-src/
├── model/
│   ├── cards_scraper.py    # Scraper + hash generator
│   ├── data_creator.py     # Synthetic dataset generator
│   ├── train.py            # Cloud training on Modal
│   ├── riftbound.db        # SQLite database
│   ├── dataset/            # Generated YOLO OBB dataset
│   ├── textures/           # (optional) Real background images
│   └── distractors/        # (optional) Non-card PNG objects
├── public/
│   ├── cards/              # Optimized card images (WebP)
│   ├── card-hashes.json    # Color grid hashes
│   ├── models/             # YOLO TF.js model files
│   └── test.html           # Detection test page
└── src/
    └── lib/
        ├── cardMatcher.js  # Frontend matching logic
        └── cardDatabase.js # IndexedDB interface
```

## Fun Fact: Photoshopped Card Images

The card identification system relies on an 8x8 pixel color grid and cosine similarity — not text recognition or detailed features. This means Photoshop-modified card images (e.g., custom cards, artistic alters, or humorous edits) could also be recognized by the system, as long as the overall color distribution remains close enough to the original card. If the general color composition is preserved (background, borders, dominant palette), the system may still identify it as the original card. The more the color distribution is altered, the lower the cosine similarity will be, making it more likely to go unrecognized or be confused with a different card.

## TODO
- [] Investigate how the model detects the position of the cards for the validation phase, maybe more parameters like deformation can be extracted to improve the accuracy of the model