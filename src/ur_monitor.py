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
from xml.etree import ElementTree
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
DEFAULT_MAX_RENT_YEN = 100_000
DEFAULT_MAX_COMMUTE_MINUTES = 60
KAYABACHO_STATION_CODE = "1901"
KAYABACHO_STATION_NAME = "茅場町"
COMMUTE_XML_URL = (
    f"{SITE_BASE}/chintai/common/xml/cost-time/"
    f"cost-time_{KAYABACHO_STATION_CODE.zfill(8)}.xml"
)


@dataclass(frozen=True)
class RailRoute:
    station: str
    train_minutes: int
    transfers: int


@dataclass(frozen=True)
class CommuteEstimate:
    station: str
    total_minutes: int
    train_minutes: int
    access_minutes: int
    transfers: int


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
    commute_station: str = ""
    commute_minutes: int | None = None
    commute_train_minutes: int | None = None
    commute_access_minutes: int | None = None
    commute_transfers: int | None = None


@dataclass(frozen=True)
class Filters:
    cities: frozenset[str] = frozenset()
    layouts: frozenset[str] = frozenset()
    max_rent_yen: int | None = None
    max_commute_minutes: int | None = None

    @classmethod
    def from_env(cls) -> "Filters":
        max_rent = os.getenv("UR_MAX_RENT_YEN", "").strip()
        max_commute = os.getenv("UR_MAX_COMMUTE_MINUTES", "").strip()
        return cls(
            cities=_csv_env("UR_CITIES"),
            layouts=_csv_env("UR_LAYOUTS"),
            max_rent_yen=int(max_rent) if max_rent else DEFAULT_MAX_RENT_YEN,
            max_commute_minutes=(
                int(max_commute) if max_commute else DEFAULT_MAX_COMMUTE_MINUTES
            ),
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


def normalize_station_name(value: str) -> str:
    value = html.unescape(value).replace("（", "(").replace("）", ")")
    value = re.sub(r"\((?:東京|東京都)\)$", "", value)
    return re.sub(r"\s+", "", value).strip()


def fetch_bytes(url: str, *, attempts: int = 3) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Referer": REFERER})
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=30) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError):
            if attempt + 1 == attempts:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def parse_commute_routes(xml_bytes: bytes) -> dict[str, RailRoute]:
    # UR declares EUC-JP; decoding first also avoids ElementTree's limited
    # multi-byte declaration support on some Python builds.
    text = xml_bytes.decode("euc_jp").replace('encoding="euc-jp"', 'encoding="utf-8"')
    root = ElementTree.fromstring(text)
    routes: dict[str, RailRoute] = {
        normalize_station_name(KAYABACHO_STATION_NAME): RailRoute(
            KAYABACHO_STATION_NAME, 0, 0
        )
    }
    for row in root.findall(".//stationTo"):
        station = row.findtext("stationName", default="")
        route = RailRoute(
            station=station,
            train_minutes=int(row.findtext("costTime", default="0")),
            transfers=int(row.findtext("changeTimes", default="0")),
        )
        key = normalize_station_name(station)
        current = routes.get(key)
        if current is None or (route.train_minutes, route.transfers) < (
            current.train_minutes,
            current.transfers,
        ):
            routes[key] = route
    return routes


def fetch_commute_routes() -> dict[str, RailRoute]:
    return parse_commute_routes(fetch_bytes(COMMUTE_XML_URL))


def _duration_max(text: str, label: str) -> int:
    match = re.search(rf"{label}\s*(\d+)(?:\s*[～〜~-]\s*(\d+))?\s*分", text)
    if not match:
        return 0
    return int(match.group(2) or match.group(1))


def estimate_commute(
    access_html: str, routes: dict[str, RailRoute]
) -> CommuteEstimate | None:
    entries = re.findall(r"<li[^>]*>(.*?)</li>", access_html or "", flags=re.I | re.S)
    if not entries and access_html:
        entries = [access_html]

    estimates: list[CommuteEstimate] = []
    for entry in entries:
        text = strip_html(entry)
        station_match = re.search(r"[「｢]([^」｣]+)[」｣]駅", text)
        if not station_match:
            continue
        route = routes.get(normalize_station_name(station_match.group(1)))
        if route is None:
            continue
        access_minutes = _duration_max(text, "バス") + _duration_max(text, "徒歩")
        estimates.append(
            CommuteEstimate(
                station=route.station,
                total_minutes=route.train_minutes + access_minutes,
                train_minutes=route.train_minutes,
                access_minutes=access_minutes,
                transfers=route.transfers,
            )
        )
    if not estimates:
        return None
    return min(estimates, key=lambda item: (item.total_minutes, item.transfers))


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


