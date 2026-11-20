from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, Query, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from app.api.deps import Account, SessionDep, Viewer
from app.db.session import SessionLocal
from app.integrations.catalog import catalog_details, fetch, https_url, search_catalog
from app.models.entities import Board, Item, Like, Media, identifier
from app.schemas.inputs import (
    BoardInput,
    CatalogAdd,
    Destination,
    ImageImport,
    ItemPatch,
    Reorder,
)
from app.services.boards import (
    append_item,
    board_details,
    edit_board,
    feed,
    normalize_tags,
    page,
    view_board,
)
from app.services.images import file_response, retrieve_image, upload_image

router = APIRouter(tags=["boards"])
Offset = Annotated[int, Query(ge=0)]
Limit = Annotated[int, Query(ge=1, le=60)]
Kind = Literal["track", "film", "image"]


@router.get("/feed")
async def list_feed(
    db: SessionDep,
    user: Viewer,
    mode: Literal["public", "following", "mine"] = "public",
    offset: Offset = 0,
    limit: Limit = 12,
):
    if mode != "public" and user is None:
        raise HTTPException(401, "Войдите в аккаунт")
    return await feed(db, user, mode, offset, limit)


def apply_board(board: Board, data: BoardInput) -> None:
    if board.visibility != data.visibility:
        if data.visibility == "private":
            board.share_id = identifier()
        if data.visibility == "public":
            board.published_at = datetime.now(UTC)
    board.title, board.description = data.title, data.description
    board.tags, board.theme, board.visibility = (
        normalize_tags(data.tags),
        data.theme,
        data.visibility,
    )


@router.post("/boards", status_code=201)
async def create_board(data: BoardInput, db: SessionDep, user: Account):
    board = Board(owner_id=user.id, visibility="private")
    apply_board(board, data)
    db.add(board)
    await db.commit()
    return await board_details(db, board, user)


@router.get("/boards/{key}")
async def read_board(key: str, db: SessionDep, user: Viewer):
    return await board_details(db, await view_board(db, key, user), user)


@router.put("/boards/{key}")
async def update_board(key: str, data: BoardInput, db: SessionDep, user: Account):
    board = await edit_board(db, key, user, owner=True)
    apply_board(board, data)
    await db.commit()
    return await board_details(db, board, user)


@router.delete("/boards/{key}", status_code=204)
async def delete_board(key: str, db: SessionDep, user: Account):
    board = await edit_board(db, key, user, owner=True)
    board.deleted = True
    await db.commit()


@router.put("/boards/{key}/cover")
async def update_cover(key: str, file: UploadFile, db: SessionDep, user: Account):
    board = await edit_board(db, key, user, owner=True)
    board.cover = await upload_image(file)
    await db.commit()
    return await board_details(db, board, user)


@router.delete("/boards/{key}/cover", status_code=204)
async def remove_cover(key: str, db: SessionDep, user: Account):
    board = await edit_board(db, key, user, owner=True)
    board.cover = None
    await db.commit()


@router.get("/boards/{key}/cover")
async def cover(key: str, db: SessionDep, user: Viewer):
    board = await view_board(db, key, user)
    return file_response(board.cover, True)


@router.get("/catalog/{kind}")
async def catalog(
    kind: Literal["track", "film"],
    user: Account,
    q: Annotated[str, Query(min_length=1, max_length=120)],
):
    return await search_catalog(kind, q.strip())


