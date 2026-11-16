// Сборка для npm: убирает типы встроенным Node-модулем и переписывает .ts в .js.
// Нужна только при публикации: в репозитории код исполняется напрямую.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const BIN = join(ROOT, "bin");
const DIST = join(ROOT, "dist");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** После снятия типов импорты всё ещё указывают на .ts — в пакете их нет. */
function rewriteImports(code) {
  return code
    .replace(/(\bfrom\s*["'][^"']+)\.ts(["'])/g, "$1.js$2")
    .replace(/(\bimport\s*\(\s*["'][^"']+)\.ts(["']\s*\))/g, "$1.js$2");
}

rmSync(DIST, { recursive: true, force: true });

let count = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\.ts$/, ".js");
  const code = readFileSync(file, "utf8");
  const stripped = stripTypeScriptTypes(code, { mode: "strip" });
  const target = join(DIST, "src", rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, rewriteImports(stripped), "utf8");
  count += 1;
}

const binCode = readFileSync(join(BIN, "witness.js"), "utf8");
const binTarget = join(DIST, "bin", "witness.js");
mkdirSync(dirname(binTarget), { recursive: true });
writeFileSync(binTarget, rewriteImports(binCode), { encoding: "utf8", mode: 0o755 });

console.log(`собрано: ${count} файлов src + bin/witness.js → dist/`);
