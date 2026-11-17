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

## Эпик 6. Браузерные проверки

### T6.1 — `check.type: "browser"`
- **files:** `src/core/browser.ts`, `src/core/criteria.ts`, `src/core/runner.ts`, `src/core/claimgen.ts`
- **acceptance:** критерий открывает страницу в Chromium, выполняет `click`/`fill`, проверяет `visible`, `text`, `consoleErrors`; Playwright загружается лениво и отсутствует в `dependencies`; без пакета — статус `error` с командой установки, не падение.
- **verify:** `node --test test/browser.test.ts` (фейковый драйвер, реальный браузер в CI не нужен).

### T6.2 — SQLite-история
- **files:** `src/core/ledger.ts`, `test/ledger.test.ts`
- **acceptance:** прогоны пишутся в `.witness/witness.db` через `node:sqlite`; старые `.witness/runs/*.json` импортируются один раз и не удаляются; чтение не создаёт базу.
- **verify:** `node --test test/ledger.test.ts` + `witness run` дважды → `ledgerHash.runs === 2`.

---

## Эпик 7. Измерение доверия (golden-набор)

### T7.1 — Сервер двух состояний
- **files:** `eval/golden/server.mjs`
- **acceptance:** `GOLDEN_STATE=broken` — фичи нет, включая «тихие» ловушки (`200 application/json` с пустым списком, `200 text/plain` вместо CSV); `GOLDEN_STATE=fixed` — фича реализована ровно по маршрутам кейсов; маршруты из negative-кейсов отсутствуют в обоих состояниях.
- **verify:** `GOLDEN_STATE=broken PORT=3911 node eval/golden/server.mjs` → `curl /api/items` отдаёт `{"items":[]}`, `/api/session` → 404.
- **статус:** [x]

### T7.2 — Харнесс и метрики
- **files:** `eval/golden/run.mjs`, `eval/golden/cases.json`
- **acceptance:** 20 кейсов (13 positive, 7 negative); для каждого `init` → `claim --yes --no-llm` → `run --baseline` на broken → `run` на fixed; считаются false-green, negative-green, false-red, тавтологии, доля машинных критериев; отчёт пишется в `eval/golden/last-report.json`; exit 1 при регрессии.
- **verify:** `npm run golden` → таблица 20 кейсов, `last-report.json` существует; exit 0 только при нулевых false-green/negative-green/false-red.
- **статус:** [x]

### T7.3 — Сила критериев
- **files:** `src/core/criteria.ts`, `src/core/http.ts`, `src/core/claimgen.ts`
- **acceptance:** `jsonNonEmpty` требует непустой массив, а не символ `[`; `bodyMinLines` требует минимум N непустых строк; login/api/csv берут маршрут из задачи; fallback без маршрута — только ручные критерии; без машинных проверок exit 1; badge `no machine checks`; отчёт `НЕ ПРОВЕРЕНО`.
- **verify:** `node --test test/http.test.ts test/criteria.test.ts test/claimgen.test.ts test/runner.test.ts test/badge.test.ts test/report.test.ts` + `npm run golden` → 0/20 false-green.
- **статус:** [x]

---

## Эпик 8. Дистрибуция npm

### T8.1 — Сборка без зависимостей
- **files:** `scripts/build.mjs`, `package.json`
- **acceptance:** `prepare` снимает типы через встроенный `stripTypeScriptTypes`, переписывает импорты `.ts` → `.js`, кладёт `dist/`; `files` включает `dist`, `skills`, README, LICENSE; `engines.node >= 24`; `dependencies: {}`.
- **verify:** `npm pack --dry-run` → в списке только `dist/` (не `src/*.ts`), `skills/witness/SKILL.md` присутствует; `node dist/bin/witness.js --version` → `0.1.0`.
- **статус:** [x]

### T8.2 — Проверка установленного пакета
- **files:** `witness-cli-0.1.0.tgz` (артефакт сборки, в git не входит)
- **acceptance:** установка в чистый префикс работает; установленный пакет на golden-сервере даёт broken → exit 1, fixed → exit 0; `witness --version` не падает на `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
- **verify:** `npm i -g witness-cli-0.1.0.tgz --prefix <tmp>` + прогон broken/fixed → `INSTALLED PACKAGE OK`.
- **статус:** [x]

### T8.3 — Публикация
- **acceptance:** `npm publish` выполнен, `npx witness-cli --version` работает у стороннего пользователя.
- **verify:** `npm view witness-cli version` → `0.1.0`.
- **статус:** [x] — `witness-cli@0.1.0` опубликован в registry; установка из npm проверена end-to-end (`INSTALLED PACKAGE OK`). Первая публикация прошла через staged publishing: placeholder `0.0.0-stage`, затем `0.1.0`.

---

## Эпик 9. VS Code и навык для агента

### T9.1 — VSIX
- **files:** `vscode/package.json`, `vscode/.vscodeignore`, `vscode/LICENSE`, `vscode/witness-vscode-0.1.0.vsix`
- **acceptance:** `@vscode/vsce package` собирает расширение без ошибок; в VSIX входят `package.json`, `readme.md`, `LICENSE.txt`, `src/extension.cjs`; `private` снят, лицензия MIT.
- **verify:** `npx --yes @vscode/vsce package` → `DONE Packaged: … (6 files)`.
- **статус:** [x]

### T9.2 — Публикация расширения
- **acceptance:** расширение опубликовано реальным publisher, устанавливается из Marketplace.
- **verify:** `code --install-extension <publisher>.witness-vscode`.
- **статус:** [ ] — **заблокировано:** нужен publisher-аккаунт; `"publisher": "witness"` — заглушка.

### T9.3 — Навык `witness`
- **files:** `skills/witness/SKILL.md`
- **acceptance:** навык требует утверждения критериев человеком, baseline до работы и свежий `witness run` перед словом «готово»; запрещает ослаблять критерии и считать ручные шаги доказательством; формат ответа содержит exit-код и детали падений.
- **verify:** файл входит в npm-tarball (`npm pack --dry-run`); формат соответствует `components/skills/<category>/<name>/SKILL.md`.
- **статус:** [x]

### T9.4 — PR в aitmpl
- **acceptance:** навык добавлен в `davila7/claude-code-templates` по пути `cli-tool/components/skills/development/witness/SKILL.md`.
- **verify:** файл виден в upstream-репозитории, каталог aitmpl его показывает.
- **статус:** [ ] — **заблокировано:** нужен форк и авторизация GitHub.

---

## Definition of Done (для всего MVP)

1. `node --test` — все тесты зелёные.
2. `node bin/witness.js --help` работает без установленных зависимостей.
3. Сквозной путь `init → claim --yes → run → report → badge` проходит на чистом примере.
4. README объясняет путь за 5 минут и содержит badge.
5. Нет ни одной внешней зависимости в ядре (`dependencies: {}`).
