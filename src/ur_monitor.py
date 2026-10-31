from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


# Keep diagnostics from crashing on Windows consoles whose legacy code page
# cannot represent every Japanese character returned by UR.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(errors="backslashreplace")


API_BASE = "https://chintai.r6.ur-net.go.jp/chintai/api/"
SITE_BASE = "https://www.ur-net.go.jp"
REFERER = f"{SITE_BASE}/chintai/kanto/tokyo/list/"
TOKYO_AREA_IDS = ("01", "02", "03", "04", "05", "06")
USER_AGENT = "ur-tokyo-telegram-monitor/1.0"


@dataclass(frozen=True)
class Vacancy:
    key: str
    building_id: str
    room_id: str
    building: str
    city: str
    room: str
    rent_yen: int
    rent: str
    common_fee: str
    layout: str
    floor_space: str
    floor: str
    access: str
    url: str


@dataclass(frozen=True)
class Filters:
    cities: frozenset[str] = frozenset()
    layouts: frozenset[str] = frozenset()
    max_rent_yen: int | None = None

    @classmethod
    def from_env(cls) -> "Filters":
        max_rent = os.getenv("UR_MAX_RENT_YEN", "").strip()
        return cls(
            cities=_csv_env("UR_CITIES"),
            layouts=_csv_env("UR_LAYOUTS"),
            max_rent_yen=int(max_rent) if max_rent else None,
        )


def _csv_env(name: str) -> frozenset[str]:
    return frozenset(part.strip() for part in os.getenv(name, "").split(",") if part.strip())


def parse_yen(value: str) -> int:
    match = re.search(r"[\d,]+", html.unescape(value))
    if not match:
        raise ValueError(f"No yen amount found in {value!r}")
    return int(match.group(0).replace(",", ""))


def strip_html(value: str) -> str:
    text = re.sub(r"<\s*br\s*/?>", " ", value or "", flags=re.I)
    text = re.sub(r"</?li[^>]*>", " / ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip(" /\t\r\n")


def post_json(endpoint: str, fields: dict[str, str], *, attempts: int = 3) -> Any:
    request = Request(
        API_BASE + endpoint,
        data=urlencode(fields).encode(),
        headers={
            "User-Agent": USER_AGENT,
            "Origin": SITE_BASE,
            "Referer": REFERER,
            "Accept": "application/json",
        },
        method="POST",
    )
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=30) as response:
                return json.load(response)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
            if attempt + 1 == attempts:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def normalize_vacancy(building: dict[str, Any], room: dict[str, Any]) -> Vacancy:
    room_url = room.get("urlDetail", "")
    if room_url.startswith("/"):
        room_url = SITE_BASE + room_url
    # Campaign rooms sometimes leave `rent` empty and embed the displayed
    # amount in `rent_normal` alongside an explanatory HTML note.
    rent_source = str(room.get("rent") or room.get("rent_normal") or "")
    rent_text = strip_html(rent_source)
    return Vacancy(
        key=f"{building['id']}:{room['id']}",
        building_id=str(building["id"]),
        room_id=str(room["id"]),
        building=strip_html(str(building.get("name", ""))),
        city=strip_html(str(building.get("skcs", ""))),
        room=strip_html(str(room.get("name", ""))),
        rent_yen=parse_yen(rent_source),
        rent=rent_text,
        common_fee=strip_html(str(room.get("commonfee_sp") or room.get("commonfee", ""))),
        layout=strip_html(str(room.get("type", ""))),
        floor_space=strip_html(str(room.get("floorspace", ""))),
        floor=strip_html(str(room.get("floor", ""))),
        access=strip_html(str(building.get("access", ""))),
        url=room_url,
    )


def matches(vacancy: Vacancy, filters: Filters) -> bool:
    return not (
        (filters.cities and vacancy.city not in filters.cities)
        or (filters.layouts and vacancy.layout not in filters.layouts)
        or (filters.max_rent_yen is not None and vacancy.rent_yen > filters.max_rent_yen)
    )


