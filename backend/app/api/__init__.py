from fastapi import APIRouter

from app.api.routers import accounts, admin, boards, pins, social

api_router = APIRouter()
for route in (accounts, boards, social, admin, pins):
    api_router.include_router(route.router)
