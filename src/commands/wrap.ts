import { spawn } from "node:child_process";
import { run } from "./run.ts";

/** `witness wrap -- <команда>` — запускает агента и сразу проверяет результат. */
export async function wrap(root: string, command: string[], flags: { tamper?: boolean }): Promise<number> {
  if (command.length === 0) {
    console.error("Нужна команда после --: witness wrap -- claude \"задача\"");
    return 2;
  }

  console.log(`Запуск: ${command.join(" ")}\n`);
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(command[0] as string, command.slice(1), {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", (error) => {
      console.error(`не удалось запустить команду: ${error.message}`);
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 0));
  });

  console.log(`\nАгент завершился с кодом ${exitCode}. Проверяем результат.\n`);
  const runCode = await run(root, { all: true, tamper: flags.tamper });
  // Код агента важнее: если он упал, это и есть ответ пользователю.
  return exitCode !== 0 ? exitCode : runCode;
}
