// Golden-набор Witness: 20 задач, два состояния приложения, честные метрики.
//
// Для каждого кейса:
//   1. init + claim --yes --no-llm (одинаковые критерии на одинаковый ввод)
//   2. run --baseline против broken  — что witness скажет о версии без фичи
//   3. run против fixed              — что witness скажет о версии с фичей
//
// Главная метрика — false-green: broken-версия не должна получать «прошло».
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CLI = join(REPO, "bin", "witness.js");
const WORK = join(HERE, ".work");
const REPORT = join(HERE, "last-report.json");

const BROKEN_PORT = 3911;
const FIXED_PORT = 3912;
const BROKEN = `http://127.0.0.1:${BROKEN_PORT}`;
const FIXED = `http://127.0.0.1:${FIXED_PORT}`;

const cases = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));

function startServer(state, port) {
  const child = spawn(process.execPath, [join(HERE, "server.mjs")], {
    env: { ...process.env, GOLDEN_STATE: state, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const ready = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      rejectReady(new Error(`сервер ${state} не стартовал за 10 с\n${stderr}`));
    }, 10_000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("golden server")) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      rejectReady(new Error(`сервер ${state} завершился с кодом ${code}\n${stderr}`));
    });
  });

  return { child, ready, stderr: () => stderr };
}

function stopServer(server) {
  if (!server) return;
  server.child.kill();
}

