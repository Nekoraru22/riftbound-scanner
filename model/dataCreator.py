"""
Riftbound Synthetic Dataset Generator for YOLO11n-OBB
Genera imágenes sintéticas con cartas rotadas sobre fondos variados,
y etiquetas en formato OBB (Oriented Bounding Box).
"""

import glob
import json
import math
import os
import random
import sqlite3

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
from tqdm import tqdm

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "riftbound.db")
CARDS_DIR = os.path.join(BASE_DIR, "cards")
BG_DIR = os.path.join(BASE_DIR, "backgrounds")
DATASET_DIR = os.path.join(BASE_DIR, "dataset")

# --- Config ---
IMAGES_PER_CARD = 100
OUTPUT_SIZE = 640          # YOLO input size
MAX_CARDS_PER_IMAGE = 3
TRAIN_RATIO = 0.85
CARD_SCALE_MIN = 0.15
CARD_SCALE_MAX = 0.55
ROTATION_RANGE = (-45, 45)
BRIGHTNESS_RANGE = (0.7, 1.3)
CONTRAST_RANGE = (0.7, 1.3)
NOISE_PROB = 0.3
BLUR_PROB = 0.2
PERSPECTIVE_PROB = 0.4


def load_card_paths_from_db() -> list[str]:
    """Lee las rutas de imágenes de cartas desde SQLite."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT image_path FROM cards").fetchall()
    conn.close()
    paths = []
    for (rel_path,) in rows:
        full = os.path.join(BASE_DIR, rel_path)
        if os.path.exists(full):
            paths.append(full)
    return paths


def load_backgrounds() -> list[np.ndarray]:
    """Carga fondos de la carpeta backgrounds/."""
    bgs = []
    os.makedirs(BG_DIR, exist_ok=True)
    for ext in ("*.jpg", "*.jpeg", "*.png", "*.webp"):
        for path in glob.glob(os.path.join(BG_DIR, ext)):
            img = cv2.imread(path)
            if img is not None:
                bgs.append(img)
    return bgs


def generate_random_background(size: int) -> np.ndarray:
    """Genera un fondo aleatorio (sólido, gradiente o con textura)."""
    bg = np.zeros((size, size, 3), dtype=np.uint8)
    choice = random.randint(0, 2)

    if choice == 0:
        # Color sólido
        color = [random.randint(20, 240) for _ in range(3)]
        bg[:] = color
    elif choice == 1:
        # Gradiente vertical
        c1 = np.array([random.randint(20, 240) for _ in range(3)])
        c2 = np.array([random.randint(20, 240) for _ in range(3)])
        for y in range(size):
            t = y / size
            bg[y, :] = (c1 * (1 - t) + c2 * t).astype(np.uint8)
    else:
        # Ruido de textura
        bg = np.random.randint(40, 200, (size, size, 3), dtype=np.uint8)
        bg = cv2.GaussianBlur(bg, (15, 15), 0)

    return bg


def rotate_point(x: float, y: float, cx: float, cy: float, angle_rad: float):
    """Rota un punto alrededor de un centro."""
    dx, dy = x - cx, y - cy
    cos_a, sin_a = math.cos(angle_rad), math.sin(angle_rad)
    return cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a


def apply_perspective(card_img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Aplica distorsión de perspectiva leve. Devuelve imagen y matriz de transformación."""
    h, w = card_img.shape[:2]
    max_offset = int(min(w, h) * 0.08)

    src_pts = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst_pts = np.float32([
        [random.randint(0, max_offset), random.randint(0, max_offset)],
        [w - random.randint(0, max_offset), random.randint(0, max_offset)],
        [w - random.randint(0, max_offset), h - random.randint(0, max_offset)],
        [random.randint(0, max_offset), h - random.randint(0, max_offset)],
    ])

    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    warped = cv2.warpPerspective(card_img, M, (w, h), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    return warped, M


def augment_color(image: np.ndarray) -> np.ndarray:
    """Aplica augmentaciones de color a la imagen completa."""
    pil_img = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))

    # Brillo
    brightness = random.uniform(*BRIGHTNESS_RANGE)
    pil_img = ImageEnhance.Brightness(pil_img).enhance(brightness)

    # Contraste
    contrast = random.uniform(*CONTRAST_RANGE)
    pil_img = ImageEnhance.Contrast(pil_img).enhance(contrast)

    # Saturación
    saturation = random.uniform(0.8, 1.2)
    pil_img = ImageEnhance.Color(pil_img).enhance(saturation)

    result = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    # Ruido gaussiano
    if random.random() < NOISE_PROB:
        noise = np.random.normal(0, random.uniform(3, 12), result.shape).astype(np.int16)
        result = np.clip(result.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    # Blur
    if random.random() < BLUR_PROB:
        k = random.choice([3, 5])
        result = cv2.GaussianBlur(result, (k, k), 0)

    return result


def place_card_on_bg(bg: np.ndarray, card_img: np.ndarray, angle_deg: float, scale: float, pos_x: float, pos_y: float):
    """
    Coloca una carta rotada sobre el fondo.
    Devuelve (bg_modificado, esquinas_obb) o (bg, None) si no cabe.
    """
    h_bg, w_bg = bg.shape[:2]

    # Escalar carta
    card_h, card_w = card_img.shape[:2]
    new_h = int(h_bg * scale)
    new_w = int(new_h * card_w / card_h)
    if new_w < 10 or new_h < 10:
        return bg, None

    card_resized = cv2.resize(card_img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    # Añadir canal alfa si no tiene
    if card_resized.shape[2] == 3:
        alpha = np.ones((new_h, new_w, 1), dtype=np.uint8) * 255
        card_resized = np.concatenate([card_resized, alpha], axis=2)

    # Perspectiva opcional
    persp_M = None
    if random.random() < PERSPECTIVE_PROB:
        card_resized, persp_M = apply_perspective(card_resized)

    # Rotación
    angle_rad = math.radians(angle_deg)
    ch, cw = card_resized.shape[:2]
    cx, cy = cw / 2, ch / 2

    # Esquinas originales de la carta
    corners = np.array([
        [0, 0],
        [cw, 0],
        [cw, ch],
        [0, ch],
    ], dtype=np.float32)

    # Aplicar perspectiva a las esquinas si se usó
    if persp_M is not None:
        ones = np.ones((4, 1), dtype=np.float32)
        pts_h = np.hstack([corners, ones])
        transformed = (persp_M @ pts_h.T).T
        corners = transformed[:, :2] / transformed[:, 2:3]

    # Matriz de rotación con OpenCV
    M_rot = cv2.getRotationMatrix2D((cx, cy), -angle_deg, 1.0)  # OpenCV usa sentido opuesto

    # Calcular nuevo tamaño del boundign box rotado
    cos_a = abs(M_rot[0, 0])
    sin_a = abs(M_rot[0, 1])
    new_bw = int(cw * cos_a + ch * sin_a)
    new_bh = int(cw * sin_a + ch * cos_a)

    # Ajustar la traslación
    M_rot[0, 2] += (new_bw - cw) / 2
    M_rot[1, 2] += (new_bh - ch) / 2

    rotated = cv2.warpAffine(card_resized, M_rot, (new_bw, new_bh),
                              flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                              borderValue=(0, 0, 0, 0))

    # Calcular esquinas rotadas
    new_cx = new_bw / 2
    new_cy = new_bh / 2
    old_cx, old_cy = cx, cy

    rotated_corners = []
    for pt in corners:
        # Aplicar la misma transformación afín
        px = M_rot[0, 0] * pt[0] + M_rot[0, 1] * pt[1] + M_rot[0, 2]
        py = M_rot[1, 0] * pt[0] + M_rot[1, 1] * pt[1] + M_rot[1, 2]
        rotated_corners.append([px, py])

    # Posición en el fondo
    off_x = int(pos_x * w_bg - new_bw / 2)
    off_y = int(pos_y * h_bg - new_bh / 2)

    # Verificar que cabe (al menos parcialmente)
    if off_x + new_bw < 0 or off_y + new_bh < 0 or off_x >= w_bg or off_y >= h_bg:
        return bg, None

    # Recortar a la región visible
    src_x1 = max(0, -off_x)
    src_y1 = max(0, -off_y)
    src_x2 = min(new_bw, w_bg - off_x)
    src_y2 = min(new_bh, h_bg - off_y)

    dst_x1 = max(0, off_x)
    dst_y1 = max(0, off_y)
    dst_x2 = dst_x1 + (src_x2 - src_x1)
    dst_y2 = dst_y1 + (src_y2 - src_y1)

    # Compositing con alfa
    card_region = rotated[src_y1:src_y2, src_x1:src_x2]
    if card_region.size == 0:
        return bg, None

    alpha = card_region[:, :, 3:4].astype(np.float32) / 255.0
    rgb = card_region[:, :, :3].astype(np.float32)
    bg_region = bg[dst_y1:dst_y2, dst_x1:dst_x2].astype(np.float32)

    blended = (rgb * alpha + bg_region * (1 - alpha)).astype(np.uint8)
    bg[dst_y1:dst_y2, dst_x1:dst_x2] = blended

    # Esquinas finales en coordenadas del fondo, normalizadas
    final_corners = []
    for rc in rotated_corners:
        fx = (rc[0] + off_x) / w_bg
        fy = (rc[1] + off_y) / h_bg
        final_corners.append((fx, fy))

    # Verificar que las esquinas están mayormente dentro de la imagen
    inside = sum(1 for fx, fy in final_corners if 0 <= fx <= 1 and 0 <= fy <= 1)
    if inside < 3:
        return bg, None

    # Clamp
    final_corners = [(max(0, min(1, fx)), max(0, min(1, fy))) for fx, fy in final_corners]

    return bg, final_corners


def generate_image(card_paths: list[str], backgrounds: list[np.ndarray]) -> tuple[np.ndarray, list[str]]:
    """
    Genera una imagen sintética con 1-3 cartas.
    Devuelve (imagen, lista_de_labels).
    """
    # Fondo
    if backgrounds:
        bg = random.choice(backgrounds).copy()
        bg = cv2.resize(bg, (OUTPUT_SIZE, OUTPUT_SIZE))
    else:
        bg = generate_random_background(OUTPUT_SIZE)

    n_cards = random.randint(1, MAX_CARDS_PER_IMAGE)
    selected = random.sample(card_paths, min(n_cards, len(card_paths)))

    labels = []
    occupied = []  # Centros ya usados para evitar solapamiento excesivo

    for card_path in selected:
        card_img = cv2.imread(card_path, cv2.IMREAD_UNCHANGED)
        if card_img is None:
            continue

        angle = random.uniform(*ROTATION_RANGE)
        scale = random.uniform(CARD_SCALE_MIN, CARD_SCALE_MAX)

        # Posición: intentar evitar solapamiento
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

        # Formato OBB: class x1 y1 x2 y2 x3 y3 x4 y4
        coords = " ".join(f"{c[0]:.6f} {c[1]:.6f}" for c in corners)
        labels.append(f"0 {coords}")

    # Augmentaciones globales de color
    bg = augment_color(bg)

    return bg, labels


def create_dataset(card_paths: list[str], backgrounds: list[np.ndarray]):
    """Genera el dataset completo."""
    # Crear estructura de carpetas
    for split in ("train", "val"):
        os.makedirs(os.path.join(DATASET_DIR, split, "images"), exist_ok=True)
        os.makedirs(os.path.join(DATASET_DIR, split, "labels"), exist_ok=True)

    total_images = len(card_paths) * IMAGES_PER_CARD // MAX_CARDS_PER_IMAGE
    train_count = int(total_images * TRAIN_RATIO)

    print(f"Generando {total_images} imágenes ({train_count} train, {total_images - train_count} val)...")

    indices = list(range(total_images))
    random.shuffle(indices)
    train_set = set(indices[:train_count])

    for i in tqdm(range(total_images), desc="Generando dataset"):
        split = "train" if i in train_set else "val"

        img, labels = generate_image(card_paths, backgrounds)

        if not labels:
            continue

        name = f"synth_{i:06d}"
        img_path = os.path.join(DATASET_DIR, split, "images", f"{name}.jpg")
        lbl_path = os.path.join(DATASET_DIR, split, "labels", f"{name}.txt")

        cv2.imwrite(img_path, img, [cv2.IMWRITE_JPEG_QUALITY, 92])
        with open(lbl_path, "w") as f:
            f.write("\n".join(labels) + "\n")

    # data.yaml
    yaml_content = f"""path: {DATASET_DIR}
train: train/images
val: val/images

nc: 1
names: ['card']
"""
    with open(os.path.join(DATASET_DIR, "data.yaml"), "w") as f:
        f.write(yaml_content)

    print(f"Dataset generado en {DATASET_DIR}")
    print(f"Config: {os.path.join(DATASET_DIR, 'data.yaml')}")


def main():
    if not os.path.exists(DB_PATH):
        print("ERROR: No se encontró riftbound.db. Ejecuta primero scraper.py")
        return

    card_paths = load_card_paths_from_db()
    if not card_paths:
        print("ERROR: No hay imágenes de cartas descargadas. Ejecuta primero scraper.py")
        return

    print(f"Cartas disponibles: {len(card_paths)}")

    backgrounds = load_backgrounds()
    if backgrounds:
        print(f"Fondos cargados: {len(backgrounds)}")
    else:
        print("Sin fondos en backgrounds/. Se generarán fondos sintéticos.")

    create_dataset(card_paths, backgrounds)
    print("¡Generación completada!")


if __name__ == "__main__":
    main()
