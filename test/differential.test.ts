import assert from "node:assert/strict";
import test from "node:test";
import { baselineFrom, compareToBaseline } from "../src/core/differential.ts";
import type { CheckStatus, RunRecord } from "../src/core/types.ts";

function record(statuses: Record<string, CheckStatus>): RunRecord {
  const criteria = Object.entries(statuses).map(([id, status]) => ({
    criterionId: id,
    text: id,
    status,
    durationMs: 1,
    detail: "",
    required: true,
    manual: false,
  }));
  return {
    schema: 1,
    claimId: "c",
    task: "t",
    startedAt: "2026-11-16T10:00:00.000Z",
    finishedAt: "2026-11-16T10:01:00.000Z",
    baseUrl: "http://127.0.0.1:1",
    total: criteria.length,
    passed: criteria.filter((c) => c.status === "pass").length,
    failed: 0,
    skipped: 0,
    requiredFailed: 0,
    criteria,
  };
}

test("baselineFrom фиксирует статусы", () => {
  const base = baselineFrom(record({ a: "fail", b: "pass" }));
  assert.deepEqual(base.results, { a: "fail", b: "pass" });
  assert.equal(base.claimId, "c");
});

test("критерий, зелёный и до, и после — тавтология", () => {
  const base = baselineFrom(record({ a: "fail", b: "pass" }));
  const report = compareToBaseline(record({ a: "pass", b: "pass" }), base);
  assert.deepEqual(report.tautologies, ["b"]);
  assert.deepEqual(report.regressions, []);
  assert.equal(report.compared, 2);
});

test("падение того, что раньше проходило — регрессия", () => {
  const base = baselineFrom(record({ a: "pass" }));
  const report = compareToBaseline(record({ a: "fail" }), base);
  assert.deepEqual(report.regressions, ["a"]);
  assert.deepEqual(report.tautologies, []);
});

test("новый критерий не считается тавтологией", () => {
  const base = baselineFrom(record({ a: "fail" }));
  const report = compareToBaseline(record({ a: "pass", fresh: "pass" }), base);
  assert.deepEqual(report.tautologies, []);
  assert.equal(report.compared, 1);
});
