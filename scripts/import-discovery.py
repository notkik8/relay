"""Refresh Relay's openly licensed discovery catalog. Python 3.12 + Pillow for --cache."""

import argparse
import hashlib
import html
import json
import re
import sys
import time
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1] / "frontend" / "public" / "discovery"
COMMONS = "https://commons.wikimedia.org/w/api.php"
AGENT = "Relay/2.0 (open-media demo; local catalog import)"
IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp"}
AUDIO_MIMES = {"audio/ogg", "application/ogg", "audio/mpeg", "audio/flac"}
LICENSE = re.compile(
    r"^(?:public domain|cc0(?: 1\.0)?|cc by(?:-sa)? \d\.\d)$", re.IGNORECASE
)
COMMON_FIELDS = {
    "action": "query",
    "format": "json",
    "formatversion": 2,
    "prop": "imageinfo",
    "iiprop": "url|size|mime|extmetadata",
    "iiurlwidth": 500,
    "iiextmetadatalanguage": "en",
    "iiextmetadatafilter": "Artist|Attribution|LicenseShortName|LicenseUrl|ObjectName|ImageDescription",
    "maxlag": 5,
}
# The last field is a target, so a sparse source category can legitimately return fewer files.
PHOTO_SOURCES = (
    (
        "Featured pictures of mountains",
        "nature",
        ("горы", "пейзаж", "путешествия"),
        100,
    ),
    (
        "Featured pictures of landscapes",
        "nature",
        ("пейзаж", "простор", "путешествия"),
        90,
    ),
    ("Featured pictures of forests", "nature", ("лес", "деревья", "тишина"), 65),
    ("Featured pictures of coasts", "nature", ("берег", "море", "путешествия"), 45),
    (
        "Featured pictures of bodies of water",
        "nature",
        ("вода", "отражение", "пейзаж"),
        55,
    ),
    ("Featured pictures of cityscapes", "city", ("город", "улицы", "путешествия"), 110),
    (
        "Featured pictures of buildings",
        "architecture",
        ("здания", "фасады", "архитектура"),
        85,
    ),
    (
        "Featured pictures of building interiors",
        "architecture",
        ("интерьеры", "пространство", "архитектура"),
        85,
    ),
    ("Featured pictures of flowers", "nature", ("цветы", "ботаника", "детали"), 65),
    ("Featured pictures of plants", "nature", ("растения", "ботаника", "детали"), 70),
    ("Featured pictures of people", "people", ("люди", "портрет", "репортаж"), 65),
    ("Featured pictures of sports", "people", ("спорт", "движение", "люди"), 50),
    ("Featured pictures of objects", "art", ("предметы", "форма", "детали"), 50),
)
SUPPLEMENT = (
    ("Featured pictures of food", "food", ("еда", "кухня", "натюрморт"), 38),
    ("Featured pictures of fruit", "food", ("еда", "фрукты", "детали"), 30),
    ("Quality images of food", "food", ("еда", "кухня", "вкус"), 58),
    ("Featured pictures of cats", "wildlife", ("кошки", "животные", "портрет"), 24),
    (
        "Featured pictures of Felidae",
        "wildlife",
        ("кошачьи", "дикая природа", "животные"),
        24,
    ),
    (
        "Featured pictures of birds in flight",
        "wildlife",
        ("птицы", "движение", "дикая природа"),
        35,
    ),
    (
        "Featured pictures of Passeriformes",
        "wildlife",
        ("птицы", "животные", "детали"),
        40,
    ),
    (
        "Featured pictures of Vulpes vulpes",
        "wildlife",
        ("лисы", "животные", "дикая природа"),
        12,
    ),
)
FILMS = (
    ("Gold rush poster.jpg", "Золотая лихорадка", "Чарли Чаплин", 1925, "комедия"),
    (
        "The General (1926) - Movie Poster.png",
        "Генерал",
        "Бастер Китон, Клайд Брукман",
        1926,
        "комедия",
    ),
    ("Sunrise vintage.jpg", "Восход солнца", "Фридрих Вильгельм Мурнау", 1927, "драма"),
    (
        "CABINETOFDRCALIGARI-poster.jpg",
        "Кабинет доктора Калигари",
        "Роберт Вине",
        1920,
        "экспрессионизм",
    ),
    ("Poster for Tol'able David.jpg", "Терпеливый Дэвид", "Генри Кинг", 1921, "драма"),
    (
        "Absinthe film poster with Glen White 1914 - Original.jpg",
        "Абсент",
        "Герберт Бренон, Джордж Такер",
        1914,
        "драма",
    ),
    ("The Kid 1921 poster.jpg", "Малыш", "Чарли Чаплин", 1921, "комедия"),
    (
        "Safety Last! (1923 poster).jpg",
        "Наконец в безопасности!",
        "Фред Ньюмейер, Сэм Тейлор",
        1923,
        "комедия",
    ),
    ("Metropolis poster.jpg", "Метрополис", "Фриц Ланг", 1927, "фантастика"),
)
MUSIC = (
    (
        "Audio files of music by Frédéric Chopin",
        "Фридерик Шопен",
        ("фортепиано", "романтизм", "классика"),
        18,
    ),
    (
        "Audio files of music by Claude Debussy",
        "Клод Дебюсси",
        ("импрессионизм", "фортепиано", "атмосфера"),
        10,
    ),
    (
        "Audio files of music by Johann Sebastian Bach",
        "Иоганн Себастьян Бах",
        ("барокко", "классика", "инструментальная"),
        14,
    ),
    (
        "Audio files of music by Erik Satie",
        "Эрик Сати",
        ("фортепиано", "минимализм", "тишина"),
        10,
    ),
    (
        "Audio files of music by Ludwig van Beethoven",
        "Людвиг ван Бетховен",
        ("классика", "оркестр", "соната"),
        14,
    ),
    (
        "Audio files of music by Scott Joplin",
        "Скотт Джоплин",
        ("рэгтайм", "ритм", "фортепиано"),
        10,
    ),
)
RU_WORDS = {
    "forest": "лес",
    "mountain": "горы",
    "sunset": "закат",
    "at night": "ночь",
    "blue hour": "синий час",
    "fog": "туман",
    "mist": "туман",
    "winter": "зима",
    "snow": "снег",
    "autumn": "осень",
    "river": "река",
    "lake": "озеро",
    "ocean": "океан",
    "street": "улица",
    "bridge": "мост",
    "stairs": "лестница",
    "church": "церковь",
    "train": "поезд",
    "japan": "япония",
    "italy": "италия",
    "cat ": "кошки",
    "cat,": "кошки",
    "portrait": "портрет",
    "flower": "цветы",
    "light": "свет",
    "coffee": "кофе",
    "piano": "фортепиано",
    "symphony": "симфония",
    "nocturne": "ноктюрн",
}


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain(value):
    parser = TextParser()
    parser.feed(str(value or ""))
    return re.sub(r"\s+", " ", html.unescape(" ".join(parser.parts))).strip()