/** Запускает CLI в папке кейса. Возвращает код, stdout и stderr. */
function runCli(args, cwd, timeoutMs = 30_000) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WITNESS_LLM_KEY: "", WITNESS_LLM_URL: "", WITNESS_LLM_MODEL: "" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      stderr += `\nтаймаут ${timeoutMs} мс`;
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** `run --json` печатает массив. На всякий случай умеем вырезать его из текста. */
function parseRuns(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function summary(record) {
  if (!record) return null;
  return {
    claimId: record.claimId,
    passed: record.passed,
    failed: record.failed,
    skipped: record.skipped,
    total: record.total,
    criteria: record.criteria.map((item) => ({
      id: item.criterionId,
      status: item.status,
      text: item.text,
      detail: item.detail,
      manual: item.manual,
    })),
    tautologies: record.differential?.tautologies ?? [],
    regressions: record.differential?.regressions ?? [],
  };
}

function pad(text, width) {
  return String(text).padEnd(width, " ");
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const brokenServer = startServer("broken", BROKEN_PORT);
  const fixedServer = startServer("fixed", FIXED_PORT);
  const results = [];

  try {
    await Promise.all([brokenServer.ready, fixedServer.ready]);

    for (const testCase of cases) {
      const dir = join(WORK, testCase.id);
      mkdirSync(dir, { recursive: true });

      const row = {
        id: testCase.id,
        kind: testCase.kind,
        template: testCase.template,
        task: testCase.task,
        claimId: null,
        broken: null,
        fixed: null,
        machine: 0,
        total: 0,
        verdict: "error",
        errors: [],
      };

      const init = await runCli(["init"], dir);
      if (init.code !== 0) {
        row.errors.push(`init: код ${init.code} · ${init.stderr.trim()}`);
        results.push(row);
        continue;
      }

      const claim = await runCli(["claim", testCase.task, "--yes", "--no-llm"], dir);
      if (claim.code !== 0) {
        row.errors.push(`claim: код ${claim.code} · ${claim.stderr.trim()}`);
        results.push(row);
        continue;
      }

      const baseline = await runCli(
        ["run", "--baseline", "--json", "--base-url", BROKEN, "--no-tamper"],
        dir,
      );
      const brokenRuns = parseRuns(baseline.stdout);
      if (!brokenRuns) {
        row.errors.push(`baseline: не разобрал JSON · ${baseline.stderr.trim()}`);
        results.push(row);
        continue;
      }

      const final = await runCli(["run", "--json", "--base-url", FIXED, "--no-tamper"], dir);
      const fixedRuns = parseRuns(final.stdout);
      if (!fixedRuns) {
        row.errors.push(`fixed: не разобрал JSON · ${final.stderr.trim()}`);
        results.push(row);
        continue;
      }

      const brokenRecord = brokenRuns[0];
      const fixedRecord = fixedRuns[0];
      row.claimId = fixedRecord?.claimId ?? brokenRecord?.claimId ?? null;
      row.broken = { exit: baseline.code, green: baseline.code === 0, ...summary(brokenRecord) };
      row.fixed = { exit: final.code, green: final.code === 0, ...summary(fixedRecord) };

      const criteria = fixedRecord?.criteria ?? [];
      row.machine = criteria.filter((item) => item.manual !== true).length;
      row.total = criteria.length;

      if (row.broken.green) row.verdict = "false-green";
      else if (row.kind === "negative" && row.fixed.green) row.verdict = "negative-green";
      else if (row.kind === "positive" && !row.fixed.green) row.verdict = "false-red";
      else row.verdict = "ok";

      results.push(row);
    }
  } finally {
    stopServer(brokenServer);
    stopServer(fixedServer);
  }

  const positive = results.filter((row) => row.kind === "positive");
  const negative = results.filter((row) => row.kind === "negative");
  const measured = results.filter((row) => row.verdict !== "error");

  const falseGreen = measured.filter((row) => row.broken?.green === true);
  const negativeGreen = negative.filter((row) => row.fixed?.green === true);
  const positiveFail = positive.filter((row) => row.fixed?.green === false);
  const tautologies = measured.reduce((sum, row) => sum + (row.fixed?.tautologies?.length ?? 0), 0);
  const machine = measured.reduce((sum, row) => sum + row.machine, 0);
  const total = measured.reduce((sum, row) => sum + row.total, 0);

  const rate = (part, whole) => (whole === 0 ? 0 : part / whole);

  const metrics = {
    cases: results.length,
    measured: measured.length,
    positive: positive.length,
    negative: negative.length,
    falseGreen: falseGreen.length,
    falseGreenRate: rate(falseGreen.length, measured.length),
    negativeGreen: negativeGreen.length,
    negativeGreenRate: rate(negativeGreen.length, negative.length),
    positiveFail: positiveFail.length,
    positivePassRate: rate(positive.length - positiveFail.length, positive.length),
    tautologies,
    machineCriteria: machine,
    totalCriteria: total,
    machineShare: rate(machine, total),
    errors: results.filter((row) => row.verdict === "error").length,
  };

  console.log(`\nWitness golden set · ${metrics.cases} кейсов\n`);
  console.log(
    `${pad("ID", 10)}${pad("KIND", 10)}${pad("BROKEN", 8)}${pad("FIXED", 8)}${pad("TAUT", 6)}${pad(
      "MACHINE",
      9,
    )}ИТОГ`,
  );
  for (const row of results) {
    const broken = row.broken ? (row.broken.green ? "pass" : "fail") : "err";
    const fixed = row.fixed ? (row.fixed.green ? "pass" : "fail") : "err";
    const taut = row.fixed?.tautologies?.length ?? 0;
    console.log(
      `${pad(row.id, 10)}${pad(row.kind, 10)}${pad(broken, 8)}${pad(fixed, 8)}${pad(taut, 6)}${pad(
        `${row.machine}/${row.total}`,
        9,
      )}${row.verdict}`,
    );
  }

  console.log("\nМетрики:");
  console.log(
    `  false-green (broken сказал «прошло»): ${metrics.falseGreen}/${metrics.measured} = ${(
      metrics.falseGreenRate * 100
    ).toFixed(1)}%`,
  );
  console.log(
    `  negative-green (непроверяемая задача сказала «прошло»): ${metrics.negativeGreen}/${
      metrics.negative
    } = ${(metrics.negativeGreenRate * 100).toFixed(1)}%`,
  );
  console.log(
    `  positive false-red (фича есть, проверка упала): ${metrics.positiveFail}/${metrics.positive} = ${(
      (1 - metrics.positivePassRate) * 100
    ).toFixed(1)}%`,
  );
  console.log(`  тавтологии (зелёные и на базе): ${metrics.tautologies}`);
  console.log(
    `  машинные критерии: ${metrics.machineCriteria}/${metrics.totalCriteria} = ${(
      metrics.machineShare * 100
    ).toFixed(1)}%`,
  );

  const report = {
    generatedAt: new Date().toISOString(),
    note: "broken — приложение без фичи; fixed — с фичей. false-green означает, что witness сказал «прошло» на broken.",
    thresholds: { falseGreen: 0, negativeGreen: 0, positiveFail: 0 },
    metrics,
    cases: results,
  };
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nОтчёт: ${REPORT}`);

  const failed = metrics.falseGreen + metrics.negativeGreen + metrics.positiveFail + metrics.errors;
  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("golden set упал:", error);
    process.exitCode = 1;
  });
