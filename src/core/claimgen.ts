import type { Criterion } from "./criteria.ts";
import { slugify } from "./criteria.ts";

/** Офлайн-генератор критериев. Работает без LLM, ключей и сети. */

type Rule = {
  match: RegExp;
  build: (task: string, path: string) => Criterion[];
};

function criterion(text: string, check: Criterion["check"], required = true): Criterion {
  return { id: slugify(text), text, required, check };
}

/** Достаёт первый путь вида /reports или /api/items из формулировки задачи. */
export function extractPath(task: string): string | null {
  const match = task.match(/(^|[\s(«"'])(\/[a-zA-Z0-9\-._~/]*[a-zA-Z0-9\-._~])/);
  return match?.[2] ?? null;
}

/** Достаёт слово-сущность: «экспорт отчёта в CSV» → «отчёт». */
function extractEntity(task: string): string {
  const known = ["отчёт", "отчет", "report", "пользовател", "user", "товар", "product", "заказ", "order", "счёт", "invoice"];
  const lower = task.toLowerCase();
  for (const word of known) {
    if (lower.includes(word)) {
      if (word === "отчет") return "отчёт";
      if (word === "пользовател") return "пользователь";
      if (word === "товар") return "товар";
      if (word === "заказ") return "заказ";
      if (word === "счёт") return "счёт";
      return word;
    }
  }
  return "данные";
}

const RULES: Rule[] = [
  {
    match: /csv|экспорт|export|скачив|download/i,
    build: (task, path) => {
      const route = path || "/api/export";
      const entity = extractEntity(task);
      return [
        criterion(`Маршрут ${route} отвечает 200`, {
          type: "http",
          method: "GET",
          path: route,
          expect: { status: 200 },
        }),
        criterion(`Ответ ${route} отдаёт CSV: заголовок Content-Type и первая строка с разделителем`, {
          type: "http",
          method: "GET",
          path: route,
          expect: { header: { "content-type": "text/csv" }, bodyContains: [","] },
        }),
        criterion(`Экспорт содержит строку заголовков и хотя бы одну строку ${entity}`, {
          type: "http",
          method: "GET",
          path: route,
          expect: { bodyContains: ["\n"] },
        }),
        criterion("В интерфейсе есть кнопка экспорта, и она скачивает файл", {
          type: "manual",
          steps: [
            `Открыть ${path || "страницу с отчётом"}`,
            "Нажать кнопку экспорта",
            "Убедиться, что скачался файл с расширением .csv и в нём есть данные",
          ],
        }),
      ];
    },
  },
  {
    match: /логин|login|вход|авториз|auth|пароль|password/i,
    build: (task) => {
      const route = "/api/login";
      return [
        criterion(`Маршрут ${route} отвечает 200`, {
          type: "http",
          method: "GET",
          path: route,
          expect: { status: 200 },
        }),
        criterion("Неверные учётные данные дают 401, а не 500 и не 200", {
          type: "http",
          method: "POST",
          path: route,
          body: { email: "wrong@example.invalid", password: "wrong" },
          expect: { status: 401 },
        }),
        criterion("Верные учётные данные дают токен или сессию", {
          type: "http",
          method: "POST",
          path: route,
          body: { email: "user@example.invalid", password: "correct-horse" },
          expect: { status: 200 },
        }),
        criterion("После входа закрытая страница доступна, а без сессии — нет", {
          type: "manual",
          steps: ["Войти под тестовым пользователем", "Открыть закрытую страницу", "Выйти и обновить страницу — должен быть редирект на вход"],
        }),
      ];
    },
  },
  {
    match: /api|endpoint|json|rest|ручк|эндпоинт/i,
    build: (task, path) => {
      const route = path || "/api/items";
      return [
        criterion(`Маршрут ${route} отвечает 200 и типом application/json`, {
          type: "http",
          method: "GET",
          path: route,
          expect: { status: 200, header: { "content-type": "application/json" } },
        }),
        criterion(`Ответ ${route} содержит непустой список данных`, {
          type: "http",
          method: "GET",
          path: route,
          expect: { bodyContains: ["["] },
        }),
        criterion("Данные из ответа действительно отображаются в интерфейсе", {
          type: "manual",
          steps: [`Открыть экран, который использует ${route}`, "Сравнить первую запись в интерфейсе с первым элементом ответа API"],
        }),
      ];
    },
  },
  {
    match: /страниц|page|форма|form|кнопк|button|интерфейс|ui/i,
    build: (task, path) => {
      const route = path || "/";
      return [
        criterion(`Страница ${route} отвечает 200`, {
          type: "http",
          method: "GET",
          path: route,
          expect: { status: 200 },
        }),
        criterion(`Страница ${route} содержит непустой HTML`, {
          type: "http",
          method: "GET",
          path: route,
          expect: { bodyContains: ["<"] },
        }),
        criterion("Новый элемент виден и работает в браузере", {
          type: "manual",
          steps: [`Открыть ${route}`, `Найти элемент из задачи: «${task.slice(0, 80)}»`, "Проверить, что действие выполняется без ошибок в консоли"],
        }),
      ];
    },
  },
];

/**
 * Универсальный набор, если ни одно правило не сработало.
 * Честно помечаем ручные шаги как manual, а не подсовываем тавтологичное http-утверждение.
 */
function fallback(task: string, path: string): Criterion[] {
  const route = path || "/";
  return [
    criterion(`Маршрут ${route} отвечает 200`, {
      type: "http",
      method: "GET",
      path: route,
      expect: { status: 200 },
    }),
    criterion("Заявленное поведение воспроизводится по шагам из задачи", {
      type: "manual",
      steps: [
        `Повторить сценарий: «${task.slice(0, 100)}»`,
        "Убедиться, что результат совпадает с ожиданием, а не только с сообщением агента",
      ],
    }),
    criterion("Соседнее поведение не сломалось (регрессия)", {
      type: "manual",
      steps: ["Пройти основной сценарий, который работал до задачи", "Сравнить с прежним поведением"],
    }),
  ];
}

/** Генерирует 3–7 критериев эвристиками: одинаковый результат на одинаковый ввод. */
export function generateHeuristic(task: string): Criterion[] {
  const trimmed = task.trim();
  const path = extractPath(trimmed) ?? "";
  const rule = RULES.find((candidate) => candidate.match.test(trimmed));
  const criteria = rule ? rule.build(trimmed, path) : fallback(trimmed, path);
  return criteria.slice(0, 7);
}