def clean_title(value, fallback):
    title = plain(value) or re.sub(r"\.[\w]{2,5}$", "", fallback.removeprefix("File:"))
    return title[:160] or fallback


def common_tags(text):
    value = text.lower()
    return [label for word, label in RU_WORDS.items() if word in value]


def get(url, params=None):
    if params:
        url = f"{url}?{urlencode(params)}"
    req = Request(
        url, headers={"User-Agent": AGENT, "Accept": "application/json,*/*;q=0.8"}
    )
    for retry in range(3):
        try:
            with urlopen(req, timeout=22) as response:
                return response.read()
        except HTTPError as exc:
            if exc.code not in {429, 503} or retry >= 2:
                raise
            delay = exc.headers.get("Retry-After", "")
            time.sleep(max(5, int(delay)) if delay.isdigit() else (5 + retry * 6))
        except (URLError, TimeoutError):
            if retry >= 2:
                raise
            time.sleep(3 + retry * 3)
    raise RuntimeError("Request did not finish")


def commons(params):
    body = json.loads(get(COMMONS, {**COMMON_FIELDS, **params}))
    time.sleep(0.65)
    if "error" in body:
        raise RuntimeError(body["error"].get("info"))
    return body


def category(name, limit, convert):
    params = {
        "generator": "categorymembers",
        "gcmtitle": f"Category:{name}",
        "gcmtype": "file",
        "gcmlimit": min(35, limit + 8),
    }
    entries = []
    for _ in range(10):
        body = commons(params)
        pages = body.get("query", {}).get("pages", [])
        for page in pages:
            if entry := convert(page):
                entries.append(entry)
                if len(entries) == limit:
                    return entries
        continuation = body.get("continue")
        if not continuation:
            break
        params.update(continuation)
    return entries


