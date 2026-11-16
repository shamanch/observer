import assert from "node:assert/strict";
import test from "node:test";
import { buildReport } from "../src/core/report.ts";
import type { RunFile } from "../src/core/ledger.ts";

const run: RunFile = {
  schema: 1,
  claimId: "2026-11-16-test",
  task: "Экспорт отчёта в CSV",
  startedAt: "2026-11-16T10:00:00.000Z",
  finishedAt: "2026-11-16T10:01:00.000Z",
  baseUrl: "http://127.0.0.1:3000",
  total: 3,
  passed: 2,
  failed: 1,
  skipped: 0,
  requiredFailed: 1,
  criteria: [
    {
      criterionId: "route",
      text: "Маршрут /reports отвечает 200",
      status: "pass",
      durationMs: 12,
      detail: "статус 200",
      required: true,
      manual: false,
    },
    {
      criterionId: "csv",
      text: "Файл содержит заголовки",
      status: "fail",
      durationMs: 20,
      detail: "в теле нет «id,name»",
      required: true,
      manual: false,
    },
    {
      criterionId: "manual",
      text: "Кнопка работает",
      status: "skip",
      durationMs: 0,
      detail: "ручная проверка",
      required: false,
      manual: true,
    },
  ],
  tamper: { available: true, findings: [] },
  differential: { baselineAt: "2026-11-16T09:00:00.000Z", compared: 3, tautologies: ["route"], regressions: [] },
};

test("отчёт самодостаточен: без внешних ссылок", () => {
  const html = buildReport({ run, claim: null, ledgerHash: "abc" });
  assert.equal(/https?:\/\//i.test(html), false);
  assert.equal(/<link|src="http|<script src/i.test(html), false);
});

test("отчёт показывает вердикт, критерии и тавтологии", () => {
  const html = buildReport({ run, claim: null, ledgerHash: "abc" });
  assert.match(html, /НЕ ПРОШЛО/);
  assert.match(html, /Экспорт отчёта в CSV/);
  assert.match(html, /Маршрут \/reports отвечает 200/);
  assert.match(html, /Тавтологии/);
  assert.match(html, /route/);
  assert.match(html, /anti-tamper/i);
});

test("отчёт экранирует HTML из задачи", () => {
  const risky: RunFile = { ...run, task: '<img src=x onerror="alert(1)">' };
  const html = buildReport({ run: risky, claim: null });
  assert.equal(html.includes("<img src=x"), false);
  assert.match(html, /&lt;img/);
});

test("без differential отчёт честно говорит, что базы нет", () => {
  const noDiff = { ...run, differential: undefined };
  const html = buildReport({ run: noDiff, claim: null });
  assert.match(html, /База не зафиксирована/);
});

test("без машинных проверок отчёт говорит «НЕ ПРОВЕРЕНО»", () => {
  const manualOnly: RunFile = {
    ...run,
    total: 2,
    passed: 0,
    failed: 0,
    skipped: 2,
    requiredFailed: 0,
    criteria: run.criteria.map((item) => ({ ...item, status: "skip", manual: true, required: true })),
  };
  const html = buildReport({ run: manualOnly, claim: null });
  assert.match(html, /НЕ ПРОВЕРЕНО/);
  assert.match(html, /verdict skip/);
});