async def get_item(db: SessionDep, board: Board, item_id: str) -> tuple[Item, Media]:
    row = (
        await db.execute(
            select(Item, Media)
            .join(Media, Item.media_id == Media.id)
            .where(
                Item.board_id == board.id,
                Item.id == item_id,
            )
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(404, "Элемент не найден")
    return row[0], row[1]


def item_data(item: Item, media: Media, key: str, likes: int = 0, liked: bool = False) -> dict:
    path = f"/api/v1/boards/{key}/items/{item.id}"
    return {
        "id": item.id,
        "position": item.position,
        "kind": media.kind,
        "title": media.title,
        "creator": media.creator,
        "year": media.year,
        "provider": media.provider,
        "source": media.source,
        "note": item.note,
        "tags": item.tags,
        "artwork": f"{path}/file?thumbnail=true" if media.file else media.artwork,
        "original": f"{path}/file" if media.kind == "image" and media.file else None,
        "preview": f"{path}/preview" if media.preview else None,
        "likes": likes,
        "liked": liked,
    }


@router.get("/boards/{key}/items")
async def items(
    key: str,
    db: SessionDep,
    user: Viewer,
    offset: Offset = 0,
    limit: Limit = 24,
    kind: Kind | None = None,
    tag: str | None = None,
):
    board = await view_board(db, key, user)
    # A shared lock keeps the page and its order version on the same committed state.
    version = await db.scalar(
        select(Board.version).where(Board.id == board.id).with_for_update(read=True)
    )
    count = (
        select(func.count())
        .select_from(Like)
        .where(
            Like.kind == "item",
            Like.object_id == Item.id,
        )
        .correlate(Item)
        .scalar_subquery()
    )
    liked = (
        select(func.count())
        .select_from(Like)
        .where(
            Like.kind == "item",
            Like.object_id == Item.id,
            Like.user_id == (user.id if user else ""),
        )
        .correlate(Item)
        .scalar_subquery()
    )
    statement = (
        select(Item, Media, count, liked)
        .join(Media, Item.media_id == Media.id)
        .where(
            Item.board_id == board.id,
        )
    )
    if kind:
        statement = statement.where(Media.kind == kind)
    if tag:
        statement = statement.where(Item.tags.contains([tag.casefold()]))
    rows = (
        await db.execute(statement.order_by(Item.position).offset(offset).limit(limit + 1))
    ).all()
    tags = await db.scalars(
        select(func.unnest(Item.tags)).where(Item.board_id == board.id).distinct()
    )
    return {
        **page(
            [item_data(i, m, key, count, bool(liked)) for i, m, count, liked in rows], offset, limit
        ),
        "version": version,
        "tags": sorted(tags.all()),
    }


@router.post("/boards/{key}/items/catalog", status_code=201)
async def add_catalog(
    key: str,
    data: CatalogAdd,
    db: SessionDep,
    user: Account,
    tasks: BackgroundTasks,
):
    # Verify membership before contacting the external catalog, then check under the write lock.
    from app.services.boards import can_edit, get_board

    board = await get_board(db, key)
    if not await can_edit(db, board, user):
        raise HTTPException(403, "У вас нет прав на это действие")
    provider = (
        "demo"
        if data.external_id.startswith("demo-")
        else ("deezer" if data.kind == "track" else "tmdb")
    )
    media = await db.scalar(
        select(Media).where(
            Media.provider == provider,
            Media.external_id == data.external_id,
            Media.kind == data.kind,
        )
    )
    fields = None
    media_id = media.id if media else None
    await db.commit()
    if media_id is None:
        fields = await catalog_details(data.kind, data.external_id)
    board = await edit_board(db, key, user)
    if fields is not None:
        await db.execute(
            insert(Media)
            .values(**fields)
            .on_conflict_do_nothing(
                index_elements=[Media.provider, Media.external_id],
            )
        )
        media_id = await db.scalar(
            select(Media.id).where(
                Media.provider == provider,
                Media.external_id == data.external_id,
                Media.kind == data.kind,
            )
        )
    if media_id is None:
        raise HTTPException(422, "Неверный тип объекта каталога")
    item = await append_item(db, board, media_id)
    await db.commit()
    if fields and fields["artwork"]:
        tasks.add_task(cache_thumbnail, media_id, fields["artwork"])
    return {"id": item.id}


async def cache_thumbnail(media_id: str, url: str) -> None:
    try:
        file_key = await retrieve_image(url)
    except HTTPException:
        return
    async with SessionLocal() as db:
        await db.execute(update(Media).where(Media.id == media_id).values(file=file_key))
        await db.commit()


async def add_image(db: SessionDep, board: Board, file_key: str, title: str):
    media = Media(
        kind="image", provider="upload", external_id=identifier(), title=title, file=file_key
    )
    db.add(media)
    await db.flush()
    item = await append_item(db, board, media.id)
    await db.commit()
    return {"id": item.id}


@router.post("/boards/{key}/items/upload", status_code=201)
async def add_upload(
    key: str,
    file: UploadFile,
    db: SessionDep,
    user: Account,
    title: Annotated[str, Form(max_length=160)] = "",
):
    board = await edit_board(db, key, user)
    return await add_image(db, board, await upload_image(file), title.strip() or "Изображение")


@router.post("/boards/{key}/items/import", status_code=201)
async def add_import(key: str, data: ImageImport, db: SessionDep, user: Account):
    board = await edit_board(db, key, user)
    return await add_image(db, board, await retrieve_image(data.url), data.title)


@router.get("/boards/{key}/items/{item_id}/file")
async def item_file(key: str, item_id: str, db: SessionDep, user: Viewer, thumbnail: bool = False):
    _, media = await get_item(db, await view_board(db, key, user), item_id)
    return file_response(media.file, thumbnail)


@router.get("/boards/{key}/items/{item_id}/preview")
async def preview(key: str, item_id: str, db: SessionDep, user: Viewer):
    _, media = await get_item(db, await view_board(db, key, user), item_id)
    if media.kind != "track" or not media.preview:
        raise HTTPException(404, "У трека нет фрагмента")
    external_id, saved = media.external_id, media.preview
    await db.commit()
    try:
        url = https_url((await fetch("deezer", f"/track/{external_id}")).get("preview"))
    except HTTPException:
        url = saved
    if not url:
        raise HTTPException(404, "У трека нет фрагмента")
    return RedirectResponse(url)


@router.put("/boards/{key}/items/{item_id}")
async def edit_item(key: str, item_id: str, data: ItemPatch, db: SessionDep, user: Account):
    item, media = await get_item(db, await edit_board(db, key, user), item_id)
    item.note, item.tags = data.note, normalize_tags(data.tags)
    await db.commit()
    return item_data(item, media, key)


@router.delete("/boards/{key}/items/{item_id}", status_code=204)
async def remove_item(key: str, item_id: str, db: SessionDep, user: Account):
    board = await edit_board(db, key, user)
    item, _ = await get_item(db, board, item_id)
    await db.delete(item)
    board.version += 1
    await db.commit()


@router.put("/boards/{key}/order")
async def reorder(key: str, data: Reorder, db: SessionDep, user: Account):
    board = await edit_board(db, key, user)
    if board.version != data.version:
        raise HTTPException(409, "Порядок уже изменился. Доска обновлена, повторите действие.")
    ordered = list(
        await db.scalars(
            select(Item)
            .where(
                Item.board_id == board.id,
            )
            .order_by(Item.position)
        )
    )
    index = next((idx for idx, item in enumerate(ordered) if item.id == data.item_id), None)
    if index is None or data.position >= len(ordered):
        raise HTTPException(422, "Позиция или элемент недоступны")
    moved = ordered.pop(index)
    ordered.insert(data.position, moved)
    for idx, item in enumerate(ordered, 1):
        item.position = idx
    board.version += 1
    await db.commit()
    return {"version": board.version}


@router.post("/boards/{key}/items/{item_id}/save", status_code=201)
async def save_item(key: str, item_id: str, data: Destination, db: SessionDep, user: Account):
    board = await view_board(db, key, user)
    source, _ = await get_item(db, board, item_id)
    target = await edit_board(db, data.board_id, user, owner=True)
    copy = await append_item(db, target, source.media_id, tags=source.tags)
    await db.commit()
    return {"id": copy.id}


@router.post("/boards/{key}/items/{item_id}/move")
async def move_item(key: str, item_id: str, data: Destination, db: SessionDep, user: Account):
    source = await edit_board_reference(db, key, user)
    target = await edit_board_reference(db, data.board_id, user)
    if source == target:
        raise HTTPException(422, "Выберите другую подборку")
    locked = {
        board_id: await edit_board(db, board_id, user) for board_id in sorted([source, target])
    }
    item, _ = await get_item(db, locked[source], item_id)
    highest = await db.scalar(select(func.max(Item.position)).where(Item.board_id == target))
    await db.execute(
        update(Item)
        .where(and_(Item.id == item.id, Item.board_id == source))
        .values(
            board_id=target,
            position=(highest or 0) + 1,
        )
    )
    locked[source].version += 1
    locked[target].version += 1
    await db.commit()
    return {"id": item.id}


async def edit_board_reference(db: SessionDep, key: str, user: Account) -> str:
    return (await view_board(db, key, user)).id


@router.get("/boards/{key}/items/{item_id}/index")
async def item_index(key: str, item_id: str, db: SessionDep, user: Viewer):
    board = await view_board(db, key, user)
    item, _ = await get_item(db, board, item_id)
    return {
        "index": await db.scalar(
            select(func.count())
            .select_from(Item)
            .where(
                Item.board_id == board.id,
                or_(Item.position < item.position),
            )
        )
    }
