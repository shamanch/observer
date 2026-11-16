import assert from "node:assert/strict";
import test from "node:test";
import { badgeColor, badgeSvg, buildBadge, verifyBadge } from "../src/core/badge.ts";
import type { RunFile } from "../src/core/ledger.ts";

function run(passed: number, total: number): RunFile {
  return {
    schema: 1,
    claimId: "c",
    task: "t",
    startedAt: "2026-11-16T10:00:00.000Z",
    finishedAt: "2026-11-16T10:01:00.000Z",
    baseUrl: "http://127.0.0.1:1",
    total,
    passed,
    failed: total - passed,
    skipped: 0,
    requiredFailed: total - passed,
    criteria: [],
  };
}

test("цвет зависит от доли прошедших", () => {
  assert.equal(badgeColor(10, 10), "#1a7f37");
  assert.equal(badgeColor(19, 20), "#1a7f37");
  assert.equal(badgeColor(17, 20), "#9a6700");
  assert.equal(badgeColor(10, 20), "#cf222e");
  assert.equal(badgeColor(0, 0), "#6e7781");
});

test("SVG содержит label и message", () => {
  const svg = badgeSvg("witness", "3/4 passing", "#9a6700");
  assert.match(svg, /witness/);
  assert.match(svg, /3\/4 passing/);
  assert.match(svg, /#9a6700/);
  assert.match(svg, /<svg/);
});

test("buildBadge переносит хеш ledger", () => {
  const badge = buildBadge(run(3, 4), { hash: "abc123", runs: 2 });
  assert.equal(badge.message, "3/4 passing");
  assert.equal(badge.ledger, "abc123");
  assert.equal(badge.runs, 2);
});

test("ручные критерии не портят цвет badge", () => {
  const withManual: RunFile = { ...run(3, 4), skipped: 1 };
  const badge = buildBadge(withManual, { hash: "x", runs: 1 });
  assert.equal(badge.message, "3/3 passing");
  assert.equal(badge.color, "#1a7f37");
});

test("verifyBadge: ok при совпадении, mismatch при изменении", () => {
  const badge = buildBadge(run(1, 1), { hash: "same", runs: 1 });
  assert.equal(verifyBadge(badge, { hash: "same" }).ok, true);
  const mismatch = verifyBadge(badge, { hash: "other" });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason ?? "", /ledger изменился/);
});

test("verifyBadge отвергает badge без хеша", () => {
  const badge = { ...buildBadge(run(1, 1), { hash: "x", runs: 1 }), ledger: "" };
  assert.equal(verifyBadge(badge, { hash: "x" }).ok, false);
});