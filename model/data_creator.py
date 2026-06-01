from __future__ import annotations

import os
import cv2
import math
import shutil
import random
import sqlite3
import numpy as np
from tqdm import tqdm
from PIL import Image, ImageEnhance

from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed


# Random number generator
rng = np.random.default_rng(seed=42)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "riftbound.db")
CARDS_DIR = os.path.join(BASE_DIR, "..", "public", "cards")
DATASET_DIR = os.path.join(BASE_DIR, "dataset")
TEXTURES_DIR = os.path.join(BASE_DIR, "textures")
DISTRACTORS_DIR = os.path.join(BASE_DIR, "distractors")

# Dataset generation settings
IMAGES_PER_CARD = 150
OUTPUT_SIZE = 768
MAX_CARDS_PER_IMAGE = 5
TRAIN_RATIO = 0.85

# Card placement settings
CARD_SCALE_MIN = 0.10
CARD_SCALE_MAX = 0.95  # cards can now fill almost the entire frame
ROTATION_RANGE = (-75, 75)

# Augmentation probabilities
BRIGHTNESS_RANGE = (0.6, 1.4)
CONTRAST_RANGE = (0.6, 1.4)
SATURATION_RANGE = (0.7, 1.3)
HUE_SHIFT_RANGE = (-10, 10)
NOISE_PROB = 0.35
BLUR_PROB = 0.25
PERSPECTIVE_PROB = 0.5
SHADOW_PROB = 0.7
# Edge-degrading augmentations kept low: they hurt the pose keypoint signal
# the model needs to predict tight, pixel-accurate card corners.
MOTION_BLUR_PROB = 0.05
JPEG_ARTIFACT_PROB = 0.10
CUTOUT_PROB = 0.15
MOSAIC_PROB = 0.25
GRID_PROB = 0.25       # bigger share of grid layouts (was 0.15)
CLOSEUP_PROB = 0.15    # single card filling >70% of the frame, possibly clipped
SLEEVE_PROB = 0.30     # sleeve overlay (glare, specular, colored border) per card
DISTRACTOR_PROB = 0.4
# No horizontal flip: real cards never appear mirror-flipped in a camera feed,
# and flipping would also break the keypoint convention (idx 0 = TL of card
# art) since the flip swaps which sprite corner sits at pixel (0, 0).
VIGNETTE_PROB = 0.3
COLOR_JITTER_PROB = 0.4
NUM_WORKERS = max(1, (os.cpu_count() or 1) - 1)


def load_card_paths_from_db() -> list[str]:
    """
    Loads card image paths from the SQLite database.

    Reads all image_path entries from the cards table and resolves them
    to absolute paths, filtering out any that no longer exist on disk.

    Returns:
        A list of absolute paths to existing card images.
    """
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT image_path FROM cards").fetchall()
    conn.close()

    paths = []
    for (rel_path,) in rows:
        full = os.path.join(BASE_DIR, rel_path)
        if os.path.exists(full):
            paths.append(full)
    return paths


def load_texture_paths() -> list[str]:
    """
    Loads background texture image paths from the textures directory.

    Creates the textures directory if it doesn't exist. Supported
    formats are JPG, JPEG, PNG, and WebP.

    Returns:
        A list of absolute paths to texture images.
    """
    if not os.path.exists(TEXTURES_DIR):
        os.makedirs(TEXTURES_DIR, exist_ok=True)
        return []

    extensions = {'.jpg', '.jpeg', '.png', '.webp'}
    paths = []
    for f in Path(TEXTURES_DIR).iterdir():
        if f.suffix.lower() in extensions:
            paths.append(str(f))
    return paths


def load_distractor_paths() -> list[str]:
    """
    Loads distractor object image paths from the distractors directory.

    Creates the distractors directory if it doesn't exist. Only PNG and
    WebP formats are supported since they can carry an alpha channel.

    Returns:
        A list of absolute paths to distractor images.
    """
    if not os.path.exists(DISTRACTORS_DIR):
        os.makedirs(DISTRACTORS_DIR, exist_ok=True)
        return []

    extensions = {'.png', '.webp'}  # Formats that support alpha
    paths = []
    for f in Path(DISTRACTORS_DIR).iterdir():
        if f.suffix.lower() in extensions:
            paths.append(str(f))
    return paths


def get_textures(_cache: list[str] = []) -> list[str]:
    """
    Returns cached texture paths, loading them on first call.

    Returns:
        A list of absolute paths to texture images.
    """
    if not _cache:
        _cache.extend(load_texture_paths())
    return _cache


def get_distractors(_cache: list[str] = []) -> list[str]:
    """
    Returns cached distractor paths, loading them on first call.

    Returns:
        A list of absolute paths to distractor images.
    """
    if not _cache:
        _cache.extend(load_distractor_paths())
    return _cache


# Alpha threshold for considering a pixel part of the card.
# Pillow's WebP encoder leaves a few semi-transparent pixels around rounded
# corners; anything above ~16/255 is safely opaque content.
_ALPHA_THRESHOLD = 16


def _trim_card_to_alpha(card_img: np.ndarray) -> np.ndarray:
    """
    Crops a card image down to the bounding box of its visible (opaque) pixels.

    The source WebP cards are tight scans but can include a 1-3% transparent
    margin around the rounded corners. Training labels are derived from the
    rectangle [0,0]-[cw,ch] of the loaded image, so any transparent margin
    becomes "fake card" area in the pose label ground truth. Trimming the
    image to its alpha content guarantees the labeled rectangle matches the
    visible card edges as closely as possible.

    Arguments:
        card_img: BGR or BGRA card image.

    Returns:
        The card image cropped to its opaque content. If the input has no
        alpha channel, it is returned unchanged.
    """
    if card_img.ndim != 3 or card_img.shape[2] < 4:
        return card_img

    alpha = card_img[:, :, 3]
    mask = alpha > _ALPHA_THRESHOLD
    if not mask.any():
        return card_img

    ys = np.nonzero(mask.any(axis=1))[0]
    xs = np.nonzero(mask.any(axis=0))[0]
    y0, y1 = int(ys[0]), int(ys[-1]) + 1
    x0, x1 = int(xs[0]), int(xs[-1]) + 1

    # Skip the copy when the bbox already matches the full image.
    if y0 == 0 and x0 == 0 and y1 == card_img.shape[0] and x1 == card_img.shape[1]:
        return card_img
    return card_img[y0:y1, x0:x1].copy()


def _load_card(path: str) -> np.ndarray | None:
    """
    Loads a card image and trims it to its alpha bounding box.

    Centralized loader so every code path that places a card on a background
    gets the same tight-cropped input — keeping pose labels consistent with
    the visible card geometry.

    Arguments:
        path: Absolute path to a card image file.

    Returns:
        A BGR/BGRA numpy array trimmed to visible content, or None if the
        file cannot be read.
    """
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None
    return _trim_card_to_alpha(img)


