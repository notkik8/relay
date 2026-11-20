import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from app.api.deps import Account, SessionDep, Viewer
from app.api.routers.accounts import public_user
from app.api.routers.boards import Limit, Offset
from app.api.routers.social import profile_user
from app.core.config import get_settings
from app.models.entities import CollectionPin, Pin, PinCollection, User, identifier
from app.schemas.inputs import CollectionInput, PinKind, Text
from app.services.boards import page
from app.services.images import file_response, upload_image
from app.services.pin_media import av_response, upload_av

router = APIRouter(tags=["pins"])
logger = logging.getLogger(__name__)
PIN_PREFIX = "p-"


@lru_cache(maxsize=2)
def read_catalog(path: Path, modified: int) -> dict:
    return {item["id"]: item for item in json.loads(path.read_text(encoding="utf-8"))}


def catalog_items() -> dict:
    path = get_settings().discovery_catalog
    try:
        return read_catalog(path, path.stat().st_mtime_ns)
    except (OSError, ValueError) as exc:
        raise HTTPException(503, "Каталог временно недоступен") from exc


def pin_data(pin: Pin, author: User) -> dict:
    material_id = f"{PIN_PREFIX}{pin.id}"
    media = f"/api/v1/pins/{material_id}/media"
    return {
        "id": material_id,
        "kind": pin.kind,
        "topic": {"image": "art", "track": "sound", "video": "cinema"}[pin.kind],
        "title": pin.title,
        "description": pin.description,
        "author": public_user(author),
        "creator": author.name,
        "credit": "",
        "source": media if pin.kind == "image" else "",
        "license": "",
        "licenseUrl": None,
        "image": media
        if pin.kind == "image"
        else f"/api/v1/pins/{material_id}/cover"
        if pin.cover
        else None,
        "thumbnail": f"{media}?thumbnail=true" if pin.kind == "image" else None,
        "audio": media if pin.kind == "track" else None,
        "audioType": None,
        "video": media if pin.kind == "video" else None,
        "ratio": 1.6 if pin.kind == "video" else 1,
        "year": None,
        "tags": [],
    }


def visible_pins():
    return select(Pin, User).join(User, Pin.owner_id == User.id).where(~User.blocked, ~User.deleted)


async def get_pin(db: SessionDep, material_id: str) -> tuple[Pin, User]:
    row = (
        (
            await db.execute(visible_pins().where(Pin.id == material_id.removeprefix(PIN_PREFIX)))
        ).one_or_none()
        if material_id.startswith(PIN_PREFIX)
        else None
    )
    if row is None:
        raise HTTPException(404, "Пин недоступен")
    return row[0], row[1]


@router.get("/pins")
async def pins(
    db: SessionDep,
    offset: Offset = 0,
    limit: Limit = 24,
    q: Annotated[str, Query(max_length=100)] = "",
    ids: Annotated[list[str] | None, Query(max_length=60)] = None,
):
    query = visible_pins()
    if ids is not None:
        query = query.where(
            Pin.id.in_(
                [
                    key[len(PIN_PREFIX) :]
                    for key in ids
                    if key.startswith(PIN_PREFIX) and len(key) == 34
                ]
            )
        )
        limit = 60
    for word in q.split():
        query = query.where(
            or_(
                *(
                    column.icontains(word, autoescape=True)
                    for column in (
                        Pin.title,
                        Pin.description,
                        User.name,
                        User.username,
                    )
                )
            )
        )
    return await pin_page(db, query, offset, limit)


async def pin_page(db: SessionDep, query, offset: int, limit: int) -> dict:
    rows = (
        await db.execute(
            query.order_by(Pin.created_at.desc(), Pin.id.desc()).offset(offset).limit(limit + 1)
        )
    ).all()
    return page([pin_data(pin, author) for pin, author in rows], offset, limit)


@router.get("/profiles/{username}/pins")
async def profile_pins(username: str, db: SessionDep, offset: Offset = 0, limit: Limit = 24):
    owner = await profile_user(db, username)
    return await pin_page(db, visible_pins().where(Pin.owner_id == owner.id), offset, limit)


@router.post("/pins", status_code=201)
async def publish_pin(
    user: Account,
    db: SessionDep,
    kind: Annotated[PinKind, Form()],
    title: Annotated[Text, Form(min_length=1, max_length=160)],
    file: UploadFile,
    description: Annotated[Text, Form(max_length=2000)] = "",
    cover: Annotated[UploadFile | None, File()] = None,
):
    if kind == "image" and cover:
        raise HTTPException(422, "Изображение уже служит обложкой пина")
    cover_key = await upload_image(cover) if cover else None
    pin_id = identifier()
    key = await upload_image(file) if kind == "image" else await upload_av(file, kind, pin_id)
    pin = Pin(
        id=pin_id,
        owner_id=user.id,
        kind=kind,
        title=title,
        description=description,
        file=key,
        cover=cover_key,
    )
    db.add(pin)
    await db.commit()
    return pin_data(pin, user)


@router.get("/pins/{material_id}")
async def public_pin(material_id: str, db: SessionDep):
    return pin_data(*(await get_pin(db, material_id)))


@router.get("/pins/{material_id}/media")
async def pin_media(material_id: str, db: SessionDep, thumbnail: bool = False):
    pin, _ = await get_pin(db, material_id)
    if pin.kind == "image":
        return file_response(pin.file, thumbnail)
    return av_response(pin.file, pin.kind)


