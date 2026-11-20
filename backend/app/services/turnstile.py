import httpx
from fastapi import HTTPException

from app.core.config import get_settings

SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TEST_KEY_PREFIXES = ("1x", "2x", "3x")
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


def registration_site_key() -> str | None:
    settings = get_settings()
    site_key = settings.turnstile_site_key
    secret = settings.turnstile_secret_key.get_secret_value()
    if not site_key or not secret:
        return None
    if (settings.secure_cookies or settings.relay_public_url.host not in LOOPBACK_HOSTS) and (
        site_key.startswith(TEST_KEY_PREFIXES) or secret.startswith(TEST_KEY_PREFIXES)
    ):
        return None
    return site_key


async def verify_registration(token: str) -> None:
    settings = get_settings()
    unavailable = "Проверка безопасности временно недоступна. Попробуйте позже."
    if not registration_site_key():
        raise HTTPException(503, "Регистрация временно недоступна.")
    secret = settings.turnstile_secret_key.get_secret_value()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.post(SITEVERIFY, json={"secret": secret, "response": token})
            response.raise_for_status()
            result = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(503, unavailable) from exc
    if not isinstance(result, dict):
        raise HTTPException(503, unavailable)
    if result.get("success") is True and (
        secret.startswith(TEST_KEY_PREFIXES)
        or (
            result.get("hostname") == settings.relay_public_url.host
            and result.get("action") == "register"
        )
    ):
        return
    raise HTTPException(400, "Пройдите проверку безопасности ещё раз.")