def generate_gradient_background(size: int, dark: bool = False) -> np.ndarray:
    """
    Generates a gradient background with a random direction.

    Creates a two-color gradient that can be vertical, horizontal,
    diagonal, or radial.

    Arguments:
        size: The width and height of the square output image.
        dark: If True, constrains colors to the 0-50 range.

    Returns:
        A gradient background image as a numpy array.
    """
    hi = 50 if dark else 240
    c1 = np.array([random.randint(0, hi) for _ in range(3)], dtype=np.float32)
    c2 = np.array([random.randint(0, hi) for _ in range(3)], dtype=np.float32)

    direction = random.choice(['vertical', 'horizontal', 'diagonal', 'radial'])
    t = _gradient_field(size, direction)

    # Blend two colors using the interpolation field
    bg = (c1[None, None, :] * (1 - t[:, :, None]) + c2[None, None, :] * t[:, :, None])
    return bg.astype(np.uint8)


def _gradient_field(size: int, direction: str) -> np.ndarray:
    """
    Computes a 2D interpolation field in [0, 1] for gradient backgrounds.

    Arguments:
        size: The width and height of the square field.
        direction: One of 'vertical', 'horizontal', 'diagonal', or 'radial'.

    Returns:
        A (size, size) float32 array with values between 0 and 1.
    """
    xs = np.linspace(0, 1, size, dtype=np.float32)
    ys = np.linspace(0, 1, size, dtype=np.float32)
    Y, X = np.meshgrid(ys, xs, indexing='ij')

    if direction == 'vertical':
        return Y
    if direction == 'horizontal':
        return X
    if direction == 'diagonal':
        return (X + Y) / 2.0

    # radial
    dist = np.sqrt((X - 0.5) ** 2 + (Y - 0.5) ** 2)
    return np.clip(dist / dist.max(), 0, 1)


