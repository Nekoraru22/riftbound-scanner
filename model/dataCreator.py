import math
import os
import random
import sqlite3

import cv2
import numpy as np
from tqdm import tqdm
from PIL import Image, ImageEnhance

# Random number generator
rng = np.random.default_rng(seed=42)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "riftbound.db")
CARDS_DIR = os.path.join(BASE_DIR, "cards")
DATASET_DIR = os.path.join(BASE_DIR, "dataset")

# Dataset generation settings
IMAGES_PER_CARD = 100
OUTPUT_SIZE = 640
MAX_CARDS_PER_IMAGE = 3
TRAIN_RATIO = 0.85

# Card placement settings
CARD_SCALE_MIN = 0.15
CARD_SCALE_MAX = 0.55
ROTATION_RANGE = (-45, 45)

# Augmentation settings
BRIGHTNESS_RANGE = (0.7, 1.3)
CONTRAST_RANGE = (0.7, 1.3)
NOISE_PROB = 0.3
BLUR_PROB = 0.2
PERSPECTIVE_PROB = 0.4


def load_card_paths_from_db() -> list[str]:
    """
    Loads card image paths from the SQLite database.

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


def generate_random_background(size: int) -> np.ndarray:
    """
    Generates a random synthetic background.

    Creates either a solid color, vertical gradient, or textured noise background.

    Arguments:
        size: The width and height of the square background.

    Returns:
        A background image as a numpy array.
    """
    bg = np.zeros((size, size, 3), dtype=np.uint8)
    choice = random.randint(0, 2)

    if choice == 0:
        # Solid color
        color = [random.randint(20, 240) for _ in range(3)]
        bg[:] = color
    elif choice == 1:
        # Vertical gradient
        c1 = np.array([random.randint(20, 240) for _ in range(3)])
        c2 = np.array([random.randint(20, 240) for _ in range(3)])
        for y in range(size):
            t = y / size
            bg[y, :] = (c1 * (1 - t) + c2 * t).astype(np.uint8)
    else:
        # Textured noise
        bg = rng.integers(40, 200, (size, size, 3), dtype=np.uint8)
        bg = cv2.GaussianBlur(bg, (15, 15), 0)

    return bg


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
        The rotated point as (x, y) tuple.
    """
    dx, dy = x - cx, y - cy
    cos_a, sin_a = math.cos(angle_rad), math.sin(angle_rad)
    return cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a


