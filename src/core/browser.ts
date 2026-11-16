import type { WitnessConfig } from "./config.ts";
import type { BrowserCheck, Criterion } from "./criteria.ts";
import type { CheckResult } from "./types.ts";

/**
 * Браузерная проверка. Playwright подключается лениво и не входит в зависимости:
 * у пользователя без браузерных критериев установка остаётся нулевой.
 */

/** Минимальная форма страницы, которая нужна проверке. */
export type BrowserPage = {
  goto(url: string, options?: { waitUntil?: "load"; timeout?: number }): Promise<unknown>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  isVisible(selector: string): Promise<boolean>;
  innerText(selector: string): Promise<string>;
  on(event: "console" | "pageerror", handler: (payload: unknown) => void): void;
};

export type BrowserInstance = {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
};

export type PlaywrightModule = {
  chromium: { launch(options?: { headless?: boolean }): Promise<BrowserInstance> };
};

export type BrowserLoader = () => Promise<PlaywrightModule | null>;

/** Ленивая загрузка: при отсутствии пакета возвращает null, а не падает. */
export const loadPlaywright: BrowserLoader = async () => {
  try {
    const module = (await import("playwright")) as unknown as PlaywrightModule;
    return module?.chromium ? module : null;
  } catch {
    return null;
  }
};

export const PLAYWRIGHT_HINT =
  "playwright не установлен. Для браузерных критериев: npm i -D playwright && npx playwright install chromium";

function resolveUrl(path: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function messageOf(error: unknown): string {
  if (error && typeof error === "object") {
    const known = error as { message?: unknown; name?: unknown };
    if (typeof known.message === "string") return known.message.split("\n")[0] ?? known.message;
  }
  return String(error);
}

function describeConsole(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const item = payload as { text?: unknown; message?: unknown };
    if (typeof item.text === "function") {
      try {
        return String((item.text as () => string)());
      } catch {
        // ниже попробуем другие варианты
      }
    }
    if (typeof item.text === "string") return item.text;
    if (typeof item.message === "string") return item.message;
  }
  return String(payload);
}

export type BrowserOptions = {
  config: WitnessConfig;
  baseUrl?: string;
  loader?: BrowserLoader;
};

/** Выполняет браузерный критерий. Исключения наружу не выходят. */
export async function runBrowserCheck(criterion: Criterion, options: BrowserOptions): Promise<CheckResult> {
  const started = performance.now();
  const check = criterion.check;
  if (check.type !== "browser") {
    return {
      criterionId: criterion.id,
      text: criterion.text,
      status: "skip",
      durationMs: 0,
      detail: "не браузерная проверка",
      required: criterion.required,
      manual: check.type === "manual",
    };
  }

  const browserCheck: BrowserCheck = check;
  const loader = options.loader ?? loadPlaywright;
  let module: PlaywrightModule | null = null;
  try {
    module = await loader();
  } catch {
    module = null;
  }
  if (!module) {
    return {
      criterionId: criterion.id,
      text: criterion.text,
      status: "error",
      durationMs: Math.round(performance.now() - started),
      detail: PLAYWRIGHT_HINT,
      required: criterion.required,
      manual: false,
    };
  }

  const url = resolveUrl(browserCheck.path, options.baseUrl ?? options.config.baseUrl);
  const timeout = options.config.timeoutMs;
  const consoleErrors: string[] = [];
  let browser: BrowserInstance | null = null;

  try {
    browser = await module.chromium.launch({ headless: true });
    const page = await browser.newPage();

    page.on("pageerror", (payload) => consoleErrors.push(`pageerror: ${describeConsole(payload)}`));
    page.on("console", (payload) => {
      const item = payload as { type?: () => string };
      let kind = "";
      try {
        kind = typeof item.type === "function" ? item.type() : "";
      } catch {
        kind = "";
      }
      if (kind === "error") consoleErrors.push(describeConsole(payload));
    });

    await page.goto(url, { waitUntil: "load", timeout });

    for (const step of browserCheck.steps ?? []) {
      if (step.action === "click") await page.click(step.selector, { timeout });
      else await page.fill(step.selector, step.value, { timeout });
    }

    const problems: string[] = [];
    const passes: string[] = [];

    for (const selector of browserCheck.expect.visible ?? []) {
      const visible = await page.isVisible(selector);
      if (visible) passes.push(`виден ${selector}`);
      else problems.push(`элемент не виден: ${selector}`);
    }

    if (browserCheck.expect.text && browserCheck.expect.text.length > 0) {
      const body = await page.innerText("body");
      for (const needle of browserCheck.expect.text) {
        if (body.includes(needle)) passes.push(`текст «${needle.slice(0, 40)}»`);
        else problems.push(`на странице нет текста «${needle.slice(0, 40)}»`);
      }
    }

    if (browserCheck.expect.consoleErrors === "none") {
      if (consoleErrors.length === 0) passes.push("ошибок в консоли нет");
      else problems.push(`ошибки в консоли (${consoleErrors.length}): ${consoleErrors.slice(0, 3).join(" | ")}`);
    }

    const ok = problems.length === 0;
    return {
      criterionId: criterion.id,
      text: criterion.text,
      status: ok ? "pass" : "fail",
      durationMs: Math.round(performance.now() - started),
      detail: ok ? passes.join(", ") : problems.join("; "),
      required: criterion.required,
      manual: false,
    };
  } catch (error) {
    return {
      criterionId: criterion.id,
      text: criterion.text,
      status: "error",
      durationMs: Math.round(performance.now() - started),
      detail: `браузер: ${messageOf(error)} · ${url}`,
      required: criterion.required,
      manual: false,
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