def generate_perlin_noise_background(size: int, dark: bool = False) -> np.ndarray:
    """
    Generates a smooth noise-based background using multiple octaves.

    Simulates Perlin-like noise by combining three octaves of random
    noise at different scales, then applies a random color tint.

    Arguments:
        size: The width and height of the square output image.
        dark: If True, scales output to a darker range.

    Returns:
        A noise background image as a numpy array.
    """
    # Simple multi-octave noise simulation
    bg = np.zeros((size, size, 3), dtype=np.float32)

    for octave in range(3):
        scale = 2 ** (octave + 2)
        noise = rng.random((size // scale + 1, size // scale + 1, 3))
        noise_resized = cv2.resize(noise, (size, size), interpolation=cv2.INTER_CUBIC)
        bg += noise_resized * (0.5 ** octave)

    # Normalize and convert
    max_val, offset = (40, 0) if dark else (200, 30)
    bg = (bg / bg.max() * max_val + offset).astype(np.uint8)

    # Random color tint
    tint = np.array([random.uniform(0.8, 1.2) for _ in range(3)])
    bg = np.clip(bg * tint, 0, 255).astype(np.uint8)

    return bg


def _load_random_texture(size: int) -> np.ndarray | None:
    """
    Attempts to load and crop a random real texture image.

    Arguments:
        size: The target width and height.

    Returns:
        A cropped/resized texture image, or None if unavailable.
    """
    textures = get_textures()
    if not textures or random.random() >= 0.4:
        return None

    tex = cv2.imread(random.choice(textures))
    if tex is None:
        return None

    h, w = tex.shape[:2]
    if h > size and w > size:
        x = random.randint(0, w - size)
        y = random.randint(0, h - size)
        tex = tex[y:y+size, x:x+size]
    else:
        tex = cv2.resize(tex, (size, size))

    if random.random() < 0.5:
        tex = np.rot90(tex, random.randint(1, 3))
        tex = cv2.resize(tex, (size, size))

    return tex


def _generate_two_tone_background(size: int, dark: bool = False) -> np.ndarray:
    """
    Generates a blurred two-tone split background.

    Arguments:
        size: The width and height of the square output image.
        dark: If True, constrains colors to a dark range.

    Returns:
        A two-tone background image as a numpy array.
    """
    bg = np.zeros((size, size, 3), dtype=np.uint8)
    lo, hi = (0, 50) if dark else (30, 220)
    c1 = [random.randint(lo, hi) for _ in range(3)]
    c2 = [random.randint(lo, hi) for _ in range(3)]
    split = random.randint(size // 4, 3 * size // 4)
    if random.random() < 0.5:
        bg[:split, :] = c1
        bg[split:, :] = c2
    else:
        bg[:, :split] = c1
        bg[:, split:] = c2
    return cv2.GaussianBlur(bg, (51, 51), 0)


def generate_random_background(size: int) -> np.ndarray:
    """
    Generates a random background for a training image.

    If real textures are available in the textures directory, uses one
    40% of the time. Otherwise picks from five synthetic types: solid
    color, gradient, perlin noise, blurred noise, or two-tone split.

    Arguments:
        size: The width and height of the square output image.

    Returns:
        A background image as a numpy array.
    """
    tex = _load_random_texture(size)
    if tex is not None:
        return tex

    choice = random.randint(0, 4)

    # 40% chance of dark background to train on black-on-black scenarios
    dark = random.random() < 0.4

    if choice == 0:
        lo, hi = (0, 50) if dark else (0, 240)
        color = [random.randint(lo, hi) for _ in range(3)]
        return np.full((size, size, 3), color, dtype=np.uint8)
    if choice == 1:
        return generate_gradient_background(size, dark=dark)
    if choice == 2:
        return generate_perlin_noise_background(size, dark=dark)
    if choice == 3:
        lo, hi = (0, 60) if dark else (40, 200)
        bg = rng.integers(lo, hi, (size, size, 3), dtype=np.uint8)
        return cv2.GaussianBlur(bg, (15, 15), 0)
    return _generate_two_tone_background(size, dark=dark)


def add_vignette(image: np.ndarray) -> np.ndarray:
    """
    Adds a vignette effect that darkens the edges of the image.

    Simulates the natural light falloff of a camera lens. Applied
    with a probability of VIGNETTE_PROB.

    Arguments:
        image: The input image as a numpy array.

    Returns:
        The image with vignette applied, or the original if skipped.
    """
    if random.random() > VIGNETTE_PROB:
        return image

    h, w = image.shape[:2]

    # Create vignette mask
    x = np.linspace(-1, 1, w)
    y = np.linspace(-1, 1, h)
    X, Y = np.meshgrid(x, y)

    # Elliptical distance from center
    dist = np.sqrt(X**2 + Y**2)

    # Vignette intensity (random)
    intensity = random.uniform(0.3, 0.7)
    vignette = 1 - dist * intensity
    vignette = np.clip(vignette, 0, 1)

    # Apply to image
    result = image.astype(np.float32)
    for i in range(3):
        result[:, :, i] *= vignette

    return result.astype(np.uint8)


def add_lighting_gradient(image: np.ndarray) -> np.ndarray:
    """
    Simulates directional lighting with a gradient overlay.

    Creates a smooth brightness gradient across the image at a random
    angle to mimic uneven ambient lighting conditions.

    Arguments:
        image: The input image as a numpy array.

    Returns:
        The image with lighting gradient applied, or the original if skipped.
    """
    if random.random() > 0.4:
        return image

    h, w = image.shape[:2]

    # Random light direction
    angle = random.uniform(0, 2 * math.pi)

    # Create gradient
    x = np.linspace(0, 1, w)
    y = np.linspace(0, 1, h)
    X, Y = np.meshgrid(x, y)

    gradient = (X * math.cos(angle) + Y * math.sin(angle))
    gradient = (gradient - gradient.min()) / (gradient.max() - gradient.min())

    # Light intensity variation
    dark = random.uniform(0.7, 0.9)
    light = random.uniform(1.0, 1.2)
    gradient = dark + gradient * (light - dark)

    # Apply
    result = image.astype(np.float32)
    for i in range(3):
        result[:, :, i] *= gradient

    return np.clip(result, 0, 255).astype(np.uint8)


def rotate_point(x: float, y: float, cx: float, cy: float, angle_rad: float) -> tuple[float, float]:
    """
    Rotates a point around a center.

    Arguments:
        x: The x coordinate of the point.
        y: The y coordinate of the point.
        cx: The x coordinate of the rotation center.
        cy: The y coordinate of the rotation center.
        angle_rad: The rotation angle in radians.

    Returns:
        The rotated point as an (x, y) tuple.
    """
    dx, dy = x - cx, y - cy
    cos_a, sin_a = math.cos(angle_rad), math.sin(angle_rad)
    return cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a


def apply_sleeve_overlay(card_img: np.ndarray) -> np.ndarray:
    """
    Simulates a card sleeve overlay: colored border, plastic glare and specular highlights.

    The function operates on the unrotated card image. The card is kept inside
    the original canvas — a colored frame is drawn over the card edges, then a
    diagonal glare streak and small specular spots are blended on top of the
    artwork. This trains the YOLO model to keep detecting cards even when the
    border and surface look different from the raw scans.

    Arguments:
        card_img: BGR or BGRA card image.

    Returns:
        The card image with the sleeve effect applied (same shape/channels).
    """
    h, w = card_img.shape[:2]

    # Ensure BGRA so we can preserve any existing alpha
    if card_img.shape[2] == 3:
        alpha = np.full((h, w, 1), 255, dtype=np.uint8)
        card_img = np.concatenate([card_img, alpha], axis=2)

    rgb = card_img[:, :, :3].astype(np.float32)
    alpha = card_img[:, :, 3:4].astype(np.float32) / 255.0

    # 1) Colored sleeve border (semi-transparent, follows card edges).
    border_thickness = max(2, int(min(w, h) * random.uniform(0.012, 0.030)))
    border_color = np.array([
        random.randint(0, 255), random.randint(0, 255), random.randint(0, 255),
    ], dtype=np.float32)
    # Bias toward neutrals & blues (most common sleeves) half the time
    if random.random() < 0.5:
        gray = random.randint(0, 90)
        border_color = np.array([gray + random.randint(-10, 10),
                                 gray + random.randint(-10, 10),
                                 gray + random.randint(-10, 10)], dtype=np.float32)
        border_color = np.clip(border_color, 0, 255)

    border_mask = np.zeros((h, w), dtype=np.float32)
    border_mask[:border_thickness, :] = 1.0
    border_mask[-border_thickness:, :] = 1.0
    border_mask[:, :border_thickness] = 1.0
    border_mask[:, -border_thickness:] = 1.0
    # Slight blur so the sleeve edge isn't perfectly sharp
    border_mask = cv2.GaussianBlur(border_mask, (5, 5), 0)
    border_strength = random.uniform(0.6, 1.0)
    bm = (border_mask * border_strength)[:, :, np.newaxis]
    rgb = rgb * (1 - bm) + border_color[None, None, :] * bm

    # 2) Diagonal glare streak (bright, soft, partially transparent).
    if random.random() < 0.75:
        glare = np.zeros((h, w), dtype=np.float32)
        angle = random.uniform(-30, 30)  # near-vertical streak
        streak_w = int(w * random.uniform(0.08, 0.22))
        cx = random.randint(int(w * 0.2), int(w * 0.8))
        pts = np.array([
            [cx - streak_w, 0], [cx + streak_w, 0],
            [cx + streak_w + int(h * math.tan(math.radians(angle))), h],
            [cx - streak_w + int(h * math.tan(math.radians(angle))), h],
        ], dtype=np.int32)
        cv2.fillPoly(glare, [pts], 1.0)
        glare = cv2.GaussianBlur(glare, (51, 51), 0)
        glare /= max(glare.max(), 1e-6)
        glare_strength = random.uniform(0.25, 0.55)
        gm = (glare * glare_strength)[:, :, np.newaxis]
        rgb = rgb * (1 - gm) + 255.0 * gm

    # 3) Specular highlights (a couple of soft bright spots).
    for _ in range(random.randint(0, 3)):
        sx = random.randint(0, w - 1)
        sy = random.randint(0, h - 1)
        radius = random.randint(max(4, w // 40), max(8, w // 12))
        spot = np.zeros((h, w), dtype=np.float32)
        cv2.circle(spot, (sx, sy), radius, 1.0, -1)
        spot = cv2.GaussianBlur(spot, (radius * 2 + 1, radius * 2 + 1), 0)
        spot /= max(spot.max(), 1e-6)
        strength = random.uniform(0.15, 0.45)
        sm = (spot * strength)[:, :, np.newaxis]
        rgb = rgb * (1 - sm) + 255.0 * sm

    rgb = np.clip(rgb, 0, 255)
    out = np.concatenate([rgb, (alpha * 255).astype(np.float32)], axis=2).astype(np.uint8)
    return out


def apply_perspective(card_img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Applies a slight perspective distortion to a card image.

    Randomly shifts the four corners inward to simulate viewing the
    card from a non-perpendicular angle.

    Arguments:
        card_img: The input card image with alpha channel.

    Returns:
        A tuple of (warped_image, transformation_matrix).
    """
    h, w = card_img.shape[:2]
    max_offset = int(min(w, h) * 0.10)  # Increased from 0.08

    src_pts = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    dst_pts = np.array([
        [random.randint(0, max_offset), random.randint(0, max_offset)],
        [w - random.randint(0, max_offset), random.randint(0, max_offset)],
        [w - random.randint(0, max_offset), h - random.randint(0, max_offset)],
        [random.randint(0, max_offset), h - random.randint(0, max_offset)],
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    warped = cv2.warpPerspective(
        card_img, M, (w, h),
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0)
    )
    return warped, M


def add_card_shadow(
    bg: np.ndarray,
    corners: list[tuple[float, float]],
    shadow_offset: tuple[int, int] | None = None,
    shadow_blur: int | None = None,
    shadow_opacity: float | None = None,
) -> np.ndarray:
    """
    Adds a realistic diffuse shadow under a card.

    Renders a blurred polygon offset from the card corners to simulate
    a drop shadow. All parameters are randomized when not provided.

    Arguments:
        bg: The background image to draw the shadow on.
        corners: Normalized (0-1) corner coordinates of the card.
        shadow_offset: Pixel offset (dx, dy) for the shadow position.
        shadow_blur: Gaussian blur kernel size for the shadow edge.
        shadow_opacity: Shadow darkness factor between 0 and 1.

    Returns:
        The background image with the shadow composited.
    """
    h, w = bg.shape[:2]

    # Randomize shadow parameters for variety
    if shadow_offset is None:
        shadow_offset = (random.randint(5, 20), random.randint(5, 20))
    if shadow_blur is None:
        shadow_blur = random.choice([11, 15, 21, 25, 31])
    if shadow_opacity is None:
        shadow_opacity = random.uniform(0.25, 0.5)

    # Convert normalized corners to pixel coordinates
    pts = np.array([
        [int(c[0] * w) + shadow_offset[0], int(c[1] * h) + shadow_offset[1]]
        for c in corners
    ], dtype=np.int32)

    # Create shadow mask
    mask = np.zeros((h, w), dtype=np.float32)
    cv2.fillPoly(mask, [pts], 1.0)

    # Blur the shadow
    mask = cv2.GaussianBlur(mask, (shadow_blur, shadow_blur), 0)

    # Apply shadow
    bg_float = bg.astype(np.float32)
    shadow_factor = 1 - mask[:, :, np.newaxis] * shadow_opacity
    bg_float *= shadow_factor

    return bg_float.astype(np.uint8)


def apply_color_jitter(image: np.ndarray) -> np.ndarray:
    """
    Applies random per-channel brightness and scale shifts.

    Each BGR channel is independently scaled and shifted to simulate
    white balance variations. Applied with a probability of COLOR_JITTER_PROB.

    Arguments:
        image: The input image as a numpy array.

    Returns:
        The color-jittered image, or the original if skipped.
    """
    if random.random() > COLOR_JITTER_PROB:
        return image

    result = image.astype(np.float32)

    for i in range(3):
        shift = random.uniform(-15, 15)
        scale = random.uniform(0.9, 1.1)
        result[:, :, i] = result[:, :, i] * scale + shift

    return np.clip(result, 0, 255).astype(np.uint8)


def apply_hue_shift(image: np.ndarray) -> np.ndarray:
    """
    Shifts the hue of the image by a small random amount.

    Converts to HSV, offsets the hue channel, and converts back.
    The shift range is defined by HUE_SHIFT_RANGE.

    Arguments:
        image: The input BGR image as a numpy array.

    Returns:
        The hue-shifted image, or the original if the shift is zero.
    """
    shift = random.randint(*HUE_SHIFT_RANGE)
    if shift == 0:
        return image

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV).astype(np.int16)
    hsv[:, :, 0] = (hsv[:, :, 0] + shift) % 180
    hsv = hsv.astype(np.uint8)

    return cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)


def augment_color(image: np.ndarray) -> np.ndarray:
    """
    Applies a full pipeline of color augmentations to an image.

    Randomly adjusts brightness, contrast, saturation, sharpness,
    hue, and color jitter. Optionally adds gaussian noise or blur.

    Arguments:
        image: The input BGR image as a numpy array.

    Returns:
        The augmented image.
    """
    pil_img = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

    # Brightness
    brightness = random.uniform(*BRIGHTNESS_RANGE)
    pil_img = ImageEnhance.Brightness(pil_img).enhance(brightness)

    # Contrast
    contrast = random.uniform(*CONTRAST_RANGE)
    pil_img = ImageEnhance.Contrast(pil_img).enhance(contrast)

    # Saturation
    saturation = random.uniform(*SATURATION_RANGE)
    pil_img = ImageEnhance.Color(pil_img).enhance(saturation)

    # Sharpness (new)
    if random.random() < 0.3:
        sharpness = random.uniform(0.5, 1.5)
        pil_img = ImageEnhance.Sharpness(pil_img).enhance(sharpness)

    result = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    # Hue shift
    if random.random() < 0.3:
        result = apply_hue_shift(result)

    # Color jitter
    result = apply_color_jitter(result)

    # Gaussian noise
    if random.random() < NOISE_PROB:
        noise_std = random.uniform(3, 15)
        noise = rng.normal(0, noise_std, result.shape).astype(np.int16)
        result = np.clip(result.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    # Gaussian blur
    if random.random() < BLUR_PROB:
        k = random.choice([3, 5, 7])
        result = cv2.GaussianBlur(result, (k, k), 0)

    return result


def apply_motion_blur(image: np.ndarray) -> np.ndarray:
    """
    Applies directional motion blur to simulate camera movement.

    Creates a linear blur kernel at a random angle and convolves it
    with the image. Applied with a probability of MOTION_BLUR_PROB.

    Arguments:
        image: The input image as a numpy array.

    Returns:
        The blurred image, or the original if skipped.
    """
    if random.random() > MOTION_BLUR_PROB:
        return image

    size = random.choice([5, 7, 9, 11])

    # Create motion blur kernel
    kernel = np.zeros((size, size))
    kernel[size // 2, :] = 1.0 / size

    # Rotate kernel for random direction
    angle = random.uniform(0, 180)
    M = cv2.getRotationMatrix2D((size / 2, size / 2), angle, 1)
    kernel = cv2.warpAffine(kernel, M, (size, size))
    kernel = kernel / kernel.sum()  # Normalize

    return cv2.filter2D(image, -1, kernel)


def apply_jpeg_artifacts(image: np.ndarray) -> np.ndarray:
    """
    Simulates JPEG compression artifacts.

    Encodes and decodes the image at a low quality setting to
    introduce realistic compression noise. Applied with a
    probability of JPEG_ARTIFACT_PROB.

    Arguments:
        image: The input image as a numpy array.

    Returns:
        The degraded image, or the original if skipped.
    """
    if random.random() > JPEG_ARTIFACT_PROB:
        return image

    quality = random.randint(40, 80)
    _, encoded = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, quality])
    decoded = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    return decoded if decoded is not None else image


def _corners_to_pose_label(corners: list[tuple[float, float]]) -> str:
    """
    Builds a YOLO-pose label string from 4 normalized card corners.

    The output format is: `0 cx cy w h x1 y1 x2 y2 x3 y3 x4 y4` where
    cx/cy/w/h is the axis-aligned bounding box enclosing the corners,
    and (x1..y4) are the 4 keypoints in TL, TR, BR, BL order — all
    normalized to [0, 1].

    Arguments:
        corners: 4 (x, y) corner tuples in normalized image space.

    Returns:
        The pose label string with 13 whitespace-separated tokens.
    """
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    cx = sum(xs) / 4
    cy = sum(ys) / 4
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    w = x_max - x_min
    h = y_max - y_min
    kpts = " ".join(f"{c[0]:.6f} {c[1]:.6f}" for c in corners)
    return f"0 {cx:.6f} {cy:.6f} {w:.6f} {h:.6f} {kpts}"


def _parse_label_centers(labels: list[str]) -> list[tuple[float, float]]:
    """
    Extracts normalized center coordinates from pose label strings.

    In the pose format the center is the second and third tokens
    (`class cx cy w h x1 y1 ... x4 y4`), so no averaging is needed.

    Arguments:
        labels: The pose label strings in YOLO format.

    Returns:
        A list of (cx, cy) tuples in normalized coordinates.
    """
    centers = []
    for label in labels:
        parts = label.split()
        if len(parts) >= 3:
            centers.append((float(parts[1]), float(parts[2])))
    return centers


def _is_far_from_centers(
    x: int, y: int, size: int, w: int, h: int,
    centers: list[tuple[float, float]],
) -> bool:
    """
    Checks if a cutout rectangle is far enough from all card centers.

    Arguments:
        x: Left edge of the cutout in pixels.
        y: Top edge of the cutout in pixels.
        size: Side length of the cutout in pixels.
        w: Image width in pixels.
        h: Image height in pixels.
        centers: Normalized card center coordinates.

    Returns:
        True if the cutout doesn't overlap any card center.
    """
    cx_norm = (x + size / 2) / w
    cy_norm = (y + size / 2) / h
    return all(
        abs(cx_norm - ccx) >= 0.15 or abs(cy_norm - ccy) >= 0.15
        for ccx, ccy in centers
    )


def _fill_cutout(result: np.ndarray, x: int, y: int, size: int) -> None:
    """
    Fills a cutout region with a random pattern (in-place).

    Arguments:
        result: The image to modify.
        x: Left edge of the cutout in pixels.
        y: Top edge of the cutout in pixels.
        size: Side length of the cutout in pixels.
    """
    fill_type = random.choice(['gray', 'black', 'white', 'noise'])
    if fill_type == 'gray':
        result[y:y+size, x:x+size] = random.randint(100, 180)
    elif fill_type == 'black':
        result[y:y+size, x:x+size] = 0
    elif fill_type == 'white':
        result[y:y+size, x:x+size] = 255
    else:
        result[y:y+size, x:x+size] = rng.integers(0, 255, (size, size, 3), dtype=np.uint8)


def apply_cutout(image: np.ndarray, labels: list[str]) -> np.ndarray:
    """
    Applies random rectangular cutout patches to the image.

    Places 1-3 filled rectangles on the image to simulate occlusion.
    Patches are positioned away from card centers to avoid hiding
    the detection targets. Applied with a probability of CUTOUT_PROB.

    Arguments:
        image: The input image as a numpy array.
        labels: The pose label strings used to locate card centers.

    Returns:
        The image with cutout patches, or the original if skipped.
    """
    if random.random() > CUTOUT_PROB:
        return image

    h, w = image.shape[:2]
    result = image.copy()
    card_centers = _parse_label_centers(labels)

    for _ in range(random.randint(1, 3)):
        patch_size = random.randint(20, 80)
        for _ in range(10):
            x = random.randint(0, w - patch_size)
            y = random.randint(0, h - patch_size)
            if _is_far_from_centers(x, y, patch_size, w, h, card_centers):
                _fill_cutout(result, x, y, patch_size)
                break

    return result


def add_distractor_objects(bg: np.ndarray, num_distractors: int | None = None) -> np.ndarray:
    """
    Composites random distractor objects onto the background.

    Loads images from the distractors directory and places them at
    random positions, scales, and rotations. These non-card objects
    help the model learn to ignore irrelevant items.
    Applied with a probability of DISTRACTOR_PROB.

    Arguments:
        bg: The background image to place distractors on.
        num_distractors: Number of objects to place. Randomized if None.

    Returns:
        The background with distractors composited.
    """
    distractors = get_distractors()

    if not distractors or random.random() > DISTRACTOR_PROB:
        return bg

    if num_distractors is None:
        num_distractors = random.randint(1, 3)

    h_bg, w_bg = bg.shape[:2]

    for _ in range(num_distractors):
        dist_path = random.choice(distractors)
        dist_img = cv2.imread(dist_path, cv2.IMREAD_UNCHANGED)

        if dist_img is None:
            continue

        # Random scale
        scale = random.uniform(0.05, 0.20)
        new_h = int(h_bg * scale)
        new_w = int(new_h * dist_img.shape[1] / dist_img.shape[0])

        if new_w < 10 or new_h < 10:
            continue

        dist_img = cv2.resize(dist_img, (new_w, new_h), interpolation=cv2.INTER_AREA)

        # Random position
        x = random.randint(0, w_bg - new_w)
        y = random.randint(0, h_bg - new_h)

        # Random rotation
        if random.random() < 0.7:
            angle = random.uniform(-45, 45)
            M = cv2.getRotationMatrix2D((new_w / 2, new_h / 2), angle, 1)
            dist_img = cv2.warpAffine(dist_img, M, (new_w, new_h),
                                       borderMode=cv2.BORDER_CONSTANT,
                                       borderValue=(0, 0, 0, 0))

        # Alpha blending
        if dist_img.shape[2] == 4:
            alpha = dist_img[:, :, 3:4].astype(np.float32) / 255.0
            rgb = dist_img[:, :, :3].astype(np.float32)
        else:
            alpha = np.ones((new_h, new_w, 1), dtype=np.float32)
            rgb = dist_img.astype(np.float32)

        # Clip to image bounds
        x2 = min(x + new_w, w_bg)
        y2 = min(y + new_h, h_bg)
        w_clip = x2 - x
        h_clip = y2 - y

        bg_region = bg[y:y2, x:x2].astype(np.float32)
        blended = rgb[:h_clip, :w_clip] * alpha[:h_clip, :w_clip] + bg_region * (1 - alpha[:h_clip, :w_clip])
        bg[y:y2, x:x2] = blended.astype(np.uint8)

    return bg


def place_card_on_bg(
    bg: np.ndarray,
    card_img: np.ndarray,
    angle_deg: float,
    scale: float,
    pos_x: float,
    pos_y: float,
) -> tuple[np.ndarray, list[tuple[float, float]] | None]:
    """
    Places a scaled and rotated card on a background.

    Handles perspective distortion, alpha compositing, and computes the
    four keypoint corner coordinates in normalized image space. Keypoints
    follow the original card-art orientation: idx 0 = TL of art, idx 1 = TR,
    idx 2 = BR, idx 3 = BL.

    Arguments:
        bg: The background image to place the card on.
        card_img: The card image (BGR or BGRA).
        angle_deg: The rotation angle in degrees.
        scale: The scale factor relative to background height.
        pos_x: The horizontal position (0-1, normalized).
        pos_y: The vertical position (0-1, normalized).

    Returns:
        A tuple of (modified_background, corners) where corners is a
        list of 4 keypoint corner points in normalized coordinates, or
        None if the card doesn't fit.
    """
    h_bg, w_bg = bg.shape[:2]

    # Scale card
    card_h, card_w = card_img.shape[:2]
    new_h = int(h_bg * scale)
    new_w = int(new_h * card_w / card_h)
    if new_w < 10 or new_h < 10:
        return bg, None

    card_resized = cv2.resize(card_img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    # Add alpha channel if missing
    if card_resized.shape[2] == 3:
        alpha = np.ones((new_h, new_w, 1), dtype=np.uint8) * 255
        card_resized = np.concatenate([card_resized, alpha], axis=2)

    # Optional perspective distortion
    persp_matrix = None
    if random.random() < PERSPECTIVE_PROB:
        card_resized, persp_matrix = apply_perspective(card_resized)

    # Rotation setup
    ch, cw = card_resized.shape[:2]
    cx, cy = cw / 2, ch / 2

    # Original card corners
    corners = np.array([
        [0, 0],
        [cw, 0],
        [cw, ch],
        [0, ch],
    ], dtype=np.float32)

    # Apply perspective to corners if used
    if persp_matrix is not None:
        ones = np.ones((4, 1), dtype=np.float32)
        pts_h = np.hstack([corners, ones])
        transformed = (persp_matrix @ pts_h.T).T
        corners = transformed[:, :2] / transformed[:, 2:3]

    # Rotation matrix (OpenCV uses opposite direction)
    rot_matrix = cv2.getRotationMatrix2D((cx, cy), -angle_deg, 1.0)

    # Calculate new bounding box size
    cos_a = abs(rot_matrix[0, 0])
    sin_a = abs(rot_matrix[0, 1])
    new_bw = int(cw * cos_a + ch * sin_a)
    new_bh = int(cw * sin_a + ch * cos_a)

    # Adjust translation
    rot_matrix[0, 2] += (new_bw - cw) / 2
    rot_matrix[1, 2] += (new_bh - ch) / 2

    rotated = cv2.warpAffine(
        card_resized, rot_matrix, (new_bw, new_bh),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0)
    )

    # Calculate rotated corners
    rotated_corners = []
    for pt in corners:
        px = rot_matrix[0, 0] * pt[0] + rot_matrix[0, 1] * pt[1] + rot_matrix[0, 2]
        py = rot_matrix[1, 0] * pt[0] + rot_matrix[1, 1] * pt[1] + rot_matrix[1, 2]
        rotated_corners.append([px, py])

    # Position on background
    off_x = int(pos_x * w_bg - new_bw / 2)
    off_y = int(pos_y * h_bg - new_bh / 2)

    # Final corners in normalized background coordinates. We compute these BEFORE
    # alpha compositing so we can reject the placement (without mutating bg) if
    # any corner falls outside the frame. The previous version clamped corners
    # to [0, 1] which produced degenerate, non-rectangular pose labels for
    # partially-visible cards — YOLO-pose then learned inconsistent keypoints,
    # which is the root cause of the "cuts corners / grabs background" symptom.
    final_corners = []
    for rc in rotated_corners:
        fx = (rc[0] + off_x) / w_bg
        fy = (rc[1] + off_y) / h_bg
        final_corners.append((fx, fy))

    # Require all 4 corners inside the frame. A small epsilon allows tiny
    # rounding without rejecting otherwise-valid placements.
    eps = 1e-3
    if not all(-eps <= fx <= 1 + eps and -eps <= fy <= 1 + eps for fx, fy in final_corners):
        return bg, None

    # Clamp the (already valid) corners to [0, 1] to absorb the epsilon.
    final_corners = [(max(0.0, min(1.0, fx)), max(0.0, min(1.0, fy))) for fx, fy in final_corners]

    # Check if card fits (at least partially) — should always pass given the
    # corner check above, but keep as a defensive guard.
    if off_x + new_bw < 0 or off_y + new_bh < 0 or off_x >= w_bg or off_y >= h_bg:
        return bg, None

    # Clip to visible region
    src_x1 = max(0, -off_x)
    src_y1 = max(0, -off_y)
    src_x2 = min(new_bw, w_bg - off_x)
    src_y2 = min(new_bh, h_bg - off_y)

    dst_x1 = max(0, off_x)
    dst_y1 = max(0, off_y)
    dst_x2 = dst_x1 + (src_x2 - src_x1)
    dst_y2 = dst_y1 + (src_y2 - src_y1)

    # Alpha compositing
    card_region = rotated[src_y1:src_y2, src_x1:src_x2]
    if card_region.size == 0:
        return bg, None

    alpha = card_region[:, :, 3:4].astype(np.float32) / 255.0
    rgb = card_region[:, :, :3].astype(np.float32)
    bg_region = bg[dst_y1:dst_y2, dst_x1:dst_x2].astype(np.float32)

    blended = (rgb * alpha + bg_region * (1 - alpha)).astype(np.uint8)
    bg[dst_y1:dst_y2, dst_x1:dst_x2] = blended

    return bg, final_corners


def _place_single_card(
    bg: np.ndarray,
    card_path: str,
    occupied: list[tuple[float, float]],
) -> tuple[np.ndarray, list[tuple[float, float]] | None, tuple[float, float]]:
    """
    Loads, transforms, and places a single card on the background.

    Reads the card image, picks random scale/angle/flip parameters,
    finds a position that avoids overlap with already placed cards,
    and composites the card onto the background.

    Arguments:
        bg: The background image to place the card on.
        card_path: Absolute path to the card image file.
        occupied: List of (x, y) center positions of already placed cards.

    Returns:
        A tuple of (modified_bg, corners_or_None, position) where corners
        is a list of 4 keypoint corner points or None if placement failed.
    """
    card_img = _load_card(card_path)
    if card_img is None:
        return bg, None, (0.0, 0.0)

    if random.random() < SLEEVE_PROB:
        card_img = apply_sleeve_overlay(card_img)

    angle = random.uniform(*ROTATION_RANGE)
    scale = random.uniform(CARD_SCALE_MIN, CARD_SCALE_MAX)

    # Position: try to avoid overlap
    px, py = 0.5, 0.5
    for _ in range(15):
        px = random.uniform(0.12, 0.88)
        py = random.uniform(0.12, 0.88)
        if not occupied or all(
            math.hypot(px - ox, py - oy) > scale * 0.35
            for ox, oy in occupied
        ):
            break

    bg, corners = place_card_on_bg(bg, card_img, angle, scale, px, py)
    return bg, corners, (px, py)


def generate_grid_image(card_paths: list[str]) -> tuple[np.ndarray, list[str]]:
    """
    Generates a training image with cards arranged in a grid layout.

    Places cards in a 2x2, 2x3, or 3x3 grid with small gaps and slight
    random jitter, simulating how users lay out cards on a surface.

    Arguments:
        card_paths: List of absolute paths to card images.

    Returns:
        A tuple of (image, labels) where labels is a list of pose
        label strings in YOLO keypoint format.
    """
    bg = generate_random_background(OUTPUT_SIZE)
    bg = add_lighting_gradient(bg)

    # Mix of small and large grids — larger grids force tiny per-card scales,
    # which is exactly the regime the model previously failed at.
    rows, cols = random.choice([
        (2, 2), (2, 3), (3, 3),
        (3, 4), (4, 4), (4, 5), (5, 5), (5, 6),
    ])
    n_cards = rows * cols
    selected = random.sample(card_paths, min(n_cards, len(card_paths)))

    # Card size: fit grid into ~85% of the image
    margin = 0.05 if max(rows, cols) >= 4 else 0.075
    usable = 1.0 - 2 * margin
    gap = random.uniform(0.005, 0.025)
    card_w = (usable - gap * (cols - 1)) / cols
    card_h = (usable - gap * (rows - 1)) / rows
    scale = min(card_w, card_h * 0.72)  # cards are taller than wide (~1.39 ratio)

    labels = []
    card_corners_for_shadows = []
    idx = 0

    for r in range(rows):
        for c in range(cols):
            if idx >= len(selected):
                break
            card_img = _load_card(selected[idx])
            idx += 1
            if card_img is None:
                continue

            if random.random() < SLEEVE_PROB:
                card_img = apply_sleeve_overlay(card_img)

            # Grid position with slight jitter
            px = margin + c * (scale + gap) + scale / 2 + random.uniform(-0.01, 0.01)
            py = margin + r * (scale / 0.72 + gap) + (scale / 0.72) / 2 + random.uniform(-0.01, 0.01)

            # Small angle jitter (-5 to 5 degrees)
            angle = random.uniform(-5, 5)

            bg, corners = place_card_on_bg(bg, card_img, angle, scale, px, py)
            if corners is None:
                continue

            card_corners_for_shadows.append(corners)
            labels.append(_corners_to_pose_label(corners))

    if random.random() < SHADOW_PROB:
        for corners in card_corners_for_shadows:
            bg = add_card_shadow(bg, corners)

    bg = augment_color(bg)
    bg = add_vignette(bg)
    bg = apply_motion_blur(bg)
    bg = apply_jpeg_artifacts(bg)

    return bg, labels


def generate_closeup_image(card_paths: list[str]) -> tuple[np.ndarray, list[str]]:
    """
    Generates an image with a single card filling most of the frame.

    Picks a tight scale (0.75-0.92) and a small rotation, then tries a few
    positions until the rotated card fits fully inside the frame. Fully-visible
    cards are required because the rest of the pipeline now rejects any
    placement with corners outside [0,1] — clamping those corners produced
    inconsistent pose labels that hurt localization precision.

    Arguments:
        card_paths: List of absolute paths to card images.

    Returns:
        A tuple of (image, labels) where labels is a list of pose
        label strings in YOLO keypoint format.
    """
    bg = generate_random_background(OUTPUT_SIZE)
    bg = add_lighting_gradient(bg)
    bg = add_distractor_objects(bg)

    card_path = random.choice(card_paths)
    card_img = _load_card(card_path)
    if card_img is None:
        # Fallback to a regular image to avoid producing an empty sample
        return generate_image(card_paths, use_mosaic=False)

    if random.random() < SLEEVE_PROB:
        card_img = apply_sleeve_overlay(card_img)

    angle = random.uniform(-20, 20)  # closeups rarely have extreme rotation

    # Try a few scale/position combos until one fits fully. We start near the
    # max and back off if rotation pushes a corner out of frame.
    corners = None
    for attempt in range(6):
        scale = random.uniform(0.75, 0.92) - attempt * 0.03
        px = random.uniform(0.45, 0.55)
        py = random.uniform(0.45, 0.55)
        bg, corners = place_card_on_bg(bg, card_img, angle, scale, px, py)
        if corners is not None:
            break

    labels: list[str] = []
    if corners is not None:
        if random.random() < SHADOW_PROB:
            bg = add_card_shadow(bg, corners)
        labels.append(_corners_to_pose_label(corners))

    bg = augment_color(bg)
    bg = add_vignette(bg)
    bg = apply_motion_blur(bg)
    bg = apply_jpeg_artifacts(bg)

    return bg, labels


def generate_image(card_paths: list[str], use_mosaic: bool = False) -> tuple[np.ndarray, list[str]]:
    """
    Generates a single synthetic training image with 1-5 cards.

    Composes a background, places cards with random transforms,
    adds shadows, and applies the full augmentation pipeline.
    May delegate to mosaic generation based on probability.

    Arguments:
        card_paths: List of absolute paths to card images.
        use_mosaic: Whether mosaic generation is allowed.

    Returns:
        A tuple of (image, labels) where labels is a list of pose
        label strings in YOLO keypoint format.
    """

    if use_mosaic and random.random() < MOSAIC_PROB:
        return generate_mosaic_image(card_paths)

    if random.random() < GRID_PROB:
        return generate_grid_image(card_paths)

    if random.random() < CLOSEUP_PROB:
        return generate_closeup_image(card_paths)

    bg = generate_random_background(OUTPUT_SIZE)

    # Add lighting effects to background
    bg = add_lighting_gradient(bg)

    # Add distractor objects before cards
    bg = add_distractor_objects(bg)

    n_cards = random.randint(1, MAX_CARDS_PER_IMAGE)
    selected = random.sample(card_paths, min(n_cards, len(card_paths)))

    labels = []
    occupied = []
    card_corners_for_shadows = []

    for card_path in selected:
        bg, corners, pos = _place_single_card(bg, card_path, occupied)
        if corners is None:
            continue

        occupied.append(pos)
        card_corners_for_shadows.append(corners)

        # Pose format: class cx cy w h x1 y1 x2 y2 x3 y3 x4 y4
        labels.append(_corners_to_pose_label(corners))

    # Add shadows (render before color augmentation for realism)
    if random.random() < SHADOW_PROB:
        for corners in card_corners_for_shadows:
            bg = add_card_shadow(bg, corners)

    # Apply global augmentations
    bg = augment_color(bg)
    bg = add_vignette(bg)
    bg = apply_motion_blur(bg)
    bg = apply_jpeg_artifacts(bg)
    bg = apply_cutout(bg, labels)

    return bg, labels


def _fill_mosaic_quadrant(
    card_paths: list[str],
    region: tuple[int, int, int, int],
    mosaic_size: int,
) -> tuple[np.ndarray, list[str]]:
    """
    Generates a sub-image with cards for one mosaic quadrant.

    Creates an independent background, places 1-2 cards, and maps
    their keypoint corners into the full mosaic coordinate space.

    Arguments:
        card_paths: List of absolute paths to card images.
        region: The (x1, y1, x2, y2) pixel bounds of the quadrant.
        mosaic_size: The full mosaic image width/height in pixels.

    Returns:
        A tuple of (resized_sub_image, labels) ready to paste into
        the mosaic.
    """
    x1, y1, x2, y2 = region
    rw, rh = x2 - x1, y2 - y1

    sub_bg = generate_random_background(OUTPUT_SIZE)
    sub_bg = add_lighting_gradient(sub_bg)

    labels = []
    n_cards = random.randint(1, 2)
    selected = random.sample(card_paths, min(n_cards, len(card_paths)))

    for card_path in selected:
        card_img = _load_card(card_path)
        if card_img is None:
            continue

        if random.random() < SLEEVE_PROB:
            card_img = apply_sleeve_overlay(card_img)

        angle = random.uniform(*ROTATION_RANGE)
        scale = random.uniform(0.25, 0.65)

        sub_bg, corners = place_card_on_bg(
            sub_bg, card_img, angle, scale,
            random.uniform(0.2, 0.8), random.uniform(0.2, 0.8),
        )
        if corners is None:
            continue

        transformed = [
            (max(0.0, min(1.0, (x1 + c[0] * rw) / mosaic_size)),
             max(0.0, min(1.0, (y1 + c[1] * rh) / mosaic_size)))
            for c in corners
        ]
        labels.append(_corners_to_pose_label(transformed))

    sub_resized = cv2.resize(sub_bg, (rw, rh))
    return sub_resized, labels


def generate_mosaic_image(card_paths: list[str]) -> tuple[np.ndarray, list[str]]:
    """
    Generates a mosaic image with 4 quadrants (YOLOv4+ style).

    Splits the output image into four regions at a random point,
    fills each with an independent sub-scene, and applies global
    augmentations to the combined result.

    Arguments:
        card_paths: List of absolute paths to card images.

    Returns:
        A tuple of (mosaic_image, labels) with pose labels in YOLO keypoint format.
    """
    size = OUTPUT_SIZE
    mosaic = np.zeros((size, size, 3), dtype=np.uint8)
    all_labels: list[str] = []

    cx = random.randint(size // 4, 3 * size // 4)
    cy = random.randint(size // 4, 3 * size // 4)

    regions = [
        (0, 0, cx, cy),
        (cx, 0, size, cy),
        (0, cy, cx, size),
        (cx, cy, size, size),
    ]

    for region in regions:
        x1, y1, x2, y2 = region
        if (x2 - x1) < 50 or (y2 - y1) < 50:
            continue

        sub_img, labels = _fill_mosaic_quadrant(card_paths, region, size)
        mosaic[y1:y2, x1:x2] = sub_img
        all_labels.extend(labels)

    mosaic = augment_color(mosaic)
    mosaic = add_vignette(mosaic)
    mosaic = apply_motion_blur(mosaic)
    mosaic = apply_jpeg_artifacts(mosaic)

    return mosaic, all_labels


_worker_card_paths: list[str] = []


def _init_worker(card_paths: list[str], base_seed: int) -> None:
    """
    Initializes random state and shared data in each worker process.

    Called once per worker at pool startup. Seeds both the stdlib
    random module and the numpy random generator with a unique
    per-process seed to ensure varied output across workers.

    Arguments:
        card_paths: List of absolute paths to card images.
        base_seed: Base seed value combined with PID for uniqueness.
    """
    global rng, _worker_card_paths
    worker_seed = base_seed + os.getpid()
    random.seed(worker_seed)
    rng = np.random.default_rng(seed=worker_seed)
    _worker_card_paths = card_paths


def _generate_and_save(task: tuple[int, str]) -> bool:
    """
    Generates a single synthetic image and saves it to disk.

    Worker function executed in a subprocess. Generates one image
    with its labels and writes both to the appropriate split directory.

    Arguments:
        task: A tuple of (image_index, split_name).

    Returns:
        True if the image was saved, False if skipped (no valid labels).
    """
    idx, split = task
    use_mosaic = split == "train"
    img, labels = generate_image(_worker_card_paths, use_mosaic=use_mosaic)

    if not labels:
        return False

    name = f"synth_{idx:06d}"
    img_path = os.path.join(DATASET_DIR, split, "images", f"{name}.jpg")
    lbl_path = os.path.join(DATASET_DIR, split, "labels", f"{name}.txt")

    cv2.imwrite(img_path, img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    with open(lbl_path, "w") as f:
        f.write("\n".join(labels) + "\n")

    return True


def create_dataset(card_paths: list[str]) -> None:
    """
    Generates the complete synthetic dataset with train/val splits.

    Creates the folder structure, generates all images with labels,
    and writes the data.yaml configuration file for YOLO training.

    Arguments:
        card_paths: List of absolute paths to card images.
    """
    # Create folder structure
    for split in ("train", "val"):
        os.makedirs(os.path.join(DATASET_DIR, split, "images"), exist_ok=True)
        os.makedirs(os.path.join(DATASET_DIR, split, "labels"), exist_ok=True)

    total_images = len(card_paths) * IMAGES_PER_CARD // MAX_CARDS_PER_IMAGE
    train_count = int(total_images * TRAIN_RATIO)

    print(f"Generating {total_images} images ({train_count} train, {total_images - train_count} val)...")
    print(f"Using textures: {len(get_textures())} found in {TEXTURES_DIR}")
    print(f"Using distractors: {len(get_distractors())} found in {DISTRACTORS_DIR}")
    print(f"Using {NUM_WORKERS} worker processes")

    indices = list(range(total_images))
    random.shuffle(indices)
    train_set = set(indices[:train_count])

    tasks = [
        (i, "train" if i in train_set else "val")
        for i in range(total_images)
    ]
    base_seed = random.randint(0, 2**31)
    empty_count = 0

    with ProcessPoolExecutor(
        max_workers=NUM_WORKERS,
        initializer=_init_worker,
        initargs=(card_paths, base_seed),
    ) as executor:
        futures = {executor.submit(_generate_and_save, task): task for task in tasks}
        try:
            for future in tqdm(as_completed(futures), total=len(futures), desc="Generating dataset"):
                if not future.result():
                    empty_count += 1
        except KeyboardInterrupt:
            for f in futures:
                f.cancel()
            executor.shutdown(wait=False, cancel_futures=True)
            raise

    if empty_count > 0:
        print(f"Warning: {empty_count} images skipped (no valid labels)")

    # Generate data.yaml
    yaml_content = f"""path: {DATASET_DIR}
train: train/images
val: val/images

nc: 1
names: ['card']
kpt_shape: [4, 2]
"""
    with open(os.path.join(DATASET_DIR, "data.yaml"), "w") as f:
        f.write(yaml_content)

    print(f"Dataset saved to {DATASET_DIR}")
    print(f"Config: {os.path.join(DATASET_DIR, 'data.yaml')}")


def main() -> None:
    """
    Entry point for the dataset generation pipeline.

    Loads card images from the database, prints the current
    configuration, and generates the full synthetic dataset.
    """
    if not os.path.exists(DB_PATH):
        print("ERROR: riftbound.db not found. Run cards_scraper.py first.")
        return

    # Clean up old dataset artifacts
    for path in [DATASET_DIR, os.path.join(BASE_DIR, "dataset.tar.gz"), os.path.join(BASE_DIR, "dataset.tar.gz.sha256")]:
        if os.path.isdir(path):
            shutil.rmtree(path)
            print(f"Removed {path}")
        elif os.path.isfile(path):
            os.remove(path)
            print(f"Removed {path}")

    card_paths = load_card_paths_from_db()
    if not card_paths:
        print("ERROR: No card images found. Run cards_scraper.py first.")
        return

    print(f"Cards available: {len(card_paths)}")
    print(f"\n{'='*50}")
    print("DATASET GENERATION SETTINGS:")
    print(f"  Images per card: {IMAGES_PER_CARD}")
    print(f"  Max cards per image: {MAX_CARDS_PER_IMAGE}")
    print(f"  Output size: {OUTPUT_SIZE}x{OUTPUT_SIZE}")
    print(f"  Train ratio: {TRAIN_RATIO}")
    print(f"  Mosaic probability: {MOSAIC_PROB}")
    print(f"{'='*50}\n")

    create_dataset(card_paths)
    print("Generation complete!")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.")
