import re
from urllib.parse import urlsplit

import anyio
import httpx
from fastapi import HTTPException

from app.core.config import get_settings

DEMO_ENTRIES = {
    "track": [
        ("autumn", "Autumn Leaves", "Bill Evans Trio", 1960, "https://www.deezer.com/"),
        ("pink", "Pink + White", "Frank Ocean", 2016, "https://www.deezer.com/"),
        ("rhubarb", "Rhubarb", "Aphex Twin", 1994, "https://www.deezer.com/"),
        ("blue", "Blue in Green", "Miles Davis", 1959, "https://www.deezer.com/"),
        ("holocene", "Holocene", "Bon Iver", 2011, "https://www.deezer.com/"),
    ],
    "film": [
        ("her", "Она", "Спайк Джонз", 2013, "https://www.themoviedb.org/movie/152601"),
        (
            "tokyo",
            "Трудности перевода",
            "София Коппола",
            2003,
            "https://www.themoviedb.org/movie/153",
        ),
        ("paris", "Париж, Техас", "Вим Вендерс", 1984, "https://www.themoviedb.org/movie/655"),
        ("days", "Идеальные дни", "Вим Вендерс", 2023, "https://www.themoviedb.org/movie/976893"),
        (
            "moon",
            "Королевство полной луны",
            "Уэс Андерсон",
            2012,
            "https://www.themoviedb.org/movie/83666",
        ),
    ],
}


def demo_entries(kind: str) -> list[dict]:
    return [
        dict(
            kind=kind,
            external_id=f"demo-{key}",
            title=title,
            creator=creator,
            year=year,
            source=source,
            artwork=None,
            preview=None,
            provider="demo",
        )
        for key, title, creator, year, source in DEMO_ENTRIES[kind]
    ]


def https_url(value) -> str | None:
    if isinstance(value, str) and urlsplit(value).scheme == "https":
        return value
    return None


async def fetch(provider: str, path: str, **params) -> dict:
    settings = get_settings()
    base = settings.tmdb_base_url if provider == "tmdb" else settings.deezer_base_url
    if provider == "tmdb":
        if not settings.tmdb_api_key:
            raise HTTPException(503, "Подключите ключ TMDB или включите демонстрационный каталог")
        if len(settings.tmdb_api_key) == 32:
            params["api_key"] = settings.tmdb_api_key
            headers = {}
        else:
            headers = {"Authorization": f"Bearer {settings.tmdb_api_key}"}
    else:
        headers = {}
    try:
        with anyio.fail_after(settings.external_timeout_s):
            async with httpx.AsyncClient(timeout=settings.external_timeout_s) as client:
                response = await client.get(f"{base}{path}", params=params, headers=headers)
                response.raise_for_status()
                data = response.json()
                if not isinstance(data, dict):
                    raise ValueError
                if "error" in data:
                    if data["error"].get("code") == 800:
                        raise HTTPException(404, "Объект исчез из каталога")
                    raise ValueError
                return data
    except (httpx.HTTPError, TimeoutError, ValueError) as exc:
        if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 404:
            raise HTTPException(404, "Объект исчез из каталога") from exc
        label = "TMDB" if provider == "tmdb" else "Deezer"
        raise HTTPException(503, f"Каталог {label} временно недоступен") from exc


def track_data(row: dict) -> dict:
    key = str(row["id"])
    return dict(
        kind="track",
        external_id=key,
        title=row.get("title") or "Без названия",
        creator=(row.get("artist") or {}).get("name", ""),
        year=None,
        source=f"https://www.deezer.com/track/{key}",
        artwork=https_url((row.get("album") or {}).get("cover_medium")),
        preview=https_url(row.get("preview")),
        provider="deezer",
    )


def film_data(row: dict) -> dict:
    key = str(row["id"])
    date = row.get("release_date") or ""
    poster = row.get("poster_path") or ""
    directors = [
        entry["name"]
        for entry in (row.get("credits") or {}).get("crew", [])
        if entry.get("job") == "Director"
    ]
    return dict(
        kind="film",
        external_id=key,
        title=row.get("title") or row.get("original_title") or "Фильм",
        creator=", ".join(directors),
        year=int(date[:4]) if date[:4].isdigit() else None,
        source=f"https://www.themoviedb.org/movie/{key}",
        preview=None,
        provider="tmdb",
        artwork=f"https://image.tmdb.org/t/p/w500{poster}"
        if re.fullmatch(r"/[a-zA-Z0-9]+\.[a-z]+", poster)
        else None,
    )


def catalog_is_demo(kind: str) -> bool:
    settings = get_settings()
    return settings.catalog_demo or (kind == "film" and settings.tmdb_demo)


async def search_catalog(kind: str, query: str) -> list[dict]:
    if catalog_is_demo(kind):
        query = query.casefold()
        return [
            entry
            for entry in demo_entries(kind)
            if query in (f"{entry['title']} {entry['creator']} {entry['external_id']}").casefold()
        ]
    if kind == "track":
        data = await fetch("deezer", "/search/track", q=query, limit=12)
        return [track_data(row) for row in data.get("data", [])[:12]]
    data = await fetch(
        "tmdb", "/search/movie", query=query, language="ru-RU", include_adult="false"
    )
    return [film_data(row) for row in data.get("results", [])[:12]]


async def catalog_details(kind: str, external_id: str) -> dict:
    if external_id.startswith("demo-"):
        if catalog_is_demo(kind):
            for entry in demo_entries(kind):
                if entry["external_id"] == external_id:
                    return {**entry, "file": None}
        raise HTTPException(404, "Объект отсутствует в каталоге")
    if kind == "track":
        result = track_data(await fetch("deezer", f"/track/{external_id}"))
    else:
        result = film_data(
            await fetch(
                "tmdb", f"/movie/{external_id}", language="ru-RU", append_to_response="credits"
            )
        )
    result["file"] = None
    return result
