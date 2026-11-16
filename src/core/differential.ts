import type { CheckStatus, DifferentialReport, RunRecord } from "./types.ts";

/**
 * Differential: проверка обязана падать на базовой версии.
 * База фиксируется до работы агента (`witness run --baseline`), после — сравниваем.
 */

export type BaselineFile = {
  schema: 1;
  claimId: string;
  createdAt: string;
  results: Record<string, CheckStatus>;
};

export function baselineFrom(record: RunRecord): BaselineFile {
  const results: Record<string, CheckStatus> = {};
  for (const criterion of record.criteria) results[criterion.criterionId] = criterion.status;
  return {
    schema: 1,
    claimId: record.claimId,
    createdAt: record.finishedAt,
    results,
  };
}

export function compareToBaseline(record: RunRecord, baseline: BaselineFile): DifferentialReport {
  const tautologies: string[] = [];
  const regressions: string[] = [];
  let compared = 0;

  for (const criterion of record.criteria) {
    const before = baseline.results[criterion.criterionId];
    if (before === undefined) continue;
    compared += 1;
    // Зелёный до фикса и после — значит проверка не различает состояния.
    if (before === "pass" && criterion.status === "pass") tautologies.push(criterion.criterionId);
    // Проходил раньше, падает сейчас — регрессия, а не «новая фича».
    if (before === "pass" && criterion.status !== "pass") regressions.push(criterion.criterionId);
  }

  return { baselineAt: baseline.createdAt, compared, tautologies, regressions };
}
