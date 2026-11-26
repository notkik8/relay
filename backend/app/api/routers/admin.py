from typing import Literal

from fastapi import APIRouter, HTTPException
from sqlalchemy import delete, func, select

from app.api.deps import Admin, SessionDep
from app.api.routers.accounts import account_data
from app.api.routers.boards import Limit, Offset
from app.models.entities import Audit, Board, Comment, Item, LoginSession, Media, Report, User
from app.schemas.inputs import Moderation
from app.services.boards import page

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats")
async def stats(db: SessionDep, admin: Admin):
    users = await db.scalar(select(func.count()).select_from(User).where(~User.deleted))
    boards = await db.scalar(select(func.count()).select_from(Board).where(~Board.deleted))
    comments = await db.scalar(select(func.count()).select_from(Comment).where(~Comment.deleted))
    rows = await db.execute(
        select(Media.kind, func.count())
        .join(
            Item,
            Item.media_id == Media.id,
        )
        .join(Board, Board.id == Item.board_id)
        .where(~Board.deleted)
        .group_by(Media.kind)
    )
    return {
        "users": users,
        "boards": boards,
        "comments": comments,
        "items": {"track": 0, "film": 0, "image": 0, **dict(rows.all())},
    }


@router.get("/users")
async def users(db: SessionDep, admin: Admin, offset: Offset = 0, limit: Limit = 24, q: str = ""):
    rows = await db.scalars(
        select(User)
        .where(User.username.icontains(q, autoescape=True))
        .order_by(
            User.created_at.desc(),
            User.id,
        )
        .offset(offset)
        .limit(limit + 1)
    )
    return page([admin_user(row) for row in rows], offset, limit)


def admin_user(user: User) -> dict:
    return {
        **account_data(user),
        "blocked": user.blocked,
        "deleted": user.deleted,
        "created_at": user.created_at,
    }


@router.get("/users/{user_id}")
async def user_detail(user_id: str, db: SessionDep, admin: Admin):
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(404, "Пользователь не найден")
    boards = await db.scalar(
        select(func.count())
        .select_from(Board)
        .where(
            Board.owner_id == user_id,
            ~Board.deleted,
        )
    )
    comments = await db.scalar(
        select(func.count())
        .select_from(Comment)
        .where(
            Comment.author_id == user_id,
            ~Comment.deleted,
        )
    )
    return {**admin_user(target), "boards": boards, "comments": comments}


@router.get("/reports")
async def reports(
    db: SessionDep,
    admin: Admin,
    offset: Offset = 0,
    limit: Limit = 24,
    state: Literal["open", "resolved"] = "open",
):
    rows = (
        await db.execute(
            select(Report, User.username, Board.title, Comment.text)
            .join(
                User,
                Report.reporter_id == User.id,
            )
            .outerjoin(Board, (Report.kind == "board") & (Report.object_id == Board.id))
            .outerjoin(
                Comment,
                (Report.kind == "comment") & (Report.object_id == Comment.id),
            )
            .where(
                Report.resolution.is_(None) if state == "open" else Report.resolution.is_not(None)
            )
            .order_by(Report.created_at.desc(), Report.id)
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    return page(
        [
            {
                "id": report.id,
                "kind": report.kind,
                "object_id": report.object_id,
                "reason": report.reason,
                "reporter": reporter,
                "created_at": report.created_at,
                "object": title if title is not None else comment,
                "resolution": report.resolution,
            }
            for report, reporter, title, comment in rows
        ],
        offset,
        limit,
    )


async def moderate(
    db: SessionDep, admin: Admin, kind: str, key: str, data: Moderation, report=None
):
    model = {"board": Board, "comment": Comment, "user": User}[kind]
    target = await db.get(model, key, with_for_update=True)
    if target is None and data.action != "dismiss":
        raise HTTPException(404, "Объект недоступен")
    if kind == "user":
        if target.admin or data.action not in {"block", "unblock", "delete"} or target.deleted:
            raise HTTPException(422, "Действие недоступно для этого аккаунта")
        target.blocked = data.action != "unblock"
        if data.action == "delete":
            target.deleted = True
            target.name, target.bio, target.avatar, target.password = (
                "Удалённый пользователь",
                "",
                None,
                "",
            )
        if target.blocked:
            await db.execute(delete(LoginSession).where(LoginSession.user_id == target.id))
    elif data.action != "dismiss":
        if data.action not in {"hide", "restore", "delete"} or target.deleted:
            raise HTTPException(422, "Действие недоступно для этого объекта")
        target.hidden = data.action == "hide"
        target.deleted = data.action == "delete"
    if report:
        report.resolution = f"{data.action}: {data.reason}"
    db.add(
        Audit(
            admin_id=admin.id,
            kind=kind,
            object_id=key,
            action=data.action,
            reason=data.reason,
            report_id=report.id if report else None,
        )
    )
    await db.commit()


@router.post("/reports/{report_id}/resolution", status_code=204)
async def resolve(report_id: str, data: Moderation, db: SessionDep, admin: Admin):
    row = await db.get(Report, report_id, with_for_update=True)
    if row is None:
        raise HTTPException(404, "Жалоба не найдена")
    if row.resolution is not None:
        raise HTTPException(409, "Жалоба уже обработана")
    await moderate(db, admin, row.kind, row.object_id, data, row)


@router.post("/objects/{kind}/{key}", status_code=204)
async def moderate_direct(
    kind: Literal["user", "board", "comment"],
    key: str,
    data: Moderation,
    db: SessionDep,
    admin: Admin,
):
    if data.action == "dismiss":
        raise HTTPException(422, "Выберите действие для объекта")
    await moderate(db, admin, kind, key, data)


@router.get("/audit")
async def audit(db: SessionDep, admin: Admin, offset: Offset = 0, limit: Limit = 24):
    rows = (
        await db.execute(
            select(Audit, User.username)
            .join(
                User,
                Audit.admin_id == User.id,
            )
            .order_by(Audit.created_at.desc(), Audit.id)
            .offset(offset)
            .limit(limit + 1)
        )
    ).all()
    return page(
        [
            {
                "id": log.id,
                "actor": actor,
                "kind": log.kind,
                "object_id": log.object_id,
                "action": log.action,
                "reason": log.reason,
                "report_id": log.report_id,
                "time": log.created_at,
            }
            for log, actor in rows
        ],
        offset,
        limit,
    )
