import { existsSync } from "node:fs";
import { paths, defaultConfig, ensureLayout, readConfig, writeConfig } from "../core/config.ts";

/** `witness init` — идемпотентная инициализация репозитория. */
export async function init(root: string): Promise<number> {
  const p = paths(root);
  ensureLayout(root);

  if (existsSync(p.config)) {
    const config = readConfig(root);
    console.log(`witness уже настроен: ${p.config}`);
    if (config) console.log(`база для проверок: ${config.baseUrl}`);
    console.log("Ничего не менял. Отредактируйте конфиг вручную, если нужно.");
    return 0;
  }

  const config = defaultConfig(root);
  writeConfig(root, config);

  console.log(`Создано: ${p.dir}`);
  console.log("  witness.json  — настройки (baseUrl, timeout, headers)");
  console.log("  claims/       — утверждённые критерии приёмки");
  console.log("  witness.db    — история прогонов (SQLite, появится после первого run)");
  console.log("");
  console.log(`База проверок: ${config.baseUrl}`);
  console.log("Если приложение на другом порту — поправьте baseUrl в witness.json.");
  console.log("");
  console.log("Дальше:");
  console.log('  witness claim "что должен сделать агент"');
  console.log("  # ... агент работает ...");
  console.log("  witness run");
  return 0;
}