def wiki_file(page, kind, topic, tags, title=None, creator=None, year=None):
    infos = page.get("imageinfo") or []
    if not infos or "pageid" not in page:
        return None
    info = infos[0]
    if info.get("mime") not in (AUDIO_MIMES if kind == "track" else IMAGE_MIMES):
        return None
    details = info.get("extmetadata", {})

    def field(name):
        return details.get(name, {}).get("value", "")

    license_name = plain(field("LicenseShortName"))
    attribution = plain(field("Attribution")) or plain(field("Artist"))
    license_url = field("LicenseUrl") or None
    if not LICENSE.fullmatch(license_name) or (
        license_name.startswith("CC BY") and (not attribution or not license_url)
    ):
        return None
    source = info.get("descriptionurl")
    if urlparse(source or "").hostname != "commons.wikimedia.org":
        return None
    heading = title or clean_title(field("ObjectName"), page["title"])
    desc = plain(field("ImageDescription"))[:500]
    width, height = info.get("width", 0), info.get("height", 0)
    ratio = width / height if width and height else 1
    if kind != "track" and (not 0.42 <= ratio <= 2.7 or min(width, height) < 260):
        return None
    if kind == "track":
        heading = re.sub(
            r"^(?:\d+\s+)?(?:Fr[eé]d[eé]ric )?Chopin\s*[-–,]\s*",
            "",
            heading,
            flags=re.IGNORECASE,
        )
        heading = heading.removesuffix(".flac")
    thumb = (
        info.get("thumburl", info["url"]).split("?utm_", 1)[0]
        if kind != "track"
        else None
    )
    return {
        "id": f"wm-{page['pageid']}",
        "kind": kind,
        "topic": topic,
        "title": heading,
        "creator": creator or attribution[:160],
        "credit": attribution[:400],
        "source": source,
        "license": license_name,
        "licenseUrl": license_url,
        "image": thumb,
        "audio": info["url"] if kind == "track" else None,
        "audioType": info["mime"] if kind == "track" else None,
        "ratio": round(ratio, 4),
        "year": year,
        "description": desc,
        "tags": list(dict.fromkeys((*tags, *common_tags(heading + " " + desc))))[:12],
    }


def get_photos(sources=PHOTO_SOURCES + SUPPLEMENT):
    rows = []
    for label, topic, tags, limit in sources:
        try:
            batch = category(
                label,
                limit,
                lambda page, topic=topic, tags=tags: wiki_file(
                    page, "image", topic, tags
                ),
            )
        except (HTTPError, URLError, RuntimeError, TimeoutError) as exc:
            print(f"{label}: {exc}", file=sys.stderr, flush=True)
            continue
        rows.extend(batch)
        print(f"{topic:12} {len(batch):3} {label}", flush=True)
    return rows


def get_films():
    lookup = {
        name: (title, creator, year, genre)
        for name, title, creator, year, genre in FILMS
    }
    body = commons(
        {"titles": "|".join(f"File:{name}" for name in lookup), "redirects": 1}
    )
    entries = []
    for page in body.get("query", {}).get("pages", []):
        name = page["title"].removeprefix("File:")
        if name in lookup:
            title, creator, year, genre = lookup[name]
            entry = wiki_file(
                page,
                "film",
                "cinema",
                ("кино", "винтаж", "немое кино", genre),
                title,
                creator,
                year,
            )
            if entry:
                entries.append(entry)
    fallback = category(
        "Film posters of silent films",
        45,
        lambda page: wiki_file(
            page,
            "film",
            "cinema",
            ("кино", "винтаж", "немое кино"),
        ),
    )
    return entries + fallback


def get_music():
    rows = []
    for label, composer, tags, limit in MUSIC:
        try:
            rows.extend(
                category(
                    label,
                    limit,
                    lambda page, tags=tags, composer=composer: wiki_file(
                        page,
                        "track",
                        "sound",
                        tags,
                        creator=composer,
                    ),
                )
            )
        except (HTTPError, URLError, RuntimeError, TimeoutError) as exc:
            print(f"{label}: {exc}", file=sys.stderr, flush=True)
    return rows


