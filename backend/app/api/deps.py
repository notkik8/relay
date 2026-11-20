from hashlib import sha256
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.entities import LoginSession, User

SessionDep = Annotated[AsyncSession, Depends(get_session)]
COOKIE = "relay_session"


def session_hash(token: str) -> str:
    return sha256(token.encode()).hexdigest()


async def current_user(request: Request, db: SessionDep) -> User | None:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    return await db.scalar(
        select(User)
        .join(LoginSession, LoginSession.user_id == User.id)
        .where(
            LoginSession.token_hash == session_hash(token),
            LoginSession.expires > func.now(),
            User.email_verified_at.is_not(None),
            ~User.blocked,
            ~User.deleted,
        )
    )


Viewer = Annotated[User | None, Depends(current_user)]


def require_user(user: Viewer) -> User:
    if user is None:
        raise HTTPException(401, "Войдите в аккаунт")
    return user


def require_admin(user: Annotated[User, Depends(require_user)]) -> User:
    if not user.admin:
        raise HTTPException(403, "Доступ только для администратора")
    return user


Account = Annotated[User, Depends(require_user)]
Admin = Annotated[User, Depends(require_admin)]
