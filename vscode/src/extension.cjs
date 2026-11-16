// Тонкая обёртка над CLI: расширение не дублирует логику и не хранит состояние.
const vscode = require("vscode");
const { execFile } = require("node:child_process");
const path = require("node:path");

let channel;

function cliCommand() {
  const configured = vscode.workspace.getConfiguration("witness").get("cliPath", "witness");
  return String(configured || "witness").trim();
}

function workspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

function splitCommand(command) {
  const parts = command.match(/"[^"]+"|\S+/g) || [];
  return parts.map((part) => part.replace(/^"|"$/g, ""));
}

function runCli(args) {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage("Witness: сначала откройте папку проекта.");
    return Promise.resolve(1);
  }

  const [command, ...prefix] = splitCommand(cliCommand());
  channel.show(true);
  channel.appendLine(`$ ${cliCommand()} ${args.join(" ")}`);

  return new Promise((resolve) => {
    const child = execFile(
      command,
      [...prefix, ...args],
      { cwd: root, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (stdout) channel.append(stdout);
        if (stderr) channel.append(stderr);
        if (error && error.code === "ENOENT") {
          channel.appendLine(
            `Не найден CLI «${command}». Укажите путь в настройках witness.cliPath, например: node C:/projects/witness/bin/witness.js`,
          );
          resolve(127);
          return;
        }
        resolve(error && typeof error.code === "number" ? error.code : 0);
      },
    );
    child.on("error", (error) => {
      channel.appendLine(`Ошибка запуска: ${error.message}`);
      resolve(1);
    });
  });
}

/** claim запускаем в терминале: человек должен увидеть и утвердить критерии. */
function claimInTerminal(task) {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage("Witness: сначала откройте папку проекта.");
    return;
  }
  const terminal =
    vscode.window.terminals.find((item) => item.name === "Witness") ||
    vscode.window.createTerminal({ name: "Witness", cwd: root });
  terminal.show();
  const escaped = task.replace(/"/g, '\\"');
  terminal.sendText(`${cliCommand()} claim "${escaped}"`);
}

function activate(context) {
  channel = vscode.window.createOutputChannel("Witness");
  context.subscriptions.push(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand("witness.init", async () => {
      const code = await runCli(["init"]);
      if (code === 0) vscode.window.showInformationMessage("Witness: проект инициализирован.");
    }),

    vscode.commands.registerCommand("witness.claim", async () => {
      const task = await vscode.window.showInputBox({
        title: "Witness: критерии приёмки",
        prompt: "Что должен сделать агент? Критерии утверждаются в терминале.",
        placeHolder: "Добавить экспорт отчёта в CSV на странице /reports",
        ignoreFocusOut: true,
      });
      if (task && task.trim()) claimInTerminal(task.trim());
    }),

    vscode.commands.registerCommand("witness.run", async () => {
      const code = await runCli(["run"]);
      if (code === 0) {
        vscode.window.showInformationMessage("Witness: все обязательные критерии прошли.");
      } else {
        vscode.window.showWarningMessage("Witness: проверка не прошла. Подробности в панели Witness.");
      }
    }),

    vscode.commands.registerCommand("witness.report", async () => {
      const root = workspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage("Witness: сначала откройте папку проекта.");
        return;
      }
      const code = await runCli(["report"]);
      if (code !== 0) return;
      const reportPath = path.join(root, ".witness", "report.html");
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(reportPath));
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
