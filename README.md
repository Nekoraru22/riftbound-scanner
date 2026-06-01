# RiftBound Scanner

A web application for scanning and cataloging RiftBound TCG cards using Computer Vision.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/nekoraru22)

## Architecture Overview

```text
┌──────────────────────────────────────────────────────────────────┐
│                        cards_scraper.py                          │
├──────────────────────────────────────────────────────────────────┤
│  1. Fetch gallery HTML                                           │
│  2. Extract card data from __NEXT_DATA__                         │
│  3. Normalize and save to SQLite                                 │
│  4. Download + optimize + rotate images (parallel WebP)          │
│  5. Adaptive crop (per card type) → eq. → 16×16 color grid  ───┐ │
└──────────────────────────────┬─────────────────────────────────│─┘
                               │                                 │
                               ▼                                 ▼
┌────────────────────────────────────────┐  ┌────────────────────────┐
│           data_creator.py              │  │    card-hashes.json    │
├────────────────────────────────────────┤  └───────────┬────────────┘
│  1. Load card images from SQLite       │              │
│  2. Generate synthetic backgrounds     │              ▼
│  3. Place cards with random transforms │  ┌────────────────────────┐
│  4. Apply augmentation pipeline        │  │  Frontend Card Matcher │
│  5. Export YOLO pose dataset           │  │  (color grid cosine    │
│                                        │  │   similarity)          │
└──────────────────┬─────────────────────┘  └────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────┐
│              train.py                  │
├────────────────────────────────────────┤
│  1. Upload dataset to Modal            │
│  2. Train YOLO11s-pose on cloud GPU    │
│  3. Export to ONNX                      │
│  4. Quantize ONNX to int8              │
│  5. Download models to public/models/  │
└────────────────────────────────────────┘
```

## How Detection Works

The scanner uses a **dual-layer approach** to scan cards in real time:

| Layer | Model | Question it answers | Details |
|-------|-------|---------------------|---------|
| **Detection** | YOLO11s-pose (768×768) | *Where* is there a card? | Locates cards in the camera frame and regresses the 4 card corners as keypoints (handles any rotation). Single class (`card`), trained on synthetic data. Out-of-focus crops are filtered out via Laplacian variance so background cards don't get matched. |
| **Identification** | Color grid fingerprint | *Which* card is it? | Crops the detected region to the artwork area (adaptive per card layout), computes a 16×16 color grid with histogram equalization, and finds the best match via cosine similarity. Tests normal, 90°-rotated and horizontally-flipped orientations to handle landscape battlefields and mirrored photos. The user can drag the 4 corner keypoints on screen to manually fine-tune the crop — a perspective warp re-runs the matcher with the corrected quad. |

YOLO alone doesn't know which card it's looking at — it only finds rectangular card-shaped objects. The color grid matcher then takes each crop and identifies the specific card.

## Card Identification Pipeline

### Artwork Crop (adaptive per card layout)

Before any feature extraction, the card image is cropped to isolate the illustration. Different card types have different art layouts, so the crop bounds are picked per card from a small table — same bounds are used at scrape time (to compute the DB feature) and at match time (to compute the query feature), so cosine similarity stays apples-to-apples.

| Card type                                  | Bottom edge | Why                                                                                                                            |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `unit / spell / gear / rune`               | **0.55**    | Standard layout: art occupies the top half, text/stats below.                                                                  |
| `legend`                                   | **0.85**    | Legends have a smaller text box; the illustration extends further down.                                                        |
| `battlefield` + `*a*` / `*-star-*` variants | **0.95**    | Full-art cards (alt-arts, star variants) and battlefields (landscape art rotated to portrait) — almost the whole card is illustration. |

The horizontal bounds are fixed at 5%–95% across all types to trim the outer black border. Each card stores its `artBottom` in `card-hashes.json`; the matcher reads it and picks the matching query crop per candidate.

```text
Standard card (0.55)            Legend (0.85)             Full-art / battlefield (0.95)
┌──────────────────┐           ┌──────────────────┐      ┌──────────────────┐
│    Card Name     │           │    Card Name     │      │                  │
├──────────────────┤           │                  │      │                  │
│                  │           │                  │      │                  │
│   Illustration   │  ─55%─►   │   Illustration   │      │   Illustration   │
│                  │           │                  │      │   (full bleed)   │
├──────────────────┤           │                  │ ─85%►│                  │
│   Card Text      │           ├──────────────────┤      │                  │
│   Stats / Energy │           │   Card Text      │      │                  │ ─95%►
└──────────────────┘           └──────────────────┘      └──────────────────┘
```

