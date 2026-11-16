import { execFileSync } from "node:child_process";
import type { TamperFinding, TamperReport } from "./types.ts";

/**
 * Anti-tamper: агент мог «починить» проверку вместо кода.
 * Ищем в диффе ослабление тестов, обход хуков и правку CI.
 */

type LineRule = {
  id: string;
  severity: "high" | "medium";
  side: "added" | "removed";
  pattern: RegExp;
  message: string;
};

const LINE_RULES: LineRule[] = [
  {
    id: "removed-assertion",
    severity: "high",
    side: "removed",
    pattern: /\b(assert|expect)\b|\.toBe\(|\.toEqual\(|\.toHaveBeenCalled/,
    message: "удалено утверждение из теста",
  },
  {
    id: "added-skip",
    severity: "high",
    side: "added",
    pattern: /(\.skip\(|skip:\s*true|\bxit\(|\bxdescribe\(|pytest\.mark\.skip)/,
    message: "тест помечен как пропущенный",
  },
  {
    id: "added-only",
    severity: "medium",
    side: "added",
    pattern: /(\.only\(|fdescribe\(|\bfit\()/,
    message: "тест ограничен через .only — остальные перестали проверяться",
  },
  {
    id: "no-verify",
    severity: "high",
    side: "added",
    pattern: /--no-verify/,
    message: "обход git-хуков (--no-verify)",
  },
  {
    id: "ignore-checks",
    severity: "medium",
    side: "added",
    pattern: /(@ts-ignore|@ts-nocheck|eslint-disable)/,
    message: "подавление проверок типов или линтера",
  },
];

const CI_FILE = /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)Jenkinsfile$/;
const CONFIG_FILE = /(jest|vitest|playwright|cypress|mocha)\.config\.|(^|\/)\.mocharc|(^|\/)pytest\.ini$/;
const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/** Проверяет сам файл (не строку) на подозрительность. */
function fileViolation(file: string): { rule: string; message: string } | null {
  if (CI_FILE.test(file)) {
    return { rule: "ci-change", message: "изменён файл CI — проверьте, не ослаблены ли гейты" };
  }
  if (CONFIG_FILE.test(file)) {
    return { rule: "test-config", message: "изменён конфиг тестового раннера" };
  }
  return null;
}

/** Разбирает unified diff и возвращает находки. Чистая функция — тестируется без git. */
export function scanDiffText(diff: string): TamperFinding[] {
  const findings: TamperFinding[] = [];
  let file = "";
  const reported = new Set<string>();

  const report = (finding: TamperFinding): void => {
    const key = `${finding.rule}|${finding.file}|${finding.message}`;
    if (reported.has(key)) return;
    reported.add(key);
    findings.push(finding);
  };

  for (const line of diff.split("\n")) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      file = header[2] ?? "";
      continue;
    }

    if (line.startsWith("+++ /dev/null") && file && TEST_FILE.test(file)) {
      report({
        rule: "deleted-test-file",
        severity: "high",
        file,
        line: "+++ /dev/null",
        message: "тестовый файл удалён",
      });
      continue;
    }

    const added = line.startsWith("+") && !line.startsWith("+++");
    const removed = line.startsWith("-") && !line.startsWith("---");
    if (!added && !removed) continue;
    if (!file) continue;

    const side = added ? "added" : "removed";
    const content = line.slice(1).trim();

    for (const rule of LINE_RULES) {
      if (rule.side !== side) continue;
      if (!rule.pattern.test(content)) continue;
      report({
        rule: rule.id,
        severity: rule.severity,
        file,
        line: content.slice(0, 160),
        message: rule.message,
      });
    }

    const violation = fileViolation(file);
    if (violation) {
      report({
        rule: violation.rule,
        severity: "medium",
        file,
        line: content.slice(0, 160),
        message: violation.message,
      });
    }
  }

  return findings;
}

/** Снимает `git diff HEAD` + список новых файлов. Вне git — available: false, а не ошибка. */
export function scanRepo(root: string): TamperReport {
  const git = (args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });

  let diff = "";
  let untracked: string[] = [];
  try {
    diff = git(["diff", "HEAD", "--unified=0", "--no-color"]);
    untracked = git(["ls-files", "--others", "--exclude-standard"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim();
    const reason = /not a git repository/i.test(stderr)
      ? "каталог не является git-репозиторием — diff не проверен"
      : stderr.split("\n")[0] || `git diff недоступен: ${(error as Error).message.split("\n")[0] ?? ""}`;
    return { available: false, reason, findings: [] };
  }

  const findings = scanDiffText(diff);

  // Новые файлы не попадают в diff HEAD, но новый CI или конфиг — тоже способ ослабить проверки.
  for (const file of untracked) {
    const violation = fileViolation(file);
    if (!violation) continue;
    findings.push({
      rule: violation.rule,
      severity: "medium",
      file,
      line: "новый файл",
      message: violation.message,
    });
  }

  return { available: true, findings };
}
