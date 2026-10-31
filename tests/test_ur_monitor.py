import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import ur_monitor


BUILDING = {
    "id": "20_2600",
    "name": "館ヶ丘",
    "skcs": "八王子市",
    "access": '<li>JR中央線「高尾」駅 徒歩10分</li>',
}
ROOM = {
    "id": "001080409",
    "name": "1-8号棟409号室",
    "rent": "48,100円",
    "commonfee_sp": "共益費：4,500円",
    "type": "3DK",
    "floorspace": "53&#13217;",
    "floor": "4階",
    "urlDetail": "/chintai/kanto/tokyo/20_2600_room.html?JKSS=001080409",
}


class MonitorTests(unittest.TestCase):
    def test_parse_yen(self):
        self.assertEqual(48100, ur_monitor.parse_yen("48,100円"))

    def test_normalize_and_strip_html(self):
        vacancy = ur_monitor.normalize_vacancy(BUILDING, ROOM)
        self.assertEqual("20_2600:001080409", vacancy.key)
        self.assertEqual(48100, vacancy.rent_yen)
        self.assertEqual("53㎡", vacancy.floor_space)
        self.assertEqual("JR中央線「高尾」駅 徒歩10分", vacancy.access)
        self.assertTrue(vacancy.url.startswith("https://www.ur-net.go.jp/"))

    def test_campaign_rent_falls_back_to_rent_normal(self):
        room = {
            **ROOM,
            "rent": "",
            "rent_normal": '<span class="item_campaign_comment">キャンペーン家賃</span>'
            '<span class="item_price">89,800円</span>',
        }
        vacancy = ur_monitor.normalize_vacancy(BUILDING, room)
        self.assertEqual(89800, vacancy.rent_yen)
        self.assertEqual("キャンペーン家賃89,800円", vacancy.rent)

    def test_filters(self):
        vacancy = ur_monitor.normalize_vacancy(BUILDING, ROOM)
        self.assertTrue(ur_monitor.matches(vacancy, ur_monitor.Filters(max_rent_yen=50000)))
        self.assertFalse(ur_monitor.matches(vacancy, ur_monitor.Filters(cities=frozenset({"新宿区"}))))
        self.assertFalse(ur_monitor.matches(vacancy, ur_monitor.Filters(layouts=frozenset({"1LDK"}))))

    def test_default_filter_caps_rent_at_100000_yen(self):
        with patch.dict(os.environ, {}, clear=True):
            filters = ur_monitor.Filters.from_env()
        self.assertEqual(100000, filters.max_rent_yen)

    def test_environment_can_override_default_rent_cap(self):
        with patch.dict(os.environ, {"UR_MAX_RENT_YEN": "85000"}, clear=True):
            filters = ur_monitor.Filters.from_env()
        self.assertEqual(85000, filters.max_rent_yen)

    def test_missing_state_creates_baseline_without_additions(self):
        vacancy = ur_monitor.normalize_vacancy(BUILDING, ROOM)
        self.assertEqual([], ur_monitor.new_vacancies(None, [vacancy]))

    def test_detects_only_new_keys(self):
        vacancy = ur_monitor.normalize_vacancy(BUILDING, ROOM)
        self.assertEqual([], ur_monitor.new_vacancies({vacancy.key: {}}, [vacancy]))
        self.assertEqual([vacancy], ur_monitor.new_vacancies({}, [vacancy]))

    def test_state_round_trip(self):
        vacancy = ur_monitor.normalize_vacancy(BUILDING, ROOM)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            ur_monitor.save_state(path, [vacancy])
            loaded = ur_monitor.load_state(path)
        self.assertIn(vacancy.key, loaded)

    def test_message_escapes_html(self):
        vacancy = ur_monitor.normalize_vacancy({**BUILDING, "name": "A&B"}, ROOM)
        message = ur_monitor.format_vacancy(vacancy)
        self.assertIn("A&amp;B", message)
        self.assertIn("UR 详情页", message)

    def test_fetches_only_buildings_with_rooms(self):
        def fake_fetch(endpoint, fields):
            if endpoint == "bukken/search/list_bukken/":
                if fields["area"] == "01":
                    return [{**BUILDING, "roomCount": 1}, {**BUILDING, "id": "empty", "roomCount": 0}]
                return []
            self.assertEqual("20_2600", fields["id"])
            return [ROOM]

        result = ur_monitor.fetch_vacancies(ur_monitor.Filters(), fake_fetch)
        self.assertEqual(["20_2600:001080409"], [item.key for item in result])


if __name__ == "__main__":
    unittest.main()

