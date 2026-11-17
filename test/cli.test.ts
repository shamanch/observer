import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main, parseArgs, VERSION } from "../src/cli.ts";
import { init } from "../src/commands/init.ts";
import { paths } from "../src/core/config.ts";

test("parseArgs: команды, флаги и значения", () => {
  const parsed = parseArgs(["run", "--all", "--claim", "abc", "--json"]);
  assert.deepEqual(parsed._, ["run"]);
  assert.equal(parsed.flags.all, true);
  assert.equal(parsed.flags.claim, "abc");
  assert.equal(parsed.flags.json, true);
});

test("parseArgs: --key=value", () => {
  const parsed = parseArgs(["run", "--base-url=http://localhost:4000"]);
  assert.equal(parsed.flags.baseUrl, "http://localhost:4000");
});

test("parseArgs: всё после -- уходит в rest", () => {
  const parsed = parseArgs(["wrap", "--", "node", "-e", "process.exit(0)"]);
  assert.deepEqual(parsed._, ["wrap"]);
  assert.deepEqual(parsed.rest, ["node", "-e", "process.exit(0)"]);
});

test("parseArgs: текст задачи сохраняется целиком", () => {
  const parsed = parseArgs(["claim", "добавить", "экспорт", "CSV", "--yes"]);
  assert.deepEqual(parsed._.slice(1), ["добавить", "экспорт", "CSV"]);
  assert.equal(parsed.flags.yes, true);
});

test("--version печатает версию, а не справку", async () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (line?: unknown) => lines.push(String(line));
  try {
    assert.equal(await main(["--version"]), 0);
  } finally {
    console.log = log;
  }
  assert.deepEqual(lines, [VERSION]);
});

test("VERSION совпадает с package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    name: string;
    version: string;
  };
  assert.equal(pkg.name, "witness-cli");
  assert.equal(VERSION, pkg.version);
});

test("без аргументов печатается справка", async () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (line?: unknown) => lines.push(String(line));
  try {
    assert.equal(await main([]), 0);
  } finally {
    console.log = log;
  }
  assert.match(lines.join("\n"), /witness init/);
});

test("init создаёт структуру и идемпотентен", async () => {
  const root = mkdtempSync(join(tmpdir(), "witness-init-"));
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(await init(root), 0);
    const p = paths(root);
    assert.ok(existsSync(p.config));
    assert.ok(existsSync(p.claims));
    // Истории ещё нет: база появляется после первого run, а не при init.
    assert.equal(existsSync(join(p.dir, "witness.db")), false);

    const config = JSON.parse(readFileSync(p.config, "utf8")) as { baseUrl: string; version: number };
    assert.equal(config.version, 1);
    assert.match(config.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

    const before = statSync(p.config).mtimeMs;
    assert.equal(await init(root), 0);
    assert.equal(statSync(p.config).mtimeMs, before, "конфиг не должен перезаписываться");
  } finally {
    console.log = log;
    rmSync(root, { recursive: true, force: true });
  }
});

test("init не затирает правки пользователя", async () => {
  const root = mkdtempSync(join(tmpdir(), "witness-init2-"));
  const log = console.log;
  console.log = () => {};
  try {
    await init(root);
    const p = paths(root);
    const config = JSON.parse(readFileSync(p.config, "utf8")) as Record<string, unknown>;
    config.baseUrl = "http://127.0.0.1:9999";
    writeFileSync(p.config, JSON.stringify(config, null, 2), "utf8");

    await init(root);
    const after = JSON.parse(readFileSync(p.config, "utf8")) as { baseUrl: string };
    assert.equal(after.baseUrl, "http://127.0.0.1:9999");
  } finally {
    console.log = log;
    rmSync(root, { recursive: true, force: true });
  }
});
