import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";
import { closeSync, openSync } from "node:fs";

const decoder = new StringDecoder("utf8");
let buffer = "";
let messages = [];
const indiceSessione = process.argv.indexOf("--session");
const indiceSessioneId = process.argv.indexOf("--session-id");
const sessioneIdAvvio = indiceSessioneId >= 0 && process.argv[indiceSessioneId + 1]
  ? process.argv[indiceSessioneId + 1]
  : "fake-session";
let fileSessione = indiceSessione >= 0 && process.argv[indiceSessione + 1]
  ? process.argv[indiceSessione + 1]
  : join(process.cwd(), `fake-session-${sessioneIdAvvio}.jsonl`);
const persistenzaTardiva = process.cwd().includes("file-tardivo");
if (!persistenzaTardiva) closeSync(openSync(fileSessione, "a"));
let contatoreSessioni = 0;

function scrivi(valore) {
  process.stdout.write(JSON.stringify(valore) + "\n");
}

function risposta(comando, data = {}) {
  scrivi({
    id: comando.id,
    type: "response",
    command: comando.type,
    success: true,
    data,
  });
}

function gestisci(comando) {
  if (comando.type === "get_state") {
    if (process.cwd().includes("stato-muto")) return;
    const stato = {
      model: { provider: "fake", id: "modello-test", name: "Modello test", contextWindow: 32000 },
      thinkingLevel: "medium",
      isStreaming: false,
      sessionId: sessioneIdAvvio,
      messageCount: messages.length,
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      autoCompactionEnabled: true,
      sessionFile: fileSessione,
    };
    if (process.cwd().includes("stato-lento")) setTimeout(() => risposta(comando, stato), 250);
    else risposta(comando, stato);
    return;
  }
  if (comando.type === "get_messages") return risposta(comando, { messages });
  if (comando.type === "get_available_models") {
    return risposta(comando, {
      models: [{ provider: "fake", id: "modello-test", name: "Modello test", contextWindow: 32000 }],
    });
  }
  if (comando.type === "get_available_thinking_levels") return risposta(comando, { levels: ["off", "medium"] });
  if (comando.type === "get_commands") {
    if (process.cwd().includes("comandi-muti")) return;
    if (process.cwd().includes("comandi-invalidi")) return risposta(comando, { commands: null });
    return risposta(comando, {
      commands: [
        { name: "dialog-test", description: "Verifica una finestra interattiva", source: "extension" },
        { name: "skill:test", description: "Competenza di test", source: "skill" },
        { name: "template-test", description: "Modello di richiesta", source: "prompt" },
      ],
    });
  }
  if (["new_session", "switch_session", "clone", "fork"].includes(comando.type)) {
    const completa = () => {
      fileSessione = comando.type === "switch_session"
        ? comando.sessionPath
        : join(process.cwd(), `fake-${comando.type}-${++contatoreSessioni}.jsonl`);
      if (!persistenzaTardiva) closeSync(openSync(fileSessione, "a"));
      risposta(comando, { cancelled: false, text: comando.type === "fork" ? "testo fork" : undefined });
    };
    if (process.cwd().includes("cambio-lento")) setTimeout(completa, 120);
    else completa();
    return;
  }
  if (comando.type === "terminate_test") {
    risposta(comando);
    setTimeout(() => process.exit(0), 20);
    return;
  }
  if (comando.type === "final_response_then_exit") {
    process.stdout.write(
      JSON.stringify({
        id: comando.id,
        type: "response",
        command: comando.type,
        success: true,
        data: { ultimo: true },
      }) + "\n",
      () => process.exit(0),
    );
    return;
  }
  if (comando.type === "bash") {
    scrivi({ type: "bash_execution_update", id: comando.id, delta: "prima città\n" });
    scrivi({ type: "bash_execution_update", id: comando.id, delta: "seconda riga completa\n" });
    risposta(comando, {
      output: "…risposta finale troncata…",
      exitCode: 0,
      cancelled: false,
      truncated: true,
      fullOutputPath: "fake-output.log",
    });
    return;
  }
  if (comando.type === "prompt") {
    // PI reale materializza il JSONL soltanto quando persiste il primo turno.
    if (persistenzaTardiva) closeSync(openSync(fileSessione, "a"));
    const user = { role: "user", content: comando.message, timestamp: Date.now() };
    messages.push(user);
    risposta(comando);
    scrivi({ type: "agent_start" });
    if (comando.message === "/dialog-test") {
      scrivi({
        type: "extension_ui_request",
        id: "ext-1",
        method: "confirm",
        title: "Conferma di test",
        message: "Vuoi continuare?",
      });
      return;
    }
    const testo = "risposta con città";
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: testo }],
      provider: "fake",
      model: "modello-test",
      usage: { input: 2, output: 3, totalTokens: 5, cost: { total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    scrivi({ type: "message_start", message: { role: "assistant" } });
    const riga = Buffer.from(
      JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "città" },
      }) + "\n",
      "utf8",
    );
    const posizioneAccento = riga.indexOf(Buffer.from("à")) + 1;
    process.stdout.write(riga.subarray(0, posizioneAccento));
    process.stdout.write(riga.subarray(posizioneAccento));
    scrivi({ type: "message_end", message: messages.at(-1) });
    scrivi({ type: "agent_settled" });
    return;
  }
  if (comando.type === "extension_ui_response") {
    scrivi({ type: "extension_ui_request", id: "notice", method: "notify", message: "Risposta ricevuta" });
    scrivi({ type: "agent_settled" });
    return;
  }
  if (comando.type === "get_session_stats") {
    return risposta(comando, {
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 2,
      tokens: { input: 2, output: 3, total: 5 },
      cost: 0,
      contextUsage: { tokens: 5, contextWindow: 32000, percent: 0.02 },
    });
  }
  risposta(comando);
}

function consuma(finale = false) {
  let indice;
  while ((indice = buffer.indexOf("\n")) >= 0) {
    const riga = buffer.slice(0, indice).replace(/\r$/, "");
    buffer = buffer.slice(indice + 1);
    if (riga.trim()) gestisci(JSON.parse(riga));
  }
  if (finale && buffer.trim()) gestisci(JSON.parse(buffer));
}

process.stdin.on("data", (pezzo) => {
  buffer += decoder.write(pezzo);
  consuma();
});
process.stdin.on("end", () => {
  buffer += decoder.end();
  consuma(true);
});
