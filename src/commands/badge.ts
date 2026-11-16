import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { badgeSvg, buildBadge, verifyBadge, type BadgeFile } from "../core/badge.ts";
import { paths } from "../core/config.ts";
import { ledgerHash, loadLatest } from "../core/ledger.ts";

/** `witness badge` — публичный сертификат проверки для README. */
export async function badge(root: string, flags: { verify?: boolean }): Promise<number> {
  const p = paths(root);
  const ledger = ledgerHash(root);

  if (flags.verify) {
    if (!existsSync(p.badgeJson)) {
      console.error("badge.json не найден. Сначала запустите: witness badge");
      return 1;
    }
    const stored = JSON.parse(readFileSync(p.badgeJson, "utf8")) as BadgeFile;
    const result = verifyBadge(stored, ledger);
    if (result.ok) {
      console.log(`badge: ok · ledger ${ledger.hash.slice(0, 16)} · прогонов ${ledger.runs}`);
      return 0;
    }
    console.error(`badge: mismatch · ${result.reason}`);
    return 1;
  }

  const run = loadLatest(root);
  if (!run) {
    console.error("Прогонов ещё не было. Запустите: witness run");
    return 1;
  }

  const data = buildBadge(run, ledger);
  writeFileSync(p.badgeSvg, badgeSvg(data.label, data.message, data.color), "utf8");
  writeFileSync(p.badgeJson, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  console.log(`badge: ${p.badgeSvg}`);
  console.log(`данные: ${p.badgeJson} · ${data.message} · ledger ${ledger.hash.slice(0, 16)}`);
  console.log("");
  console.log("В README:");
  console.log("  ![witness](.witness/badge.svg)");
  return 0;
}
