import assert from "node:assert/strict";
import test from "node:test";
import {
  countHttp,
  makeClaimId,
  slugify,
  uniqueCriterionIds,
  validateClaim,
  type Criterion,
} from "../src/core/criteria.ts";

const valid = {
  id: "2026-11-16-test",
  task: "добавить экспорт CSV на /reports",
  createdAt: "2026-11-16T10:00:00.000Z",
  criteria: [
    {
      id: "route-200",
      text: "Маршрут /reports отвечает 200",
      check: { type: "http", method: "GET", path: "/reports", expect: { status: 200 } },
    },
    {
      id: "manual",
      text: "Кнопка скачивает файл",
      check: { type: "manual", steps: ["нажать", "проверить"] },
    },
  ],
};

test("slugify транслитерирует кириллицу и убирает мусор", () => {
  assert.equal(slugify("Добавить экспорт CSV"), "dobavit-eksport-csv");
  assert.equal(slugify("  ???  "), "claim");
  assert.equal(slugify("a".repeat(100)).length, 48);
});

test("makeClaimId начинается с даты", () => {
  const id = makeClaimId("Экспорт отчёта", new Date("2026-11-16T00:00:00Z"));
  assert.equal(id, "2026-11-16-eksport-otcheta");
});

test("validateClaim принимает корректный claim", () => {
  const result = validateClaim(valid);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.claim.criteria.length, 2);
    assert.equal(result.claim.criteria[0]?.required, true);
    assert.equal(countHttp(result.claim.criteria), 1);
  }
});

test("validateClaim отклоняет http-критерий без утверждений", () => {
  const result = validateClaim({
    ...valid,
    criteria: [
      {
        id: "empty",
        text: "Ничего не проверяет",
        check: { type: "http", method: "GET", path: "/x", expect: {} },
      },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /ни одного утверждения/);
});

test("validateClaim отклоняет критерий без path", () => {
  const result = validateClaim({
    ...valid,
    criteria: [{ id: "x", text: "x", check: { type: "http", method: "GET", expect: { status: 200 } } }],
  });
  assert.equal(result.ok, false);
});

test("validateClaim отклоняет пустой список критериев", () => {
  const result = validateClaim({ ...valid, criteria: [] });
  assert.equal(result.ok, false);
});

test("uniqueCriterionIds разводит дубликаты", () => {
  const criteria = [
    { id: "same", text: "a", required: true },
    { id: "same", text: "b", required: true },
  ] as unknown as Criterion[];
  const unique = uniqueCriterionIds(criteria);
  assert.deepEqual(
    unique.map((item) => item.id),
    ["same", "same-2"],
  );
});
