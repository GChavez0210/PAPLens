const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const MIGRATION_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
const MIGRATION_COLUMN_TYPES = /^(REAL|INTEGER|TEXT)$/;

function validateMigrationIdentifier(table, column, type) {
  if (
    !MIGRATION_IDENTIFIER.test(table) ||
    !MIGRATION_IDENTIFIER.test(column) ||
    !MIGRATION_COLUMN_TYPES.test(type)
  ) {
    throw new Error("Invalid migration identifier");
  }
}

class AppDatabase {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    const dataPath = path.join(userDataPath, "data");
    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }

    this.dbPath = path.join(dataPath, "app_meta.db");
    this.db = new Database(this.dbPath);
    this.db.pragma('foreign_keys = ON');
    // WAL keeps readers unblocked during imports; NORMAL sync is durable enough
    // for WAL mode and roughly halves bulk-insert time on spinning disks.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        encrypted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        age INTEGER,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  saveSetting(key, value, encrypted = 0) {
    const stmt = this.db.prepare(`
      INSERT INTO global_settings(key, value, encrypted, updated_at)
      VALUES(@key, @value, @encrypted, @updated_at)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        encrypted=excluded.encrypted,
        updated_at=excluded.updated_at
    `);
    stmt.run({
      key,
      value: String(value),
      encrypted,
      updated_at: new Date().toISOString()
    });
  }

  getSetting(key) {
    return this.db.prepare("SELECT key, value, encrypted FROM global_settings WHERE key = ?").get(key);
  }

  // Profiles
  getProfiles() {
    return this.db.prepare("SELECT * FROM profiles ORDER BY created_at DESC").all();
  }

  getProfile(id) {
    return this.db.prepare("SELECT * FROM profiles WHERE id = ?").get(id);
  }

  createProfile(id, name, age, notes) {
    const stmt = this.db.prepare(`
      INSERT INTO profiles(id, name, age, notes)
      VALUES(@id, @name, @age, @notes)
    `);
    stmt.run({ id, name, age: age || null, notes: notes || null });
  }

  deleteProfile(id) {
    this.db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

class ProfileDatabase {
  constructor(userDataPath, profileId) {
    if (!profileId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId)) {
      throw new Error(`Invalid profileId: "${profileId}"`);
    }
    const profilesPath = path.join(userDataPath, "data", "profiles", profileId);
    if (!fs.existsSync(profilesPath)) {
      fs.mkdirSync(profilesPath, { recursive: true });
    }

    this.profileId = profileId;
    this.profilePath = profilesPath;
    this.dbPath = path.join(profilesPath, "paplens.db");
    this.db = new Database(this.dbPath);
    this.db.pragma('foreign_keys = ON');
    // WAL keeps readers unblocked during imports; NORMAL sync is durable enough
    // for WAL mode. Profile deletion removes the whole profile directory, so the
    // -wal/-shm sidecar files are cleaned up with the database.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.init();
  }

  init() {
    const ddl = `
      CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          manufacturer TEXT NOT NULL,
          model TEXT NOT NULL,
          serial_number TEXT NOT NULL,
          firmware TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial_number);

      CREATE TABLE IF NOT EXISTS nights (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          night_date TEXT NOT NULL,
          start_ts TEXT,
          end_ts TEXT,
          usage_hours REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_nights_device_date ON nights(device_id, night_date);
      CREATE INDEX IF NOT EXISTS idx_nights_device_date_desc ON nights(device_id, night_date DESC);

      CREATE TABLE IF NOT EXISTS night_metrics (
          night_id TEXT PRIMARY KEY,
          ahi_total REAL,
          apneas_per_hr REAL,
          hypopneas_per_hr REAL,
          obstructive_apneas_per_hr REAL,
          central_apneas_per_hr REAL,
          unclassified_apneas_per_hr REAL,
          pressure_median REAL,
          pressure_p95 REAL,
          leak_p50 REAL,
          leak_p95 REAL,
          minute_vent_p50 REAL,
          minute_vent_p95 REAL,
          resp_rate_p50 REAL,
          resp_rate_p95 REAL,
          flow_limitation_p95 REAL,
          event_cluster_index_source REAL,
          tidal_vol_p50 REAL,
          tidal_vol_p95 REAL,
          duration_minutes REAL,
          on_duration_minutes REAL,
          patient_hours_cumulative REAL,
          spo2_avg REAL,
          pulse_avg REAL,
          data_quality TEXT,
          FOREIGN KEY(night_id) REFERENCES nights(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_night_metrics_night_id ON night_metrics(night_id);

      CREATE TABLE IF NOT EXISTS derived_metrics (
          night_id TEXT PRIMARY KEY,
          stability_score REAL,
          mask_fit_score REAL,
          ventilation_stability_score REAL,
          compliance_risk TEXT,
          pressure_responsiveness REAL,
          residual_burden TEXT,
          outliers TEXT,
          z_scores TEXT,
          computed_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(night_id) REFERENCES nights(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_derived_computed_at ON derived_metrics(computed_at);

      CREATE TABLE IF NOT EXISTS correlations (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          window_days INTEGER NOT NULL,
          results TEXT NOT NULL,
          computed_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_correlations_device_time ON correlations(device_id, computed_at DESC);

      CREATE TABLE IF NOT EXISTS insights_explanations (
          id TEXT PRIMARY KEY,
          night_id TEXT NOT NULL,
          key TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          details TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(night_id) REFERENCES nights(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_explanations_night_key ON insights_explanations(night_id, key);

      CREATE TABLE IF NOT EXISTS import_log (
          id TEXT PRIMARY KEY,
          device_id TEXT,
          folder_path TEXT,
          nights_inserted INTEGER,
          nights_updated INTEGER,
          import_timestamp TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS datalog_folder_mtimes (
          folder_path TEXT NOT NULL,
          date_dir   TEXT NOT NULL,
          mtime_ms   INTEGER NOT NULL,
          PRIMARY KEY (folder_path, date_dir)
      );

      CREATE TABLE IF NOT EXISTS import_file_cache (
          folder_path TEXT NOT NULL,
          cache_key   TEXT NOT NULL,
          value       TEXT NOT NULL,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (folder_path, cache_key)
      );
    `;
    this.db.exec(ddl);

    // Apply migrations for Phase 9 clinical additions securely
    const addColumnIfNotExists = (table, column, type) => {
      try {
        validateMigrationIdentifier(table, column, type);
        const info = this.db.pragma(`table_info(${table})`);
        const hasColumn = info.some(col => col.name === column);
        if (!hasColumn) {
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        }
      } catch (err) {
        console.error(`Migration error for ${table}.${column}:`, err);
      }
    };

    addColumnIfNotExists('derived_metrics', 'therapy_stability_score', 'REAL');
    addColumnIfNotExists('derived_metrics', 'leak_severity_tier', 'INTEGER');
    addColumnIfNotExists('derived_metrics', 'leak_consistency_index', 'REAL');
    addColumnIfNotExists('derived_metrics', 'pressure_variance', 'REAL');
    addColumnIfNotExists('derived_metrics', 'flow_limitation_score', 'REAL');
    addColumnIfNotExists('derived_metrics', 'event_cluster_index', 'REAL');
    addColumnIfNotExists('night_metrics', 'obstructive_apneas_per_hr', 'REAL');
    addColumnIfNotExists('night_metrics', 'central_apneas_per_hr', 'REAL');
    addColumnIfNotExists('night_metrics', 'unclassified_apneas_per_hr', 'REAL');
    addColumnIfNotExists('night_metrics', 'duration_minutes', 'REAL');
    addColumnIfNotExists('night_metrics', 'on_duration_minutes', 'REAL');
    addColumnIfNotExists('night_metrics', 'patient_hours_cumulative', 'REAL');
    addColumnIfNotExists('night_metrics', 'spo2_avg', 'REAL');
    addColumnIfNotExists('night_metrics', 'pulse_avg', 'REAL');
    addColumnIfNotExists('night_metrics', 'flow_limitation_p95', 'REAL');
    addColumnIfNotExists('night_metrics', 'event_cluster_index_source', 'REAL');
    // Phase 10: richer clinical metrics
    addColumnIfNotExists('night_metrics', 'rin_per_hr', 'REAL');
    addColumnIfNotExists('night_metrics', 'csr_per_hr', 'REAL');
    addColumnIfNotExists('night_metrics', 'snore_index', 'REAL');
    addColumnIfNotExists('night_metrics', 'leak_spike_count', 'INTEGER');
    addColumnIfNotExists('night_metrics', 'pressure_histogram', 'TEXT');
    addColumnIfNotExists('night_metrics', 'pressure_efficiency', 'REAL');
    // Periodic breathing detection
    addColumnIfNotExists('night_metrics', 'pb_episode_count', 'INTEGER');
    addColumnIfNotExists('night_metrics', 'pb_total_seconds', 'REAL');
    addColumnIfNotExists('night_metrics', 'pb_pct', 'REAL');
    addColumnIfNotExists('night_metrics', 'pb_avg_cycle_sec', 'REAL');
    addColumnIfNotExists('night_metrics', 'pb_is_significant', 'INTEGER');
    addColumnIfNotExists('night_metrics', 'pb_leak_confounded', 'INTEGER');
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = { AppDatabase, ProfileDatabase, validateMigrationIdentifier };