### Color Grid Matching

Each card's artwork is converted into a compact numerical fingerprint:

```text
Artwork Crop              Histogram Eq.           16×16 Color Grid         Feature Vector
┌────────────────┐       ┌────────────────┐      ┌─┬─┬─┬─┬─┬─┬─┬─┐
│                │       │                │      │ │ │ │ │ │ │ │ │    [0.12, 0.34, 0.56,  ← R,G,B cell 1
│  Illustration  │ ────► │  Normalized    │ ───► ├─┼─┼─┼─┼─┼─┼─┼─┤     0.23, 0.45, 0.67,  ← R,G,B cell 2
│                │  eq.  │  Brightness    │      ├─┼─┼─┼─┼─┼─┼─┼─┤     ...
│                │       │                │      │ │ │ │ │ │ │ │ │     0.89, 0.12, 0.34]  ← R,G,B cell 256
└────────────────┘       └────────────────┘      └─┴─┴─┴─┴─┴─┴─┴─┘
                                                  256 cells             768 values (256 × 3 RGB)
```

1. **Histogram equalization**: Per-channel brightness normalization so dark photos match well-lit references
2. **Resize**: Equalized artwork is resized to 16×16 pixels
3. **Color extraction**: Each pixel's RGB values are normalized to 0-1 range
4. **Cosine similarity**: Query vector is compared against all stored card vectors
5. **Best match wins**: The card with the highest similarity is selected

### Full-Resolution Cropping

When uploading a multi-card image, the app resizes it to 2048px for YOLO detection (which processes at 768×768 internally), but crops each detected card from the **original full-resolution image**. This ensures each card has maximum pixel detail for the color grid, even when many cards share a single photo.

### Manual 4-Corner Correction

When YOLO's corner keypoints are off (slight angle error, clipped corner, perspective distortion from photographing at an angle), the user can drag the 4 corner handles on a selected detection to fit the card precisely. The handles appear on whichever detection is selected; dragging any of them deforms the quadrilateral freely — there's no rectangle constraint, so it captures real perspective.

On pointer-up, the app:

1. Geometrically sorts the 4 dragged points into visual TL → TR → BR → BL order (so the warp is robust to whichever corner the user moved past which other corner).
2. Solves an 8×8 linear system for the perspective matrix that maps the destination rectangle to the source quadrilateral.
3. Runs a bilinear-interpolated **perspective warp** over the original full-resolution image — un-distorting the card to an axis-aligned crop. If the user-drawn quad is wider than tall, the warp also rotates 90° to keep the matcher seeing a portrait layout (so `artBottom` still works).
4. Re-runs `identifyCard` on the new crop and updates the side panel with the new top-1 match.

The implementation lives in [src/lib/perspectiveCrop.js](src/lib/perspectiveCrop.js); UI/interaction in [src/components/identify/DetectionCanvas.jsx](src/components/identify/DetectionCanvas.jsx).

### Sharpness Filter

After YOLO produces oriented bounding boxes, each crop's **Laplacian variance** is measured at 64×64 grayscale. Crops below a configurable threshold (default 100) are dropped before identification — this stops the matcher from confidently labeling out-of-focus cards in the background of a photo as random matches. Sharpness can be tuned via `detector.sharpnessThreshold` from the dev console.

### Orientation Handling

Cards can be scanned in any rotation, mirrored (selfie cam, scan through glass), or laid out as landscape battlefields. The matcher tests up to three orientations per detection and keeps the best:

```text
┌─────────┐      ┌───────────────┐      ┌─────────┐
│         │      │               │      │         │
│  Card   │      │     Card      │      │  draC   │  (mirrored)
│         │      │               │      │         │
└─────────┘      └───────────────┘      └─────────┘
   Normal       Landscape (rot 90°)     Horizontal flip

Best similarity across the three is used
```

## Synthetic Dataset Generation

