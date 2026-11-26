"""Populate a local demonstration database or create an administrator."""

import argparse
import asyncio
import os
from datetime import UTC, datetime, timedelta
from getpass import getpass
from secrets import token_urlsafe

from sqlalchemy import select

from app.api.routers.accounts import passwords
from app.db.session import SessionLocal, engine
from app.integrations.catalog import demo_entries
from app.models.entities import Board, Comment, Item, Media, User
from app.schemas.inputs import Credentials

BOARDS = (
    (
        "autumn",
        "Осенний вечер",
        "Тихий джаз, тёплый свет и кино, которое хочется пересмотреть.",
        "amber",
        "anna",
        ["осень", "джаз", "кино"],
        ["autumn", "her", "blue", "moon"],
    ),
    (
        "night",
        "После полуночи",
        "Мелодии и фильмы для города, который ещё не спит.",
        "blue",
        "misha",
        ["ночь", "город"],
        ["rhubarb", "tokyo", "pink"],
    ),
    (
        "tokyo",
        "Окна Токио",
        "Повседневность, огни большого города и паузы между разговорами.",
        "violet",
        "lena",
        ["токио", "город"],
        ["tokyo", "days", "rhubarb"],
    ),
    (
        "slow",
        "Медленнее",
        "То, к чему я возвращаюсь по воскресеньям.",
        "moss",
        "anna",
        ["воскресенье", "джаз"],
        ["days", "blue", "holocene"],
    ),
    (
        "road",
        "Дорога на запад",
        "Долгие дороги, открытые окна и кино о возвращении.",
        "rose",
        "lena",
        ["дорога", "кино"],
        ["paris", "holocene", "moon"],
    ),
    (
        "room",
        "Комната с музыкой",
        "Небольшой плейлист для тех часов, когда никуда не нужно.",
        "slate",
        "misha",
        ["музыка", "джаз"],
        ["blue", "autumn", "rhubarb"],
    ),
    (
        "summer",
        "Последние дни лета",
        "Всё, что хочется унести с собой в сентябрь.",
        "amber",
        "lena",
        ["лето", "кино"],
        ["moon", "pink", "holocene"],
    ),
)


async def demo(large: bool):
    async with SessionLocal() as db:
        users = {}
        for username, name, bio in [
            ("anna", "Анна Лебедева", "Собираю музыку, кино и свет."),
            ("misha", "Миша Волков", "Ночной город и любимые пластинки."),
            ("lena", "Лена Орлова", "В поисках уютного кино."),
        ]:
            person = await db.scalar(select(User).where(User.username == username))
            if person is None:
                person = User(
                    username=username,
                    name=name,
                    bio=bio,
                    password=passwords.hash(token_urlsafe()),
                )
                db.add(person)
                await db.flush()
            users[username] = person
        entries = {}
        for fields in demo_entries("track") + demo_entries("film"):
            media = await db.scalar(
                select(Media).where(
                    Media.provider == "demo",
                    Media.external_id == fields["external_id"],
                )
            )
            if media is None:
                media = Media(**fields)
                db.add(media)
                await db.flush()
            entries[fields["external_id"].removeprefix("demo-")] = media.id
        for index, (_, title, description, theme, author, tags, items) in enumerate(BOARDS):
            owner = users[author]
            if await db.scalar(
                select(Board.id).where(Board.owner_id == owner.id, Board.title == title)
            ):
                continue
            board = Board(
                owner_id=owner.id,
                title=title,
                description=description,
                theme=theme,
                tags=tags,
                visibility="public",
                published_at=datetime.now(UTC) - timedelta(hours=index),
                version=len(items),
            )
            db.add(board)
            await db.flush()
            for position, entry in enumerate(items, 1):
                db.add(
                    Item(
                        board_id=board.id, media_id=entries[entry], position=position, tags=tags[:1]
                    )
                )
            if index == 0:
                db.add(
                    Comment(
                        board_id=board.id,
                        author_id=users["lena"].id,
                        text="Blue in Green здесь к месту. Сохранила на вечер.",
                    )
                )
        if large and not await db.scalar(
            select(Board.id).where(
                Board.owner_id == users["anna"].id,
                Board.title == "500 элементов",
            )
        ):
            board = Board(
                title="500 элементов",
                visibility="public",
                owner_id=users["anna"].id,
                theme="slate",
                published_at=datetime.now(UTC) - timedelta(days=2),
                version=500,
            )
            db.add(board)
            await db.flush()
            media_ids = list(entries.values())
            db.add_all(
                Item(board_id=board.id, media_id=media_ids[i % len(media_ids)], position=i + 1)
                for i in range(500)
            )
        await db.commit()


async def administrator(username: str, password: str):
    username = Credentials(username=username, password=password).username.lower()
    if len(password) < 15:
        raise SystemExit("Пароль должен содержать не менее 15 символов")
    async with SessionLocal() as db:
        if await db.scalar(select(User.id).where(User.username == username)):
            raise SystemExit("Имя пользователя уже существует")
        db.add(
            User(username=username, name=username, password=passwords.hash(password), admin=True)
        )
        await db.commit()


async def run(args):
    try:
        if args.command == "demo":
            await demo(args.large)
        else:
            await administrator(
                args.username,
                os.environ.get("RELAY_ADMIN_PASSWORD") or getpass("Пароль администратора: "),
            )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("demo").add_argument("--large", action="store_true")
    admin = sub.add_parser("admin")
    admin.add_argument("username")
    asyncio.run(run(parser.parse_args()))
