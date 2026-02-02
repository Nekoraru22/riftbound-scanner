"""
Riftbound Card Scraper
Extrae todas las cartas de la galería oficial de Riftbound,
las guarda en SQLite y descarga las imágenes.
"""

import json
import os
import re
import sqlite3
import sys
import time

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "riftbound.db")
CARDS_DIR = os.path.join(BASE_DIR, "cards")
GALLERY_URL = "https://riftbound.leagueoflegends.com/en-us/card-gallery/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
}


def fetch_gallery_html() -> str:
    """Descarga el HTML de la galería de cartas."""
    print("Descargando galería...")
    resp = requests.get(GALLERY_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.text


def extract_next_data(html: str) -> dict:
    """Extrae el JSON de __NEXT_DATA__ del HTML."""
    soup = BeautifulSoup(html, "html.parser")
    script = soup.find("script", id="__NEXT_DATA__")
    if script and script.string:
        return json.loads(script.string)
    # Fallback: regex
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    raise RuntimeError("No se encontró __NEXT_DATA__ en el HTML")


def extract_cards(next_data: dict) -> list[dict]:
    """Extrae la lista de cartas del JSON de Next.js."""
    blades = next_data.get("props", {}).get("pageProps", {}).get("blades", [])
    for blade in blades:
        cards = blade.get("cards", {})
        if isinstance(cards, dict) and "items" in cards:
            return cards["items"]
        if isinstance(cards, list) and len(cards) > 0:
            return cards
    # Intento alternativo: buscar recursivamente
    return _find_cards_recursive(next_data)


def _find_cards_recursive(obj, depth=0):
    """Busca recursivamente un array de cartas en el JSON."""
    if depth > 10:
        return []
    if isinstance(obj, list) and len(obj) > 5:
        if isinstance(obj[0], dict) and "cardImage" in obj[0]:
            return obj
    if isinstance(obj, dict):
        for v in obj.values():
            result = _find_cards_recursive(v, depth + 1)
            if result:
                return result
    if isinstance(obj, list):
        for item in obj:
            result = _find_cards_recursive(item, depth + 1)
            if result:
                return result
    return []


def normalize_card(raw: dict) -> dict:
    """Normaliza una carta al formato plano para SQLite."""
    card_image = raw.get("cardImage", {})
    image_url = card_image.get("url", "") if isinstance(card_image, dict) else ""

    # Domains
    domain_obj = raw.get("domain", {})
    if isinstance(domain_obj, dict):
        domains = domain_obj.get("values", [])
    elif isinstance(domain_obj, list):
        domains = domain_obj
    else:
        domains = []
    domain_list = [d.get("id", d) if isinstance(d, dict) else d for d in domains]

    # Rarity
    rarity_obj = raw.get("rarity", {})
    if isinstance(rarity_obj, dict):
        val = rarity_obj.get("value", rarity_obj)
        rarity = val.get("id", "") if isinstance(val, dict) else str(val)
    else:
        rarity = str(rarity_obj)

    # Card type
    type_obj = raw.get("cardType", {})
    if isinstance(type_obj, dict):
        types = type_obj.get("type", [])
    elif isinstance(type_obj, list):
        types = type_obj
    else:
        types = []
    card_type = types[0].get("id", "") if types and isinstance(types[0], dict) else ""

    # Set
    set_obj = raw.get("set", {})
    if isinstance(set_obj, dict):
        set_val = set_obj.get("value", set_obj)
        set_id = set_val.get("id", "") if isinstance(set_val, dict) else str(set_val)
        set_name = set_val.get("label", "") if isinstance(set_val, dict) else ""
    else:
        set_id = str(set_obj)
        set_name = ""

    # Energy / Might
    energy_obj = raw.get("energy", {})
    energy = energy_obj.get("value", {}).get("id") if isinstance(energy_obj, dict) else energy_obj
    might_obj = raw.get("might", {})
    might = might_obj.get("value", {}).get("id") if isinstance(might_obj, dict) else might_obj

    # Tags
    tags_obj = raw.get("tags", {})
    if isinstance(tags_obj, dict):
        tag_list = tags_obj.get("tags", [])
    elif isinstance(tags_obj, list):
        tag_list = tags_obj
    else:
        tag_list = []

    # Illustrator
    illus_obj = raw.get("illustrator", {})
    if isinstance(illus_obj, dict):
        illus_vals = illus_obj.get("values", [])
        illustrator = illus_vals[0].get("label", "") if illus_vals else ""
    elif isinstance(illus_obj, list):
        illustrator = illus_obj[0] if illus_obj else ""
    else:
        illustrator = str(illus_obj)

    # Text
    text_obj = raw.get("text", {})
    if isinstance(text_obj, dict):
        rt = text_obj.get("richText", {})
        text = rt.get("body", "") if isinstance(rt, dict) else str(rt)
    else:
        text = str(text_obj) if text_obj else ""

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
    """Crea la base de datos y la tabla de cartas."""
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


def insert_cards(conn: sqlite3.Connection, cards: list[dict]):
    """Inserta o actualiza las cartas en la base de datos."""
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


def download_images(cards: list[dict]):
    """Descarga las imágenes de las cartas."""
    os.makedirs(CARDS_DIR, exist_ok=True)
    skipped = 0
    failed = 0

    for card in tqdm(cards, desc="Descargando imágenes"):
        url = card["image_url"]
        if not url:
            continue

        filepath = os.path.join(BASE_DIR, card["image_path"])
        if os.path.exists(filepath):
            skipped += 1
            continue

        try:
            resp = requests.get(url, headers=HEADERS, timeout=20)
            resp.raise_for_status()
            with open(filepath, "wb") as f:
                f.write(resp.content)
            time.sleep(0.1)  # Rate limiting
        except Exception as e:
            failed += 1
            tqdm.write(f"  Error descargando {card['id']}: {e}")

    print(f"Descarga completa. Omitidas: {skipped}, Fallidas: {failed}")


def main():
    html = fetch_gallery_html()
    next_data = extract_next_data(html)
    raw_cards = extract_cards(next_data)

    if not raw_cards:
        print("ERROR: No se encontraron cartas en la página.", file=sys.stderr)
        sys.exit(1)

    print(f"Cartas encontradas: {len(raw_cards)}")

    cards = [normalize_card(c) for c in raw_cards]

    # Guardar en SQLite
    conn = init_db(DB_PATH)
    insert_cards(conn, cards)
    total = conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    print(f"Cartas en base de datos: {total}")
    conn.close()

    # Descargar imágenes
    download_images(cards)
    print("¡Scraping completado!")


if __name__ == "__main__":
    main()
