import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import type { WitnessConfig } from "../src/core/config.ts";
import { validateClaim, type Claim } from "../src/core/criteria.ts";
import { exitCodeFor, runClaim } from "../src/core/runner.ts";

function makeClaim(): Claim {
  const result = validateClaim({
    id: "run-test",
    task: "проверить маршруты",
    createdAt: new Date().toISOString(),
    criteria: [
      { id: "ok", text: "маршрут /ok отвечает 200", check: { type: "http", method: "GET", path: "/ok", expect: { status: 200 } } },
      { id: "bad", text: "маршрут /ok отдаёт 404", check: { type: "http", method: "GET", path: "/ok", expect: { status: 404 } } },
      { id: "manual", text: "человек посмотрел", check: { type: "manual", steps: ["посмотреть"] } },
    ],
  });
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.claim;
}

test("runClaim считает pass/fail/skip и не падает", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;

  const config: WitnessConfig = {
    version: 1,
    name: "test",
    baseUrl: `http://127.0.0.1:${port}`,
    timeoutMs: 2000,
    headers: {},
  };

  try {
    const record = await runClaim(makeClaim(), config, { scanTamper: false });
    assert.equal(record.total, 3);
    assert.equal(record.passed, 1);
    assert.equal(record.failed, 1);
    assert.equal(record.skipped, 1);
    assert.equal(record.requiredFailed, 1);
    assert.equal(exitCodeFor(record), 1);
    assert.equal(record.criteria.find((c) => c.criterionId === "manual")?.status, "skip");
  } finally {
    server.close();
  }
});

test("все обязательные прошли — exit-код 0", async () => {
  const claim = makeClaim();
  const onlyPassing: Claim = {
    ...claim,
    criteria: [
      { ...claim.criteria[0]! },
      { ...claim.criteria[2]!, required: false },
    ],
  };
  const config: WitnessConfig = {
    version: 1,
    name: "test",
    baseUrl: "http://127.0.0.1:1",
    timeoutMs: 500,
    headers: {},
  };
  // Сервера нет — оба http-критерия упадут, но manual обязательным не считается.
  const record = await runClaim(onlyPassing, config, { scanTamper: false });
  assert.equal(record.requiredFailed, 1);
  assert.equal(exitCodeFor(record), 1);

  const manualOnly: Claim = { ...claim, criteria: [{ ...claim.criteria[2]! }] };
  const manualRecord = await runClaim(manualOnly, config, { scanTamper: false });
  assert.equal(manualRecord.requiredFailed, 0);
  assert.equal(exitCodeFor(manualRecord), 0);
});
