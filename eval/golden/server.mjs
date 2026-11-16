// Учебное приложение для golden-набора: одно и то же, но в двух состояниях.
// GOLDEN_STATE=broken — фичи нет (иногда «тихо»: 200 и JSON, но пусто).
// GOLDEN_STATE=fixed  — фича реализована ровно по маршрутам из кейсов.
import { createServer } from "node:http";

const STATE = process.env.GOLDEN_STATE === "fixed" ? "fixed" : "broken";
const PORT = Number(process.env.PORT ?? 3911);

const CSV_ROUTES = new Set([
  "/api/export",
  "/api/orders/export",
  "/api/download",
  "/api/clients/csv",
  "/export/report.csv",
]);

const LOGIN_ROUTES = new Set(["/api/login", "/login", "/auth/signin"]);

// Маршруты, которые в «исправленном» приложении сознательно не реализованы:
// задача называет другой адрес, и witness не должен уходить проверять соседний.
const ABSENT_ROUTES = new Set(["/api/session", "/signin"]);

const DATA_ROUTES = new Set(["/api/orders", "/api/items", "/api/users", "/api/products", "/api/tasks"]);

const rows = [
  { id: 1, name: "widget", amount: 100 },
  { id: 2, name: "gadget", amount: 250 },
];

function send(res, status, type, body) {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function csv(res) {
  if (STATE === "broken") {
    // Ловушка: статус 200, но это не CSV. Проверка обязана смотреть content-type.
    send(res, 200, "text/plain; charset=utf-8", "экспорт ещё не реализован\n");
    return;
  }
  const lines = ["id,name,amount", ...rows.map((row) => `${row.id},${row.name},${row.amount}`)];
  send(res, 200, "text/csv; charset=utf-8", `${lines.join("\n")}\n`);
}

function login(req, res, raw) {
  if (STATE === "broken") {
    send(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: "not implemented" }));
    return;
  }
  if (req.method === "POST") {
    if (raw.includes("wrong")) {
      send(res, 401, "application/json; charset=utf-8", JSON.stringify({ error: "unauthorized" }));
      return;
    }
    send(res, 200, "application/json; charset=utf-8", JSON.stringify({ token: "test-token" }));
    return;
  }
  send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true }));
}

function jsonData(res) {
  if (STATE === "broken") {
    // Главная ловушка golden-набора: формально 200 и application/json,
    // но данных нет. Слабая проверка «тело содержит [» здесь позеленеет.
    send(res, 200, "application/json; charset=utf-8", JSON.stringify({ items: [] }));
    return;
  }
  send(res, 200, "application/json; charset=utf-8", JSON.stringify(rows));
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    if (ABSENT_ROUTES.has(path)) {
      send(res, 404, "text/plain; charset=utf-8", "not found");
      return;
    }
    if (CSV_ROUTES.has(path)) {
      csv(res);
      return;
    }
    if (LOGIN_ROUTES.has(path)) {
      login(req, res, raw);
      return;
    }
    if (DATA_ROUTES.has(path)) {
      jsonData(res);
      return;
    }
    if (path === "/") {
      if (STATE === "broken") {
        send(res, 404, "text/plain; charset=utf-8", "not found");
        return;
      }
      send(res, 200, "text/html; charset=utf-8", "<!doctype html><html><body><h1>OK</h1></body></html>");
      return;
    }
    send(res, 404, "text/plain; charset=utf-8", "not found");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`golden server ${STATE} on ${PORT}`);
});
