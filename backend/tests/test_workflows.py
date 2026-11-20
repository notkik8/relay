import asyncio
import io
import os
from contextlib import AsyncExitStack
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.routers.accounts import passwords
from app.api.routers.pins import catalog_items
from app.core.config import get_settings
from app.db.session import get_session
from app.main import app
from app.models import Base
from app.models.entities import EmailVerification, Item, Media, User
from app.services import mail

pytestmark = pytest.mark.skipif(
    not os.getenv("RELAY_TEST_DATABASE_URL"),
    reason="Set RELAY_TEST_DATABASE_URL to an isolated PostgreSQL database",
)

PASSWORD = "RelayTestPassword123!"


@pytest.fixture
async def relay(tmp_path, monkeypatch):
    database_url = os.environ["RELAY_TEST_DATABASE_URL"]
    schema = f"relay_test_{uuid4().hex}"
    control = create_async_engine(database_url, poolclass=NullPool)
    async with control.begin() as connection:
        await connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    engine = create_async_engine(
        database_url,
        poolclass=NullPool,
        connect_args={"server_settings": {"search_path": schema}},
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def session():
        async with sessions() as db:
            yield db

    monkeypatch.setattr(get_settings(), "media_root", tmp_path)
    monkeypatch.setattr(get_settings(), "catalog_demo", True)
    monkeypatch.setattr(get_settings(), "smtp_host", "smtp.test")
    inbox = {}
    monkeypatch.setattr(mail, "send_verification", inbox.__setitem__)
    monkeypatch.setitem(app.dependency_overrides, get_session, session)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with AsyncExitStack() as stack:
            accounts = {
                key: await stack.enter_async_context(
                    AsyncClient(transport=ASGITransport(app=app), base_url="http://relay.example"),
                )
                for key in ("guest", "owner", "editor", "reader", "admin")
            }
            for key in ("owner", "editor", "reader"):
                email = f"{key}@example.org"
                response = await accounts[key].post(
                    "/api/v1/accounts",
                    json={
                        "username": key,
                        "email": email,
                        "password": PASSWORD,
                    },
                )
                assert response.status_code == 201, response.text
                response = await accounts[key].post(
                    "/api/v1/accounts/verify",
                    json={"token": inbox[email], "password": PASSWORD},
                )
                assert response.status_code == 200, response.text
            async with sessions() as db:
                db.add(
                    User(
                        username="admin",
                        email="admin@example.org",
                        name="Moderator",
                        password=passwords.hash(PASSWORD),
                        email_verified_at=datetime.now(UTC),
                        admin=True,
                    )
                )
                await db.commit()
            response = await accounts["admin"].post(
                "/api/v1/sessions",
                json={
                    "email": "admin@example.org",
                    "password": PASSWORD,
                },
            )
            assert response.status_code == 200, response.text
            yield accounts, sessions
    finally:
        await engine.dispose()
        async with control.begin() as connection:
            await connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        await control.dispose()


async def create_board(client, title, visibility="private"):
    response = await client.post("/api/v1/boards", json={"title": title, "visibility": visibility})
    assert response.status_code == 201, response.text
    return response.json()


async def add_catalog(client, key, kind="film", external_id="demo-her"):
    response = await client.post(
        f"/api/v1/boards/{key}/items/catalog",
        json={
            "kind": kind,
            "external_id": external_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def png():
    content = io.BytesIO()
    Image.new("RGB", (2, 2), "#123456").save(content, format="PNG")
    return content.getvalue()


async def test_email_confirmation_required_expires_and_is_single_use(relay, monkeypatch):
    clients, sessions = relay
    guest = clients["guest"]
    inbox = {}
    monkeypatch.setattr(mail, "send_verification", inbox.__setitem__)
    email = "new@example.org"
    credentials = {"email": email, "password": PASSWORD}
    response = await guest.post("/api/v1/accounts", json={**credentials, "username": "new_user"})
    assert response.status_code == 201
    assert "set-cookie" not in response.headers
    assert (await guest.get("/api/v1/profiles/new_user")).status_code == 404
    assert (await guest.post("/api/v1/sessions", json=credentials)).status_code == 403
    assert (await guest.post("/api/v1/accounts/verification", json=credentials)).status_code == 429
    token = inbox[email]
    async with sessions() as db:
        verification = await db.get(EmailVerification, email)
        verification.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        verification.sent_at -= timedelta(minutes=2)
        await db.commit()
    verify = "/api/v1/accounts/verify"
    assert (
        await guest.post(verify, json={"token": token, "password": PASSWORD})
    ).status_code == 410
    assert (await guest.post("/api/v1/accounts/verification", json=credentials)).status_code == 200
    assert inbox[email] != token
    payload = {"token": inbox[email], "password": PASSWORD}
    assert (await guest.post(verify, json={**payload, "password": "incorrect"})).status_code == 401
    responses = await asyncio.gather(
        guest.post(verify, json=payload), guest.post(verify, json=payload)
    )
    assert sorted(response.status_code for response in responses) == [200, 410]
    assert (await guest.get("/api/v1/accounts/me")).json()["email"] == email
    public = (await guest.get("/api/v1/profiles/new_user")).json()["user"]
    assert public["username"] == "new_user" and "email" not in public
    assert (await guest.delete("/api/v1/sessions/current")).status_code == 204
    assert (await guest.post("/api/v1/sessions", json=credentials)).status_code == 200


async def test_public_pins_and_private_collections(relay):
    clients, _ = relay
    guest, owner, reader = (clients[key] for key in ("guest", "owner", "reader"))
    upload = {
        "data": {"kind": "image", "title": "Песчаные дюны", "description": "Снимок с берега"},
        "files": {"file": ("image.png", png(), "image/png")},
    }
    assert (await guest.post("/api/v1/pins", **upload)).status_code == 401
    posted = await owner.post("/api/v1/pins", **upload)
    assert posted.status_code == 201, posted.text
    pin = posted.json()
    assert pin["author"]["username"] == "owner" and "email" not in pin["author"]
    assert (await guest.get(pin["thumbnail"])).headers["content-type"] == "image/webp"
    searched = await guest.get("/api/v1/pins", params={"q": "дюны"})
    assert searched.json()["items"][0]["id"] == pin["id"]
    assert (await guest.get("/api/v1/profiles/owner/pins")).json()["items"][0]["id"] == pin["id"]
    full_pin = f"/api/v1/pins/{pin['id']}"
    assert (await reader.delete(full_pin)).status_code == 403
    result = await owner.post("/api/v1/pin-collections", json={"title": "Идеи"})
    assert result.status_code == 201 and not result.json()["public"]
    folder = f"/api/v1/pin-collections/{result.json()['id']}"
    uploaded_entry = f"{folder}/pins/{pin['id']}"
    catalog_id = next(iter(catalog_items()))
    catalog_entry = f"{folder}/pins/{catalog_id}"
    assert (await guest.get(folder)).status_code == 404
    assert (await reader.put(uploaded_entry)).status_code == 404
    for entry in (uploaded_entry, uploaded_entry, catalog_entry):
        assert (await owner.put(entry)).status_code == 204
    assert len((await owner.get(folder)).json()["items"]) == 2
    assert (await owner.put(folder, json={"title": "Фото", "public": True})).status_code == 200
    items = (await guest.get(folder)).json()["items"]
    assert {item["material"]["id"] for item in items} == {pin["id"], catalog_id}
    assert (await owner.delete(full_pin)).status_code == 204
    assert (await guest.get(pin["thumbnail"])).status_code == 404
    assert len((await guest.get(folder)).json()["items"]) == 1
    assert (await owner.delete(folder)).status_code == 204
    assert (await guest.get(folder)).status_code == 404


async def test_board_rights_private_files_editors_and_version(relay):
    clients, _ = relay
    guest, owner, editor, reader = (clients[key] for key in ("guest", "owner", "editor", "reader"))
    board = await create_board(owner, "Осенний вечер")
    path = f"/api/v1/boards/{board['key']}"
    image = await owner.post(
        f"{path}/items/upload", files={"file": ("sample.png", png(), "image/png")}
    )
    assert image.status_code == 201, image.text
    asset = f"{path}/items/{image.json()['id']}/file"
    for client in (guest, editor, reader):
        for endpoint in (path, f"{path}/items", f"{path}/comments", asset):
            assert (await client.get(endpoint)).status_code == 404
    assert (await owner.get(asset)).content == png()
    assert (await owner.get(f"{asset}?thumbnail=true")).headers["content-type"] == "image/webp"
    invalid = await owner.post(
        f"{path}/items/upload", files={"file": ("fake.png", b"bad", "image/png")}
    )
    assert invalid.status_code == 422
    oversize = await owner.post(
        f"{path}/items/upload",
        files={
            "file": ("large.png", bytes(10 * 1024 * 1024 + 1), "image/png"),
        },
    )
    assert oversize.status_code == 413
    assert (await owner.post(f"{path}/members", json={"username": "editor"})).status_code == 204
    notices = (await editor.get("/api/v1/notifications")).json()["items"]
    assert notices[0]["pending"]
    assert (await editor.get(path)).status_code == 404
    accepted = await editor.put(
        f"/api/v1/notifications/{notices[0]['id']}/invite", json={"accept": True}
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["editable"]
    second = await add_catalog(editor, board["key"])
    assert (await editor.get(asset)).status_code == 200
    assert (await editor.put(path, json={"title": "Чужое изменение"})).status_code == 403
    version = (await owner.get(f"{path}/items")).json()["version"]
    first = image.json()["id"]
    responses = await asyncio.gather(
        owner.put(f"{path}/order", json={"item_id": second, "position": 0, "version": version}),
        editor.put(f"{path}/order", json={"item_id": first, "position": 1, "version": version}),
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert [item["id"] for item in (await owner.get(f"{path}/items")).json()["items"]] == [
        second,
        first,
    ]
    linked = await owner.put(path, json={"title": board["title"], "visibility": "link"})
    link_key = linked.json()["key"]
    assert link_key != board["key"]
    link = f"/api/v1/boards/{link_key}"
    assert (await guest.get(path)).status_code == 404
    assert (await guest.get(f"{link}/items/{first}/file")).status_code == 200
    assert not (await guest.get("/api/v1/feed")).json()["items"]
    assert not (await guest.get("/api/v1/profiles/owner")).json()["boards"]["items"]
    assert (
        await owner.put(link, json={"title": board["title"], "visibility": "private"})
    ).status_code == 200
    reopened = await owner.put(path, json={"title": board["title"], "visibility": "link"})
    assert reopened.json()["key"] != link_key
    assert (await guest.get(f"{link}/items/{first}/file")).status_code == 404
    assert (await owner.put(path, json={"title": board["title"]})).status_code == 200
    assert (await owner.delete(f"{path}/members/editor")).status_code == 204
    assert (await editor.get(asset)).status_code == 404


async def test_follow_likes_comments_copy_and_moderation(relay):
    clients, _ = relay
    guest, owner, reader, admin = (clients[key] for key in ("guest", "owner", "reader", "admin"))
    original = await create_board(owner, "Осенний вечер", "public")
    key = original["key"]
    path = f"/api/v1/boards/{key}"
    assert (await guest.get("/api/v1/search", params={"q": "осенний"})).json()["boards"]["items"]
    assert (await reader.put("/api/v1/profiles/owner/follow")).status_code == 204
    assert (await reader.put("/api/v1/profiles/owner/follow")).status_code == 204
    assert (await reader.get("/api/v1/feed?mode=following")).json()["items"][0]["key"] == key
    item_id = await add_catalog(owner, key)
    for endpoint in (f"{path}/like", f"{path}/items/{item_id}/like"):
        for _ in range(2):
            assert (await reader.put(endpoint)).status_code == 204
    read_board = (await reader.get(path)).json()
    assert read_board["likes"] == 1 and read_board["liked"]
    assert (await reader.get(f"{path}/items")).json()["items"][0]["likes"] == 1
    assert (await reader.delete(f"{path}/like")).status_code == 204
    comment = await reader.post(f"{path}/comments", json={"text": "Что посмотреть вечером?"})
    assert comment.status_code == 201, comment.text
    assert (await owner.delete(f"{path}/comments/{comment.json()['id']}")).status_code == 404
    notices = (await owner.get("/api/v1/notifications")).json()["items"]
    assert sorted(notice["type"] for notice in notices) == ["comment", "follow", "like", "like"]
    destination = await create_board(reader, "Своя")
    destination_path = f"/api/v1/boards/{destination['key']}"
    copied = await reader.post(
        f"{path}/items/{item_id}/save", json={"board_id": destination["key"]}
    )
    assert copied.status_code == 201, copied.text
    cannot_move = await owner.post(
        f"{path}/items/{item_id}/move", json={"board_id": destination["key"]}
    )
    assert cannot_move.status_code in (403, 404)
    assert (await owner.delete(f"{path}/items/{item_id}")).status_code == 204
    assert (await reader.get(f"{destination_path}/items")).json()["items"][0]["title"] == "Она"
    for kind, identifier in (("board", key), ("comment", comment.json()["id"])):
        report = await reader.post(
            f"{path}/reports",
            json={
                "kind": kind,
                "object_id": identifier,
                "reason": "Проверка модерации",
            },
        )
        assert report.status_code == 201, report.text
    assert (await owner.get("/api/v1/admin/stats")).status_code == 403
    reports = (await admin.get("/api/v1/admin/reports")).json()["items"]
    assert len(reports) == 2
    for report in reports:
        resolution = await admin.post(
            f"/api/v1/admin/reports/{report['id']}/resolution",
            json={
                "action": "hide",
                "reason": "Материал скрыт по жалобе",
            },
        )
        assert resolution.status_code == 204, resolution.text
    assert (await guest.get(path)).status_code == 404
    assert not (await guest.get("/api/v1/feed")).json()["items"]
    assert len((await admin.get("/api/v1/admin/audit")).json()["items"]) == 2
    user_id = (await reader.get("/api/v1/accounts/me")).json()["id"]
    assert (
        await admin.post(
            f"/api/v1/admin/objects/user/{user_id}",
            json={
                "action": "block",
                "reason": "Проверка отзыва сессии",
            },
        )
    ).status_code == 204
    assert (await reader.get("/api/v1/accounts/me")).json() is None
    assert (
        await reader.post(
            "/api/v1/sessions", json={"email": "reader@example.org", "password": PASSWORD}
        )
    ).status_code == 401


async def test_large_collection_page_and_atomic_move(relay):
    clients, sessions = relay
    owner = clients["owner"]
    board = await create_board(owner, "Большая подборка")
    key = board["key"]
    path = f"/api/v1/boards/{key}"
    async with sessions() as db:
        film = Media(kind="film", provider="demo", external_id="demo-her", title="Она")
        db.add(film)
        await db.flush()
        db.add_all(Item(board_id=key, media_id=film.id, position=index + 1) for index in range(499))
        await db.commit()
    last = await add_catalog(owner, key)
    tail = (await owner.get(f"{path}/items?offset=480&limit=24")).json()
    assert len(tail["items"]) == 20 and tail["items"][-1]["id"] == last
    assert tail["next_offset"] is None
    assert (
        await owner.put(
            f"{path}/order",
            json={
                "item_id": last,
                "position": 0,
                "version": tail["version"],
            },
        )
    ).status_code == 200
    assert (await owner.get(f"{path}/items")).json()["items"][0]["id"] == last
    destination = await create_board(owner, "Назначение")
    rejected = await owner.post(f"{path}/items/{last}/move", json={"board_id": key})
    assert rejected.status_code == 422
    assert (await owner.get(f"{path}/items")).json()["items"][0]["id"] == last
    moved = await owner.post(f"{path}/items/{last}/move", json={"board_id": destination["key"]})
    assert moved.status_code == 200, moved.text
    assert (await owner.get(f"{path}/items/{last}/index")).status_code == 404
    assert (await owner.get(f"/api/v1/boards/{destination['key']}/items")).json()["items"][0][
        "id"
    ] == last
