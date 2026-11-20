from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from fastapi import APIRouter, HTTPException, Request, Response, UploadFile
from pwdlib import PasswordHash
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from app.api.deps import COOKIE, Account, SessionDep, Viewer, session_hash
from app.core.config import get_settings
from app.models.entities import EmailVerification, LoginSession, User
from app.schemas.inputs import (
    Credentials,
    HandleCredentials,
    HandleRegistration,
    PasswordRecovery,
    ProfilePatch,
    Registration,
    VerificationInput,
)
from app.services.images import file_response, upload_image
from app.services.mail import deliver_verification, require_mail
from app.services.turnstile import registration_site_key, verify_registration

router = APIRouter(tags=["accounts"])
passwords = PasswordHash.recommended()
dummy_hash = passwords.hash(token_urlsafe())
verification_ttl = timedelta(hours=24)
resend_wait = timedelta(minutes=1)


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
    return {**public_user(user), "email": user.email, "admin": user.admin}


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


@router.post("/accounts/handle", status_code=201)
async def register_handle(
    data: HandleRegistration, db: SessionDep, request: Request, response: Response
):
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
            User.email.is_(None),
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


async def pending_verification(db: SessionDep, email: str) -> EmailVerification | None:
    return await db.scalar(
        select(EmailVerification).where(EmailVerification.email == email).with_for_update()
    )


async def send_confirmation(db: SessionDep, verification: EmailVerification):
    token = token_urlsafe(32)
    verification.token_hash = session_hash(token)
    verification.sent_at = datetime.now(UTC)
    verification.expires_at = verification.sent_at + verification_ttl
    email = verification.email
    try:
        await db.commit()
    except IntegrityError as exc:
        raise HTTPException(409, "Письмо уже запрошено. Проверьте почту.") from exc
    await deliver_verification(email, token)
    return {"email": email}


@router.post("/accounts", status_code=201)
async def register(data: Registration, db: SessionDep):
    require_mail()
    email, username = data.email.lower(), data.username.lower()
    verification = await pending_verification(db, email)
    if await db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "С этой почтой уже есть аккаунт. Войдите в Relay.")
    if await db.scalar(select(User.id).where(User.username == username)):
        raise HTTPException(409, "Этот ник уже занят")
    if verification and verification.expires_at > datetime.now(UTC):
        raise HTTPException(
            409, "Регистрация уже начата. Проверьте почту или запросите новое письмо."
        )
    if verification is None:
        verification = EmailVerification(email=email)
        db.add(verification)
    verification.username = username
    verification.password = await run_in_threadpool(passwords.hash, data.password)
    return await send_confirmation(db, verification)


@router.post("/accounts/verification")
async def resend(data: Credentials, db: SessionDep):
    require_mail()
    email = data.email.lower()
    verification = await pending_verification(db, email)
    user = await db.scalar(select(User).where(User.email == email))
    password_hash = user.password if user else verification.password if verification else None
    valid = await run_in_threadpool(passwords.verify, data.password, password_hash or dummy_hash)
    if not valid or (user and (user.blocked or user.deleted or user.email_verified_at)):
        raise HTTPException(401, "Проверьте почту и пароль для неподтверждённого аккаунта")
    if verification and verification.sent_at + resend_wait > datetime.now(UTC):
        raise HTTPException(429, "Новое письмо можно запросить через минуту после предыдущего")
    if verification is None:
        verification = EmailVerification(email=email)
        db.add(verification)
    return await send_confirmation(db, verification)


@router.post("/accounts/verify")
async def verify(data: VerificationInput, db: SessionDep, request: Request, response: Response):
    verification = await db.scalar(
        select(EmailVerification)
        .where(EmailVerification.token_hash == session_hash(data.token))
        .with_for_update()
    )
    now = datetime.now(UTC)
    if verification is None or verification.expires_at <= now:
        raise HTTPException(410, "Ссылка устарела. Запросите новое письмо.")
    user = await db.scalar(select(User).where(User.email == verification.email).with_for_update())
    if verification.username and user:
        raise HTTPException(409, "С этой почтой уже есть аккаунт. Войдите в Relay.")
    if user and (user.blocked or user.deleted or user.email_verified_at):
        raise HTTPException(410, "Ссылка устарела. Войдите в аккаунт или запросите новое письмо.")
    password_hash = user.password if user else verification.password
    if not password_hash or not await run_in_threadpool(
        passwords.verify, data.password, password_hash
    ):
        raise HTTPException(401, "Неверный пароль")
    if user is None:
        user = User(
            email=verification.email,
            username=verification.username,
            name=verification.username,
            password=password_hash,
        )
        db.add(user)
    user.email_verified_at = now
    await db.delete(verification)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        # The handle may have been claimed by another signup while this link was pending.
        await db.execute(
            delete(EmailVerification).where(
                EmailVerification.token_hash == session_hash(data.token)
            )
        )
        await db.commit()
        raise HTTPException(409, "Почта или ник уже заняты. Начните регистрацию заново.") from exc
    return await issue_session(db, request, response, user)


@router.post("/sessions")
async def login(
    data: Credentials | HandleCredentials, db: SessionDep, request: Request, response: Response
):
    if isinstance(data, HandleCredentials):
        user = await db.scalar(select(User).where(User.username == data.username.lower()))
        verification = None
    else:
        email = data.email.lower()
        user = await db.scalar(select(User).where(User.email == email))
        verification = None if user else await db.get(EmailVerification, email)
    password_hash = user.password if user else verification.password if verification else None
    valid = await run_in_threadpool(passwords.verify, data.password, password_hash or dummy_hash)
    if not valid or (user and (user.blocked or user.deleted)):
        raise HTTPException(401, "Неверные данные входа или аккаунт недоступен")
    if user is None or (user.email is not None and user.email_verified_at is None):
        raise HTTPException(403, "Подтвердите почту, чтобы войти в Relay")
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
