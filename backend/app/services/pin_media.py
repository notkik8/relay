import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from starlette.responses import FileResponse

from app.core.config import get_settings
from app.services.images import SECURITY_HEADERS

MEDIA_LIMIT = 50 * 1024 * 1024
AUDIO_TYPES = {
    "mp3": "audio/mpeg", "wav": "audio/wav", "ogg": "audio/ogg", "flac": "audio/flac",
}
VIDEO_TYPES = {"mp4": "video/mp4", "webm": "video/webm"}


def audio_extension(header: bytes) -> str | None:
    if header.startswith(b"RIFF") and header[8:12] == b"WAVE":
        return "wav"
    if header.startswith(b"fLaC"):
        return "flac"
    if header.startswith(b"OggS") and (b"OpusHead" in header or b"\x01vorbis" in header):
        return "ogg"
    offset = 0
    if header.startswith(b"ID3") and len(header) >= 10:
        for value in header[6:10]:
            if value & 0x80:
                return None
            offset = (offset << 7) | value
        offset += 10 + (10 if header[5] & 0x10 else 0)
    frame = header[offset:offset + 4]
    if len(frame) == 4 and frame[0] == 0xFF and frame[1] & 0xE6 == 0xE2:
        if frame[1] & 0x18 != 0x08 and frame[2] >> 4 not in (0, 15) and frame[2] & 0x0C != 0x0C:
            return "mp3"
    return None


def video_extension(header: bytes) -> str | None:
    if header[4:8] == b"ftyp" and header[8:12] in (
        b"isom", b"iso2", b"iso5", b"iso6", b"mp41", b"mp42", b"avc1", b"dash", b"MSNV",
    ):
        return "mp4"
    if header.startswith(b"\x1a\x45\xdf\xa3") and b"\x42\x82\x84webm" in header[:128]:
        return "webm"
    return None


def store_av(file: UploadFile, kind: str, pin_id: str) -> str:
    header = file.file.read(1024 * 1024)
    extension = audio_extension(header) if kind == "track" else video_extension(header)
    if not extension:
        formats = "MP3, WAV, OGG или FLAC" if kind == "track" else "MP4 или WebM"
        raise HTTPException(422, f"Выберите файл в формате {formats}")
    if file.size is not None and file.size > MEDIA_LIMIT:
        raise HTTPException(413, "Аудио или видео должно весить не более 50 МБ")
    directory = get_settings().media_root / "pins"
    directory.mkdir(parents=True, exist_ok=True)
    key = f"{pin_id}.{extension}"
    with NamedTemporaryFile(dir=directory, delete=False) as temporary:
        try:
            temporary.write(header)
            remaining = MEDIA_LIMIT - len(header)
            while chunk := file.file.read(min(64 * 1024, remaining + 1)):
                remaining -= len(chunk)
                if remaining < 0:
                    raise HTTPException(413, "Аудио или видео должно весить не более 50 МБ")
                temporary.write(chunk)
            temporary.close()
            os.replace(temporary.name, directory / key)
        finally:
            Path(temporary.name).unlink(missing_ok=True)
    return key


async def upload_av(file: UploadFile, kind: str, pin_id: str) -> str:
    try:
        return await run_in_threadpool(store_av, file, kind, pin_id)
    finally:
        await file.close()


def av_response(key: str, kind: str) -> FileResponse:
    path = get_settings().media_root / "pins" / key
    media_type = (AUDIO_TYPES if kind == "track" else VIDEO_TYPES).get(path.suffix[1:])
    if media_type is None or not path.is_file():
        raise HTTPException(404, "Файл не найден")
    return FileResponse(path, media_type=media_type, headers=SECURITY_HEADERS)
