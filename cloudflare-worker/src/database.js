const MAX_VACANCIES = 1000;
const REQUIRED_VACANCY_FIELDS = [
  "key",
  "building_id",
  "room_id",
  "building",
  "city",
  "room",
  "rent_yen",
  "url",
];

export class SnapshotValidationError extends Error {}

function invalid(message) {
  throw new SnapshotValidationError(message);
}

export function parseYen(value) {
  const match = String(value || "").match(/[\d,]+/);
  return match ? Number(match[0].replaceAll(",", "")) : 0;
}

function validIsoDate(value) {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function normalizedVacancy(item) {
  for (const field of REQUIRED_VACANCY_FIELDS) {
    if (item?.[field] === undefined || item[field] === null || item[field] === "") {
      invalid(`Vacancy field ${field} is required`);
    }
  }
  if (!String(item.url).startsWith("https://www.ur-net.go.jp/")) {
    invalid("Vacancy URL must be an official UR URL");
  }
  const rentYen = Number(item.rent_yen);
  const commonFeeYen = Number.isFinite(Number(item.common_fee_yen))
    ? Number(item.common_fee_yen)
    : parseYen(item.common_fee);
  if (!Number.isSafeInteger(rentYen) || rentYen < 0 || rentYen > 10_000_000) {
    invalid("Vacancy rent_yen is invalid");
  }
  if (!Number.isSafeInteger(commonFeeYen) || commonFeeYen < 0 || commonFeeYen > 1_000_000) {
    invalid("Vacancy common fee is invalid");
  }
  return {
    ...item,
    rent_yen: rentYen,
    common_fee_yen: commonFeeYen,
    monthly_total_yen: rentYen + commonFeeYen,
  };
}

export function normalizeSnapshot(payload) {
  if (!payload || typeof payload !== "object") invalid("Snapshot body is required");
  if (!payload.snapshot_id || String(payload.snapshot_id).length > 160) {
    invalid("snapshot_id is required");
  }
  if (!validIsoDate(payload.started_at) || !validIsoDate(payload.completed_at)) {
    invalid("Snapshot timestamps are invalid");
  }
  if (!['success', 'failure'].includes(payload.status)) {
    invalid("Snapshot status is invalid");
  }
  const vacancies = payload.vacancies ?? [];
  if (!Array.isArray(vacancies) || vacancies.length > MAX_VACANCIES) {
    invalid("Snapshot vacancies are invalid");
  }
  if (payload.status === "success" && payload.vacancies === undefined) {
    invalid("Successful snapshot vacancies are required");
  }
  return {
    snapshot_id: String(payload.snapshot_id),
    started_at: new Date(payload.started_at).toISOString(),
    completed_at: new Date(payload.completed_at).toISOString(),
    status: payload.status,
    error_summary: payload.error_summary ? String(payload.error_summary).slice(0, 500) : null,
    vacancies: payload.status === "success" ? vacancies.map(normalizedVacancy) : [],
  };
}

export function calculateMonitorStatus(now, latest) {
  if (!latest?.last_success_at) {
    return { code: "unhealthy", label: "监控异常", message: "尚未收到成功检查结果。" };
  }
  if (latest.status === "failure") {
    return { code: "unhealthy", label: "监控异常", message: "最近一次检查失败，正在保留上次成功数据。" };
  }
  const ageMinutes = (now.getTime() - Date.parse(latest.last_success_at)) / 60000;
  if (ageMinutes <= 10) {
    return { code: "healthy", label: "运行正常", message: "监控正在按计划检查。" };
  }
  if (ageMinutes <= 30) {
    return { code: "delayed", label: "可能延迟", message: "最近检查有所延迟。" };
  }
  return { code: "unhealthy", label: "监控异常", message: "超过 30 分钟未收到成功检查结果。" };
}

const UPSERT_VACANCY_SQL = `
  INSERT INTO vacancies (
    key, building_id, room_id, building, city, room,
    rent_yen, common_fee_yen, monthly_total_yen, common_fee,
    layout, floor_space, floor, access, url,
    commute_station, commute_minutes, commute_train_minutes,
    commute_access_minutes, commute_transfers,
    first_seen_at, last_seen_at, is_active
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(key) DO UPDATE SET
    building_id=excluded.building_id, room_id=excluded.room_id,
    building=excluded.building, city=excluded.city, room=excluded.room,
    rent_yen=excluded.rent_yen, common_fee_yen=excluded.common_fee_yen,
    monthly_total_yen=excluded.monthly_total_yen, common_fee=excluded.common_fee,
    layout=excluded.layout, floor_space=excluded.floor_space, floor=excluded.floor,
    access=excluded.access, url=excluded.url,
    commute_station=excluded.commute_station, commute_minutes=excluded.commute_minutes,
    commute_train_minutes=excluded.commute_train_minutes,
    commute_access_minutes=excluded.commute_access_minutes,
    commute_transfers=excluded.commute_transfers,
    last_seen_at=excluded.last_seen_at, is_active=1
`;

function vacancyBindings(item, timestamp) {
  return [
    item.key, item.building_id, item.room_id, item.building, item.city, item.room,
    item.rent_yen, item.common_fee_yen, item.monthly_total_yen, item.common_fee || "",
    item.layout || "", item.floor_space || "", item.floor || "", item.access || "", item.url,
    item.commute_station || "", item.commute_minutes ?? null,
    item.commute_train_minutes ?? null, item.commute_access_minutes ?? null,
    item.commute_transfers ?? null, timestamp, timestamp,
  ];
}

export async function writeSnapshot(db, rawPayload) {
  const snapshot = normalizeSnapshot(rawPayload);
  const duplicate = await db
    .prepare("SELECT id, new_count, removed_count FROM monitor_runs WHERE snapshot_id = ?")
    .bind(snapshot.snapshot_id)
    .first();
  if (duplicate) return { duplicate: true, new_count: duplicate.new_count, removed_count: duplicate.removed_count };

  if (snapshot.status === "failure") {
    await db.prepare(`
      INSERT INTO monitor_runs
        (snapshot_id, started_at, completed_at, status, vacancy_count, new_count, removed_count, error_summary)
      VALUES (?, ?, ?, 'failure', 0, 0, 0, ?)
    `).bind(snapshot.snapshot_id, snapshot.started_at, snapshot.completed_at, snapshot.error_summary).run();
    return { duplicate: false, new_count: 0, removed_count: 0 };
  }

  const [knownResult, activeResult] = await Promise.all([
    db.prepare("SELECT key FROM vacancies").all(),
    db.prepare("SELECT key FROM vacancies WHERE is_active = 1").all(),
  ]);
  const known = new Set((knownResult.results || []).map((row) => row.key));
  const active = new Set((activeResult.results || []).map((row) => row.key));
  const current = new Set(snapshot.vacancies.map((item) => item.key));
  const newCount = snapshot.vacancies.filter((item) => !known.has(item.key)).length;
  const removedCount = [...active].filter((key) => !current.has(key)).length;

  const statements = [
    db.prepare(`
      INSERT INTO monitor_runs
        (snapshot_id, started_at, completed_at, status, vacancy_count, new_count, removed_count, error_summary)
      VALUES (?, ?, ?, 'success', ?, ?, ?, NULL)
    `).bind(
      snapshot.snapshot_id,
      snapshot.started_at,
      snapshot.completed_at,
      snapshot.vacancies.length,
      newCount,
      removedCount,
    ),
    db.prepare("UPDATE vacancies SET is_active = 0 WHERE is_active = 1"),
    ...snapshot.vacancies.map((item) =>
      db.prepare(UPSERT_VACANCY_SQL).bind(...vacancyBindings(item, snapshot.completed_at))),
  ];
  await db.batch(statements);
  return { duplicate: false, new_count: newCount, removed_count: removedCount };
}

export async function getDashboard(db, now = new Date()) {
  const [latest, vacanciesResult] = await Promise.all([
    db.prepare(`
      SELECT mr.*,
        (SELECT completed_at FROM monitor_runs WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1)
          AS last_success_at
      FROM monitor_runs mr ORDER BY completed_at DESC LIMIT 1
    `).first(),
    db.prepare(`
      SELECT * FROM vacancies WHERE is_active = 1
      ORDER BY (first_seen_at >= datetime('now', '-24 hours')) DESC, monthly_total_yen ASC
    `).all(),
  ]);
  const vacancies = vacanciesResult.results || [];
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  return {
    monitor: {
      ...calculateMonitorStatus(now, latest),
      last_success_at: latest?.last_success_at || null,
      last_run_at: latest?.completed_at || null,
    },
    stats: {
      vacancy_count: vacancies.length,
      new_count_24h: vacancies.filter((item) => Date.parse(item.first_seen_at) >= dayAgo).length,
    },
    filters: {
      cities: [...new Set(vacancies.map((item) => item.city).filter(Boolean))].sort(),
      layouts: [...new Set(vacancies.map((item) => item.layout).filter(Boolean))].sort(),
    },
    vacancies,
    synchronized_at: now.toISOString(),
  };
}
