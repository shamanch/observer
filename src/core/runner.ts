import type { WitnessConfig } from "./config.ts";
import type { Claim } from "./criteria.ts";
import { compareToBaseline, type BaselineFile } from "./differential.ts";
import { runHttpCheck } from "./http.ts";
import { scanRepo } from "./tamper.ts";
import type { CheckResult, RunRecord } from "./types.ts";

export type RunOptions = {
  scanTamper?: boolean;
  baseline?: BaselineFile | null;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

/** Прогоняет все критерии последовательно. Исключения наружу не выходят. */
export async function runClaim(claim: Claim, config: WitnessConfig, options: RunOptions = {}): Promise<RunRecord> {
  const startedAt = new Date().toISOString();
  const criteria: CheckResult[] = [];

  for (const criterion of claim.criteria) {
    criteria.push(
      await runHttpCheck(criterion, {
        config,
        baseUrl: options.baseUrl,
        fetchImpl: options.fetchImpl,
      }),
    );
  }

  const passed = criteria.filter((item) => item.status === "pass").length;
  const failed = criteria.filter((item) => item.status === "fail" || item.status === "error").length;
  const skipped = criteria.filter((item) => item.status === "skip").length;
  const requiredFailed = criteria.filter(
    (item) => item.required && item.status !== "pass" && item.status !== "skip",
  ).length;

  const record: RunRecord = {
    schema: 1,
    claimId: claim.id,
    task: claim.task,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: options.baseUrl ?? config.baseUrl,
    total: criteria.length,
    passed,
    failed,
    skipped,
    requiredFailed,
    criteria,
  };

  if (options.baseline) record.differential = compareToBaseline(record, options.baseline);
  if (options.scanTamper) record.tamper = scanRepo(process.cwd());

  return record;
}

/** Exit-код: 0 только если все обязательные критерии прошли. */
export function exitCodeFor(record: RunRecord): number {
  return record.requiredFailed === 0 ? 0 : 1;
}
