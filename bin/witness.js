#!/usr/bin/env node
import { main } from "../src/cli.ts";

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("witness: непредвиденная ошибка:", err);
    process.exitCode = 1;
  });