def get_art():
    entries = []
    asset = commons({"titles": "File:Hokusai- Kanagawa.jpg"})
    for page in asset.get("query", {}).get("pages", []):
        wave = wiki_file(
            page,
            "image",
            "art",
            ("искусство", "япония", "гравюра", "море"),
            "Большая волна в Канагаве",
            "Кацусика Хокусай",
            1831,
        )
        if wave:
            wave["originalTitle"] = "Great Wave off Kanagawa"
            entries.append(wave)
    base = "https://openaccess-api.clevelandart.org/api/artworks/"
    for query, tags in (
        ("Hokusai", ("япония", "гравюра")),
        ("Claude Monet", ("живопись", "импрессионизм")),
        ("portrait painting", ("живопись", "портрет")),
        ("landscape painting", ("живопись", "пейзаж")),
        ("photograph", ("фотография", "архив")),
        ("textile", ("текстиль", "узор")),
    ):
        params = {"q": query, "cc0": 1, "has_image": 1, "limit": 30}
        items = json.loads(get(base, params))["data"]
        time.sleep(0.75)
        for item in items:
            picture = (item.get("images") or {}).get("web") or {}
            if item.get("share_license_status") != "CC0" or not (
                picture.get("url") and picture.get("width") and picture.get("height")
            ):
                continue
            ratio = int(picture["width"]) / int(picture["height"])
            if not 0.42 <= ratio <= 2.7:
                continue
            creator = ", ".join(
                part["description"].partition(" (")[0]
                for part in (item.get("creators") or [])[:2]
                if part.get("description")
            )
            title = item["title"]
            entries.append(
                {
                    "id": f"cma-{item['id']}",
                    "kind": "image",
                    "topic": "art",
                    "title": title,
                    "creator": creator,
                    "credit": ", ".join(
                        filter(None, [creator, "Cleveland Museum of Art"])
                    ),
                    "source": item["url"],
                    "license": "CC0",
                    "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
                    "image": picture["url"],
                    "audio": None,
                    "audioType": None,
                    "ratio": round(ratio, 4),
                    "year": item.get("creation_date_earliest"),
                    "description": plain(item.get("description"))[:500],
                    "tags": list(
                        dict.fromkeys(
                            ("искусство", "музей", *tags, *common_tags(title))
                        )
                    ),
                }
            )
    return entries


