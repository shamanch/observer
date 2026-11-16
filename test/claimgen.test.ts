import assert from "node:assert/strict";
import test from "node:test";
import { extractPath, generateHeuristic } from "../src/core/claimgen.ts";
import { countHttp, validateClaim } from "../src/core/criteria.ts";

const cases = [
  "Добавить экспорт отчёта в CSV на странице /reports",
  "Сделай выгрузку данных в csv",
  "Добавить логин через email и пароль",
  "Починить авторизацию на /login",
  "Создать API /api/orders со списком заказов",
  "Отдавать JSON на /api/items",
  "Сверстать страницу /pricing с новым блоком",
  "Переделать форму подписки",
  "Обновить кнопку «Купить» на лендинге",
  "Сделать что-то полезное",
];

test("на каждую из 10 задач получается валидный claim", () => {
  for (const task of cases) {
    const criteria = generateHeuristic(task);
    assert.ok(criteria.length >= 3, `${task}: слишком мало критериев (${criteria.length})`);
    assert.ok(criteria.length <= 7, `${task}: слишком много критериев`);

    const result = validateClaim({
      id: "t",
      task,
      createdAt: new Date().toISOString(),
      criteria,
    });
    assert.equal(result.ok, true, `${task}: ${result.ok ? "" : result.errors.join("; ")}`);
  }
});

test("экспорт CSV даёт http-проверки и путь из задачи", () => {
  const criteria = generateHeuristic("Добавить экспорт отчёта в CSV на странице /reports");
  assert.ok(countHttp(criteria) >= 2);
  const paths = criteria
    .map((criterion) => (criterion.check.type === "http" ? criterion.check.path : ""))
    .filter(Boolean);
  assert.ok(paths.includes("/reports"), `нет /reports среди ${paths.join(", ")}`);
});

test("логин проверяет код 401 на неверных данных", () => {
  const criteria = generateHeuristic("Добавить логин через email и пароль");
  const hasUnauthorized = criteria.some(
    (criterion) => criterion.check.type === "http" && criterion.check.expect.status === 401,
  );
  assert.equal(hasUnauthorized, true);
});

test("логин проверяет маршрут из задачи, а не всегда /api/login", () => {
  const criteria = generateHeuristic("Сделать login на /api/session");
  const paths = criteria
    .map((criterion) => (criterion.check.type === "http" ? criterion.check.path : ""))
    .filter(Boolean);
  assert.ok(paths.includes("/api/session"), `нет /api/session среди ${paths.join(", ")}`);
  assert.equal(paths.includes("/api/login"), false);
});

test("API-задача требует непустой JSON, а не просто скобку", () => {
  const criteria = generateHeuristic("Создать API /api/orders со списком заказов");
  const nonEmpty = criteria.find(
    (criterion) => criterion.check.type === "http" && criterion.check.expect.jsonNonEmpty === true,
  );
  assert.ok(nonEmpty, "нет критерия jsonNonEmpty");
  const bracket = criteria.find(
    (criterion) =>
      criterion.check.type === "http" && criterion.check.expect.bodyContains?.includes("["),
  );
  assert.equal(bracket, undefined, "осталась слабая проверка на скобку");
});

test("CSV-задача требует минимум две непустые строки", () => {
  const criteria = generateHeuristic("Добавить экспорт отчёта в CSV на странице /reports");
  const lines = criteria.find(
    (criterion) => criterion.check.type === "http" && criterion.check.expect.bodyMinLines === 2,
  );
  assert.ok(lines, "нет критерия bodyMinLines: 2");
});

test("API-задача проверяет content-type", () => {
  const criteria = generateHeuristic("Создать API /api/orders со списком заказов");
  const hasJson = criteria.some(
    (criterion) =>
      criterion.check.type === "http" && criterion.check.expect.header?.["content-type"] === "application/json",
  );
  assert.equal(hasJson, true);
});

test("UI-задача получает браузерную проверку консоли", () => {
  const criteria = generateHeuristic("Сверстать страницу /pricing с новым блоком");
  const browserCheck = criteria.find((criterion) => criterion.check.type === "browser");
  assert.ok(browserCheck, "нет browser-критерия");
  if (browserCheck.check.type === "browser") {
    assert.equal(browserCheck.check.path, "/pricing");
    assert.equal(browserCheck.check.expect.consoleErrors, "none");
  }
  assert.ok(criteria.some((criterion) => criterion.check.type === "manual"));
});

test("генерация детерминирована", () => {
  const task = "Добавить экспорт отчёта в CSV на странице /reports";
  assert.deepEqual(generateHeuristic(task), generateHeuristic(task));
});

test("extractPath находит путь и не путается в тексте без пути", () => {
  assert.equal(extractPath("экспорт на /reports"), "/reports");
  assert.equal(extractPath("api /api/items?limit=10"), "/api/items");
  assert.equal(extractPath("без пути вообще"), null);
});

test("расплывчатая задача без маршрута не получает выдуманную http-проверку", () => {
  const criteria = generateHeuristic("Сделать что-то полезное");
  assert.equal(countHttp(criteria), 0);
  assert.equal(criteria.every((criterion) => criterion.check.type === "manual"), true);
  assert.ok(criteria.length >= 3);
});
