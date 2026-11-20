"""Фоновый обработчик задач (arq): пересчёт рекомендаций, обработка изображений.

Запуск: arq app.worker.main.WorkerSettings
"""

from arq import cron
from arq.connections import RedisSettings

from app.core.config import get_settings


async def recompute_recommendations(ctx: dict) -> None:
    """Пересчёт рекомендаций подборок — будет реализован на этапе 6."""


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    functions = [recompute_recommendations]
    cron_jobs = [cron(recompute_recommendations, minute={0, 15, 30, 45})]
