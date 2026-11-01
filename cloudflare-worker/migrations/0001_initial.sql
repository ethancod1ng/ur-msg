CREATE TABLE IF NOT EXISTS vacancies (
  key TEXT PRIMARY KEY,
  building_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  building TEXT NOT NULL,
  city TEXT NOT NULL,
  room TEXT NOT NULL,
  rent_yen INTEGER NOT NULL CHECK (rent_yen >= 0),
  common_fee_yen INTEGER NOT NULL CHECK (common_fee_yen >= 0),
  monthly_total_yen INTEGER NOT NULL CHECK (monthly_total_yen >= 0),
  common_fee TEXT NOT NULL DEFAULT '',
  layout TEXT NOT NULL DEFAULT '',
  floor_space TEXT NOT NULL DEFAULT '',
  floor TEXT NOT NULL DEFAULT '',
  access TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  commute_station TEXT NOT NULL DEFAULT '',
  commute_minutes INTEGER,
  commute_train_minutes INTEGER,
  commute_access_minutes INTEGER,
  commute_transfers INTEGER,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_vacancies_active_total
  ON vacancies (is_active, monthly_total_yen);
CREATE INDEX IF NOT EXISTS idx_vacancies_first_seen
  ON vacancies (first_seen_at);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  vacancy_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  removed_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_completed
  ON monitor_runs (completed_at DESC);
