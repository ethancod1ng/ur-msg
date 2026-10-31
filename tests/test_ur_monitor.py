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

ROUTES = {
    "高尾": ur_monitor.RailRoute("高尾", train_minutes=42, transfers=1),
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

    def test_estimates_conservative_walk_time(self):
        estimate = ur_monitor.estimate_commute(
            '<li>JR中央線「高尾」駅 徒歩7～15分</li>', ROUTES
        )
        self.assertEqual(57, estimate.total_minutes)
        self.assertEqual(15, estimate.access_minutes)
        self.assertEqual(1, estimate.transfers)

    def test_estimates_bus_plus_walk_time(self):
        estimate = ur_monitor.estimate_commute(
            '<li>JR中央線「高尾」駅 バス7～12分 徒歩1～4分</li>', ROUTES
        )
        self.assertEqual(58, estimate.total_minutes)
        self.assertEqual(16, estimate.access_minutes)

    def test_commute_filter_rejects_unknown_and_over_limit(self):
        base = ur_monitor.normalize_vacancy(BUILDING, ROOM)
        self.assertFalse(
            ur_monitor.matches(base, ur_monitor.Filters(max_commute_minutes=60))
        )
        commute = ur_monitor.CommuteEstimate("高尾", 61, 45, 16, 1)
        far = ur_monitor.normalize_vacancy(BUILDING, ROOM, commute)
        self.assertFalse(
            ur_monitor.matches(far, ur_monitor.Filters(max_commute_minutes=60))
        )
        commute = ur_monitor.CommuteEstimate("高尾", 60, 45, 15, 1)
        eligible = ur_monitor.normalize_vacancy(BUILDING, ROOM, commute)
        self.assertTrue(
            ur_monitor.matches(eligible, ur_monitor.Filters(max_commute_minutes=60))
        )

    def test_default_filter_caps_rent_at_100000_yen(self):
        with patch.dict(os.environ, {}, clear=True):
            filters = ur_monitor.Filters.from_env()
        self.assertEqual(100000, filters.max_rent_yen)
        self.assertEqual(60, filters.max_commute_minutes)

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
        commute = ur_monitor.CommuteEstimate("高尾", 52, 42, 10, 1)
        vacancy = ur_monitor.normalize_vacancy({**BUILDING, "name": "A&B"}, ROOM, commute)
        message = ur_monitor.format_vacancy(vacancy)
        self.assertIn("A&amp;B", message)
        self.assertIn("到茅場町约 <b>52 分钟</b>", message)
        self.assertIn("每月合计约 <b>52,600円</b>（含月租、共益费）", message)
        self.assertNotIn("48,100円", message)
        self.assertNotIn("4,500円", message)
        self.assertIn("3DK｜53㎡｜4楼", message)
        self.assertIn("查看 UR 详情", message)
        self.assertNotIn("JR中央線", message)
        self.assertNotIn("10万以内", message)

    def test_fetches_only_buildings_with_rooms(self):
        def fake_fetch(endpoint, fields):
            if endpoint == "bukken/search/list_bukken/":
                if fields["area"] == "01":
                    return [{**BUILDING, "roomCount": 1}, {**BUILDING, "id": "empty", "roomCount": 0}]
                return []
            self.assertEqual("20_2600", fields["id"])
            return [ROOM]

        result = ur_monitor.fetch_vacancies(
            ur_monitor.Filters(max_commute_minutes=60), fake_fetch, ROUTES
        )
        self.assertEqual(["20_2600:001080409"], [item.key for item in result])
        self.assertEqual(52, result[0].commute_minutes)


if __name__ == "__main__":
    unittest.main()

