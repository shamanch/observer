import assert from "node:assert/strict";
import test from "node:test";
import { PLAYWRIGHT_HINT, runBrowserCheck, type BrowserPage, type PlaywrightModule } from "../src/core/browser.ts";
import type { WitnessConfig } from "../src/core/config.ts";
import type { Criterion } from "../src/core/criteria.ts";

type FakeOptions = {
  visible?: Record<string, boolean>;
  body?: string;
  consoleErrors?: Array<string | { text: string; url: string }>;
  gotoError?: string;
};

type Fake = { module: PlaywrightModule; calls: string[]; closed: () => boolean };

/** Фейковый браузер: настоящий Playwright в тестах не нужен. */
function fakePlaywright(options: FakeOptions = {}): Fake {
  const calls: string[] = [];
  let closed = false;
  const handlers: Record<string, Array<(payload: unknown) => void>> = { console: [], pageerror: [] };

  const page: BrowserPage = {
    async goto(url) {
      calls.push(`goto ${url}`);
      if (options.gotoError) throw new Error(options.gotoError);
      for (const entry of options.consoleErrors ?? []) {
        const text = typeof entry === "string" ? entry : entry.text;
        const location = typeof entry === "string" ? undefined : { url: entry.url };
        for (const handler of handlers.console ?? []) handler({ type: () => "error", text: () => text, location: () => location });
      }
    },
    async click(selector) {
      calls.push(`click ${selector}`);
    },
    async fill(selector, value) {
      calls.push(`fill ${selector}=${value}`);
    },
    async isVisible(selector) {
      calls.push(`isVisible ${selector}`);
      return options.visible?.[selector] ?? false;
    },
    async innerText(selector) {
      calls.push(`innerText ${selector}`);
      return options.body ?? "";
    },
    on(event, handler) {
      (handlers[event] ??= []).push(handler);
    },
  };

  const module: PlaywrightModule = {
    chromium: {
      async launch() {
        calls.push("launch");
        return {
          newPage: async () => page,
          close: async () => {
            closed = true;
            calls.push("close");
          },
        };
      },
    },
  };

  return { module, calls, closed: () => closed };
}

function config(): WitnessConfig {
  return {
    version: 1,
    name: "test",
    baseUrl: "http://127.0.0.1:3000",
    timeoutMs: 5000,
    headers: {},
  };
}

function criterion(check: Criterion["check"]): Criterion {
  return { id: "b", text: "браузерная проверка", required: true, check };
}

test("успешная проверка: видимый элемент, текст, чистая консоль", async () => {
  const fake = fakePlaywright({ visible: { ".toast": true }, body: "Готово: файл сохранён" });
  const result = await runBrowserCheck(
    criterion({
      type: "browser",
      path: "/reports",
      expect: { visible: [".toast"], text: ["файл сохранён"], consoleErrors: "none" },
    }),
    { config: config(), loader: async () => fake.module },
  );

  assert.equal(result.status, "pass");
  assert.match(result.detail, /виден \.toast/);
  assert.match(result.detail, /текст/);
  assert.equal(fake.closed(), true);
});

test("невидимый элемент — fail с указанием селектора", async () => {
  const fake = fakePlaywright({ visible: { ".toast": false } });
  const result = await runBrowserCheck(
    criterion({ type: "browser", path: "/", expect: { visible: [".toast"] } }),
    { config: config(), loader: async () => fake.module },
  );

  assert.equal(result.status, "fail");
  assert.match(result.detail, /не виден: \.toast/);
});

test("отсутствующий текст — fail", async () => {
  const fake = fakePlaywright({ body: "пусто" });
  const result = await runBrowserCheck(
    criterion({ type: "browser", path: "/", expect: { text: ["экспорт готов"] } }),
    { config: config(), loader: async () => fake.module },
  );

  assert.equal(result.status, "fail");
  assert.match(result.detail, /нет текста/);
});

