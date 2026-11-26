from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from fastapi import APIRouter, HTTPException, Request, Response, UploadFile
from pwdlib import PasswordHash
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from app.api.deps import COOKIE, Account, SessionDep, Viewer, session_hash
from app.core.config import get_settings
from app.models.entities import LoginSession, User
from app.schemas.inputs import Credentials, PasswordRecovery, ProfilePatch, Registration
from app.services.images import file_response, upload_image
from app.services.turnstile import registration_site_key, verify_registration

router = APIRouter(tags=["accounts"])
passwords = PasswordHash.recommended()
dummy_hash = passwords.hash(token_urlsafe())


def public_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "bio": user.bio,
        "avatar_url": f"/api/v1/profiles/{user.username}/avatar?v={user.avatar[:12]}"
        if user.avatar
        else None,
    }


def account_data(user: User) -> dict:
    return {**public_user(user), "admin": user.admin}


async def issue_session(db: SessionDep, request: Request, response: Response, user: User):
    settings = get_settings()
    token = token_urlsafe(32)
    ttl = timedelta(days=settings.session_days)
    previous = request.cookies.get(COOKIE)
    if previous:
        await db.execute(
            delete(LoginSession).where(LoginSession.token_hash == session_hash(previous))
        )
    await db.execute(
        delete(LoginSession).where(
            LoginSession.user_id == user.id,
            LoginSession.expires <= datetime.now(UTC),
        )
    )
    db.add(
        LoginSession(
            token_hash=session_hash(token),
            user_id=user.id,
            expires=datetime.now(UTC) + ttl,
        )
    )
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    response.set_cookie(
        COOKIE,
        token,
        max_age=int(ttl.total_seconds()),
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
    )
    return account_data(user)


@router.get("/accounts/registration")
async def registration_config():
    return {"turnstile_site_key": registration_site_key()}


@router.post("/accounts", status_code=201)
async def register(data: Registration, db: SessionDep, request: Request, response: Response):
    await verify_registration(data.turnstile_token)
    username = data.username.lower()
    recovery_code = token_urlsafe(24)
    user = User(
        username=username,
        name=username,
        password=await run_in_threadpool(passwords.hash, data.password),
        recovery_code_hash=session_hash(recovery_code),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Этот ник уже занят") from exc
    account = await issue_session(db, request, response, user)
    return {"account": account, "recovery_code": recovery_code}


@router.post("/accounts/recovery")
async def recover_password(
    data: PasswordRecovery, db: SessionDep, request: Request, response: Response
):
    user = await db.scalar(
        select(User)
        .where(
            User.username == data.username.lower(),
            User.recovery_code_hash == session_hash(data.recovery_code),
            ~User.blocked,
            ~User.deleted,
        )
        .with_for_update()
    )
    if user is None:
        raise HTTPException(401, "Проверьте ник и код восстановления.")
    recovery_code = token_urlsafe(24)
    user.recovery_code_hash = session_hash(recovery_code)
    user.password = await run_in_threadpool(passwords.hash, data.password)
    await db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
    account = await issue_session(db, request, response, user)
    return {"account": account, "recovery_code": recovery_code}


@router.post("/sessions")
async def login(data: Credentials, db: SessionDep, request: Request, response: Response):
    user = await db.scalar(select(User).where(User.username == data.username.lower()))
    password_hash = user.password if user else dummy_hash
    valid = await run_in_threadpool(passwords.verify, data.password, password_hash)
    if not valid or user is None or user.blocked or user.deleted:
        raise HTTPException(401, "Неверные данные входа или аккаунт недоступен")
    await db.refresh(user, with_for_update=True)
    if user.blocked or user.deleted or user.password != password_hash:
        raise HTTPException(401, "Аккаунт недоступен")
    return await issue_session(db, request, response, user)


@router.delete("/sessions/current", status_code=204)
async def logout(request: Request, response: Response, db: SessionDep):
    if token := request.cookies.get(COOKIE):
        await db.execute(delete(LoginSession).where(LoginSession.token_hash == session_hash(token)))
        await db.commit()
    response.delete_cookie(COOKIE, secure=get_settings().secure_cookies, httponly=True)


@router.get("/accounts/me")
async def me(user: Viewer):
    return account_data(user) if user else None


@router.put("/accounts/me")
async def update_profile(data: ProfilePatch, db: SessionDep, user: Account):
    user.name, user.bio = data.name, data.bio
    await db.commit()
    return account_data(user)


@router.put("/accounts/me/avatar")
async def avatar_upload(file: UploadFile, db: SessionDep, user: Account):
    user.avatar = await upload_image(file)
    await db.commit()
    return account_data(user)


@router.get("/profiles/{username}/avatar")
async def avatar(username: str, db: SessionDep):
    key = await db.scalar(
        select(User.avatar).where(
            User.username == username.lower(),
            ~User.blocked,
            ~User.deleted,
        )
    )
    return file_response(key, True)
