/** Модель критерия приёмки: то, что человек утвердил до работы агента. */

export type JsonScalar = string | number | boolean | null;

export type HttpExpect = {
  /** Ожидаемый HTTP-статус. */
  status?: number;
  /** Подстроки, которые обязаны быть в теле ответа. */
  bodyContains?: string[];
  /** Значения по «точечному» пути в JSON-ответе: { "user.role": "admin" }. */
  jsonPath?: Record<string, JsonScalar>;
  /** Ожидаемые заголовки ответа. */
  header?: Record<string, string>;
};

export type HttpCheck = {
  type: "http";
  method: "GET" | "POST";
  /** Абсолютный адрес или путь относительно baseUrl. */
  path: string;
  expect: HttpExpect;
  body?: unknown;
};

export type ManualCheck = {
  type: "manual";
  steps: string[];
};

export type Check = HttpCheck | ManualCheck;

export type Criterion = {
  id: string;
  text: string;
  /** Обязательный критерий влияет на exit-код прогона. */
  required: boolean;
  check: Check;
};

export type Claim = {
  id: string;
  task: string;
  createdAt: string;
  criteria: Criterion[];
};

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

/** Превращает произвольный текст в стабильный ASCII-slug. */
export function slugify(text: string): string {
  const lower = text.toLowerCase();
  let out = "";
  for (const char of lower) {
    if (CYRILLIC[char] !== undefined) {
      out += CYRILLIC[char];
    } else if (/[a-z0-9]/.test(char)) {
      out += char;
    } else {
      out += "-";
    }
  }
  return out.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "claim";
}

/** ID claim'а: дата + slug задачи. */
export function makeClaimId(task: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `${date}-${slugify(task)}`;
}

/** Делает ID критериев уникальными внутри claim'а. */
export function uniqueCriterionIds(criteria: Criterion[]): Criterion[] {
  const seen = new Map<string, number>();
  return criteria.map((criterion) => {
    const base = criterion.id || slugify(criterion.text);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...criterion, id: count === 1 ? base : `${base}-${count}` };
  });
}

export type ValidationResult = { ok: true; claim: Claim } | { ok: false; errors: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCheck(value: unknown, where: string, errors: string[]): Check | null {
  if (!isObject(value)) {
    errors.push(`${where}: check должен быть объектом`);
    return null;
  }
  if (value.type === "manual") {
    const steps = Array.isArray(value.steps) ? value.steps.filter((s) => typeof s === "string") : [];
    if (steps.length === 0) {
      errors.push(`${where}: ручная проверка без шагов`);
      return null;
    }
    return { type: "manual", steps };
  }
  if (value.type !== "http") {
    errors.push(`${where}: неизвестный тип проверки ${String(value.type)}`);
    return null;
  }
  const method = value.method === "POST" ? "POST" : "GET";
  if (typeof value.path !== "string" || !value.path.trim()) {
    errors.push(`${where}: http-проверка без path`);
    return null;
  }
  if (!isObject(value.expect)) {
    errors.push(`${where}: http-проверка без expect`);
    return null;
  }
  const expect: HttpExpect = {};
  const raw = value.expect;
  if (raw.status !== undefined) {
    if (typeof raw.status !== "number" || raw.status < 100 || raw.status > 599) {
      errors.push(`${where}: expect.status должен быть HTTP-кодом`);
    } else {
      expect.status = raw.status;
    }
  }
  if (raw.bodyContains !== undefined) {
    const list = Array.isArray(raw.bodyContains)
      ? raw.bodyContains.filter((s): s is string => typeof s === "string")
      : [];
    if (list.length === 0) errors.push(`${where}: expect.bodyContains пуст`);
    else expect.bodyContains = list;
  }
  if (raw.jsonPath !== undefined) {
    if (!isObject(raw.jsonPath)) {
      errors.push(`${where}: expect.jsonPath должен быть объектом`);
    } else {
      const entries = Object.entries(raw.jsonPath).filter(
        (pair): pair is [string, JsonScalar] =>
          pair[1] === null || ["string", "number", "boolean"].includes(typeof pair[1]),
      );
      if (entries.length === 0) errors.push(`${where}: expect.jsonPath пуст`);
      else expect.jsonPath = Object.fromEntries(entries);
    }
  }
  if (raw.header !== undefined) {
    if (!isObject(raw.header)) {
      errors.push(`${where}: expect.header должен быть объектом`);
    } else {
      const entries = Object.entries(raw.header).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      );
      if (entries.length === 0) errors.push(`${where}: expect.header пуст`);
      else expect.header = Object.fromEntries(entries);
    }
  }
  const assertions = [expect.status, expect.bodyContains, expect.jsonPath, expect.header].filter(
    (item) => item !== undefined,
  );
  if (assertions.length === 0) {
    errors.push(`${where}: http-проверка не содержит ни одного утверждения`);
    return null;
  }
  const check: HttpCheck = { type: "http", method, path: value.path.trim(), expect };
  if (value.body !== undefined) check.body = value.body;
  return check;
}

/** Полная валидация claim'а перед записью и перед прогоном. */
export function validateClaim(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return { ok: false, errors: ["claim должен быть объектом"] };

  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
  const task = typeof value.task === "string" && value.task.trim() ? value.task.trim() : "";
  const createdAt =
    typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt))
      ? value.createdAt
      : new Date().toISOString();
  if (!id) errors.push("claim.id отсутствует");
  if (!task) errors.push("claim.task отсутствует");

  const rawCriteria = Array.isArray(value.criteria) ? value.criteria : [];
  if (rawCriteria.length === 0) errors.push("claim.criteria пуст");
  if (rawCriteria.length > 20) errors.push("claim.criteria: больше 20 критериев — это не проверка, а ТЗ");

  const criteria: Criterion[] = [];
  rawCriteria.forEach((item, index) => {
    const where = `criteria[${index}]`;
    if (!isObject(item)) {
      errors.push(`${where}: критерий должен быть объектом`);
      return;
    }
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) {
      errors.push(`${where}: нет текста критерия`);
      return;
    }
    const check = validateCheck(item.check, where, errors);
    if (!check) return;
    criteria.push({
      id: typeof item.id === "string" && item.id.trim() ? slugify(item.id) : slugify(text),
      text,
      required: item.required !== false,
      check,
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    claim: { id, task, createdAt, criteria: uniqueCriterionIds(criteria) },
  };
}

export function countHttp(criteria: Criterion[]): number {
  return criteria.filter((criterion) => criterion.check.type === "http").length;
}
