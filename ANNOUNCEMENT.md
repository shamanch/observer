# Анонс Witness 0.1.3

Готовые тексты для публикации. Ничего не обещают сверх того, что умеет инструмент.

## Русский

**Witness — проверка, что AI-агент действительно сделал задачу**

Агент говорит «готово», а фича не работает: тестов не было, а слово модели проверить нечем.
Witness превращает задачу в критерии приёмки, которые утверждает человек, и прогоняет их
детерминированно — без второй LLM в роли судьи.

```bash
witness claim "Экспорт CSV на /reports"
# ... агент работает ...
witness run
```

На выходе: pass/fail по каждому критерию, HTML-отчёт, история прогонов в SQLite и badge
с хешем ledger. Baseline до работы отделяет настоящую проверку от тавтологии, anti-tamper
ловит попытки ослабить проверки вместо кода.

Без API-ключей, Docker и зависимостей. Node 24+.

- npm: `npm i -g witness-cli`
- VS Code: `code --install-extension shamanch.witness-vscode`
- GitHub: https://github.com/shamanch/observer

Golden-набор v1: 20 HTTP-кейсов, ложных зелёных — 0.

Чего не делает: не заменяет code review и не ищет уязвимости. Зелёный badge значит
«утверждённые проверки прошли», а не «продукт хороший».

## English

**Witness — proof that an AI agent actually completed the task**

Agents say "done"; the feature still doesn't work. There were no tests, and the model's word
is not evidence. Witness turns a task into human-approved acceptance criteria and runs them
deterministically — no second LLM as a judge.

```bash
witness claim "CSV export on /reports"
# ... the agent works ...
witness run
```

You get pass/fail per criterion, an HTML report, a SQLite run history, and a badge with the
ledger hash. A baseline before the work separates a real check from a tautology; anti-tamper
flags attempts to weaken checks instead of fixing code.

No API keys, no Docker, zero runtime dependencies. Node 24+.

- npm: `npm i -g witness-cli`
- VS Code: `code --install-extension shamanch.witness-vscode`
- GitHub: https://github.com/shamanch/observer

Golden set v1: 20 HTTP cases, 0 false greens.

Not a code review, not a vulnerability scanner. A green badge means the approved checks
passed, not that the product is good.

## Совсем коротко (X / Mastodon)

```
AI-агент сказал «готово» — а фича не работает.

Witness превращает задачу в утверждённые человеком критерии и прогоняет их
детерминированно: pass/fail, HTML-отчёт, badge с хешем истории.

npm i -g witness-cli
code --install-extension shamanch.witness-vscode
github.com/shamanch/observer

Без ключей, Docker и зависимостей. Node 24+.
```
