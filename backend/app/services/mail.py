import logging
import smtplib
import ssl
from email.message import EmailMessage

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def require_mail() -> None:
    if not get_settings().smtp_host:
        raise HTTPException(503, "Отправка писем пока недоступна. Попробуйте позже.")


def send_verification(email: str, token: str) -> None:
    settings = get_settings()
    base = str(settings.relay_public_url).rstrip("/")
    link = f"{base}/verify-email#{token}"
    message = EmailMessage()
    message["Subject"] = "Подтвердите почту для Relay"
    message["From"] = settings.smtp_from
    message["To"] = email
    message.set_content(
        "Откройте ссылку и введите пароль от аккаунта Relay, чтобы подтвердить почту.\n\n"
        f"{link}\n\nСсылка действует 24 часа. Если вы не запрашивали письмо, пропустите его."
    )
    context = ssl.create_default_context()
    address = (settings.smtp_host, settings.smtp_port)
    connection = (
        smtplib.SMTP_SSL(*address, timeout=8, context=context)
        if settings.smtp_security == "tls"
        else smtplib.SMTP(*address, timeout=8)
    )
    with connection as smtp:
        if settings.smtp_security == "starttls":
            smtp.starttls(context=context)
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
        smtp.send_message(message)


async def deliver_verification(email: str, token: str) -> None:
    try:
        await run_in_threadpool(send_verification, email, token)
    except (OSError, ValueError) as exc:
        logger.warning("Verification mail delivery failed (%s)", type(exc).__name__)
        raise HTTPException(503, "Не удалось отправить письмо. Попробуйте позже.") from exc