def apply_perspective(card_img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Applies a slight perspective distortion to a card image.

    Arguments:
        card_img: The input card image with alpha channel.

    Returns:
        A tuple of (warped_image, transformation_matrix).
    """
    h, w = card_img.shape[:2]
    max_offset = int(min(w, h) * 0.08)

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


def augment_color(image: np.ndarray) -> np.ndarray:
    """
    Applies color augmentations to an image.

    Randomly adjusts brightness, contrast, saturation, and optionally
    adds gaussian noise or blur.

    Arguments:
        image: The input image as a numpy array.

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
    saturation = random.uniform(0.8, 1.2)
    pil_img = ImageEnhance.Color(pil_img).enhance(saturation)

    result = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    # Gaussian noise
    if random.random() < NOISE_PROB:
        noise = rng.normal(0, random.uniform(3, 12), result.shape).astype(np.int16)
        result = np.clip(result.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    # Blur
    if random.random() < BLUR_PROB:
        k = random.choice([3, 5])
        result = cv2.GaussianBlur(result, (k, k), 0)

    return result


def place_card_on_bg(
    bg: np.ndarray,
    card_img: np.ndarray,
    angle_deg: float,
    scale: float,
    pos_x: float,
    pos_y: float
) -> tuple[np.ndarray, list[tuple[float, float]] | None]:
    """
    Places a rotated card on a background image.

    Arguments:
        bg: The background image to place the card on.
        card_img: The card image to place.
        angle_deg: The rotation angle in degrees.
        scale: The scale factor relative to background height.
        pos_x: The horizontal position (0-1, normalized).
        pos_y: The vertical position (0-1, normalized).

    Returns:
        A tuple of (modified_background, obb_corners) where obb_corners
        is a list of 4 corner points in normalized coordinates, or None
        if the card doesn't fit.
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

    # Check if card fits (at least partially)
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

    # Final corners in normalized background coordinates
    final_corners = []
    for rc in rotated_corners:
        fx = (rc[0] + off_x) / w_bg
        fy = (rc[1] + off_y) / h_bg
        final_corners.append((fx, fy))

    # Verify corners are mostly inside the image
    inside = sum(1 for fx, fy in final_corners if 0 <= fx <= 1 and 0 <= fy <= 1)
    if inside < 3:
        return bg, None

    # Clamp corners to valid range
    final_corners = [(max(0.0, min(1.0, fx)), max(0.0, min(1.0, fy))) for fx, fy in final_corners]

    return bg, final_corners


def generate_image(card_paths: list[str]) -> tuple[np.ndarray, list[str]]:
    """
    Generates a synthetic training image with 1-3 cards.

    Arguments:
        card_paths: List of paths to card images.

    Returns:
        A tuple of (image, labels) where labels is a list of OBB
        label strings in YOLO format.
    """
    bg = generate_random_background(OUTPUT_SIZE)

    n_cards = random.randint(1, MAX_CARDS_PER_IMAGE)
    selected = random.sample(card_paths, min(n_cards, len(card_paths)))

    labels = []
    occupied = []  # Track used centers to avoid excessive overlap

    for card_path in selected:
        card_img = cv2.imread(card_path, cv2.IMREAD_UNCHANGED)
        if card_img is None:
            continue

        angle = random.uniform(*ROTATION_RANGE)
        scale = random.uniform(CARD_SCALE_MIN, CARD_SCALE_MAX)

        # Position: try to avoid overlap
        px, py = 0.5, 0.5
        for _ in range(10):
            px = random.uniform(0.15, 0.85)
            py = random.uniform(0.15, 0.85)
            if not occupied or all(
                math.hypot(px - ox, py - oy) > scale * 0.4
                for ox, oy in occupied
            ):
                break

        bg, corners = place_card_on_bg(bg, card_img, angle, scale, px, py)
        if corners is None:
            continue

        occupied.append((px, py))

        # OBB format: class x1 y1 x2 y2 x3 y3 x4 y4
        coords = " ".join(f"{c[0]:.6f} {c[1]:.6f}" for c in corners)
        labels.append(f"0 {coords}")

    # Apply global color augmentations
    bg = augment_color(bg)

    return bg, labels


def create_dataset(card_paths: list[str]) -> None:
    """
    Generates the complete synthetic dataset.

    Creates train and val splits with images and OBB labels,
    plus a data.yaml configuration file for YOLO training.

    Arguments:
        card_paths: List of paths to card images.
    """
    # Create folder structure
    for split in ("train", "val"):
        os.makedirs(os.path.join(DATASET_DIR, split, "images"), exist_ok=True)
        os.makedirs(os.path.join(DATASET_DIR, split, "labels"), exist_ok=True)

    total_images = len(card_paths) * IMAGES_PER_CARD // MAX_CARDS_PER_IMAGE
    train_count = int(total_images * TRAIN_RATIO)

    print(f"Generating {total_images} images ({train_count} train, {total_images - train_count} val)...")

    indices = list(range(total_images))
    random.shuffle(indices)
    train_set = set(indices[:train_count])

    for i in tqdm(range(total_images), desc="Generating dataset"):
        split = "train" if i in train_set else "val"

        img, labels = generate_image(card_paths)

        if not labels:
            continue

        name = f"synth_{i:06d}"
        img_path = os.path.join(DATASET_DIR, split, "images", f"{name}.jpg")
        lbl_path = os.path.join(DATASET_DIR, split, "labels", f"{name}.txt")

        cv2.imwrite(img_path, img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        with open(lbl_path, "w") as f:
            f.write("\n".join(labels) + "\n")

    # Generate data.yaml
    yaml_content = f"""path: {DATASET_DIR}
train: train/images
val: val/images

nc: 1
names: ['card']
"""
    with open(os.path.join(DATASET_DIR, "data.yaml"), "w") as f:
        f.write(yaml_content)

    print(f"Dataset saved to {DATASET_DIR}")
    print(f"Config: {os.path.join(DATASET_DIR, 'data.yaml')}")


def main() -> None:
    # Check for database and card images
    if not os.path.exists(DB_PATH):
        print("ERROR: riftbound.db not found. Run cards_scraper.py first.")
        return

    # Load card image paths
    card_paths = load_card_paths_from_db()
    if not card_paths:
        print("ERROR: No card images found. Run cards_scraper.py first.")
        return
    print(f"Cards available: {len(card_paths)}")

    # Create dataset
    create_dataset(card_paths)
    print("Generation complete!")


if __name__ == "__main__":
    main()