def fetch_vacancies(
    filters: Filters,
    fetch: Callable[[str, dict[str, str]], Any] = post_json,
) -> list[Vacancy]:
    buildings: list[dict[str, Any]] = []
    for area in TOKYO_AREA_IDS:
        rows = fetch("bukken/search/list_bukken/", {"tdfk": "13", "area": area, "vacancy": "1"})
        buildings.extend(row for row in rows if int(row.get("roomCount") or 0) > 0)

    vacancies: list[Vacancy] = []
    for building in buildings:
        rooms = fetch("room/list/", {"tdfk": "13", "id": str(building["id"]), "mode": "init"})
        for room in rooms:
            vacancy = normalize_vacancy(building, room)
            if matches(vacancy, filters):
                vacancies.append(vacancy)
    return sorted(vacancies, key=lambda item: (item.city, item.building, item.rent_yen, item.room))


def load_state(path: Path) -> dict[str, dict[str, Any]] | None:
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return {item["key"]: item for item in data.get("vacancies", [])}


def save_state(path: Path, vacancies: Iterable[Vacancy]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "vacancies": [asdict(item) for item in vacancies],
    }
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def new_vacancies(previous: dict[str, dict[str, Any]] | None, current: list[Vacancy]) -> list[Vacancy]:
    if previous is None:
        return []
    return [item for item in current if item.key not in previous]


def format_vacancy(item: Vacancy) -> str:
    details = " / ".join(value for value in (item.layout, item.floor_space, item.floor) if value)
    lines = [
        f"🏠 <b>{html.escape(item.building)}</b>（{html.escape(item.city)}）",
        f"{html.escape(item.room)} · {html.escape(details)}",
        f"💴 {html.escape(item.rent)} · {html.escape(item.common_fee)}",
    ]
    if item.access:
        lines.append(f"🚉 {html.escape(item.access)}")
    lines.append(f'<a href="{html.escape(item.url, quote=True)}">UR 详情页</a>')
    return "\n".join(lines)


def message_chunks(vacancies: list[Vacancy], limit: int = 3900) -> list[str]:
    blocks = [format_vacancy(item) for item in vacancies]
    chunks: list[str] = []
    current = f"🔔 <b>东京 UR 新增空室：{len(vacancies)} 间</b>"
    for block in blocks:
        candidate = current + "\n\n" + block
        if len(candidate) > limit and current:
            chunks.append(current)
            current = block
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def send_telegram(token: str, chat_id: str, message: str) -> None:
    request = Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=urlencode(
            {
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML",
                "disable_web_page_preview": "true",
            }
        ).encode(),
        headers={"User-Agent": USER_AGENT},
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    if not result.get("ok"):
        raise RuntimeError(f"Telegram rejected the message: {result}")


def run(state_path: Path, *, dry_run: bool = False, notify_initial: bool = False) -> int:
    vacancies = fetch_vacancies(Filters.from_env())
    previous = load_state(state_path)
    additions = vacancies if previous is None and notify_initial else new_vacancies(previous, vacancies)
    print(f"Found {len(vacancies)} matching vacancies; {len(additions)} new.")

    if dry_run:
        for item in vacancies:
            print(f"- {item.city} | {item.building} | {item.room} | {item.rent} | {item.url}")
        return 0

    if additions:
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
        chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
        if not token or not chat_id:
            raise RuntimeError("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required when new vacancies exist")
        for chunk in message_chunks(additions):
            send_telegram(token, chat_id, chunk)

    save_state(state_path, vacancies)
    if previous is None and not notify_initial:
        print("Initial baseline saved; no notification sent.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Monitor Tokyo UR vacancies and notify Telegram")
    parser.add_argument("--state", type=Path, default=Path("data/state.json"))
    parser.add_argument("--dry-run", action="store_true", help="Fetch and print without sending or saving")
    parser.add_argument("--notify-initial", action="store_true", help="Notify for every vacancy on the first run")
    args = parser.parse_args(argv)
    try:
        return run(args.state, dry_run=args.dry_run, notify_initial=args.notify_initial)
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

