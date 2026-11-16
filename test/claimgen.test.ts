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

test("API-задача проверяет content-type", () => {
  const criteria = generateHeuristic("Создать API /api/orders со списком заказов");
  const hasJson = criteria.some(
    (criterion) =>
      criterion.check.type === "http" && criterion.check.expect.header?.["content-type"] === "application/json",
  );
  assert.equal(hasJson, true);
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

test("задача без ключевых слов всё равно даёт честные критерии", () => {
  const criteria = generateHeuristic("Сделать что-то полезное");
  assert.equal(countHttp(criteria), 1);
  assert.ok(criteria.some((criterion) => criterion.check.type === "manual"));
  // Никаких тавтологий вида bodyContains: [""]
  for (const criterion of criteria) {
    if (criterion.check.type === "http" && criterion.check.expect.bodyContains) {
      assert.ok(criterion.check.expect.bodyContains.every((needle) => needle.length > 0));
    }
  }
});
