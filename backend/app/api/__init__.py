from fastapi import APIRouter

from app.api.routers import accounts, admin, boards, health, pins, social

api_router = APIRouter()
for route in (health, accounts, boards, social, admin, pins):
    api_router.include_router(route.router)
