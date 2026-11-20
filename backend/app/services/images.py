import hashlib
import http.client
import io
import ipaddress
import os
import socket
import ssl
from pathlib import Path
from tempfile import NamedTemporaryFile
from time import monotonic
from urllib.parse import urlsplit

import anyio
from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.responses import FileResponse

from app.core.config import get_settings

FORMATS = {
    "JPEG": ("jpg", "image/jpeg"),
    "PNG": ("png", "image/png"),
    "WEBP": ("webp", "image/webp"),
}
SECURITY_HEADERS = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
}


def upload_limit() -> int:
    return get_settings().max_upload_mb * 1024 * 1024


def atomic_write(path: Path, data: bytes) -> None:
    if path.is_file():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        name = temporary.name
        try:
            temporary.write(data)
            temporary.close()
            os.replace(name, path)
        finally:
            Path(name).unlink(missing_ok=True)


def store_image(data: bytes) -> str:
    if len(data) > upload_limit():
        raise HTTPException(413, "Изображение должно весить не более 10 МБ")
    try:
        with Image.open(io.BytesIO(data), formats=list(FORMATS)) as image:
            if image.width * image.height > 30_000_000:
                raise HTTPException(422, "Разрешение изображения превышает 30 Мп")
            image.load()
            suffix = FORMATS[image.format][0]
            thumb = ImageOps.exif_transpose(image)
            thumb.thumbnail((760, 760))
            buffer = io.BytesIO()
            thumb.save(buffer, "WEBP", quality=82)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError) as exc:
        raise HTTPException(422, "Выберите корректный файл JPEG, PNG или WebP") from exc
    root = get_settings().media_root
    key = f"{hashlib.sha256(data).hexdigest()}.{suffix}"
    atomic_write(root / "thumbs" / f"{key}.webp", buffer.getvalue())
    atomic_write(root / "originals" / key, data)
    return key


async def upload_image(file: UploadFile) -> str:
    try:
        raw = await file.read(upload_limit() + 1)
        return await anyio.to_thread.run_sync(store_image, raw)
    finally:
        await file.close()


def download_image(url: str) -> bytes:
    deadline = monotonic() + 3.8
    parts = urlsplit(url)
    host = parts.hostname
    if (
        parts.scheme != "https"
        or not host
        or parts.port not in (443, None)
        or parts.username
        or parts.password
        or parts.fragment
        or "\\" in url
    ):
        raise ValueError("HTTPS URL required")
    candidates = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    addresses = list(dict.fromkeys(result[4][0] for result in candidates))
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise ValueError("Public addresses required")
    connection = http.client.HTTPSConnection(host, timeout=2)
    try:
        # Bind the connection to the validated address and verify TLS for the hostname.
        sock = socket.create_connection((addresses[0], 443), timeout=2)
        try:
            connection.sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
        except Exception:
            sock.close()
            raise
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        connection.request("GET", target, headers={"Accept": "image/jpeg,image/png,image/webp"})
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError("Image unavailable")
        limit = upload_limit() + 1
        data = bytearray()
        while len(data) < limit:
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise TimeoutError
            chunk = response.read1(min(64 * 1024, limit - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        return bytes(data)
    finally:
        connection.close()


async def retrieve_image(url: str) -> str:
    try:
        with anyio.fail_after(4):
            raw = await anyio.to_thread.run_sync(download_image, url, abandon_on_cancel=True)
    except (TimeoutError, ValueError, OSError, http.client.HTTPException) as exc:
        raise HTTPException(
            422, "Не удалось скачать изображение по публичной HTTPS-ссылке"
        ) from exc
    return await anyio.to_thread.run_sync(store_image, raw)


def file_response(key: str | None, thumbnail: bool) -> FileResponse:
    if not key:
        raise HTTPException(404, "Файл не найден")
    root = get_settings().media_root
    path = root / "thumbs" / f"{key}.webp" if thumbnail else root / "originals" / key
    if not path.is_file():
        raise HTTPException(404, "Файл не найден")
    return FileResponse(path, headers=SECURITY_HEADERS)
