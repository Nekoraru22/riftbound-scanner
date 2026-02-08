import os
import re
import sys
import json
import shutil
import sqlite3
from io import BytesIO

import requests

import cv2
import numpy as np
from PIL import Image
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "riftbound.db")
PUBLIC_DIR = os.path.join(BASE_DIR, "..", "public")
CARDS_DIR = os.path.join(PUBLIC_DIR, "cards")
HASHES_PATH = os.path.join(PUBLIC_DIR, "card-hashes.json")
GALLERY_URL = "https://riftbound.leagueoflegends.com/en-us/card-gallery/"

GRID_SIZE = 16 # 16x16 grid = 768 features (256 cells * 3 RGB channels)
DCT_SIZE = 32 # 32x32 resize for DCT feature extraction
DCT_BLOCK = 8 # 8x8 low-frequency block → 63 coefficients per channel

# Artwork crop region (portrait card) — excludes frame, name bar, text/stats
ART_TOP = 0.05
ART_BOTTOM = 0.55
ART_LEFT = 0.05
ART_RIGHT = 0.95

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}

MAX_WORKERS = 10
SESSION = requests.Session()
SESSION.headers.update(HEADERS)


def fetch_gallery_html() -> str:
    """
    Downloads the HTML of the card gallery.

    Returns:
        The raw HTML content of the gallery page.
    """
    print("Downloading gallery...")
    resp = SESSION.get(GALLERY_URL, timeout=30)
    resp.raise_for_status()
    return resp.text


def extract_next_data(html: str) -> dict:
    """
    Extracts the __NEXT_DATA__ JSON object from the HTML page.

    Arguments:
        html: The raw HTML content of the page.

    Returns:
        The parsed JSON data from the __NEXT_DATA__ script tag.
    """
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    raise RuntimeError("__NEXT_DATA__ not found in the HTML")


def extract_cards(next_data: dict) -> list[dict]:
    """
    Extracts the list of cards from the Next.js JSON data.

    Arguments:
        next_data: The parsed JSON data from __NEXT_DATA__.
    
    Returns:
        A list of raw card dictionaries.
    """
    blades = next_data.get("props", {}).get("pageProps", {}).get("blades", [])
    for blade in blades:
        cards = blade.get("cards", {})
        if isinstance(cards, dict) and "items" in cards:
            return cards["items"]
        if isinstance(cards, list) and len(cards) > 0:
            return cards
    
    # Fallback: search recursively
    return _find_cards_recursive(next_data)


def _is_card_array(obj) -> bool:
    """
    Checks if the object is a valid array of card dictionaries.

    Arguments:
        obj: The object to check.

    Returns:
        True if the object is a list of cards with cardImage keys.
    """
    if not isinstance(obj, list) or len(obj) <= 5:
        return False
    return isinstance(obj[0], dict) and "cardImage" in obj[0]


def _find_cards_recursive(obj, depth=0):
    """
    Recursively searches for a card array in the JSON structure.

    Arguments:
        obj: The JSON object to search through.
        depth: Current recursion depth to prevent infinite loops.

    Returns:
        A list of card dictionaries if found, empty list otherwise.
    """
    if depth > 10:
        return []

    if _is_card_array(obj):
        return obj

    children = []
    if isinstance(obj, dict):
        children = obj.values()
    elif isinstance(obj, list):
        children = obj

    for child in children:
        result = _find_cards_recursive(child, depth + 1)
        if result:
                return result
    return []


def _get_list_from_obj(obj, key: str) -> list:
    """
    Extracts a list from an object that may be a dict or list.

    Arguments:
        obj: The source object (dict or list).
        key: The key to look for if obj is a dict.

    Returns:
        The extracted list or empty list.
    """
    if isinstance(obj, dict):
        return obj.get(key, [])
    if isinstance(obj, list):
        return obj
    return []


def _get_nested_value(obj, value_key: str, id_key: str, default: str = "") -> str:
    """
    Extracts a nested value from a dict structure.

    Arguments:
        obj: The source object.
        value_key: The intermediate key (e.g., "value").
        id_key: The final key to extract (e.g., "id" or "label").
        default: Default value if extraction fails.

    Returns:
        The extracted string value.
    """
    if not isinstance(obj, dict):
        return str(obj) if obj else default
    val = obj.get(value_key, obj)
    if isinstance(val, dict):
        return val.get(id_key, default)
    return str(val) if val else default


