# TASKS: Witness MVP

Легенда: `[ ]` — не начато, `[x]` — готово. Каждая задача имеет **acceptance** (что должно быть истинно) и **verify** (как проверить машинно).

---

## Эпик 0. Фундамент

### T0.1 — Каркас репозитория
- **files:** `package.json`, `tsconfig.json`, `.gitignore`, `README.md`
- **acceptance:** `node bin/witness.js --help` печатает список команд и exit-код 0; `npm test` запускает `node --test`.
- **verify:** `node bin/witness.js --help && node --test`
- **статус:** [x]

### T0.2 — Конфиг и `.witness/`
- **files:** `src/core/config.ts`, `src/commands/init.ts`
- **acceptance:** `init` создаёт `.witness/witness.json`, `.witness/claims/`, `.witness/runs/`; повторный вызов не перезаписывает пользовательские значения; в `.gitignore` добавляется только `.witness/runs/*.tmp`.
- **verify:** `node bin/witness.js init` дважды подряд, второй — без ошибок и без изменения mtime `witness.json`.
- **статус:** [x]

---

## Эпик 1. Claim — критерии приёмки

### T1.1 — Модель критерия
- **files:** `src/core/criteria.ts`
- **acceptance:** тип `Criterion { id, text, check: {type:'http', method, url, expect}, required }`; валидатор отклоняет критерий без `expect`; id стабилен (slug + counter).
- **verify:** `node --test test/criteria.test.ts`

### T1.2 — Генератор критериев из задачи
- **files:** `src/core/claimgen.ts`
- **acceptance:** для задачи вида «добавь экспорт CSV на /reports» возвращает ≥3 критерия, среди них минимум один `http`-проверяемый; при `--llm` и наличии ключа — использует модель, иначе эвристики; ответ модели валидируется схемой.
- **verify:** `node --test test/claimgen.test.ts` (10 golden-кейсов)

### T1.3 — Команда `claim`
- **files:** `src/commands/claim.ts`
- **acceptance:** пишет `.witness/claims/<id>.json`; показывает черновик и ждёт `y/n/e`; `--yes` пропускает интерактив; `--dry-run` ничего не пишет.
- **verify:** `echo y | node bin/witness.js claim "..."` → файл существует, JSON валиден.

---

## Эпик 2. Run — исполнение

### T2.1 — HTTP-проверка
- **files:** `src/checks/http.ts`
- **acceptance:** поддерживает `status`, `bodyContains`, `jsonPath eq`, `header eq`; таймаут по умолчанию 10 с; сетевые ошибки → `fail` с кодом `ENETWORK`, а не падение процесса.
- **verify:** `node --test test/http.test.ts` (локальный сервер на 127.0.0.1)

### T2.2 — Исполнитель
- **files:** `src/core/runner.ts`
- **acceptance:** прогоняет критерии последовательно, пишет результат по каждому, никогда не бросает исключение наружу; exit-код 0 только если все `required` прошли.
- **verify:** `node --test test/runner.test.ts`

### T2.3 — Ledger
- **files:** `src/core/ledger.ts`
- **acceptance:** история в `.witness/witness.db` (SQLite, встроенный драйвер, без npm-зависимостей); каждый прогон имеет `hash` = SHA-256 канонического JSON; прошлые записи не меняются; старые `.witness/runs/*.json` импортируются один раз.
- **verify:** два прогона → две строки в таблице `runs`, `loadLatest` возвращает последний; hash пересчитывается и совпадает; файл `witness.db` существует.

### T2.4 — Команда `run`
- **files:** `src/commands/run.ts`
- **acceptance:** `run` (последний claim), `run --all` (весь ledger), `run --claim <id>`; печатает pass/fail таблицей; `--json` для машинного вывода.
- **verify:** `node bin/witness.js run --all`

---

## Эпик 3. Доверие — differential и anti-tamper

### T3.1 — Differential
- **files:** `src/core/differential.ts`
- **acceptance:** критерий, зелёный и на базе, помечается `tautology`; при `--base` без git-репозитория — предупреждение, не ошибка.
- **verify:** `node --test test/differential.test.ts`

### T3.2 — Anti-tamper
- **files:** `src/core/tamper.ts`
- **acceptance:** ловит в `git diff`: `skip(`, `.only(`, `--no-verify`, удаление строк с `assert`, правку `.github/workflows/*`; возвращает список находок с файлом и строкой.
- **verify:** `node --test test/tamper.test.ts` (фикстура с диффом)

---

## Эпик 4. Видимость

### T4.1 — Отчёт
- **files:** `src/core/report.ts`, `src/commands/report.ts`
- **acceptance:** `report` создаёт `.witness/report.html` — один файл, без внешних ссылок; содержит таблицу критериев, вердикты, пометки `tautology`/`tamper`.
- **verify:** `node bin/witness.js report` → файл существует, в нём нет `http://` и `https://`.

### T4.2 — Badge
- **files:** `src/core/badge.ts`, `src/commands/badge.ts`
- **acceptance:** `badge` пишет `.witness/badge.svg` и `.witness/badge.json` с `hash` ledger; `badge --verify` пересчитывает и говорит `ok`/`mismatch`; цвет зависит от доли прошедших (≥95% зелёный, ≥80% жёлтый, иначе красный).
- **verify:** `node bin/witness.js badge && node bin/witness.js badge --verify`

---

## Эпик 5. Интеграции

### T5.1 — `wrap`
- **files:** `src/commands/wrap.ts`
- **acceptance:** запускает произвольную команду, наследует stdio, сохраняет её exit-код, затем делает `run --all`; при падении агента прогон всё равно выполняется.
- **verify:** `node bin/witness.js wrap -- node -e "process.exit(3)"` → exit-код 3, прогон выполнен.

### T5.2 — VS Code-расширение
- **files:** `vscode/package.json`, `vscode/src/extension.cjs`, `vscode/README.md`
- **acceptance:** 3 команды (`witness.init`, `witness.claim`, `witness.run`); каждая вызывает CLI через `child_process`; вывод в Output Channel `Witness`; при отсутствии CLI — понятная ошибка.
- **verify:** `node --check vscode/src/extension.cjs` без ошибок (сборка не нужна).

---

## Definition of Done (для всего MVP)

1. `node --test` — все тесты зелёные.
2. `node bin/witness.js --help` работает без установленных зависимостей.
3. Сквозной путь `init → claim --yes → run → report → badge` проходит на чистом примере.
4. README объясняет путь за 5 минут и содержит badge.
5. Нет ни одной внешней зависимости в ядре (`dependencies: {}`).
