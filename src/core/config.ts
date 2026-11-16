import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/** Конфиг репозитория, который создаёт `witness init`. */
export type WitnessConfig = {
  version: number;
  name: string;
  /** База для относительных путей в критериях, например http://127.0.0.1:3000 */
  baseUrl: string;
  timeoutMs: number;
  headers: Record<string, string>;
};

export const WITNESS_DIR = ".witness";

export type Paths = {
  root: string;
  dir: string;
  config: string;
  claims: string;
  runs: string;
  baseline: string;
  report: string;
  badgeSvg: string;
  badgeJson: string;
};

export function paths(root: string): Paths {
  const dir = join(root, WITNESS_DIR);
  return {
    root,
    dir,
    config: join(dir, "witness.json"),
    claims: join(dir, "claims"),
    runs: join(dir, "runs"),
    baseline: join(dir, "baseline.json"),
    report: join(dir, "report.html"),
    badgeSvg: join(dir, "badge.svg"),
    badgeJson: join(dir, "badge.json"),
  };
}

function guessName(root: string): string {
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
    } catch {
      // повреждённый package.json не должен ломать init
    }
  }
  return basename(root) || "project";
}

export function defaultConfig(root: string): WitnessConfig {
  return {
    version: 1,
    name: guessName(root),
    baseUrl: "http://127.0.0.1:3000",
    timeoutMs: 10_000,
    headers: {},
  };
}

/** Читает конфиг, подставляя значения по умолчанию для отсутствующих полей. */
export function readConfig(root: string): WitnessConfig | null {
  const file = paths(root).config;
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<WitnessConfig>;
  const base = defaultConfig(root);
  return {
    version: typeof raw.version === "number" ? raw.version : base.version,
    name: typeof raw.name === "string" && raw.name ? raw.name : base.name,
    baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl ? raw.baseUrl : base.baseUrl,
    timeoutMs: typeof raw.timeoutMs === "number" && raw.timeoutMs > 0 ? raw.timeoutMs : base.timeoutMs,
    headers:
      raw.headers && typeof raw.headers === "object"
        ? Object.fromEntries(
            Object.entries(raw.headers).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
          )
        : {},
  };
}

export function writeConfig(root: string, config: WitnessConfig): void {
  const p = paths(root);
  mkdirSync(p.dir, { recursive: true });
  writeFileSync(p.config, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Создаёт структуру каталогов, не трогая существующие файлы. */
export function ensureLayout(root: string): void {
  // Каталог runs/ больше не создаётся: история живёт в witness.db.
  // Он остаётся только как архив для старых JSON-прогонов.
  mkdirSync(paths(root).claims, { recursive: true });
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