def _get_stat_value(obj):
    """
    Extracts a stat value (energy/might) from an object.

    Arguments:
        obj: The stat object.

    Returns:
        The stat value or the object itself.
    """
    if isinstance(obj, dict):
        return obj.get("value", {}).get("id")
    return obj


def _get_first_label(obj, list_key: str) -> str:
    """
    Extracts the first label from a nested list structure.

    Arguments:
        obj: The source object.
        list_key: The key containing the list.

    Returns:
        The first label found or empty string.
    """
    if isinstance(obj, dict):
        vals = obj.get(list_key, [])
        return vals[0].get("label", "") if vals else ""
    if isinstance(obj, list):
        return obj[0] if obj else ""
    return str(obj) if obj else ""


def _get_card_text(obj) -> str:
    """
    Extracts the card text from the text object.

    Arguments:
        obj: The text object.

    Returns:
        The card text content.
    """
    if isinstance(obj, dict):
        rt = obj.get("richText", {})
        return rt.get("body", "") if isinstance(rt, dict) else str(rt)
    return str(obj) if obj else ""


def normalize_card(raw: dict) -> dict:
    """
    Normalizes a card to a flat format suitable for SQLite storage.

    Arguments:
        raw: The raw card dictionary from the API response.

    Returns:
        A normalized card dictionary with consistent field names.
    """
    card_image = raw.get("cardImage", {})
    image_url = card_image.get("url", "") if isinstance(card_image, dict) else ""

    # Domains
    domains = _get_list_from_obj(raw.get("domain", {}), "values")
    domain_list = [d.get("id", d) if isinstance(d, dict) else d for d in domains]

    # Rarity
    rarity = _get_nested_value(raw.get("rarity", {}), "value", "id")

    # Card type
    types = _get_list_from_obj(raw.get("cardType", {}), "type")
    card_type = types[0].get("id", "") if types and isinstance(types[0], dict) else ""

    # Set
    set_obj = raw.get("set", {})
    set_id = _get_nested_value(set_obj, "value", "id")
    set_name = _get_nested_value(set_obj, "value", "label")

    # Energy / Might
    energy = _get_stat_value(raw.get("energy", {}))
    might = _get_stat_value(raw.get("might", {}))

    # Tags
    tag_list = _get_list_from_obj(raw.get("tags", {}), "tags")

    # Illustrator
    illustrator = _get_first_label(raw.get("illustrator", {}), "values")

    # Text
    text = _get_card_text(raw.get("text", {}))

    card_id = raw.get("id", "")
    return {
        "id": card_id,
        "name": raw.get("name", ""),
        "collector_number": raw.get("collectorNumber", 0),
        "public_code": raw.get("publicCode", ""),
        "set_id": set_id.upper(),
        "set_name": set_name,
        "domains": json.dumps(domain_list),
        "rarity": rarity,
        "card_type": card_type,
        "energy": energy,
        "might": might,
        "tags": json.dumps(tag_list),
        "illustrator": illustrator,
        "text": text,
        "orientation": raw.get("orientation", "portrait"),
        "image_url": image_url,
        "image_path": f"../public/cards/{card_id}.webp",
    }


