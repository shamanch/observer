import type { WitnessConfig } from "./config.ts";
import type { Criterion, HttpCheck, JsonScalar } from "./criteria.ts";
import type { CheckResult } from "./types.ts";

/** Исполнение http-критерия. Никакой LLM: только запрос и сравнение. */

function resolveUrl(path: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Читает значение по пути вида user.roles[0].name. */
export function readJsonPath(value: unknown, path: string): unknown {
  const parts = path
    .split(".")
    .flatMap((part) => part.split(/\[(\d+)\]/).filter((piece) => piece !== ""));
  let current: unknown = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function sameValue(actual: unknown, expected: JsonScalar): boolean {
  if (typeof expected === "number" && typeof actual === "string") {
    return Number(actual) === expected;
  }
  return actual === expected;
}

function format(value: unknown): string {
  if (typeof value === "string") return `«${value.slice(0, 120)}»`;
  return JSON.stringify(value) ?? String(value);
}

/** Ищет непустой массив в JSON: сам ответ или вложенное поле (до 4 уровней). */
export function hasNonEmptyArray(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (Array.isArray(value)) {
    if (value.length > 0) return true;
    return value.some((item) => hasNonEmptyArray(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => hasNonEmptyArray(item, depth + 1));
  }
  return false;
}

export type HttpCheckOptions = {
  config: WitnessConfig;
  /** Переопределение базы (для differential по другому окружению). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

/** Выполняет один http-критерий и возвращает результат, не бросая исключений. */
export async function runHttpCheck(criterion: Criterion, options: HttpCheckOptions): Promise<CheckResult> {
  const started = performance.now();
  const check = criterion.check;
  if (check.type !== "http") {
    return {
      criterionId: criterion.id,
      text: criterion.text,
      status: "skip",
      durationMs: 0,
      detail: "ручная проверка — требует человека",
      required: criterion.required,
      manual: true,
    };
  }

  const http: HttpCheck = check;
  const url = resolveUrl(http.path, options.baseUrl ?? options.config.baseUrl);
  const headers: Record<string, string> = { ...options.config.headers };
  if (http.body !== undefined) headers["content-type"] = "application/json";

  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, {
      method: http.method,
      headers,
      body: http.body === undefined ? undefined : JSON.stringify(http.body),
      signal: AbortSignal.timeout(options.config.timeoutMs),
    });

    const bodyText = await response.text();
    const problems: string[] = [];
    const passes: string[] = [];
    const expect = http.expect;

    if (expect.status !== undefined) {
      if (response.status === expect.status) passes.push(`статус ${response.status}`);
      else problems.push(`ждали статус ${expect.status}, получили ${response.status}`);
    }

    if (expect.header) {
      for (const [name, expected] of Object.entries(expect.header)) {
        const actual = response.headers.get(name) ?? "";
        if (actual.toLowerCase().includes(expected.toLowerCase())) passes.push(`заголовок ${name}`);
        else problems.push(`заголовок ${name}: ждали «${expected}», получили «${actual || "пусто"}»`);
      }
    }

    if (expect.bodyContains) {
      for (const needle of expect.bodyContains) {
        if (bodyText.includes(needle)) passes.push(`тело содержит «${needle.slice(0, 40)}»`);
        else problems.push(`в теле нет «${needle.slice(0, 40)}»`);
      }
    }

    if (expect.jsonPath || expect.jsonNonEmpty) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        problems.push("ответ не является JSON, а проверка требует JSON");
        parsed = undefined;
      }
      if (parsed !== undefined) {
        if (expect.jsonNonEmpty) {
          if (hasNonEmptyArray(parsed)) passes.push("JSON содержит непустой список");
          else problems.push("JSON не содержит непустого списка (пустой массив или массива нет)");
        }
        for (const [path, expected] of Object.entries(expect.jsonPath ?? {})) {
          const actual = readJsonPath(parsed, path);
          if (sameValue(actual, expected)) passes.push(`${path} = ${format(expected)}`);
          else problems.push(`${path}: ждали ${format(expected)}, получили ${format(actual)}`);
        }
      }
    }

    if (expect.bodyMinLines !== undefined) {
      const lines = bodyText.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
      if (lines >= expect.bodyMinLines) passes.push(`непустых строк: ${lines}`);
      else problems.push(`ждали минимум ${expect.bodyMinLines} непустых строк, получили ${lines}`);
    }

    const ok = problems.length === 0;
    const duration = Math.round(performance.now() - started);
    return {
      criterionId: criterion.id,
      text: criterion.text,
      status: ok ? "pass" : "fail",
      durationMs: duration,
      detail: ok ? passes.join(", ") : problems.join("; "),
      required: criterion.required,
      manual: false,
    };
  } catch (error) {
    const duration = Math.round(performance.now() - started);
    const err = error as Error;
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    return {
      criterionId: criterion.id,
      text: criterion.text,
      status: "error",
      durationMs: duration,
      detail: isTimeout
        ? `таймаут ${options.config.timeoutMs} мс: ${url}`
        : `нет соединения с ${url} — сервер не запущен? (${err.message})`,
      required: criterion.required,
      manual: false,
    };
  }
}
