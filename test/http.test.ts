import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";
import type { WitnessConfig } from "../src/core/config.ts";
import type { Criterion } from "../src/core/criteria.ts";
import { readJsonPath, runHttpCheck } from "../src/core/http.ts";

let server: Server;
let baseUrl = "";

function config(overrides: Partial<WitnessConfig> = {}): WitnessConfig {
  return {
    version: 1,
    name: "test",
    baseUrl,
    timeoutMs: 2000,
    headers: {},
    ...overrides,
  };
}

function criterion(check: Criterion["check"]): Criterion {
  return { id: "c", text: "test", required: true, check };
}

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ user: { role: "admin", tags: ["a", "b"] }, count: 2 }));
      return;
    }
    if (req.url === "/json-empty") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ items: [] }));
      return;
    }
    if (req.url === "/csv") {
      res.writeHead(200, { "content-type": "text/csv" });
      res.end("id,name\n1,widget\n");
      return;
    }
    if (req.url === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("late");
      }, 300);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("nope");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
});

test("readJsonPath читает вложенные поля и индексы", () => {
  const value = { user: { roles: [{ name: "admin" }] } };
  assert.equal(readJsonPath(value, "user.roles[0].name"), "admin");
  assert.equal(readJsonPath(value, "user.missing"), undefined);
});

test("статус и jsonPath проходят", async () => {
  const result = await runHttpCheck(
    criterion({
      type: "http",
      method: "GET",
      path: "/json",
      expect: { status: 200, jsonPath: { "user.role": "admin", count: 2 } },
    }),
    { config: config() },
  );
  assert.equal(result.status, "pass");
  assert.match(result.detail, /статус 200/);
});

test("несовпадение значения — fail с объяснением", async () => {
  const result = await runHttpCheck(
    criterion({
      type: "http",
      method: "GET",
      path: "/json",
      expect: { jsonPath: { "user.role": "user" } },
    }),
    { config: config() },
  );
  assert.equal(result.status, "fail");
  assert.match(result.detail, /user\.role/);
});

test("csv: заголовок и подстрока тела", async () => {
  const result = await runHttpCheck(
    criterion({
      type: "http",
      method: "GET",
      path: "/csv",
      expect: { status: 200, header: { "content-type": "text/csv" }, bodyContains: ["id,name"] },
    }),
    { config: config() },
  );
  assert.equal(result.status, "pass");
});

test("jsonNonEmpty: вложенный непустой массив проходит", async () => {
  const result = await runHttpCheck(
    criterion({ type: "http", method: "GET", path: "/json", expect: { jsonNonEmpty: true } }),
    { config: config() },
  );
  assert.equal(result.status, "pass");
  assert.match(result.detail, /непустой список/);
});

test("jsonNonEmpty: пустой массив — fail, а не «есть скобка»", async () => {
  const result = await runHttpCheck(
    criterion({ type: "http", method: "GET", path: "/json-empty", expect: { jsonNonEmpty: true } }),
    { config: config() },
  );
  assert.equal(result.status, "fail");
  assert.match(result.detail, /не содержит непустого списка/);
});

test("bodyMinLines считает непустые строки", async () => {
  const pass = await runHttpCheck(
    criterion({ type: "http", method: "GET", path: "/csv", expect: { bodyMinLines: 2 } }),
    { config: config() },
  );
  assert.equal(pass.status, "pass");

  const fail = await runHttpCheck(
    criterion({ type: "http", method: "GET", path: "/csv", expect: { bodyMinLines: 3 } }),
    { config: config() },
  );
  assert.equal(fail.status, "fail");
  assert.match(fail.detail, /ждали минимум 3/);
});

test("404 — это fail, а не ошибка сети", async () => {
  const result = await runHttpCheck(
    criterion({ type: "http", method: "GET", path: "/missing", expect: { status: 200 } }),
    { config: config() },
  );
  assert.equal(result.status, "fail");
  assert.match(result.detail, /404/);
});

test("недоступный порт даёт status error, не исключение", async () => {
  const result = await runHttpCheck(
    criterion({ type: "http", method: "GET", path: "/json", expect: { status: 200 } }),
    { config: config({ baseUrl: "http://127.0.0.1:1", timeoutMs: 1000 }) },
  );
  assert.equal(result.status, "error");
  assert.match(result.detail, /соединения|таймаут/);
});

test("таймаут обрабатывается как error", async () => {
  const result = await runHttpCheck(
    criterion({ type: "http", method: "GET", path: "/slow", expect: { status: 200 } }),
    { config: config({ timeoutMs: 50 }) },
  );
  assert.equal(result.status, "error");
  assert.match(result.detail, /таймаут/);
});

test("ручной критерий не ходит в сеть и помечается skip", async () => {
  const result = await runHttpCheck(criterion({ type: "manual", steps: ["глазами"] }), { config: config() });
  assert.equal(result.status, "skip");
  assert.equal(result.manual, true);
});

test("POST с телом передаётся на сервер", async () => {
  const server2 = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.writeHead(body.includes("hello") ? 201 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: body }));
    });
  });
  await new Promise<void>((resolve) => server2.listen(0, "127.0.0.1", resolve));
  const address = server2.address();
  const port = address && typeof address === "object" ? address.port : 0;

  try {
    const result = await runHttpCheck(
      criterion({
        type: "http",
        method: "POST",
        path: "/echo",
        body: { message: "hello" },
        expect: { status: 201, bodyContains: ["hello"] },
      }),
      { config: config({ baseUrl: `http://127.0.0.1:${port}` }) },
    );
    assert.equal(result.status, "pass");
  } finally {
    server2.close();
  }
});
