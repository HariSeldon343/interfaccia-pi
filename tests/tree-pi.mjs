import { spawn } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

const sessionFile = join(process.cwd(), "tree-session.jsonl");
openSync(sessionFile, "a");

// Simula uno strumento lungo che sopravvivrebbe al solo processo RPC radice.
const strumento = spawn(
  process.execPath,
  ["-e", "setInterval(() => {}, 1000)"],
  { detached: true, windowsHide: true, stdio: "ignore" },
);
strumento.unref();
writeFileSync(join(process.cwd(), "tree-child.pid"), String(strumento.pid), "utf8");

const righe = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function scrivi(valore) {
  process.stdout.write(JSON.stringify(valore) + "\n");
}

righe.on("line", (riga) => {
  let comando;
  try {
    comando = JSON.parse(riga);
  } catch {
    return;
  }
  if (comando.type === "get_state") {
    scrivi({
      type: "response",
      id: comando.id,
      command: "get_state",
      success: true,
      data: { sessionFile, isStreaming: false },
    });
  } else if (comando.type === "exit_root") {
    scrivi({
      type: "response",
      id: comando.id,
      command: "exit_root",
      success: true,
      data: {},
    });
    setTimeout(() => process.exit(0), 20);
  }
});

righe.on("close", () => process.exit(0));