def normalize_vacancy(
    building: dict[str, Any],
    room: dict[str, Any],
    commute: CommuteEstimate | None = None,
) -> Vacancy:
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
        commute_station=commute.station if commute else "",
        commute_minutes=commute.total_minutes if commute else None,
        commute_train_minutes=commute.train_minutes if commute else None,
        commute_access_minutes=commute.access_minutes if commute else None,
        commute_transfers=commute.transfers if commute else None,
    )


def matches(vacancy: Vacancy, filters: Filters) -> bool:
    return not (
        (filters.cities and vacancy.city not in filters.cities)
        or (filters.layouts and vacancy.layout not in filters.layouts)
        or (filters.max_rent_yen is not None and vacancy.rent_yen > filters.max_rent_yen)
        or (
            filters.max_commute_minutes is not None
            and (
                vacancy.commute_minutes is None
                or vacancy.commute_minutes > filters.max_commute_minutes
            )
        )
    )


def fetch_vacancies(
    filters: Filters,
    fetch: Callable[[str, dict[str, str]], Any] = post_json,
    commute_routes: dict[str, RailRoute] | None = None,
) -> list[Vacancy]:
    if filters.max_commute_minutes is not None and commute_routes is None:
        commute_routes = fetch_commute_routes()
    buildings: list[dict[str, Any]] = []
    for area in TOKYO_AREA_IDS:
        rows = fetch("bukken/search/list_bukken/", {"tdfk": "13", "area": area, "vacancy": "1"})
        buildings.extend(row for row in rows if int(row.get("roomCount") or 0) > 0)

    vacancies: list[Vacancy] = []
    for building in buildings:
        commute = (
            estimate_commute(str(building.get("access", "")), commute_routes)
            if commute_routes is not None
            else None
        )
        rooms = fetch("room/list/", {"tdfk": "13", "id": str(building["id"]), "mode": "init"})
        for room in rooms:
            vacancy = normalize_vacancy(building, room, commute)
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
    floor = item.floor.replace("階", "楼")
    details = "｜".join(value for value in (item.layout, item.floor_space, floor) if value)
    try:
        monthly_total = item.rent_yen + parse_yen(item.common_fee)
    except ValueError:
        monthly_total = None
    lines = [
        f"🏠 <b>{html.escape(item.building)}</b>｜{html.escape(item.city)}",
        f"🚪 {html.escape(item.room)}",
    ]
    if monthly_total is not None:
        lines.append(
            f"💴 月费约 <b>{monthly_total:,}円</b>（含共益费）"
        )
    else:
        lines.append("💴 每月费用：请查看 UR 详情")
    if item.commute_minutes is not None:
        lines.append(
            f"🚆 到茅場町约 <b>{item.commute_minutes} 分钟</b>｜"
            f"换乘 {item.commute_transfers} 次"
        )
        lines.append(
            f"📍 {html.escape(item.commute_station)}站｜"
            f"房源到车站按最长约 {item.commute_access_minutes} 分钟"
        )
    lines.extend(
        [
            f"📐 {html.escape(details)}",
            f'<a href="{html.escape(item.url, quote=True)}">查看 UR 详情</a>',
        ]
    )
    return "\n".join(lines)


def message_chunks(
    vacancies: list[Vacancy],
    limit: int = 3900,
    heading: str | None = None,
) -> list[str]:
    blocks = [format_vacancy(item) for item in vacancies]
    chunks: list[str] = []
    current = heading or f"🎯 <b>符合你的条件｜新增 {len(vacancies)} 间</b>"
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


def digest_chunks(vacancies: list[Vacancy]) -> list[str]:
    if not vacancies:
        return ["📋 <b>今日符合条件空室</b>\n\n当前暂无符合条件的空室。"]
    return message_chunks(
        vacancies,
        heading=f"📋 <b>今日符合条件空室｜{len(vacancies)} 间</b>",
    )


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


def run(
    state_path: Path,
    *,
    dry_run: bool = False,
    notify_initial: bool = False,
    digest: bool = False,
) -> int:
    vacancies = fetch_vacancies(Filters.from_env())

    if digest:
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
        chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
        if not token or not chat_id:
            raise RuntimeError("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required for a digest")
        for chunk in digest_chunks(vacancies):
            send_telegram(token, chat_id, chunk)
        print(f"Daily digest sent with {len(vacancies)} matching vacancies.")
        return 0

    previous = load_state(state_path)
    additions = vacancies if previous is None and notify_initial else new_vacancies(previous, vacancies)
    print(f"Found {len(vacancies)} matching vacancies; {len(additions)} new.")

    if dry_run:
        for item in vacancies:
            print(
                f"- {item.city} | {item.building} | {item.room} | {item.rent} | "
                f"茅場町 {item.commute_minutes}分 | {item.url}"
            )
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
    parser.add_argument(
        "--digest",
        action="store_true",
        help="Send all currently matching vacancies without changing incremental state",
    )
    args = parser.parse_args(argv)
    try:
        return run(
            args.state,
            dry_run=args.dry_run,
            notify_initial=args.notify_initial,
            digest=args.digest,
        )
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

