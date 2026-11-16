import assert from "node:assert/strict";
import test from "node:test";
import { scanDiffText, scanRepo } from "../src/core/tamper.ts";

const diffWithRemovedAssertion = `diff --git a/src/app.test.ts b/src/app.test.ts
--- a/src/app.test.ts
+++ b/src/app.test.ts
@@ -10,3 +10,2 @@
 expect(response.status).toBe(200);
-assert.equal(body.length, 3);
`;

const diffWithSkip = `diff --git a/test/api.test.ts b/test/api.test.ts
--- a/test/api.test.ts
+++ b/test/api.test.ts
@@ -1,1 +1,2 @@
 describe("api", () => {
+  it.skip("работает", () => {});
`;

const diffWithNoVerify = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -3,1 +3,1 @@
-"commit": "lint-staged"
+"commit": "lint-staged --no-verify"
`;

const diffWithCiChange = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,1 +1,1 @@
-run: npm test
+run: npm test || true
`;

const diffWithDeletedTest = `diff --git a/test/old.test.ts b/test/old.test.ts
deleted file mode 100644
--- a/test/old.test.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-test("old", () => {
-  expect(1).toBe(1);
-});
`;

test("удалённый assert ловится как high", () => {
  const findings = scanDiffText(diffWithRemovedAssertion);
  const hit = findings.find((f) => f.rule === "removed-assertion");
  assert.ok(hit);
  assert.equal(hit.severity, "high");
  assert.equal(hit.file, "src/app.test.ts");
});

test("добавленный skip ловится", () => {
  const findings = scanDiffText(diffWithSkip);
  assert.ok(findings.some((f) => f.rule === "added-skip"));
});

test("--no-verify ловится", () => {
  const findings = scanDiffText(diffWithNoVerify);
  assert.ok(findings.some((f) => f.rule === "no-verify"));
});

test("правка CI ловится и не дублируется", () => {
  const findings = scanDiffText(diffWithCiChange);
  const ci = findings.filter((f) => f.rule === "ci-change");
  assert.equal(ci.length, 1);
  assert.equal(ci[0]?.severity, "medium");
});

test("удаление тестового файла ловится", () => {
  const findings = scanDiffText(diffWithDeletedTest);
  assert.ok(findings.some((f) => f.rule === "deleted-test-file"));
});

test("чистый дифф не даёт находок", () => {
  const clean = `diff --git a/src/feature.ts b/src/feature.ts
--- a/src/feature.ts
+++ b/src/feature.ts
@@ -1,1 +1,2 @@
 export const x = 1;
+export const y = 2;
`;
  assert.deepEqual(scanDiffText(clean), []);
});

test("вне git репозитория scanRepo не бросает исключение", () => {
  const report = scanRepo(process.cwd());
  assert.equal(typeof report.available, "boolean");
  assert.ok(Array.isArray(report.findings));
});
