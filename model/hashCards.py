"""
Pre-computes color grid features for all Riftbound cards.
Each card is resized to a grid and average RGB values are stored.
This is more robust than perceptual hashing for matching noisy crops.

Usage:
    python hashCards.py
"""

import json
import os
import sqlite3

import cv2
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "riftbound.db")
OUTPUT_PATH = os.path.join(BASE_DIR, "..", "public", "card-hashes.json")

GRID_SIZE = 8  # 8x8 grid = 192 features (64 cells * 3 RGB channels)


def compute_color_grid(image: np.ndarray, grid_size: int = GRID_SIZE) -> list[float]:
    """Resize image to grid_size x grid_size and return flattened normalized RGB."""
    # Resize to grid using INTER_AREA for good downsampling
    small = cv2.resize(image, (grid_size, grid_size), interpolation=cv2.INTER_AREA)
    # Convert BGR to RGB
    small = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    # Normalize to [0, 1] and flatten
    features = small.astype(np.float32).flatten() / 255.0
    return [round(float(v), 4) for v in features]


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, name, collector_number, set_id, set_name, rarity, card_type, orientation, image_path FROM cards"
    ).fetchall()
    conn.close()

    cards = []
    skipped = 0

    for row in rows:
        img_path = os.path.join(BASE_DIR, row["image_path"])
        if not os.path.exists(img_path):
            skipped += 1
            continue

        img = cv2.imread(img_path)
        if img is None:
            skipped += 1
            continue

        features = compute_color_grid(img)

        cards.append({
            "id": row["id"],
            "name": row["name"],
            "number": row["collector_number"],
            "set": row["set_id"],
            "setName": row["set_name"],
            "rarity": row["rarity"],
            "type": row["card_type"],
            "orientation": row["orientation"],
            "f": features,
        })

    cards.sort(key=lambda c: (c["set"], c["number"]))

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"gridSize": GRID_SIZE, "cards": cards}, f, ensure_ascii=False)

    print(f"Processed {len(cards)} cards ({skipped} skipped)")
    print(f"Features per card: {GRID_SIZE}x{GRID_SIZE}x3 = {GRID_SIZE*GRID_SIZE*3}")
    print(f"Output: {os.path.abspath(OUTPUT_PATH)}")


if __name__ == "__main__":
    main()
