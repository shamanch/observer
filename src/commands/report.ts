import { writeFileSync } from "node:fs";
import { paths } from "../core/config.ts";
import { ledgerHash, loadLatest } from "../core/ledger.ts";
import { buildReport } from "../core/report.ts";
import { loadClaims } from "./run.ts";

/** `witness report` — самодостаточный HTML без сети. */
export async function report(root: string, flags: { open?: boolean }): Promise<number> {
  const p = paths(root);
  const run = loadLatest(root);
  if (!run) {
    console.error("Прогонов ещё не было. Запустите: witness run");
    return 1;
  }

  const claimData = loadClaims(root).claims.find((candidate) => candidate.id === run.claimId) ?? null;
  const ledger = ledgerHash(root);
  const html = buildReport({ run, claim: claimData, ledgerHash: ledger.hash });
  writeFileSync(p.report, html, "utf8");

  console.log(`Отчёт: ${p.report}`);
  console.log(`Критериев: ${run.total} · прошло ${run.passed} · упало ${run.failed} · ручных ${run.skipped}`);
  if (flags.open) console.log("Откройте файл в браузере: двойной клик по пути выше.");
  return 0;
}
