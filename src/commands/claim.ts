import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { paths, readConfig } from "../core/config.ts";
import { countHttp, makeClaimId, validateClaim, type Claim } from "../core/criteria.ts";
import { printCriteria } from "../core/format.ts";
import { generateCriteria, llmOptionsFromEnv } from "../core/llm.ts";

export type ClaimFlags = {
  yes?: boolean;
  dry?: boolean;
  noLlm?: boolean;
};

function uniqueClaimId(root: string, task: string): string {
  const p = paths(root);
  const base = makeClaimId(task);
  let id = base;
  let counter = 2;
  while (existsSync(join(p.claims, `${id}.json`))) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  return id;
}

/** `witness claim "<задача>"` — черновик критериев, утверждение человеком. */
export async function claim(root: string, task: string, flags: ClaimFlags): Promise<number> {
  const p = paths(root);
  const config = readConfig(root);
  if (!config) {
    console.error("witness не инициализирован. Запустите: witness init");
    return 1;
  }
  if (!task.trim()) {
    console.error('Нужна формулировка задачи: witness claim "добавить экспорт CSV"');
    return 1;
  }

  const llm = flags.noLlm ? null : llmOptionsFromEnv();
  const generated = await generateCriteria(task, llm);
  if (generated.warning) console.error(`внимание: ${generated.warning}`);

  const id = uniqueClaimId(root, task);
  const draft = validateClaim({
    id,
    task: task.trim(),
    createdAt: new Date().toISOString(),
    criteria: generated.criteria,
  });
  if (!draft.ok) {
    console.error("не удалось построить критерии:");
    for (const error of draft.errors) console.error(`  - ${error}`);
    return 1;
  }

  const claimData: Claim = draft.claim;
  const httpCount = countHttp(claimData.criteria);

  console.log(`\nЗадача: ${claimData.task}`);
  console.log(`Источник критериев: ${generated.source === "llm" ? "модель + валидация" : "шаблоны (без LLM)"}`);
  console.log(`Критерии (${claimData.criteria.length}), http-проверок: ${httpCount}\n`);
  printCriteria(claimData.criteria);
  if (httpCount === 0) {
    console.log("\n  внимание: все критерии ручные — автоматической проверки не будет.");
  }

  const target = join(p.claims, `${claimData.id}.json`);

  if (flags.dry) {
    console.log(`\n--dry-run: файл не записан. Был бы создан ${target}`);
    return 0;
  }

  if (!flags.yes) {
    if (!process.stdin.isTTY) {
      console.error("\nНет интерактивного ввода. Подтвердите явно: witness claim \"...\" --yes");
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("\nУтвердить критерии? [y] да / [e] сначала отредактирую / [n] отмена: "))
      .trim()
      .toLowerCase();
    rl.close();
    if (answer === "n" || answer === "no" || answer === "н") {
      console.log("Отменено, ничего не записано.");
      return 0;
    }
    if (answer === "e" || answer === "edit") {
      writeFileSync(target, `${JSON.stringify(claimData, null, 2)}\n`, "utf8");
      console.log(`\nЧерновик записан: ${target}`);
      console.log("Отредактируйте критерии и запустите: witness run");
      return 0;
    }
  }

  writeFileSync(target, `${JSON.stringify(claimData, null, 2)}\n`, "utf8");
  console.log(`\nУтверждено и записано: ${target}`);
  console.log("Теперь отдайте задачу агенту, затем: witness run");
  return 0;
}
