from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.entities import Board, Comment, Follow, Item, Like, Media, Membership, User


def normalize_tags(tags: list[str]) -> list[str]:
    return list(dict.fromkeys(tag.casefold() for tag in tags))


def active_board():
    return and_(
        ~Board.hidden,
        ~Board.deleted,
        Board.owner_id.in_(
            select(User.id).where(~User.blocked, ~User.deleted),
        ),
    )


async def get_board(db: AsyncSession, key: str, *, lock: bool = False) -> Board:
    statement = (
        select(Board)
        .where(
            active_board(),
            or_(Board.id == key, Board.share_id == key),
        )
        .execution_options(populate_existing=lock)
    )
    board = await db.scalar(statement.with_for_update() if lock else statement)
    if board is None:
        raise HTTPException(404, "Подборка недоступна")
    return board


async def can_edit(db: AsyncSession, board: Board, user: User | None) -> bool:
    if user is None:
        return False
    if user.id == board.owner_id:
        return True
    return (
        await db.scalar(
            select(
                exists().where(
                    Membership.board_id == board.id,
                    Membership.user_id == user.id,
                    Membership.status == "accepted",
                )
            )
        )
        is True
    )


async def view_board(db: AsyncSession, key: str, user: User | None) -> Board:
    board = await get_board(db, key)
    if board.visibility == "public" or (board.visibility == "link" and board.share_id == key):
        return board
    if await can_edit(db, board, user):
        return board
    raise HTTPException(404, "Подборка недоступна")


async def edit_board(db: AsyncSession, key: str, user: User, *, owner: bool = False) -> Board:
    board = await get_board(db, key, lock=True)
    permitted = board.owner_id == user.id if owner else await can_edit(db, board, user)
    if not permitted:
        raise HTTPException(403, "У вас нет прав на это действие")
    return board


def board_rows(user: User | None):
    count_by_kind = [
        select(func.count())
        .select_from(Item)
        .join(Media, Item.media_id == Media.id)
        .where(
            Item.board_id == Board.id,
            Media.kind == kind,
        )
        .correlate(Board)
        .scalar_subquery()
        for kind in ("track", "film", "image")
    ]
    likes = (
        select(func.count())
        .select_from(Like)
        .where(
            Like.kind == "board",
            Like.object_id == Board.id,
        )
        .correlate(Board)
        .scalar_subquery()
    )
    liked = (
        exists()
        .where(
            Like.kind == "board",
            Like.object_id == Board.id,
            Like.user_id == (user.id if user else ""),
        )
        .correlate(Board)
    )
    comments = (
        select(func.count())
        .select_from(Comment)
        .join(User, Comment.author_id == User.id)
        .where(
            Comment.board_id == Board.id,
            ~Comment.hidden,
            ~Comment.deleted,
            ~User.blocked,
            ~User.deleted,
        )
        .correlate(Board)
        .scalar_subquery()
    )
    return select(Board, User, *count_by_kind, likes, liked, comments).join(
        User,
        Board.owner_id == User.id,
    )


def board_data(row, user: User | None, editable: bool = False) -> dict:
    board, author, tracks, films, images, likes, liked, comments = row
    key = board.share_id if board.visibility == "link" else board.id
    return {
        "key": key,
        "title": board.title,
        "description": board.description,
        "tags": board.tags,
        "theme": board.theme,
        "visibility": board.visibility,
        "version": board.version,
        "author": {"username": author.username, "name": author.name},
        "cover_url": f"/api/v1/boards/{key}/cover?v={board.cover[:12]}" if board.cover else None,
        "counts": {"track": tracks, "film": films, "image": images},
        "likes": likes,
        "liked": liked,
        "comments": comments,
        "created_at": board.created_at,
        "owned": user is not None and user.id == board.owner_id,
        "editable": editable,
    }


async def board_details(db: AsyncSession, board: Board, user: User | None) -> dict:
    row = (await db.execute(board_rows(user).where(Board.id == board.id))).one()
    return board_data(row, user, await can_edit(db, board, user))


async def feed(db: AsyncSession, user: User | None, mode: str, offset: int, limit: int):
    statement = board_rows(user).where(active_board())
    if mode == "mine" and user:
        statement = statement.where(
            or_(
                Board.owner_id == user.id,
                exists().where(
                    Membership.board_id == Board.id,
                    Membership.user_id == user.id,
                    Membership.status == "accepted",
                ),
            )
        ).order_by(Board.created_at.desc())
    else:
        statement = statement.where(Board.visibility == "public")
        if mode == "following" and user:
            statement = statement.where(
                Board.owner_id.in_(
                    select(Follow.target_id).where(Follow.follower_id == user.id),
                )
            ).order_by(Board.published_at.desc())
        else:
            recent = (
                select(func.count())
                .select_from(Like)
                .where(
                    Like.kind == "board",
                    Like.object_id == Board.id,
                    Like.created_at >= datetime.now(UTC) - timedelta(days=7),
                )
                .correlate(Board)
                .scalar_subquery()
            )
            statement = statement.order_by(recent.desc(), Board.published_at.desc())
    rows = (await db.execute(statement.order_by(Board.id).offset(offset).limit(limit + 1))).all()
    return page([board_data(row, user, mode == "mine") for row in rows], offset, limit)


def page(values: list, offset: int, limit: int) -> dict:
    return {"items": values[:limit], "next_offset": offset + limit if len(values) > limit else None}


async def append_item(db: AsyncSession, board: Board, media_id: str, **kwargs) -> Item:
    highest = await db.scalar(select(func.max(Item.position)).where(Item.board_id == board.id))
    item = Item(board_id=board.id, media_id=media_id, position=(highest or 0) + 1, **kwargs)
    db.add(item)
    board.version += 1
    await db.flush()
    return item