def write(entries):
    ROOT.mkdir(parents=True, exist_ok=True)
    target = ROOT / "catalog.json"
    stage = target.with_suffix(".tmp")
    stage.write_text(
        json.dumps(entries, ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    stage.replace(target)


def image_features(image):
    import colorsys

    from PIL import Image, ImageOps

    image = ImageOps.exif_transpose(image).convert("RGB")
    miniature = image.resize((36, 36))
    hist = Counter()
    levels = []
    for r, g, b in miniature.getdata():
        hue, saturation, brightness = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        levels.append(0.2126 * r / 255 + 0.7152 * g / 255 + 0.0722 * b / 255)
        if saturation < 0.17 or brightness < 0.19:
            hist["neutral"] += 1
        else:
            hue_names = [
                "red",
                "orange",
                "yellow",
                "green",
                "teal",
                "blue",
                "violet",
                "rose",
            ]
            hist[hue_names[int((hue + 0.037) % 1 * len(hue_names))]] += 1
    dominant = [
        family for family, count in hist.most_common(3) if count / len(levels) >= 0.113
    ]
    brightness = sum(levels) / len(levels)
    paint = miniature.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
    return {
        "colors": dominant,
        "light": "dark"
        if brightness < 0.34
        else "light"
        if brightness > 0.66
        else "mid",
        "placeholder": "#" + "".join(f"{channel:02x}" for channel in paint),
    }


def cache_images(entries, limit):
    import io

    from PIL import Image, ImageOps

    destination = ROOT / "preview"
    destination.mkdir(exist_ok=True)
    cached = 0
    for entry in entries:
        if not entry["image"] or cached >= limit:
            continue
        file = destination / f"{entry['id']}.webp"
        if not file.exists():
            try:
                with Image.open(io.BytesIO(get(entry["image"]))) as source:
                    entry.update(image_features(source))
                    resized = ImageOps.exif_transpose(source).convert("RGB")
                    resized.thumbnail((600, 820), Image.Resampling.LANCZOS)
                    resized.save(file, "WEBP", quality=80)
            except (OSError, ValueError) as exc:
                print(f"{entry['id']}: {exc}", file=sys.stderr, flush=True)
                continue
            finally:
                time.sleep(0.35)
        else:
            with Image.open(file) as source:
                entry.update(image_features(source))
        entry["preview"] = f"/discovery/preview/{file.name}"
        cached += 1
        if cached % 25 == 0:
            print(f"Cached {cached} previews", flush=True)
    print(f"Cached {cached} previews", flush=True)


def featured(entries):
    path = Path(__file__).with_name("discovery-featured.json")
    lineup = json.loads(path.read_text()) if path.is_file() else {}
    priority = {identifier: index for index, identifier in enumerate(lineup)}
    for entry in entries:
        entry.pop("featured", None)
        name = lineup.get(entry["id"])
        if not name:
            continue
        if entry["title"] != name:
            entry.setdefault("originalTitle", entry["title"])
            entry["title"] = name
        entry["featured"] = priority[entry["id"]]
    return entries


def priority_cache(entries, count):
    buckets = {}
    for entry in entries:
        if entry.get("image") and "featured" not in entry:
            buckets.setdefault(entry["topic"], []).append(entry)
    for rows in buckets.values():
        rows.sort(key=lambda row: hashlib.sha256(row["id"].encode()).digest())
    chosen = sorted(
        (entry for entry in entries if "featured" in entry),
        key=lambda entry: entry["featured"],
    )
    for index in range(count):
        for rows in buckets.values():
            if index < len(rows):
                chosen.append(rows[index])
    unique = {row["id"]: row for row in chosen}
    return list(unique.values()) + [row for row in entries if row["id"] not in unique]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only-cache", action="store_true")
    parser.add_argument("--supplement", action="store_true")
    parser.add_argument("--refresh-art", action="store_true")
    parser.add_argument("--cache", type=int, default=0)
    parser.add_argument(
        "--front",
        type=Path,
        help="Optional, one id per line in initial discovery order",
    )
    args = parser.parse_args()
    snapshot = ROOT / "catalog.json"
    previous = json.loads(snapshot.read_text()) if snapshot.is_file() else []
    entries = {row["id"]: row for row in previous}
    if args.supplement:
        entries.update((row["id"], row) for row in get_photos(SUPPLEMENT))
    if not (args.only_cache or args.supplement or args.refresh_art):
        for collect in (get_films, get_music, get_photos, get_art):
            try:
                entries.update((row["id"], row) for row in collect())
            except (HTTPError, URLError, RuntimeError, TimeoutError) as exc:
                print(f"{collect.__name__}: {exc}", file=sys.stderr, flush=True)
    if args.refresh_art:
        art = get_art()
        if art:
            entries = {
                key: value
                for key, value in entries.items()
                if not key.startswith(("aic-", "cma-"))
            }
            entries.update((row["id"], row) for row in art)
    if not entries:
        raise SystemExit("No materials were downloaded. The catalog was not written.")
    for old in previous:
        current = entries.get(old["id"])
        if current and old.get("preview") and current.get("image") == old.get("image"):
            for name in ("preview", "colors", "light", "placeholder"):
                if name in old:
                    current[name] = old[name]
    entries = list(entries.values())
    recordings = Path(__file__).with_name("discovery-recordings.json")
    if recordings.is_file():
        entries.extend(
            row
            for row in json.loads(recordings.read_text())
            if (ROOT / "audio" / Path(row["audio"]).name).is_file()
        )
    entries = list({row["id"]: row for row in reversed(entries)}.values())[::-1]
    featured(entries)
    if args.front:
        priority = {
            key.strip(): index
            for index, key in enumerate(args.front.read_text().splitlines())
        }
        entries.sort(key=lambda row: priority.get(row["id"], len(priority)))
    if args.cache:
        cache_images(priority_cache(entries, args.cache), args.cache)
    write(entries)
    print(Counter(entry["kind"] for entry in entries), flush=True)


if __name__ == "__main__":
    main()
