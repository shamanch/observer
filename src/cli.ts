import { badge } from "./commands/badge.ts";
import { claim } from "./commands/claim.ts";
import { init } from "./commands/init.ts";
import { report } from "./commands/report.ts";
import { run } from "./commands/run.ts";
import { wrap } from "./commands/wrap.ts";

export const VERSION = "0.1.0";

const HELP = `witness ${VERSION} — проверяет, что AI-агент реально сделал задачу

Использование:
  witness init                          инициализировать репозиторий
  witness claim "<задача>" [--yes]      критерии приёмки (человек утверждает)
  witness run                           проверить текущее состояние
  witness run --all                     регрессия по всем критериям
  witness run --baseline                зафиксировать базу до работы агента
  witness run --claim <id>              конкретный claim
  witness report                        HTML-отчёт (.witness/report.html)
  witness badge [--verify]              сертификат для README
  witness wrap -- <команда>             агент + автопроверка

Флаги:
  --yes             не спрашивать подтверждение в claim
  --dry-run         показать критерии, ничего не записывая
  --no-llm          только офлайн-шаблоны, без обращения к модели
  --base-url <url>  переопределить адрес приложения на время прогона
  --no-tamper       не анализировать git diff
  --json            машинный вывод прогона
  --help, -h        эта справка
  --version, -v     версия

Переменные окружения:
  WITNESS_LLM_KEY   ключ LLM (необязателен; без него работают шаблоны)
  WITNESS_LLM_URL   адрес OpenAI-совместимого API
  WITNESS_LLM_MODEL имя модели

Ничего не отправляется в сеть без вашего ключа. Результаты остаются локально.
`;

export type ParsedArgs = {
  _: string[];
  flags: Record<string, string | boolean>;
  rest: string[];
};

const VALUE_FLAGS = new Set(["claim", "base-url", "base"]);

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (arg === "--") {
      rest = argv.slice(index + 1);
      break;
    }

    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        flags[camel(body.slice(0, eq))] = body.slice(eq + 1);
        continue;
      }
      if (VALUE_FLAGS.has(body)) {
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[camel(body)] = next;
          index += 1;
          continue;
        }
        flags[camel(body)] = "";
        continue;
      }
      flags[camel(body)] = true;
      continue;
    }

    if (arg === "-h" || arg === "-v") {
      flags[arg === "-h" ? "help" : "version"] = true;
      continue;
    }

    positional.push(arg);
  }

  return { _: positional, flags, rest };
}

const ROOT = process.cwd();

export async function main(argv: string[]): Promise<number> {
  const { _, flags, rest } = parseArgs(argv);

  if (flags.version === true) {
    console.log(VERSION);
    return 0;
  }
  if (flags.help === true || _[0] === "help" || _[0] === undefined) {
    console.log(HELP);
    return 0;
  }

  const command = _[0];

  switch (command) {
    case "init":
      return init(ROOT);

    case "claim": {
      const task = _.slice(1).join(" ").trim();
      return claim(ROOT, task, {
        yes: flags.yes === true,
        dry: flags.dryRun === true,
        noLlm: flags.noLlm === true,
      });
    }

    case "run": {
      const claimFlag = typeof flags.claim === "string" && flags.claim ? flags.claim : undefined;
      const baseUrl = typeof flags.baseUrl === "string" && flags.baseUrl ? flags.baseUrl : undefined;
      return run(ROOT, {
        all: flags.all === true || rest.includes("--all"),
        claim: claimFlag,
        baseUrl,
        baseline: flags.baseline === true,
        tamper: flags.noTamper !== true,
        json: flags.json === true,
      });
    }

    case "report":
      return report(ROOT, { open: flags.open === true });

    case "badge":
      return badge(ROOT, { verify: flags.verify === true });

    case "wrap":
      return wrap(ROOT, rest, { tamper: flags.noTamper !== true });

    default:
      console.error(`Неизвестная команда: ${command}`);
      console.error("Список команд: witness --help");
      return 2;
  }
}