`data_creator.py` generates a synthetic YOLO pose training dataset by compositing card images onto randomized backgrounds with heavy augmentation. Each card is labeled with its 4 corners as keypoints. The goal is to train a model that detects cards in real-world camera frames and locates their corners precisely.

```bash
cd model
python data_creator.py
```

Generation is parallelized across all CPU cores using `ProcessPoolExecutor`.

### Augmentation Pipeline

Each training image goes through the following pipeline:

```text
Background Generation          Card Placement              Global Augmentations
┌───────────────────┐        ┌──────────────────┐        ┌────────────────────┐
│ - Solid color     │        │ - Random scale   │        │ - Brightness       │
│ - Gradient        │  ───►  │ - Random rotation│  ───►  │ - Contrast         │
│ - Perlin noise    │        │ - Perspective    │        │ - Saturation       │
│ - Blurred noise   │        │ - Shadow casting │        │ - Hue shift        │
│ - Two-tone split  │        │ - Overlap avoid  │        │ - Color jitter     │
│ - Real texture    │        │ - Sleeve overlay │        │ - Gaussian noise   │
│ + Lighting grad.  │        │ - 1-5 cards      │        │ - Motion blur      │
│ + Distractors     │        │                  │        │ - JPEG artifacts   │
└───────────────────┘        └──────────────────┘        │ - Vignette         │
                                                         │ - Cutout           │
                                                         └────────────────────┘
```

The generator picks one of four scene modes per image:

- **Standard scene** (~60%): 1–5 cards placed with random transforms and overlap avoidance.
- **Grid layout** (~25%, `GRID_PROB`): cards arranged in a 2×2 up to 5×6 grid with light jitter — simulates organized collection scans, including the dense tiny-card case YOLO previously failed at.
- **Close-up** (~15%, `CLOSEUP_PROB`): a single card scaled 0.85×–1.30× of the frame, optionally clipped by the image edges — teaches the model to keep detecting cards that fill or overflow the camera view.
- **Mosaic** (~25% of train images, `MOSAIC_PROB`): YOLOv4-style 4-quadrant composition with independent sub-scenes.

**Sleeve simulation** (`SLEEVE_PROB = 0.30`): before placement, ~30% of cards get a sleeve overlay — colored border, diagonal glare streak, and 0–3 specular highlights — so the detector learns the look of cards through plastic sleeves with reflections.

### Optional Assets

Place these in the `model/` directory before running the generator:

| Directory | Contents | Effect |
| --- | --- | --- |
| `textures/` | JPG/PNG photos of real surfaces (desks, mats, tables) | Used as backgrounds 40% of the time |
| `distractors/` | PNG objects with alpha (dice, tokens, sleeves) | Placed randomly to teach the model to ignore non-card objects |

### Configuration

Key settings at the top of `data_creator.py`:

| Setting               | Default     | Description                                                                  |
| --------------------- | ----------- | ---------------------------------------------------------------------------- |
| `IMAGES_PER_CARD`     | 150         | Synthetic images generated per card                                          |
| `OUTPUT_SIZE`         | 768         | Image dimensions (768×768) — matches training `imgsz` and detector input size |
| `MAX_CARDS_PER_IMAGE` | 5           | Maximum cards per standard scene                                             |
| `TRAIN_RATIO`         | 0.85        | Train/val split ratio                                                        |
| `CARD_SCALE_MIN/MAX`  | 0.10 / 0.95 | Card size range relative to image — high max lets cards fill the frame      |
| `ROTATION_RANGE`      | -75 to 75   | Rotation angle range in degrees                                              |
| `MOSAIC_PROB`         | 0.25        | Probability of YOLOv4-style 4-quadrant mosaic                                |
| `GRID_PROB`           | 0.25        | Probability of a grid layout (up to 5×6)                                     |
| `CLOSEUP_PROB`        | 0.15        | Probability of a single oversized card (possibly clipped by edges)           |
| `SLEEVE_PROB`         | 0.30        | Probability of applying sleeve overlay per card                              |

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
| `data.yaml` | YOLO config file. Points to train/val paths, defines class count (`nc: 1`), class names (`['card']`) and keypoint shape (`kpt_shape: [4, 2]`). Rewritten by `train.py` with remote paths during cloud training. |
| `train/` | 85% of the dataset. Used by YOLO to learn during training. |
| `val/` | 15% of the dataset. Used by YOLO during training to measure progress and pick the best checkpoint. |
| `images/` | Synthetic 768×768 JPG images generated by `data_creator.py`. Each contains 1–30 cards (single card up to a 5×6 grid) on randomized backgrounds. |
| `labels/` | One `.txt` per image (same name). Each line is one card detection in YOLO pose format. |

