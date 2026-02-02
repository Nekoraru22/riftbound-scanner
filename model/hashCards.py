"""
Pre-computes perceptual hashes (dHash) for all Riftbound cards.
Outputs a JSON file that the web app loads for card identification.

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

HASH_SIZE = 16  # 16x16 = 256-bit hash for good accuracy


def dhash(image: np.ndarray, hash_size: int = HASH_SIZE) -> str:
    """Compute difference hash of an image. Returns hex string."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
    # Compare adjacent pixels horizontally
    diff = resized[:, 1:] > resized[:, :-1]
    # Pack bits into hex string
    bits = diff.flatten()
    # Pack into bytes
    byte_array = np.packbits(bits)
    return byte_array.tobytes().hex()


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, name, collector_number, set_id, set_name, rarity, card_type, image_path FROM cards"
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

        h = dhash(img)

        cards.append({
            "id": row["id"],
            "name": row["name"],
            "number": row["collector_number"],
            "set": row["set_id"],
            "setName": row["set_name"],
            "rarity": row["rarity"],
            "type": row["card_type"],
            "hash": h,
        })

    # Sort by set + collector number for consistency
    cards.sort(key=lambda c: (c["set"], c["number"]))

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"hashSize": HASH_SIZE, "cards": cards}, f, ensure_ascii=False)

    print(f"Hashed {len(cards)} cards ({skipped} skipped)")
    print(f"Output: {os.path.abspath(OUTPUT_PATH)}")


if __name__ == "__main__":
    main()
