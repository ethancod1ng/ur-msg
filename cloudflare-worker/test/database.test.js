import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateMonitorStatus,
  normalizeSnapshot,
  parseYen,
} from "../src/database.js";

test("parses formatted common fees", () => {
  assert.equal(parseYen("共益費：4,800円"), 4800);
  assert.equal(parseYen(""), 0);
});

test("normalizes a successful snapshot and calculates monthly total", () => {
  const snapshot = normalizeSnapshot({
    snapshot_id: "run-123",
    started_at: "2026-11-01T00:00:00Z",
    completed_at: "2026-11-01T00:01:00Z",
    status: "success",
    vacancies: [
      {
        key: "20_1310:room",
        building_id: "20_1310",
        room_id: "room",
        building: "竹の塚第二",
        city: "足立区",
        room: "17号棟501号室",
        rent_yen: 79200,
        common_fee: "共益費：4,800円",
        url: "https://www.ur-net.go.jp/chintai/example",
      },
    ],
  });

  assert.equal(snapshot.vacancies[0].common_fee_yen, 4800);
  assert.equal(snapshot.vacancies[0].monthly_total_yen, 84000);
});

test("rejects invalid or unsafe snapshots", () => {
  assert.throws(() => normalizeSnapshot({ status: "success", vacancies: [] }), /snapshot_id/);
  assert.throws(
    () =>
      normalizeSnapshot({
        snapshot_id: "x",
        started_at: "2026-11-01T00:00:00Z",
        completed_at: "2026-11-01T00:01:00Z",
        status: "success",
        vacancies: [{ key: "x", url: "https://example.com" }],
      }),
    /required|UR URL/i,
  );
});

test("calculates healthy, delayed, and unhealthy states", () => {
  const now = new Date("2026-11-01T01:00:00Z");
  assert.equal(
    calculateMonitorStatus(now, {
      status: "success",
      completed_at: "2026-11-01T00:55:00Z",
      last_success_at: "2026-11-01T00:55:00Z",
    }).code,
    "healthy",
  );
  assert.equal(
    calculateMonitorStatus(now, {
      status: "success",
      completed_at: "2026-11-01T00:45:00Z",
      last_success_at: "2026-11-01T00:45:00Z",
    }).code,
    "delayed",
  );
  assert.equal(
    calculateMonitorStatus(now, {
      status: "failure",
      completed_at: "2026-11-01T00:59:00Z",
      last_success_at: "2026-11-01T00:58:00Z",
    }).code,
    "unhealthy",
  );
  assert.equal(calculateMonitorStatus(now, null).code, "unhealthy");
});
