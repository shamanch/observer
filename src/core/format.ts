import type { Criterion } from "./criteria.ts";
import type { CheckResult, RunRecord } from "./types.ts";

/** Текстовый вывод в терминал: компактно и без цвета, чтобы читалось в CI. */

const ICON: Record<CheckResult["status"], string> = {
  pass: "✓",
  fail: "✗",
  skip: "·",
  error: "!",
};

export function describeCheck(criterion: Criterion): string {
  if (criterion.check.type === "manual") return "manual";
  if (criterion.check.type === "browser") return `browser ${criterion.check.path}`;
  return `${criterion.check.method} ${criterion.check.path}`;
}

export function printCriteria(criteria: Criterion[]): void {
  criteria.forEach((criterion, index) => {
    const mark = criterion.required ? "" : " (необязательный)";
    console.log(`  ${index + 1}. ${criterion.text}${mark}`);
    console.log(`     ${describeCheck(criterion)}`);
  });
}

export function printRun(record: RunRecord): void {
  console.log(`\n${record.task}`);
  console.log(`claim: ${record.claimId} · база: ${record.baseUrl}\n`);
  record.criteria.forEach((item, index) => {
    const mark = item.required ? "" : " (необязательный)";
    console.log(`  ${ICON[item.status]} ${index + 1}. ${item.text}${mark}  [${item.durationMs} мс]`);
    if (item.status !== "pass") console.log(`      ${item.detail}`);
  });

  if (record.tamper) {
    if (!record.tamper.available) {
      console.log(`\n  anti-tamper: ${record.tamper.reason ?? "нет данных"}`);
    } else if (record.tamper.findings.length > 0) {
      console.log("\n  anti-tamper: найдено подозрительное");
      for (const finding of record.tamper.findings) {
        console.log(`    ${finding.severity === "high" ? "КРИТИЧНО" : "внимание"} ${finding.file}: ${finding.message}`);
      }
    } else {
      console.log("\n  anti-tamper: чисто");
    }
  }

  if (record.differential) {
    const { tautologies, regressions, compared } = record.differential;
    console.log(`\n  differential: сравнено ${compared}`);
    if (tautologies.length > 0) console.log(`    тавтологии (зелёные и до фикса): ${tautologies.join(", ")}`);
    if (regressions.length > 0) console.log(`    регрессии: ${regressions.join(", ")}`);
    if (tautologies.length === 0 && regressions.length === 0) console.log("    проверки различают состояния");
  }

  const verdict = record.requiredFailed === 0 ? "ПРОШЛО" : "НЕ ПРОШЛО";
  console.log(`\n  Итог: ${verdict} · ${record.passed}/${record.total} прошло, ${record.failed} упало, ${record.skipped} ручных\n`);
}