def init_db(db_path: str) -> sqlite3.Connection:
    """
    Creates the database and the cards table if they don't exist.

    Arguments:
        db_path: The file path for the SQLite database.

    Returns:
        An open connection to the database.
    """
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cards (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            collector_number INTEGER,
            public_code     TEXT,
            set_id          TEXT,
            set_name        TEXT,
            domains         TEXT,
            rarity          TEXT,
            card_type       TEXT,
            energy          INTEGER,
            might           INTEGER,
            tags            TEXT,
            illustrator     TEXT,
            text            TEXT,
            orientation     TEXT,
            image_url       TEXT,
            image_path      TEXT
        )
    """)
    conn.commit()
    return conn


def insert_cards(conn: sqlite3.Connection, cards: list[dict]) -> None:
    """
    Inserts or updates cards in the database.

    Arguments:
        conn: An open SQLite database connection.
        cards: A list of normalized card dictionaries to insert.
    """
    conn.executemany("""
        INSERT OR REPLACE INTO cards
        (id, name, collector_number, public_code, set_id, set_name,
         domains, rarity, card_type, energy, might, tags,
         illustrator, text, orientation, image_url, image_path)
        VALUES
        (:id, :name, :collector_number, :public_code, :set_id, :set_name,
         :domains, :rarity, :card_type, :energy, :might, :tags,
         :illustrator, :text, :orientation, :image_url, :image_path)
    """, cards)
    conn.commit()


def _download_single_image(card: dict) -> tuple[str, bool]:
    """
    Downloads a single card image and optimizes it to WebP format.

    Arguments:
        card: The card dictionary containing image URL.

    Returns:
        A tuple of (card_id, success).
    """
    card_id = card["id"]
    url = card["image_url"]

    if not url:
        return (card_id, False)

    filepath = os.path.join(CARDS_DIR, f"{card_id}.webp")
    try:
        resp = SESSION.get(url, timeout=20)
        resp.raise_for_status()

        # Load image and optimize to WebP
        with Image.open(BytesIO(resp.content)) as img:
            # Rotate landscape images to portrait
            if img.width > img.height:
                img = img.rotate(90, expand=True)
            img.save(filepath, format="WEBP", quality=80)
        return (card_id, True)
    except Exception:
        return (card_id, False)


def download_images(cards: list[dict]) -> None:
    """
    Downloads card images, optimizes them to WebP, and saves to public/cards.

    Arguments:
        cards: A list of card dictionaries containing image URLs.
    """
    # Clear and recreate the cards directory
    if os.path.exists(CARDS_DIR):
        shutil.rmtree(CARDS_DIR)
    os.makedirs(CARDS_DIR)

    cards_to_download = [c for c in cards if c["image_url"]]
    failed = 0

    if not cards_to_download:
        print("No cards to download.")
        return

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(_download_single_image, card): card for card in cards_to_download}
        try:
            for future in tqdm(as_completed(futures), total=len(futures), desc="Downloading and optimizing"):
                card_id, success = future.result()
                if not success:
                    failed += 1
                    tqdm.write(f"  Error downloading {card_id}")
        except KeyboardInterrupt:
            for f in futures:
                f.cancel()
            executor.shutdown(wait=False, cancel_futures=True)
            raise

    print(f"Download complete. Total: {len(cards_to_download)}, Failed: {failed}")


def _crop_artwork(image: np.ndarray) -> np.ndarray:
    """
    Crop to the artwork region of a portrait card image.

    Excludes the shared frame, name bar, text box and stats so that
    features are computed only on the discriminative illustration.

    Arguments:
        image: BGR image (from cv2.imread), assumed portrait orientation.

    Returns:
        Cropped BGR image containing only the artwork region.
    """
    h, w = image.shape[:2]
    sy = round(h * ART_TOP)
    ey = round(h * ART_BOTTOM)
    sx = round(w * ART_LEFT)
    ex = round(w * ART_RIGHT)
    return image[sy:ey, sx:ex].copy()


def _equalize_histogram(image: np.ndarray) -> np.ndarray:
    """
    Per-channel histogram equalization matching the JS equalizeHistogram().

    Normalizes brightness so that reference images and dark query photos
    produce comparable features.

    Arguments:
        image: BGR image (from cv2.imread).

    Returns:
        Equalized BGR image.
    """
    result = image.copy()
    for ch in range(3):
        result[:, :, ch] = cv2.equalizeHist(result[:, :, ch])
    return result


def _compute_dct_features(image: np.ndarray) -> list[float]:
    """
    Compute DCT low-frequency feature vector (189 floats) matching phash.js.

    Uses an unnormalized DCT-II (same as phash.js) to ensure cosine similarity
    between Python-generated DB features and JS-generated query features is valid.

    Arguments:
        image: BGR image (from cv2.imread).

    Returns:
        List of 189 floats (63 coefficients per R/G/B channel).
    """
    eq = _equalize_histogram(image)
    small = cv2.resize(eq, (DCT_SIZE, DCT_SIZE), interpolation=cv2.INTER_AREA)
    small_rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).astype(np.float64)

    # DCT-II matrix without normalization (matches phash.js manual DCT)
    n = np.arange(DCT_SIZE)
    C = np.cos(np.pi / DCT_SIZE * np.outer(n, n + 0.5))

    features = []
    for ch in range(3):  # R, G, B
        channel = small_rgb[:, :, ch]
        dct = C @ channel @ C.T

        # Extract 8x8 low-frequency block, skip DC at (0,0)
        for row in range(DCT_BLOCK):
            for col in range(DCT_BLOCK):
                if row == 0 and col == 0:
                    continue
                features.append(round(float(dct[row, col]), 4))

    return features


def _compute_color_grid(image: np.ndarray, grid_size: int = GRID_SIZE) -> list[float]:
    """
    Resizes an image to a grid and returns flattened normalized RGB values.

    Arguments:
        image: The input image as a numpy array (BGR format from cv2).
        grid_size: The size of the output grid (default 8x8).

    Returns:
        A list of normalized RGB values (0-1) for each grid cell.
    """
    eq = _equalize_histogram(image)
    small = cv2.resize(eq, (grid_size, grid_size), interpolation=cv2.INTER_AREA)
    small = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    features = small.astype(np.float32).flatten() / 255.0
    return [round(float(v), 4) for v in features]


def generate_card_hashes() -> None:
    """
    Generates color grid hashes for all cards and saves them to a JSON file.

    Reads card metadata from the database, computes color grid features for
    each card image, and saves the results to a JSON file for use by the
    frontend card matcher.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, name, collector_number, public_code, set_id, set_name, domains, rarity, card_type, energy, might, tags, illustrator, text, orientation, image_url, image_path FROM cards"
    ).fetchall()
    conn.close()

    cards = []
    skipped = 0

    for row in tqdm(rows, desc="Generating hashes"):
        img_path = os.path.join(BASE_DIR, row["image_path"])
        if not os.path.exists(img_path):
            skipped += 1
            continue

        img = cv2.imread(img_path)
        if img is None:
            skipped += 1
            continue

        art = _crop_artwork(img)
        features = _compute_color_grid(art)
        dct_features = _compute_dct_features(art)

        # Parse domains JSON array → take first domain (primary)
        domains_raw = row["domains"] or "[]"
        try:
            domain_list = json.loads(domains_raw)
        except (json.JSONDecodeError, TypeError):
            domain_list = []
        domain = domain_list[0] if domain_list else None

        # Parse tags JSON array
        tags_raw = row["tags"] or "[]"
        try:
            tag_list = json.loads(tags_raw)
        except (json.JSONDecodeError, TypeError):
            tag_list = []

        cards.append({
            "id": row["id"],
            "name": row["name"],
            "number": row["collector_number"],
            "code": row["public_code"],
            "set": row["set_id"],
            "setName": row["set_name"],
            "domain": domain,
            "domains": domain_list,
            "rarity": row["rarity"],
            "type": row["card_type"],
            "energy": row["energy"],
            "might": row["might"],
            "tags": tag_list,
            "illustrator": row["illustrator"],
            "text": row["text"],
            "orientation": row["orientation"],
            "imageUrl": row["image_url"],
            "f": features,
            "d": dct_features,
        })

    cards.sort(key=lambda c: (c["set"], c["number"]))

    os.makedirs(os.path.dirname(HASHES_PATH), exist_ok=True)
    with open(HASHES_PATH, "w", encoding="utf-8") as f:
        json.dump({"gridSize": GRID_SIZE, "cards": cards}, f, ensure_ascii=False)

    print(f"Hashes generated: {len(cards)} cards ({skipped} skipped)")


def main():
    args = sys.argv[1:]

    if args and args[0] == "--only-hashes":
        generate_card_hashes()
        print("Done.")
        return

    # Fetch and parse gallery
    html = fetch_gallery_html()
    next_data = extract_next_data(html)
    raw_cards = extract_cards(next_data)

    if not raw_cards:
        print("ERROR: No cards found on the page.", file=sys.stderr)
        sys.exit(1)
    print(f"Cards found: {len(raw_cards)}")

    # Normalize cards
    cards = [normalize_card(c) for c in raw_cards]

    # Save to SQLite
    conn = init_db(DB_PATH)
    insert_cards(conn, cards)
    total = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    print(f"Cards in database: {total}")
    conn.close()

    # Download, optimize, and rotate images
    download_images(cards)

    # Generate hashes for card matching
    generate_card_hashes()

    print("Scraping complete!")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.")
