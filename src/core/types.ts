/** Общие типы результата прогона. */

export type CheckStatus = "pass" | "fail" | "skip" | "error";

export type CheckResult = {
  criterionId: string;
  text: string;
  status: CheckStatus;
  durationMs: number;
  detail: string;
  required: boolean;
  /** true для критериев, которые проверяет человек. */
  manual: boolean;
};

export type TamperSeverity = "high" | "medium";

export type TamperFinding = {
  rule: string;
  severity: TamperSeverity;
  file: string;
  line: string;
  message: string;
};

export type TamperReport = {
  available: boolean;
  reason?: string;
  findings: TamperFinding[];
};

export type DifferentialReport = {
  baselineAt: string;
  compared: number;
  /** Критерии, зелёные и на базе, и сейчас: проверка ничего не доказывает. */
  tautologies: string[];
  /** Критерии, которые раньше проходили, а теперь падают. */
  regressions: string[];
};

export type RunRecord = {
  schema: 1;
  claimId: string;
  task: string;
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  requiredFailed: number;
  criteria: CheckResult[];
  tamper?: TamperReport;
  differential?: DifferentialReport;
};
