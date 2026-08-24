import { createInterface } from "node:readline";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const indiceSessione = process.argv.indexOf("--session");
const fileSessione = indiceSessione >= 0
  ? resolve(process.argv[indiceSessione + 1])
  : join(process.cwd(), `.pi-gui-test-${process.pid}.jsonl`);

if (!existsSync(fileSessione)) {
  writeFileSync(
    fileSessione,
    JSON.stringify({
      type: "session",
      version: 3,
      id: `test-${process.pid}`,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    }) + "\n",
    "utf8",
  );
}

function risposta(comando, data = {}) {
  process.stdout.write(JSON.stringify({
    type: "response",
    id: comando.id,
    command: comando.type,
    success: true,
    data,
  }) + "\n");
}

const righe = createInterface({ input: process.stdin, crlfDelay: Infinity });
righe.on("line", (riga) => {
  const comando = JSON.parse(riga);
  if (comando.type === "abort") return risposta(comando);
  if (comando.type === "get_commands") return risposta(comando, { commands: [] });
  if (comando.type === "get_state") {
    return risposta(comando, {
      sessionFile: fileSessione,
      sessionName: null,
      model: { provider: "test", id: "test-model", name: "Test model" },
      thinkingLevel: "off",
      isStreaming: false,
      cwd: process.cwd(),
    });
  }
  if (comando.type === "prompt") {
    appendFileSync(fileSessione, JSON.stringify({
      type: "message",
      id: `message-${Date.now()}`,
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: comando.message || "" },
    }) + "\n", "utf8");
  }
  return risposta(comando);
});
