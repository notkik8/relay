from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from app.api.deps import Account, SessionDep, Viewer
from app.api.routers.accounts import public_user
from app.api.routers.boards import Limit, Offset, get_item
from app.models.entities import (
    Board,
    Comment,
    Follow,
    Item,
    Like,
    Membership,
    Notification,
    Report,
    User,
)
from app.schemas.inputs import CommentInput, Invite, InviteReply, ReportInput
from app.services.boards import (
    active_board,
    board_data,
    board_details,
    board_rows,
    edit_board,
    get_board,
    page,
    view_board,
)

router = APIRouter(tags=["social"])


def notify(db: SessionDep, recipient: str, actor: str, kind: str, **kwargs) -> None:
    if recipient != actor:
        db.add(Notification(recipient_id=recipient, actor_id=actor, kind=kind, **kwargs))


async def profile_user(db: SessionDep, username: str) -> User:
    user = await db.scalar(
        select(User).where(
            User.username == username.lower(),
            ~User.blocked,
            ~User.deleted,
        )
    )
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    return user


@router.get("/profiles/{username}")
async def profile(
    username: str,
    db: SessionDep,
    user: Viewer,
    offset: Offset = 0,
    limit: Limit = 12,
):
    target = await profile_user(db, username)
    visible = Board.visibility == "public"
    if user:
        visible = or_(
            visible,
            Board.owner_id == user.id,
            exists().where(
                Membership.board_id == Board.id,
                Membership.user_id == user.id,
                Membership.status == "accepted",
            ),
        )
    rows = (
        await db.execute(
            board_rows(user)
            .where(
                active_board(),
                Board.owner_id == target.id,
                visible,
            )
            .order_by(Board.created_at.desc(), Board.id)
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    followers = (
        select(func.count())
        .select_from(Follow)
        .join(User, User.id == Follow.follower_id)
        .where(
            Follow.target_id == target.id,
            ~User.blocked,
            ~User.deleted,
        )
        .scalar_subquery()
    )
    following = (
        select(func.count())
        .select_from(Follow)
        .join(User, User.id == Follow.target_id)
        .where(
            Follow.follower_id == target.id,
            ~User.blocked,
            ~User.deleted,
        )
        .scalar_subquery()
    )
    is_following = exists().where(
        Follow.follower_id == (user.id if user else ""),
        Follow.target_id == target.id,
    )
    counts = (await db.execute(select(followers, following, is_following))).one()
    return {
        "user": public_user(target),
        "followers": counts[0],
        "following": counts[1],
        "is_following": counts[2],
        "boards": page([board_data(row, user) for row in rows], offset, limit),
    }


@router.put("/profiles/{username}/follow", status_code=204)
async def follow(username: str, db: SessionDep, user: Account):
    target = await profile_user(db, username)
    if user.id == target.id:
        raise HTTPException(422, "Вы не можете подписаться на себя")
    result = await db.execute(
        insert(Follow)
        .values(
            follower_id=user.id,
            target_id=target.id,
        )
        .on_conflict_do_nothing()
    )
    if result.rowcount:
        notify(db, target.id, user.id, "follow")
    await db.commit()


@router.delete("/profiles/{username}/follow", status_code=204)
async def unfollow(username: str, db: SessionDep, user: Account):
    target = await profile_user(db, username)
    await db.execute(
        delete(Follow).where(Follow.follower_id == user.id, Follow.target_id == target.id)
    )
    await db.commit()


@router.get("/search")
async def search(
    db: SessionDep,
    user: Viewer,
    q: Annotated[str, Query(min_length=1, max_length=120)],
    offset: Offset = 0,
    limit: Limit = 12,
):
    value = q.strip().lstrip("#").casefold()
    public = active_board(), Board.visibility == "public"
    board_tags = select(func.unnest(Board.tags).label("tag")).where(*public)
    item_tags = (
        select(func.unnest(Item.tags).label("tag"))
        .join(Board, Item.board_id == Board.id)
        .where(
            *public,
        )
    )
    all_tags = board_tags.union(item_tags).subquery()
    tags_on_item = exists().where(Item.board_id == Board.id, Item.tags.contains([value]))
    tag_match = or_(Board.tags.contains([value]), tags_on_item)
    match = (
        tag_match
        if q.startswith("#")
        else or_(
            Board.title.collate("und-x-icu").icontains(value, autoescape=True),
            Board.description.collate("und-x-icu").icontains(value, autoescape=True),
            tag_match,
        )
    )
    rows = (
        await db.execute(
            board_rows(user)
            .where(*public, match)
            .order_by(
                Board.published_at.desc(),
                Board.id,
            )
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    users = (
        await db.scalars(
            select(User)
            .where(
                ~User.blocked,
                ~User.deleted,
                or_(
                    User.username.icontains(value, autoescape=True),
                    User.name.collate("und-x-icu").icontains(value, autoescape=True),
                ),
            )
            .order_by(User.username)
            .offset(offset)
            .limit(limit + 1)
        )
        if not q.startswith("#")
        else None
    )
    tags = await db.scalars(
        select(all_tags.c.tag)
        .where(
            all_tags.c.tag.collate("und-x-icu").icontains(value, autoescape=True),
        )
        .order_by(all_tags.c.tag)
        .offset(offset)
        .limit(limit + 1)
    )
    return {
        "boards": page([board_data(row, user) for row in rows], offset, limit),
        "users": page([public_user(person) for person in users] if users else [], offset, limit),
        "tags": page(list(tags), offset, limit),
    }


@router.put("/boards/{key}/like", status_code=204)
@router.delete("/boards/{key}/like", status_code=204)
@router.put("/boards/{key}/items/{item_id}/like", status_code=204)
@router.delete("/boards/{key}/items/{item_id}/like", status_code=204)
async def react(
    key: str,
    db: SessionDep,
    user: Account,
    request: Request,
    item_id: str | None = None,
):
    board = await view_board(db, key, user)
    if item_id:
        await get_item(db, board, item_id)
    kind, object_id = ("item", item_id) if item_id else ("board", board.id)
    if request.method == "PUT":
        result = await db.execute(
            insert(Like)
            .values(
                user_id=user.id,
                kind=kind,
                object_id=object_id,
            )
            .on_conflict_do_nothing()
        )
        if result.rowcount:
            notify(db, board.owner_id, user.id, "like", board_id=board.id, object_id=item_id)
    else:
        await db.execute(
            delete(Like).where(
                Like.user_id == user.id,
                Like.kind == kind,
                Like.object_id == object_id,
            )
        )
    await db.commit()


@router.get("/boards/{key}/comments")
async def comments(key: str, db: SessionDep, user: Viewer, offset: Offset = 0, limit: Limit = 20):
    board = await view_board(db, key, user)
    rows = (
        await db.execute(
            select(Comment, User)
            .join(User, Comment.author_id == User.id)
            .where(
                Comment.board_id == board.id,
                ~Comment.hidden,
                ~Comment.deleted,
                ~User.blocked,
                ~User.deleted,
            )
            .order_by(Comment.created_at.desc(), Comment.id)
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    return page(
        [
            {
                "id": entry.id,
                "text": entry.text,
                "author": public_user(author),
                "created_at": entry.created_at,
                "owned": user is not None and user.id == author.id,
            }
            for entry, author in rows
        ],
        offset,
        limit,
    )


@router.post("/boards/{key}/comments", status_code=201)
async def comment(key: str, data: CommentInput, db: SessionDep, user: Account):
    board = await view_board(db, key, user)
    entry = Comment(board_id=board.id, author_id=user.id, text=data.text)
    db.add(entry)
    await db.flush()
    notify(db, board.owner_id, user.id, "comment", board_id=board.id, object_id=entry.id)
    await db.commit()
    return {"id": entry.id}


@router.delete("/boards/{key}/comments/{comment_id}", status_code=204)
async def delete_comment(key: str, comment_id: str, db: SessionDep, user: Account):
    board = await view_board(db, key, user)
    result = await db.execute(
        update(Comment)
        .where(
            Comment.id == comment_id,
            Comment.board_id == board.id,
            Comment.author_id == user.id,
            ~Comment.deleted,
        )
        .values(deleted=True)
    )
    if not result.rowcount:
        raise HTTPException(404, "Комментарий недоступен")
    await db.commit()


@router.get("/boards/{key}/members")
async def members(key: str, db: SessionDep, user: Account):
    board = await view_board(db, key, user)
    if board.owner_id != user.id:
        raise HTTPException(403, "Участников выбирает владелец")
    rows = (
        await db.execute(
            select(Membership, User)
            .join(User, Membership.user_id == User.id)
            .where(
                Membership.board_id == board.id,
                ~User.deleted,
            )
            .order_by(Membership.created_at)
        )
    ).all()
    return [{"user": public_user(member), "status": access.status} for access, member in rows]


@router.post("/boards/{key}/members", status_code=204)
async def invite(key: str, data: Invite, db: SessionDep, user: Account):
    board = await edit_board(db, key, user, owner=True)
    target = await profile_user(db, data.username)
    if target.id == user.id:
        raise HTTPException(422, "Вы уже владелец подборки")
    membership = await db.get(Membership, (board.id, target.id))
    if membership is None:
        db.add(Membership(board_id=board.id, user_id=target.id))
    elif membership.status == "declined":
        membership.status = "pending"
    else:
        raise HTTPException(409, "Пользователь уже приглашён")
    notify(db, target.id, user.id, "invite", board_id=board.id)
    await db.commit()


@router.delete("/boards/{key}/members/{username}", status_code=204)
async def revoke(key: str, username: str, db: SessionDep, user: Account):
    board = await edit_board(db, key, user, owner=True)
    member_id = select(User.id).where(User.username == username.lower()).scalar_subquery()
    await db.execute(
        delete(Membership).where(
            Membership.board_id == board.id,
            Membership.user_id == member_id,
        )
    )
    await db.commit()


@router.get("/notifications")
async def notifications(db: SessionDep, user: Account, offset: Offset = 0, limit: Limit = 24):
    rows = (
        await db.execute(
            select(Notification, User, Board, Membership.status)
            .join(
                User,
                Notification.actor_id == User.id,
            )
            .outerjoin(Board, Notification.board_id == Board.id)
            .outerjoin(
                Membership,
                (Membership.board_id == Board.id) & (Membership.user_id == user.id),
            )
            .where(Notification.recipient_id == user.id)
            .order_by(
                Notification.created_at.desc(),
                Notification.id,
            )
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    result = []
    for entry, actor, board, status in rows:
        visible = (
            board
            and not board.hidden
            and not board.deleted
            and (board.owner_id == user.id or board.visibility != "private" or status == "accepted")
        )
        result.append(
            {
                "id": entry.id,
                "type": entry.kind,
                "read": entry.read,
                "actor": public_user(actor),
                "created_at": entry.created_at,
                "board_title": board.title if visible or (board and status == "pending") else None,
                "board_key": (board.share_id if board.visibility == "link" else board.id)
                if visible
                else None,
                "object_id": entry.object_id,
                "pending": bool(
                    entry.kind == "invite"
                    and status == "pending"
                    and board
                    and not board.hidden
                    and not board.deleted
                    and not actor.blocked
                    and not actor.deleted
                ),
            }
        )
    return page(result, offset, limit)


@router.put("/notifications/read", status_code=204)
async def read_notifications(db: SessionDep, user: Account):
    await db.execute(
        update(Notification)
        .where(
            Notification.recipient_id == user.id,
            ~Notification.read,
        )
        .values(read=True)
    )
    await db.commit()


@router.put("/notifications/{notification_id}/invite")
async def reply(notification_id: str, data: InviteReply, db: SessionDep, user: Account):
    entry = await db.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.recipient_id == user.id,
            Notification.kind == "invite",
        )
    )
    if entry is None:
        raise HTTPException(404, "Приглашение недоступно")
    board = await get_board(db, entry.board_id, lock=True)
    membership = await db.get(Membership, (board.id, user.id), populate_existing=True)
    if membership is None or membership.status != "pending":
        raise HTTPException(409, "Приглашение больше не действует")
    membership.status = "accepted" if data.accept else "declined"
    entry.read = True
    await db.commit()
    return await board_details(db, board, user) if data.accept else None


@router.post("/boards/{key}/reports", status_code=201)
async def report(key: str, data: ReportInput, db: SessionDep, user: Account):
    board = await view_board(db, key, user)
    if data.kind == "board":
        if board.id != data.object_id and key != data.object_id:
            raise HTTPException(404, "Объект недоступен")
        object_id = board.id
    else:
        object_id = await db.scalar(
            select(Comment.id)
            .join(User, Comment.author_id == User.id)
            .where(
                Comment.id == data.object_id,
                Comment.board_id == board.id,
                ~Comment.deleted,
                ~Comment.hidden,
                ~User.deleted,
                ~User.blocked,
            )
        )
        if object_id is None:
            raise HTTPException(404, "Комментарий недоступен")
    result = await db.execute(
        insert(Report)
        .values(
            reporter_id=user.id,
            kind=data.kind,
            object_id=object_id,
            reason=data.reason,
        )
        .on_conflict_do_nothing()
    )
    if not result.rowcount:
        raise HTTPException(409, "Вы уже отправили жалобу на этот объект")
    await db.commit()
    return {"status": "received"}
