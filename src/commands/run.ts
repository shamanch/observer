import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths, readConfig } from "../core/config.ts";
import { validateClaim, type Claim } from "../core/criteria.ts";
import { baselineFrom, type BaselineFile } from "../core/differential.ts";
import { printRun } from "../core/format.ts";
import { ledgerHash, recordRun } from "../core/ledger.ts";
import { exitCodeFor, runClaim } from "../core/runner.ts";

export type RunFlags = {
  all?: boolean;
  claim?: string;
  baseUrl?: string;
  baseline?: boolean;
  tamper?: boolean;
  json?: boolean;
};

export function loadClaims(root: string): { claims: Claim[]; errors: string[] } {
  const dir = paths(root).claims;
  if (!existsSync(dir)) return { claims: [], errors: [] };
  const claims: Claim[] = [];
  const errors: string[] = [];

  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
      const result = validateClaim(parsed);
      if (result.ok) claims.push(result.claim);
      else errors.push(`${file}: ${result.errors.join("; ")}`);
    } catch (error) {
      errors.push(`${file}: ${(error as Error).message}`);
    }
  }
  return { claims, errors };
}

function loadBaseline(root: string): BaselineFile | null {
  const file = paths(root).baseline;
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as BaselineFile;
  } catch {
    return null;
  }
}

/** `witness run` — прогон критериев и запись в ledger. */
export async function run(root: string, flags: RunFlags): Promise<number> {
  const p = paths(root);
  const config = readConfig(root);
  if (!config) {
    console.error("witness не инициализирован. Запустите: witness init");
    return 1;
  }

  const loaded = loadClaims(root);
  for (const error of loaded.errors) console.error(`внимание: пропущен claim — ${error}`);
  if (loaded.claims.length === 0) {
    console.error('Критериев нет. Создайте их: witness claim "что должен сделать агент"');
    return 1;
  }

  let selected: Claim[];
  if (flags.claim) {
    selected = loaded.claims.filter(
      (candidate) => candidate.id === flags.claim || candidate.id.startsWith(flags.claim ?? ""),
    );
  } else if (flags.all) {
    selected = loaded.claims;
  } else {
    selected = [loaded.claims[loaded.claims.length - 1] as Claim];
  }

  if (selected.length === 0) {
    console.error(`claim не найден: ${flags.claim ?? ""}`);
    return 1;
  }

  const baseline = flags.baseline ? null : loadBaseline(root);
  const records = [];

  for (const claimData of selected) {
    const record = await runClaim(claimData, config, {
      scanTamper: flags.tamper !== false,
      baseline: baseline && baseline.claimId === claimData.id ? baseline : null,
      baseUrl: flags.baseUrl,
    });
    const saved = recordRun(root, record);
    records.push({ record, saved });
  }

  if (flags.baseline && records[0]) {
    const base = baselineFrom(records[0].record);
    writeFileSync(p.baseline, `${JSON.stringify(base, null, 2)}\n`, "utf8");
    if (!flags.json) {
      console.log(`База зафиксирована: ${p.baseline}`);
      console.log("Теперь отдайте задачу агенту и запустите witness run снова.\n");
    }
  }

  if (flags.json) {
    console.log(JSON.stringify(records.map((item) => item.record), null, 2));
  } else {
    for (const item of records) {
      printRun(item.record);
      console.log(`  ledger: #${item.saved.id} · ${item.saved.hash.slice(0, 16)}`);
    }
    const ledger = ledgerHash(root);
    console.log(`  всего прогонов в ledger: ${ledger.runs}`);
    console.log("  отчёт: witness report");
  }

  return records.some((item) => exitCodeFor(item.record) !== 0) ? 1 : 0;
}