@router.get("/pins/{material_id}/cover")
async def pin_cover(material_id: str, db: SessionDep):
    pin, _ = await get_pin(db, material_id)
    return file_response(pin.cover, True)


@router.delete("/pins/{material_id}", status_code=204)
async def unpublish_pin(material_id: str, db: SessionDep, user: Account):
    pin, _ = await get_pin(db, material_id)
    if pin.owner_id != user.id:
        raise HTTPException(403, "Удалить пин может его автор")
    await db.delete(pin)
    await db.commit()
    if pin.kind != "image":
        try:
            (get_settings().media_root / "pins" / pin.file).unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not remove file for pin %s", pin.id)


def collection_data(collection: PinCollection, owner: User) -> dict:
    return {
        "id": collection.id,
        "title": collection.title,
        "description": collection.description,
        "public": collection.public,
        "owner": public_user(owner),
    }


async def get_collection(db: SessionDep, key: str, viewer: Viewer, editing: bool = False):
    query = (
        select(PinCollection, User)
        .join(User, PinCollection.owner_id == User.id)
        .where(PinCollection.id == key, ~User.blocked, ~User.deleted)
    )
    if editing:
        query = query.with_for_update(of=PinCollection)
    row = (await db.execute(query)).one_or_none()
    own = bool(row and viewer and row[0].owner_id == viewer.id)
    if row is None or (not own and (editing or not row[0].public)):
        raise HTTPException(404, "Папка недоступна")
    return row[0], row[1]


@router.get("/profiles/{username}/pin-collections")
async def profile_collections(
    username: str, db: SessionDep, viewer: Viewer, offset: Offset = 0, limit: Limit = 24
):
    owner = await profile_user(db, username)
    query = select(PinCollection).where(PinCollection.owner_id == owner.id)
    if not viewer or viewer.id != owner.id:
        query = query.where(PinCollection.public)
    rows = (
        await db.scalars(
            query.order_by(PinCollection.created_at.desc(), PinCollection.id.desc())
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    return page([collection_data(collection, owner) for collection in rows], offset, limit)


@router.post("/pin-collections", status_code=201)
async def create_collection(data: CollectionInput, db: SessionDep, user: Account):
    collection = PinCollection(owner_id=user.id, **data.model_dump())
    db.add(collection)
    await db.commit()
    return collection_data(collection, user)


@router.get("/pin-collections/{key}")
async def collection_detail(
    key: str, db: SessionDep, user: Viewer, offset: Offset = 0, limit: Limit = 24
):
    collection, owner = await get_collection(db, key, user)
    rows = (
        await db.execute(
            select(CollectionPin, Pin, User)
            .outerjoin(Pin, CollectionPin.pin_id == Pin.id)
            .outerjoin(User, Pin.owner_id == User.id)
            .where(
                CollectionPin.collection_id == key,
                or_(CollectionPin.catalog_id.is_not(None), ~User.blocked & ~User.deleted),
            )
            .order_by(CollectionPin.created_at.desc(), CollectionPin.id.desc())
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    catalog = catalog_items() if any(entry.catalog_id for entry, _, _ in rows) else {}
    items = [
        {
            "id": entry.id,
            "material_id": entry.catalog_id or f"{PIN_PREFIX}{pin.id}",
            "material": catalog.get(entry.catalog_id)
            if entry.catalog_id
            else pin_data(pin, author),
        }
        for entry, pin, author in rows
    ]
    return {"collection": collection_data(collection, owner), **page(items, offset, limit)}


@router.put("/pin-collections/{key}")
async def update_collection(key: str, data: CollectionInput, db: SessionDep, user: Account):
    collection, owner = await get_collection(db, key, user, editing=True)
    collection.title, collection.description, collection.public = (
        data.title,
        data.description,
        data.public,
    )
    await db.commit()
    return collection_data(collection, owner)


@router.delete("/pin-collections/{key}", status_code=204)
async def remove_collection(key: str, db: SessionDep, user: Account):
    collection, _ = await get_collection(db, key, user, editing=True)
    await db.delete(collection)
    await db.commit()


@router.put("/pin-collections/{key}/pins/{material_id}", status_code=204)
async def add_to_collection(key: str, material_id: str, db: SessionDep, user: Account):
    await get_collection(db, key, user, editing=True)
    if material_id.startswith(PIN_PREFIX):
        pin, _ = await get_pin(db, material_id)
        reference = {"pin_id": pin.id}
    elif material_id in catalog_items():
        reference = {"catalog_id": material_id}
    else:
        raise HTTPException(404, "Пин недоступен")
    try:
        await db.execute(
            insert(CollectionPin).values(collection_id=key, **reference).on_conflict_do_nothing()
        )
        await db.commit()
    except IntegrityError as exc:
        raise HTTPException(404, "Пин недоступен") from exc


@router.delete("/pin-collections/{key}/pins/{entry_id}", status_code=204)
async def remove_from_collection(key: str, entry_id: str, db: SessionDep, user: Account):
    await get_collection(db, key, user, editing=True)
    await db.execute(
        delete(CollectionPin).where(
            CollectionPin.collection_id == key,
            CollectionPin.id == entry_id,
        )
    )
    await db.commit()
