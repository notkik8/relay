"""Measure the three typical operations on a test stand.

Requires httpx from the backend environment. Creates a test account and writes
catalog items to its own board. Never run against a production URL.
"""

import argparse
import asyncio
import json
import math
import os
import re
import secrets
import time
from pathlib import Path

import httpx


async def measured(client, method, path, **kwargs):
    start = time.perf_counter()
    try:
        response = await client.request(method, path, **kwargs)
        status = response.status_code
    except httpx.HTTPError as exc:
        status = type(exc).__name__
    return (time.perf_counter() - start) * 1000, status


async def run(args):
    api = f"{args.url.rstrip('/')}/api/v1"
    result = {}
    async with httpx.AsyncClient(
        base_url=api,
        limits=httpx.Limits(
            max_connections=args.users,
            max_keepalive_connections=args.users,
        ),
        timeout=12,
    ) as client:
        username = f"load_{secrets.token_hex(4)}"
        email = f"{username}@example.org"
        password = secrets.token_urlsafe(24)
        response = await client.post(
            "/accounts",
            json={"username": username, "email": email, "password": password},
        )
        response.raise_for_status()
        mailbox = os.getenv("RELAY_MAILPIT_URL", "http://127.0.0.1:8025").rstrip("/")
        search = await client.get(f"{mailbox}/api/v1/search", params={"query": f"to:{email}"})
        search.raise_for_status()
        messages = search.json()["messages"]
        if not messages:
            raise RuntimeError("Verification email missing from the local Mailpit inbox")
        message = await client.get(f"{mailbox}/api/v1/message/{messages[0]['ID']}")
        message.raise_for_status()
        token = re.search(r"/verify-email#([A-Za-z0-9_-]{43})", message.json()["Text"])
        if token is None:
            raise RuntimeError("Missing verification link in the email")
        (await client.post(
            "/accounts/verify", json={"token": token[1], "password": password},
        )).raise_for_status()
        response = await client.post(
            "/boards", json={"title": "Нагрузочная проверка", "visibility": "private"}
        )
        response.raise_for_status()
        board = f"/boards/{response.json()['key']}"
        entry = {"kind": "film", "external_id": "demo-her"}
        (await client.post(f"{board}/items/catalog", json=entry)).raise_for_status()
        public = (await client.get("/feed")).json()["items"]
        read_board = f"/boards/{public[0]['key']}" if public else board
        for name, method, path, kwargs in (
            ("feed", "GET", "/feed", {}),
            ("board", "GET", read_board, {}),
            ("add_item", "POST", f"{board}/items/catalog", {"json": entry}),
        ):
            samples = []
            for _ in range(args.rounds):
                samples.extend(
                    await asyncio.gather(
                        *(measured(client, method, path, **kwargs) for _ in range(args.users))
                    )
                )
            times = sorted(elapsed for elapsed, _ in samples)
            errors = [str(code) for _, code in samples if not isinstance(code, int) or code >= 400]
            result[name] = {
                "requests": len(samples),
                "p95_ms": round(times[math.ceil(0.95 * len(times)) - 1], 2),
                "max_ms": round(max(times), 2),
                "errors": len(errors),
                "error_types": sorted(set(errors)),
            }
    return {"concurrent_requests": args.users, "rounds": args.rounds, "operations": result}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Base URL for the isolated stand with CATALOG_DEMO=true")
    parser.add_argument("--users", type=int, choices=range(1, 101), default=100)
    parser.add_argument("--rounds", type=int, choices=range(1, 11), default=3)
    parser.add_argument("--output", type=Path)
    settings = parser.parse_args()
    rendered = json.dumps(asyncio.run(run(settings)), indent=2, ensure_ascii=False)
    print(rendered)
    if settings.output:
        settings.output.write_text(rendered + "\n", encoding="utf-8")
