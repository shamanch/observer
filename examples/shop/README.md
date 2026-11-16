# Пример: как выглядит работа Witness

```bash
cd examples/shop
node server.js        # в отдельном терминале

node ../../bin/witness.js init
node ../../bin/witness.js claim "Добавить экспорт отчёта в CSV на странице /api/export" --yes
node ../../bin/witness.js run
node ../../bin/witness.js report
node ../../bin/witness.js badge
node ../../bin/witness.js badge --verify
```

Ожидаемый результат: 3 http-критерия проходят, ручной критерий помечен как `РУЧНАЯ`,
exit-код 0, в `.witness/` появляются `witness.db`, `report.html`, `badge.svg`, `badge.json`.

Проверка «наоборот»: остановите сервер и запустите `run` снова — http-критерии
должны упасть с понятной причиной, exit-код 1.

## Браузерная проверка (необязательно)

На `/` отдаётся страница с кнопкой экспорта. Чтобы проверить её в браузере:

```bash
npm i -D playwright
npx playwright install chromium

node ../../bin/witness.js claim "Сверстать страницу / с кнопкой экспорта" --yes
node ../../bin/witness.js run
```

`claim` добавит критерий «страница открывается без ошибок в консоли». Если нужен клик,
допишите в `.witness/claims/<id>.json` шаги и ожидание:

```json
"steps": [{ "action": "click", "selector": "#export" }],
"expect": { "text": ["Готово"], "consoleErrors": "none" }
```

Без установленного Playwright такой критерий честно упадёт со статусом `error`
и командой установки, а не притворится зелёным.