### Label Format (YOLO pose)

Labels are generated automatically by `data_creator.py` alongside each image. Since the cards are placed synthetically, the script knows the exact position, rotation, and scale of every card it composites — so it writes the corresponding label file with the precise corner coordinates. No manual annotation is needed.

Each line in a label file describes one card with an axis-aligned bounding box plus its 4 corner keypoints:

```
class cx cy w h x1 y1 x2 y2 x3 y3 x4 y4
```

Example: `0 0.612 0.418 0.647 0.583 0.288 0.399 0.508 0.138 0.935 0.434 0.705 0.721`

| Field | Meaning |
| --- | --- |
| `0` | Class ID (always `0` = card, since there's only one class) |
| `cx cy w h` | Center, width and height of the axis-aligned bounding box enclosing the 4 corners, normalized to 0-1. |
| `x1 y1` ... `x4 y4` | The 4 card corners as keypoints, normalized to 0-1, in TL → TR → BR → BL order relative to the card art. `kpt_shape: [4, 2]` means each keypoint carries only `(x, y)` — no visibility flag, since card corners are always considered visible. |

## Cloud Training

`train.py` handles training on [Modal](https://modal.com/) cloud GPUs:

```bash
modal run train.py                  # Upload dataset + train + export + download
modal run train.py --skip-upload    # Train only (dataset already uploaded)
modal run train.py --resume         # Resume from last.pt on the volume (runner was killed, etc.)
modal run train.py --export-only    # Export and download only (already trained)
```

Trains a YOLO11s-pose model on an **A100 GPU** at **`imgsz=768`** for up to **80 epochs** (with `patience=40` early stopping and `cos_lr=True`), exports to ONNX, automatically quantizes the ONNX model to int8 for optimal web performance, and copies the model files to `public/models/` for the web app.

> **`--resume`**: If the Modal runner is terminated mid-training (spot preemption, timeout, CLI disconnect without `--detach`), the last checkpoint is preserved on the volume. Run with `--resume` to pick up from where it left off — no dataset re-upload needed.

| Setting | Value |
|---------|-------|
| GPU | A100 |
| `imgsz` | 768 (matches `OUTPUT_SIZE` in data_creator and `inputSize` in yoloDetector.js) |
| `task` / `kpt_shape` | `pose` / `[4, 2]` (4 corner keypoints, x/y only) |
| `epochs` | 80 with `patience=40` |
| `batch` | 32 |
| `cos_lr` | True |
| `close_mosaic` | 15 (last ~19% of the schedule runs without mosaic augmentation) |
| `pose` / `box` / `cls` | 25.0 / 7.5 / 0.3 (keypoint loss weighted high for tight corner localization) |
| `hsv_v` / `mixup` / `degrees` | 0.6 / 0.2 / 3.0 |
| `fliplr` / `flipud` | 0.0 / 0.0 (no flips — see dataset notes above) |

Use `--detach` to run training in the background (you can close your terminal or shut down your PC):

```bash
modal run --detach train.py          # Launch and disconnect
modal run train.py --export-only     # Download results later
```

> Without `--detach`, the Modal container is canceled when the local CLI disconnects. The last saved `best.pt` checkpoint stays on the volume and you can recover it with `--export-only`.

## Model Formats & Optimization

The training pipeline automatically generates two optimized ONNX formats:

| Format | Speed | Use Case |
|--------|-------|----------|
| **ONNX (float32)** | Baseline | Modern browsers with ONNX Runtime |
| **ONNX (int8)** | Faster, smaller | Best performance, mobile-friendly |

```
Training ──► Export ONNX ──► Quantize int8 ──► Deploy to public/
best.pt      best.onnx       best_quantized     yolo11s-pose-riftbound-q8.onnx
```

The quantization step prints the actual file sizes and the size reduction it achieved.

No additional steps required — both formats are ready for use after `modal run train.py`.

**Settings UI**: Users can choose between **Normal (Float32)** and **Fast (Int8 Quantized)**. The preference is saved to localStorage and persists across sessions.

**ONNX Runtime Web**: ONNX is the only exported format (native int8 support, ~2.5 MB runtime). The int8 model is recommended for fast, mobile-friendly inference.

## Model & Dataset

| Resource | URL |
|----------|-----|
| YOLO11s-pose Model | <https://platform.ultralytics.com/nekoraru22/yolo11s-pose-riftbound> |
| Training Dataset | <https://platform.ultralytics.com/nekoraru22/datasets/dataset-pose-riftbound> |

## Project Structure

```text
riftbound-scanner-src/
├── model/
│   ├── cards_scraper.py    # Scraper + hash generator (artwork crop + histogram eq.)
│   ├── data_creator.py     # Synthetic dataset generator
│   ├── train.py            # Cloud training on Modal
│   ├── riftbound.db        # SQLite database
│   ├── dataset/            # Generated YOLO pose dataset
│   ├── textures/           # (optional) Real background images
│   └── distractors/        # (optional) Non-card PNG objects
├── public/
│   ├── cards/              # Optimized card images (WebP)
│   ├── card-hashes.json    # Color grid feature hashes (768 floats per card)
│   └── models/             # YOLO models (ONNX float32, ONNX-int8)
└── src/
    └── lib/
        ├── cardMatcher.js  # Color grid matching (cosine similarity)
        └── yoloDetector.js # YOLO11s-pose inference (ONNX)
```

## Example

<img width="2518" height="1288" alt="Sin título-1" src="https://github.com/user-attachments/assets/941b189b-494d-4756-baf0-63f694dd50cc" />

## Updating the Card Database

When a new RiftBound set drops or new promos are added to the official gallery, you only need to refresh the local card data — **you do not need to retrain YOLO** to recognize new cards. The detector finds "cards" generically (single class); the matcher is what identifies a specific card, and it only needs `card-hashes.json` updated.

### Quick update — most common case

Run the full scraper once. It re-fetches the gallery, downloads any new card images, and regenerates `card-hashes.json` from scratch:

```bash
cd model
python cards_scraper.py
```

That's it. After the run finishes, hard-refresh the web app (`Ctrl+Shift+R`) and the new cards will be matchable immediately.

What the scraper does, in order:

1. Fetches `https://riftbound.leagueoflegends.com/en-us/card-gallery/` and parses `__NEXT_DATA__`.
2. Inserts new rows into `model/riftbound.db` (`INSERT OR REPLACE`, so existing rows are updated).
3. **Wipes and recreates** `public/cards/` with all current cards as WebP. Landscape battlefields are rotated to portrait at this step.
4. Regenerates `public/card-hashes.json` with adaptive crop per card type.

### Just regenerate hashes (no re-download)

If you only changed feature-extraction code (`_compute_color_grid`, `_equalize_histogram`, `ART_REGIONS`, `GRID_SIZE`, etc.) and the card images on disk are already up to date:

```bash
cd model
python cards_scraper.py --only-hashes
```

This skips the network fetch and the image download/optimization pass and reuses the existing `public/cards/*.webp`. About 30 seconds for ~950 cards.

### When you actually do need to retrain YOLO

You only need to re-run training if you change something that affects detection (not identification). New cards alone do not require a retrain — they're just more rows in the matcher's lookup table.

| Change | Do you need to retrain YOLO? |
|--------|------|
| New cards added (new set / promos) | **No** — just `python cards_scraper.py` |
| New artwork style with very different shape/colors | Usually no, unless the model misses detecting them |
| Change `OUTPUT_SIZE`, `imgsz`, or model arch | Yes — `modal run --detach train.py` |
| New augmentation (sleeves, grids, close-ups, etc.) | Yes — regenerate dataset + train |

Retrain workflow when needed:

```bash
cd model
python data_creator.py            # Regenerate synthetic dataset locally (CPU)
modal run --detach train.py       # Upload + train on Modal A100, ~1–2 h
# When training finishes:
modal run train.py --export-only  # Download exported ONNX to public/models/
```

## TODO

- Improve card identification cards into big plastic sleeves
