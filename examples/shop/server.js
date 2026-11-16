// Учебный сервер для проверки Witness: отдаёт JSON и CSV.
import { createServer } from "node:http";

const rows = [
  { id: 1, name: "widget", amount: 100 },
  { id: 2, name: "gadget", amount: 250 },
];

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/api/export") {
    const csv = ["id,name,amount", ...rows.map((row) => `${row.id},${row.name},${row.amount}`)].join("\n");
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
    res.end(`${csv}\n`);
    return;
  }

  if (url.pathname === "/api/items") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(rows));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
});

const port = Number(process.env.PORT ?? 3777);
server.listen(port, "127.0.0.1", () => {
  console.log(`пример слушает http://127.0.0.1:${port}`);
});
