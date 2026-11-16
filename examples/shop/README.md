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

Ожидаемый результат: 2 http-критерия проходят, ручной критерий помечен как `РУЧНАЯ`,
exit-код 0, в `.witness/` появляются `report.html`, `badge.svg`, `badge.json`.

Проверка «наоборот»: остановите сервер и запустите `run` снова — оба http-критерия
должны упасть с понятной причиной, exit-код 1.
