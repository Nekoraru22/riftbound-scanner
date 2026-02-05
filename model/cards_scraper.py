import os
import re
import sys
import json
import sqlite3
import requests

import cv2
import numpy as np
from PIL import Image
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "riftbound.db")
CARDS_DIR = os.path.join(BASE_DIR, "cards")
HASHES_PATH = os.path.join(BASE_DIR, "..", "public", "card-hashes.json")
GALLERY_URL = "https://riftbound.leagueoflegends.com/en-us/card-gallery/"

GRID_SIZE = 8 # 8x8 grid = 192 features (64 cells * 3 RGB channels)

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
        "image_path": f"cards/{card_id}.png",
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


def _download_single_image(card: dict, existing_files: set) -> tuple[str, bool]:
    """
    Downloads a single card image.

    Arguments:
        card: The card dictionary containing image URL.
        existing_files: Set of already downloaded file names.

    Returns:
        A tuple of (card_id, success).
    """
    card_id = card["id"]
    url = card["image_url"]

    if not url or f"{card_id}.png" in existing_files:
        return (card_id, True)

    filepath = os.path.join(CARDS_DIR, f"{card_id}.png")
    try:
        resp = SESSION.get(url, timeout=20)
        resp.raise_for_status()
        with open(filepath, "wb") as f:
            f.write(resp.content)
        return (card_id, True)
    except Exception:
        return (card_id, False)


def download_images(cards: list[dict]) -> None:
    """
    Downloads the card images to the local cards directory using parallel requests.

    Arguments:
        cards: A list of card dictionaries containing image URLs.
    """
    os.makedirs(CARDS_DIR, exist_ok=True)

    existing_files = set(os.listdir(CARDS_DIR))
    cards_to_download = [c for c in cards if c["image_url"] and f"{c['id']}.png" not in existing_files]
    skipped = len(cards) - len(cards_to_download)
    failed = 0

    if not cards_to_download:
        print(f"Download complete. Skipped: {skipped}, Failed: 0")
        return

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(_download_single_image, card, existing_files): card for card in cards_to_download}
        try:
            for future in tqdm(as_completed(futures), total=len(futures), desc="Downloading images"):
                card_id, success = future.result()
                if not success:
                    failed += 1
                    tqdm.write(f"  Error downloading {card_id}")
        except KeyboardInterrupt:
            for f in futures:
                f.cancel()
            executor.shutdown(wait=False, cancel_futures=True)
            raise

    print(f"Download complete. Skipped: {skipped}, Failed: {failed}")


def rotate_landscape_images() -> int:
    """
    Rotates all landscape (horizontal) images to portrait (vertical) orientation.

    Card images should be in portrait orientation for consistent processing.
    This function finds all landscape images in the cards directory and
    rotates them 90 degrees counter-clockwise.

    Returns:
        The number of images that were rotated.
    """
    if not os.path.exists(CARDS_DIR):
        return 0

    extensions = (".png", ".jpg", ".jpeg", ".webp")
    rotated_count = 0

    files = [f for f in os.listdir(CARDS_DIR) if f.lower().endswith(extensions)]

    for filename in tqdm(files, desc="Checking orientations"):
        filepath = os.path.join(CARDS_DIR, filename)
        try:
            with Image.open(filepath) as img:
                width, height = img.size
                if width > height:
                    rotated = img.rotate(90, expand=True)
                    rotated.save(filepath)
                    rotated_count += 1
        except Exception:
            pass

    if rotated_count > 0:
        print(f"Rotated {rotated_count} landscape images to portrait")

    return rotated_count


def _compute_color_grid(image: np.ndarray, grid_size: int = GRID_SIZE) -> list[float]:
    """
    Resizes an image to a grid and returns flattened normalized RGB values.

    Arguments:
        image: The input image as a numpy array (BGR format from cv2).
        grid_size: The size of the output grid (default 8x8).

    Returns:
        A list of normalized RGB values (0-1) for each grid cell.
    """
    small = cv2.resize(image, (grid_size, grid_size), interpolation=cv2.INTER_AREA)
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
        "SELECT id, name, collector_number, set_id, set_name, rarity, card_type, orientation, image_url, image_path FROM cards"
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

        features = _compute_color_grid(img)

        cards.append({
            "id": row["id"],
            "name": row["name"],
            "number": row["collector_number"],
            "set": row["set_id"],
            "setName": row["set_name"],
            "rarity": row["rarity"],
            "type": row["card_type"],
            "orientation": row["orientation"],
            "imageUrl": row["image_url"],
            "f": features,
        })

    cards.sort(key=lambda c: (c["set"], c["number"]))

    os.makedirs(os.path.dirname(HASHES_PATH), exist_ok=True)
    with open(HASHES_PATH, "w", encoding="utf-8") as f:
        json.dump({"gridSize": GRID_SIZE, "cards": cards}, f, ensure_ascii=False)

    print(f"Hashes generated: {len(cards)} cards ({skipped} skipped)")


def optimize_and_copy_cards() -> None:
    """
    Optimizes card images for web and copies them to the public directory.

    This function reads all card images from the cards directory, optimizes
    them (e.g., converts to WebP format), and saves them to the public/cards
    directory for use by the frontend.
    """
    source_dir = CARDS_DIR
    target_dir = os.path.join(BASE_DIR, "..", "public", "cards")
    os.makedirs(target_dir, exist_ok=True)

    extensions = (".png", ".jpg", ".jpeg", ".webp")
    files = [f for f in os.listdir(source_dir) if f.lower().endswith(extensions)]

    for filename in tqdm(files, desc="Optimizing and copying cards"):
        source_path = os.path.join(source_dir, filename)
        target_path = os.path.join(target_dir, filename)

        try:
            with Image.open(source_path) as img:
                img.save(target_path, format="WEBP", quality=80)
        except Exception:
            pass


def main():
    # Get arguments
    args = sys.argv[1:]

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

    if args and args[0] == "--skip-download":
        print("Skipping image download.")
    else:
        # Download images and normalize orientations
        download_images(cards)
        rotate_landscape_images()

    # Generate color grid hashes for card matching
    generate_card_hashes()

    # Optimize cards for web and copy into public directory
    optimize_and_copy_cards()

    print("Scraping complete!")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.")
