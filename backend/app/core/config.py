from functools import lru_cache
from pathlib import Path

from pydantic import HttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "Relay"
    api_prefix: str = "/api"
    database_url: str = "postgresql+asyncpg://relay:relay@localhost:5432/relay"
    session_days: int = 14
    secure_cookies: bool = False
    cors_origins: list[str] = ["http://localhost:5173"]
    media_root: Path = Path("./media")
    max_upload_mb: int = 10
    discovery_catalog: Path = (
        Path(__file__).resolve().parents[3] / "frontend/public/discovery/catalog.json"
    )
    relay_public_url: HttpUrl = HttpUrl("http://127.0.0.1:8080")
    turnstile_site_key: str = ""
    turnstile_secret_key: SecretStr = SecretStr("")
    tmdb_api_key: str = ""
    tmdb_base_url: str = "https://api.themoviedb.org/3"
    deezer_base_url: str = "https://api.deezer.com"
    catalog_demo: bool = False
    tmdb_demo: bool = False
    external_timeout_s: float = 3.8


@lru_cache
def get_settings() -> Settings:
    return Settings()