test("ошибка в консоли валит проверку и попадает в detail", async () => {
  const fake = fakePlaywright({ body: "ok", consoleErrors: ["Uncaught TypeError: x is not a function"] });
  const result = await runBrowserCheck(
    criterion({ type: "browser", path: "/", expect: { consoleErrors: "none" } }),
    { config: config(), loader: async () => fake.module },
  );

  assert.equal(result.status, "fail");
  assert.match(result.detail, /ошибки в консоли/);
  assert.match(result.detail, /x is not a function/);
});

test("шаги выполняются по порядку: click и fill", async () => {
  const fake = fakePlaywright({ visible: { "#result": true } });
  const result = await runBrowserCheck(
    criterion({
      type: "browser",
      path: "/form",
      steps: [
        { action: "fill", selector: "#email", value: "user@example.invalid" },
        { action: "click", selector: "#submit" },
      ],
      expect: { visible: ["#result"] },
    }),
    { config: config(), loader: async () => fake.module },
  );

  assert.equal(result.status, "pass");
  const actionable = fake.calls.filter((call) => !call.startsWith("goto") && call !== "launch" && call !== "close");
  assert.deepEqual(actionable, ["fill #email=user@example.invalid", "click #submit", "isVisible #result"]);
});

test("адрес собирается из baseUrl и path", async () => {
  const fake = fakePlaywright({ body: "ok" });
  await runBrowserCheck(
    criterion({ type: "browser", path: "/reports", expect: { text: ["ok"] } }),
    { config: config(), loader: async () => fake.module },
  );
  assert.ok(fake.calls.includes("goto http://127.0.0.1:3000/reports"));
});

test("без playwright — понятная ошибка, а не стектрейс", async () => {
  const result = await runBrowserCheck(
    criterion({ type: "browser", path: "/", expect: { consoleErrors: "none" } }),
    { config: config(), loader: async () => null },
  );

  assert.equal(result.status, "error");
  assert.equal(result.detail, PLAYWRIGHT_HINT);
});

test("404 favicon не считается ошибкой приложения", async () => {
  const fake = fakePlaywright({
    body: "ok",
    consoleErrors: [
      { text: "Failed to load resource: the server responded with a status of 404", url: "http://127.0.0.1:3000/favicon.ico" },
    ],
  });
  const result = await runBrowserCheck(
    criterion({ type: "browser", path: "/", expect: { consoleErrors: "none" } }),
    { config: config(), loader: async () => fake.module },
  );
  assert.equal(result.status, "pass");
  assert.match(result.detail, /ошибок в консоли нет/);
});

test("404 другого ресурса остаётся ошибкой", async () => {
  const fake = fakePlaywright({
    body: "ok",
    consoleErrors: [
      { text: "Failed to load resource: the server responded with a status of 404", url: "http://127.0.0.1:3000/app.js" },
    ],
  });
  const result = await runBrowserCheck(
    criterion({ type: "browser", path: "/", expect: { consoleErrors: "none" } }),
    { config: config(), loader: async () => fake.module },
  );
  assert.equal(result.status, "fail");
});

test("падение загрузчика тоже даёт error, а не исключение", async () => {
  const result = await runBrowserCheck(
    criterion({ type: "browser", path: "/", expect: { consoleErrors: "none" } }),
    {
      config: config(),
      loader: async () => {
        throw new Error("модуль сломан");
      },
    },
  );

  assert.equal(result.status, "error");
  assert.equal(result.detail, PLAYWRIGHT_HINT);
});

test("ошибка навигации даёт status error и закрывает браузер", async () => {
  const fake = fakePlaywright({ gotoError: "net::ERR_CONNECTION_REFUSED" });
  const result = await runBrowserCheck(
    criterion({ type: "browser", path: "/", expect: { consoleErrors: "none" } }),
    { config: config(), loader: async () => fake.module },
  );

  assert.equal(result.status, "error");
  assert.match(result.detail, /ERR_CONNECTION_REFUSED/);
  assert.equal(fake.closed(), true);
});
