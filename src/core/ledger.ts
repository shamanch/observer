import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { paths } from "./config.ts";
import type { RunRecord } from "./types.ts";

/**
 * Ledger: append-only история прогонов в SQLite.
 * Используется встроенный `node:sqlite` — внешних зависимостей по-прежнему нет.
 */

/** Стабильная сериализация: одинаковый объект — одинаковый хеш. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

export function hashOf(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export type RunFile = RunRecord & { hash?: string; id?: number };

export type RecordedRun = { id: number; hash: string };

export type RunSummary = {
  id: number;
  claimId: string;
  task: string;
  startedAt: string;
  passed: number;
  total: number;
  hash: string;
};

const SCHEMA_VERSION = 1;
const DB_NAME = "witness.db";

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id TEXT NOT NULL,
  task TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  base_url TEXT NOT NULL,
  total INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  required_failed INTEGER NOT NULL,
  hash TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_started ON runs (started_at, id);
CREATE INDEX IF NOT EXISTS runs_claim ON runs (claim_id);
`;

function dbPath(root: string): string {
  return join(paths(root).dir, DB_NAME);
}

function insertStatement(db: DatabaseSync) {
  return db.prepare(
    `INSERT INTO runs
      (claim_id, task, started_at, finished_at, base_url, total, passed, failed, skipped, required_failed, hash, body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
}

function insertRun(db: DatabaseSync, record: RunRecord, hash: string): number {
  const info = insertStatement(db).run(
    record.claimId,
    record.task,
    record.startedAt,
    record.finishedAt,
    record.baseUrl,
    record.total,
    record.passed,
    record.failed,
    record.skipped,
    record.requiredFailed,
    hash,
    JSON.stringify(record),
  );
  return Number(info.lastInsertRowid);
}

function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}

/**
 * Однократно переносит историю из старых `.witness/runs/*.json` в базу.
 * Файлы не удаляются: это архив на случай, если базу придётся восстановить.
 */
function importLegacyJson(root: string, db: DatabaseSync): void {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'legacy_imported'").get();
  if (done) return;

  const dir = paths(root).runs;
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort() : [];
  if (files.length === 0) {
    setMeta(db, "legacy_imported", "empty");
    return;
  }

  db.exec("BEGIN");
  try {
    for (const name of files) {
      const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as RunFile;
      const { hash: stored, id: _id, ...body } = raw;
      const hash = stored ?? hashOf(body);
      insertRun(db, body, hash);
    }
    setMeta(db, "legacy_imported", new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function openWritable(root: string): DatabaseSync {
  const p = paths(root);
  mkdirSync(p.dir, { recursive: true });
  const db = new DatabaseSync(dbPath(root));
  db.exec(CREATE_SQL);
  const version = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | null;
  if (!version) setMeta(db, "schema", String(SCHEMA_VERSION));
  importLegacyJson(root, db);
  return db;
}

function legacyFiles(root: string): string[] {
  const dir = paths(root).runs;
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort() : [];
}

/** Чтение тоже должно уметь подхватить старую историю из JSON-файлов. */
function ensureMigrated(root: string): void {
  if (legacyFiles(root).length === 0) return;
  const migrated = withRead(root, false, (db) => {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'legacy_imported'").get();
    return row !== null;
  });
  if (migrated) return;
  const db = openWritable(root);
  db.close();
}

/** Чтение не создаёт файл базы: если истории нет — возвращается fallback. */
function withRead<T>(root: string, fallback: T, fn: (db: DatabaseSync) => T): T {
  const file = dbPath(root);
  if (!existsSync(file)) return fallback;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return fn(db);
  } catch {
    // База повреждена или создана другой версией — не падаем, просто нет данных.
    return fallback;
  } finally {
    db.close();
  }
}

/** Записывает прогон. Прошлые записи не меняются. */
export function recordRun(root: string, record: RunRecord): RecordedRun {
  const db = openWritable(root);
  try {
    const hash = hashOf(record);
    return { id: insertRun(db, record, hash), hash };
  } finally {
    db.close();
  }
}

/** Список прогонов в порядке добавления (для отчётов и диагностики). */
export function listRuns(root: string): RunSummary[] {
  ensureMigrated(root);
  return withRead<RunSummary[]>(root, [], (db) => {
    const rows = db
      .prepare("SELECT id, claim_id, task, started_at, passed, total, hash FROM runs ORDER BY id")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      claimId: String(row.claim_id),
      task: String(row.task),
      startedAt: String(row.started_at),
      passed: Number(row.passed),
      total: Number(row.total),
      hash: String(row.hash),
    }));
  });
}

export function loadLatest(root: string): RunFile | null {
  ensureMigrated(root);
  return withRead<RunFile | null>(root, null, (db) => {
    const row = db
      .prepare("SELECT id, hash, body FROM runs ORDER BY started_at DESC, id DESC LIMIT 1")
      .get() as Record<string, unknown> | null;
    if (!row) return null;
    const body = JSON.parse(String(row.body)) as RunRecord;
    return { ...body, hash: String(row.hash), id: Number(row.id) };
  });
}

/** Хеш всего ledger: SHA-256 от списка хешей прогонов. */
export function ledgerHash(root: string): { hash: string; runs: number } {
  ensureMigrated(root);
  return withRead<{ hash: string; runs: number }>(root, { hash: hashOf([]), runs: 0 }, (db) => {
    const rows = db.prepare("SELECT hash FROM runs ORDER BY id").all() as Array<{ hash: string }>;
    const hashes = rows.map((row) => String(row.hash));
    return { hash: hashOf(hashes), runs: hashes.length };
  });
}

/** Проверяет, что записанный хеш совпадает с содержимым прогона. */
export function verifyRunHash(run: RunFile): boolean {
  if (!run.hash) return false;
  const { hash, id: _id, ...rest } = run;
  return hashOf(rest) === hash;
}
