from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import api_router
from app.api.routers.health import router as health_router
from app.core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    prefix = f"{settings.api_prefix}/v1"
    app = FastAPI(
        title=settings.app_name,
        openapi_url=f"{prefix}/openapi.json",
        docs_url="/api/docs",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def protect_session(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            host = request.headers.get("host")
            allowed = origin is None or (
                urlsplit(origin).netloc == host or origin in settings.cors_origins
            )
            if not allowed:
                return JSONResponse({"detail": "Источник запроса недоступен"}, status_code=403)
        response = await call_next(request)
        if request.url.path.startswith(prefix):
            response.headers.setdefault("Cache-Control", "private, no-store")
        return response

    app.include_router(health_router, prefix=settings.api_prefix, include_in_schema=False)
    app.include_router(api_router, prefix=prefix)
    return app


app = create_app()
