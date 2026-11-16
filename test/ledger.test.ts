import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { paths } from "../src/core/config.ts";
import { canonical, hashOf, ledgerHash, listRuns, loadLatest, recordRun, verifyRunHash } from "../src/core/ledger.ts";
import type { RunRecord } from "../src/core/types.ts";

function makeRecord(startedAt: string, passed: number): RunRecord {
  return {
    schema: 1,
    claimId: "claim-1",
    task: "тест",
    startedAt,
    finishedAt: startedAt,
    baseUrl: "http://127.0.0.1:3000",
    total: 2,
    passed,
    failed: 2 - passed,
    skipped: 0,
    requiredFailed: 2 - passed,
    criteria: [
      {
        criterionId: "a",
        text: "a",
        status: passed > 0 ? "pass" : "fail",
        durationMs: 1,
        detail: "",
        required: true,
        manual: false,
      },
      {
        criterionId: "b",
        text: "b",
        status: "fail",
        durationMs: 1,
        detail: "",
        required: true,
        manual: false,
      },
    ],
  };
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "witness-ledger-"));
}

test("canonical не зависит от порядка ключей", () => {
  assert.equal(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
  assert.equal(hashOf({ a: 1 }), hashOf({ a: 1 }));
  assert.notEqual(hashOf({ a: 1 }), hashOf({ a: 2 }));
});

test("recordRun пишет в SQLite и не перезаписывает прошлое", () => {
  const root = tempRoot();
  try {
    const first = recordRun(root, makeRecord("2026-11-16T10:00:00.000Z", 2));
    const second = recordRun(root, makeRecord("2026-11-16T11:00:00.000Z", 1));

    assert.equal(first.id, 1);
    assert.equal(second.id, 2);
    assert.notEqual(first.hash, second.hash);
    assert.ok(existsSync(join(paths(root).dir, "witness.db")));

    const latest = loadLatest(root);
    assert.equal(latest?.passed, 1);
    assert.equal(latest?.id, 2);
    assert.equal(verifyRunHash(latest!), true);

    // Прошлый прогон остался на месте и не изменился.
    const runs = listRuns(root);
    assert.equal(runs.length, 2);
    assert.equal(runs[0]?.passed, 2);
    assert.equal(runs[0]?.hash, first.hash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ledgerHash меняется при новом прогоне и стабилен при чтении", () => {
  const root = tempRoot();
  try {
    recordRun(root, makeRecord("2026-11-16T10:00:00.000Z", 2));
    const before = ledgerHash(root).hash;
    assert.equal(ledgerHash(root).hash, before);
    recordRun(root, makeRecord("2026-11-16T11:00:00.000Z", 1));
    assert.notEqual(ledgerHash(root).hash, before);
    assert.equal(ledgerHash(root).runs, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("чтение не создаёт базу, пока истории нет", () => {
  const root = tempRoot();
  try {
    assert.equal(loadLatest(root), null);
    assert.deepEqual(listRuns(root), []);
    assert.equal(ledgerHash(root).runs, 0);
    assert.equal(existsSync(join(paths(root).dir, "witness.db")), false);
    assert.equal(readdirSync(root).length, 0);
    assert.equal(paths(root).dir.endsWith(".witness"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("подделанный прогон не проходит проверку хеша", () => {
  const root = tempRoot();
  try {
    recordRun(root, makeRecord("2026-11-16T10:00:00.000Z", 0));
    const latest = loadLatest(root);
    assert.ok(latest);
    assert.equal(verifyRunHash({ ...latest!, passed: 2 }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("старые JSON-прогоны переносятся в базу один раз", () => {
  const root = tempRoot();
  try {
    const p = paths(root);
    mkdirSync(p.runs, { recursive: true });
    const older = makeRecord("2026-11-16T10:00:00.000Z", 2);
    const newer = makeRecord("2026-11-16T11:00:00.000Z", 1);
    writeFileSync(join(p.runs, "2026-11-16T10-00-00-000Z.json"), JSON.stringify({ ...older, hash: hashOf(older) }), "utf8");
    writeFileSync(join(p.runs, "2026-11-16T11-00-00-000Z.json"), JSON.stringify({ ...newer, hash: hashOf(newer) }), "utf8");

    // Чтение само подхватывает старую историю.
    const latest = loadLatest(root);
    assert.equal(latest?.passed, 1);

    const ledger = ledgerHash(root);
    assert.equal(ledger.runs, 2);
    assert.equal(ledger.hash, hashOf([hashOf(older), hashOf(newer)]));

    // Повторный запуск не дублирует записи.
    recordRun(root, makeRecord("2026-11-16T12:00:00.000Z", 0));
    assert.equal(ledgerHash(root).runs, 3);
    // JSON-файлы остаются архивом.
    assert.equal(readdirSync(p.runs).filter((name) => name.endsWith(".json")).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
