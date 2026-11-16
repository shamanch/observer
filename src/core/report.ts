import type { Claim } from "./criteria.ts";
import type { RunFile } from "./ledger.ts";
import { machineChecks } from "./runner.ts";
import type { CheckStatus } from "./types.ts";

/** Самодостаточный HTML-отчёт: один файл, ноль внешних запросов. */

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  skip: "РУЧНАЯ",
  error: "ОШИБКА",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Убирает схему, чтобы в отчёте не было внешних ссылок. */
function stripScheme(text: string): string {
  return text.replace(/https?:\/\//gi, "");
}

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} с` : `${value} мс`;
}

export type ReportInput = {
  run: RunFile;
  claim?: Claim | null;
  ledgerHash?: string;
};

export function buildReport(input: ReportInput): string {
  const { run } = input;
  const machine = machineChecks(run);
  const verdict = machine === 0 ? "НЕ ПРОВЕРЕНО" : run.requiredFailed === 0 ? "ПРОВЕРЕНО" : "НЕ ПРОШЛО";
  const verdictClass = machine === 0 ? "skip" : run.requiredFailed === 0 ? "ok" : "bad";
  const date = new Date(run.finishedAt).toLocaleString("ru-RU");

  const criteriaRows = run.criteria
    .map((item) => {
      const cls = item.status === "pass" ? "ok" : item.status === "skip" ? "skip" : "bad";
      const text = input.claim?.criteria.find((c) => c.id === item.criterionId)?.text ?? item.text;
      return `<tr class="${cls}">
      <td><span class="pill ${cls}">${STATUS_LABEL[item.status]}</span></td>
      <td>${escapeHtml(text)}${item.required ? "" : ' <span class="muted">(необязательный)</span>'}</td>
      <td class="detail">${escapeHtml(item.detail)}</td>
      <td class="num">${ms(item.durationMs)}</td>
    </tr>`;
    })
    .join("\n");

  const tamper = run.tamper
    ? run.tamper.available
      ? run.tamper.findings.length === 0
        ? `<p class="ok-text">Подозрительных изменений в тестах, CI и конфигах не найдено.</p>`
        : `<ul class="findings">${run.tamper.findings
            .map(
              (finding) =>
                `<li><b>${finding.severity === "high" ? "КРИТИЧНО" : "ВНИМАНИЕ"}</b> · ${escapeHtml(
                  finding.file,
                )}: ${escapeHtml(finding.message)}<br><code>${escapeHtml(finding.line)}</code></li>`,
            )
            .join("")}</ul>`
      : `<p class="muted">Diff не проверен: ${escapeHtml(stripScheme(run.tamper.reason ?? "нет данных"))}</p>`
    : `<p class="muted">Anti-tamper не запускался (запустите с --tamper).</p>`;

  const differential = run.differential
    ? `<section>
      <h2>Differential</h2>
      <p>База: ${escapeHtml(new Date(run.differential.baselineAt).toLocaleString("ru-RU"))} · сравнено критериев: ${
        run.differential.compared
      }</p>
      ${
        run.differential.tautologies.length > 0
          ? `<p class="bad-text"><b>Тавтологии:</b> ${escapeHtml(
              run.differential.tautologies.join(", "),
            )} — эти критерии были зелёными и до работы агента, значит ничего не доказывают.</p>`
          : `<p class="ok-text">Тавтологий нет: каждый зелёный критерий падал на базе.</p>`
      }
      ${
        run.differential.regressions.length > 0
          ? `<p class="bad-text"><b>Регрессии:</b> ${escapeHtml(run.differential.regressions.join(", "))}</p>`
          : ""
      }
    </section>`
    : `<section><h2>Differential</h2><p class="muted">База не зафиксирована. Снимите её до работы агента: <code>witness run --baseline</code>.</p></section>`;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Witness — ${escapeHtml(run.task.slice(0, 60))}</title>
<style>
  :root { color-scheme: light dark; --ok:#1a7f37; --bad:#cf222e; --skip:#9a6700; --line:#d0d7de; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; max-width:1100px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:16px; margin:28px 0 10px; }
  .muted { color:#6e7781; }
  .verdict { display:inline-block; padding:4px 12px; border-radius:999px; font-weight:700; font-size:13px; color:#fff; }
  .verdict.ok { background:var(--ok); } .verdict.bad { background:var(--bad); } .verdict.skip { background:var(--skip); }
  .meta { margin:8px 0 0; color:#6e7781; font-size:13px; }
  .summary { display:flex; gap:20px; margin:20px 0 8px; }
  .summary div { padding:10px 16px; border:1px solid var(--line); border-radius:8px; min-width:96px; }
  .summary b { display:block; font-size:20px; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th, td { text-align:left; padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#6e7781; }
  td.num { white-space:nowrap; text-align:right; color:#6e7781; }
  td.detail { color:#57606a; font-size:13px; max-width:420px; }
  tr.bad td { background:rgba(207,34,46,.06); }
  .pill { padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; color:#fff; }
  .pill.ok { background:var(--ok); } .pill.bad { background:var(--bad); } .pill.skip { background:var(--skip); }
  .ok-text { color:var(--ok); } .bad-text { color:var(--bad); }
  .findings { padding-left:18px; } .findings li { margin-bottom:8px; }
  code { background:rgba(175,184,193,.2); padding:1px 5px; border-radius:4px; font-size:12px; word-break:break-all; }
  footer { margin-top:36px; color:#6e7781; font-size:12px; border-top:1px solid var(--line); padding-top:12px; }
</style>
</head>
<body>
  <h1>${escapeHtml(run.task)}</h1>
  <p><span class="verdict ${verdictClass}">${verdict}</span></p>
  <p class="meta">Claim <code>${escapeHtml(run.claimId)}</code> · ${escapeHtml(date)} · база ${escapeHtml(
    stripScheme(run.baseUrl),
  )}</p>

  <div class="summary">
    <div><b>${run.total}</b>критериев</div>
    <div><b class="ok-text">${run.passed}</b>прошло</div>
    <div><b class="bad-text">${run.failed}</b>упало</div>
    <div><b>${run.skipped}</b>ручных</div>
  </div>

  <section>
    <h2>Критерии приёмки</h2>
    <table>
      <thead><tr><th>Статус</th><th>Критерий</th><th>Что произошло</th><th>Время</th></tr></thead>
      <tbody>
${criteriaRows}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Anti-tamper</h2>
    ${tamper}
  </section>

  ${differential}

  <footer>
    Witness ${escapeHtml(run.claimId)} · прогон завершён ${escapeHtml(run.finishedAt)}${
      input.ledgerHash ? ` · ledger ${escapeHtml(input.ledgerHash.slice(0, 16))}` : ""
    }
  </footer>
</body>
</html>
`;
}
