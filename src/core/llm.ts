import type { Criterion, JsonScalar } from "./criteria.ts";
import { validateClaim } from "./criteria.ts";
import { generateHeuristic } from "./claimgen.ts";

/**
 * LLM используется один раз — при генерации критериев.
 * Ключ приносит пользователь (BYO), сеть опциональна: без ключа работает офлайн-генератор.
 */

export type LlmOptions = {
  apiKey: string;
  url: string;
  model: string;
};

export function llmOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): LlmOptions | null {
  const apiKey = env.WITNESS_LLM_KEY || env.OPENAI_API_KEY || "";
  if (!apiKey) return null;
  return {
    apiKey,
    url: env.WITNESS_LLM_URL || "https://api.openai.com/v1/chat/completions",
    model: env.WITNESS_LLM_MODEL || "gpt-4o-mini",
  };
}

const SYSTEM_PROMPT = `Ты превращаешь задачу разработчика в проверяемые критерии приёмки.
Отвечай строго JSON-объектом без markdown:
{"criteria":[{"text":"...","required":true,"check":{"type":"http","method":"GET","path":"/api/x","expect":{"status":200}}}]}
Правила:
- от 3 до 7 критериев;
- минимум 2 критерия типа http, остальные type manual со steps;
- http expect может содержать status, bodyContains (массив строк), jsonPath (объект), header (объект);
- path — относительный путь, начинающийся с /;
- критерий должен ловить именно заявленное поведение, а не «сервер отвечает».
Не добавляй пояснений, только JSON.`;

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("ответ модели не содержит JSON");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function asJsonScalar(value: unknown): JsonScalar | undefined {
  if (value === null) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value as JsonScalar;
  return undefined;
}

function normalizeCriteria(raw: unknown): Criterion[] {
  if (!raw || typeof raw !== "object") throw new Error("ожидался объект с полем criteria");
  const list = (raw as { criteria?: unknown }).criteria;
  if (!Array.isArray(list)) throw new Error("поле criteria отсутствует или не массив");

  const criteria: Criterion[] = list.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`criteria[${index}] не объект`);
    const src = item as Record<string, unknown>;
    const text = typeof src.text === "string" ? src.text.trim() : "";
    if (!text) throw new Error(`criteria[${index}] без текста`);
    const checkSrc = (src.check ?? {}) as Record<string, unknown>;
    if (checkSrc.type === "manual") {
      const steps = Array.isArray(checkSrc.steps)
        ? checkSrc.steps.filter((step): step is string => typeof step === "string")
        : [];
      if (steps.length === 0) throw new Error(`criteria[${index}]: manual без steps`);
      return { id: text, text, required: src.required !== false, check: { type: "manual", steps } };
    }
    const expectSrc = (checkSrc.expect ?? {}) as Record<string, unknown>;
    const expect: Record<string, unknown> = {};
    if (typeof expectSrc.status === "number") expect.status = expectSrc.status;
    if (Array.isArray(expectSrc.bodyContains)) {
      expect.bodyContains = expectSrc.bodyContains.filter((s): s is string => typeof s === "string");
    }
    if (expectSrc.jsonPath && typeof expectSrc.jsonPath === "object") {
      const entries = Object.entries(expectSrc.jsonPath as Record<string, unknown>)
        .map(([key, value]) => [key, asJsonScalar(value)] as const)
        .filter((pair): pair is readonly [string, JsonScalar] => pair[1] !== undefined);
      if (entries.length > 0) expect.jsonPath = Object.fromEntries(entries);
    }
    if (expectSrc.header && typeof expectSrc.header === "object") {
      const entries = Object.entries(expectSrc.header as Record<string, unknown>).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      );
      if (entries.length > 0) expect.header = Object.fromEntries(entries);
    }
    if (Object.keys(expect).length === 0) throw new Error(`criteria[${index}]: пустой expect`);
    if (typeof checkSrc.path !== "string" || !checkSrc.path.startsWith("/")) {
      throw new Error(`criteria[${index}]: path должен начинаться с /`);
    }
    return {
      id: text,
      text,
      required: src.required !== false,
      check: {
        type: "http",
        method: checkSrc.method === "POST" ? "POST" : "GET",
        path: checkSrc.path,
        expect,
      } as Criterion["check"],
    };
  });
  return criteria;
}

export type GenerateResult = { criteria: Criterion[]; source: "llm" | "heuristic"; warning?: string };

/** Генерирует критерии: LLM при наличии ключа, иначе (или при ошибке) — эвристики. */
export async function generateCriteria(task: string, options: LlmOptions | null): Promise<GenerateResult> {
  const heuristic = generateHeuristic(task);
  if (!options) return { criteria: heuristic, source: "heuristic" };

  try {
    const response = await fetch(options.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: task },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`LLM вернул ${response.status}`);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const criteria = normalizeCriteria(parseJsonLoose(content));
    const check = validateClaim({
      id: "llm-draft",
      task,
      createdAt: new Date().toISOString(),
      criteria,
    });
    if (!check.ok) throw new Error(check.errors.join("; "));
    return { criteria: check.claim.criteria, source: "llm" };
  } catch (error) {
    return {
      criteria: heuristic,
      source: "heuristic",
      warning: `LLM недоступен (${(error as Error).message}), использованы шаблоны`,
    };
  }
}
