import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";
import { appendFileSync, closeSync, openSync, writeFileSync } from "node:fs";

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
let leafIdAttivo = process.cwd().includes("leaf-cronologia") ? "n-new" : null;

// Condotte del consiglio. Come il resto del file si pilotano con i marcatori
// nel nome della cartella di lavoro, per non introdurre un secondo modo di
// guidare il finto.
const marcatore = (nome) => process.cwd().includes(nome);
const ruoloConsiglio = process.env.PI_GUI_CONSIGLIO_RUOLO || "";
let promptRicevuti = 0;
let ruoloCheFallisce = null;

if (ruoloConsiglio) {
  // Traccia leggibile dal test: le tre variabili arrivano solo dall'ambiente
  // del processo figlio, non dalla riga di comando.
  try {
    writeFileSync(
      join(process.cwd(), `consiglio-ambiente-${sessioneIdAvvio}.json`),
      JSON.stringify({
        ruolo: ruoloConsiglio,
        workspace: process.env.PI_GUI_CONSIGLIO_WORKSPACE ?? null,
        piano: process.env.PI_GUI_CONSIGLIO_PIANO ?? null,
        argomenti: process.argv.slice(2),
      }),
      "utf8",
    );
  } catch {
    // La traccia è un aiuto ai test, non una condizione di funzionamento.
  }
}

// Traccia dei prompt ricevuti da un ruolo del consiglio: serve a leggere nel
// test che cosa è arrivato davvero alla sessione, per esempio gli allegati per
// riferimento. Come la traccia dell'ambiente è un aiuto ai test.
function tracciaPrompt(messaggio) {
  if (!ruoloConsiglio) return;
  try {
    appendFileSync(
      join(process.cwd(), `consiglio-prompt-${sessioneIdAvvio}.txt`),
      `--- PROMPT ${promptRicevuti} ---\n${String(messaggio ?? "")}\n`,
      "utf8",
    );
  } catch {
    // La traccia è un aiuto ai test, non una condizione di funzionamento.
  }
}

// Uscita dello scrittore nel formato a cinque sezioni che il parser accetta.
// Gli identificativi dei contributi e il tipo di lavoro si leggono dal prompt
// ricevuto, come farebbe uno scrittore vero: così la prova di integrazione non
// inventa nomi che il ponte non ha mandato.
function uscitaScrittoreValida(messaggio) {
  const testo = String(messaggio ?? "");
  const contributi = [...testo.matchAll(/^--- INIZIO CONTRIBUTO (.+) ---$/gmu)]
    .map((trovato) => trovato[1].trim())
    .filter(Boolean);
  const diCodice = /^Tipo di lavoro: codice\.$/mu.test(testo);
  let fileModificati = ["nessuno"];
  if (diCodice) {
    const nome = "nota-del-consiglio.md";
    try {
      writeFileSync(join(process.cwd(), nome), "Nota scritta dallo scrittore del consiglio.\n", "utf8");
      fileModificati = [nome];
    } catch {
      // Se non riesco a scrivere resto sul segnaposto: il controllo lo dirà.
    }
  }
  const righe = [
    "### RISULTATO",
    `Sintesi del consiglio, scritta dal ruolo scrittore a partire da ${contributi.length || "nessun"} contributo.`,
    "",
    "### PROVENIENZA",
    "| Parte del risultato | Contributo | Cosa ho preso | Perché |",
    "| --- | --- | --- | --- |",
  ];
  for (const id of contributi) {
    righe.push(`| Sintesi | ${id} | la parte sul rischio | è la sola verificabile |`);
  }
  righe.push(
    "",
    "### SCARTATI",
    "| Contributo | Cosa ho lasciato fuori | Perché |",
    "| --- | --- | --- |",
  );
  for (const id of contributi) {
    righe.push(`| ${id} | le ripetizioni | già dette nel risultato |`);
  }
  righe.push("", "### FILE MODIFICATI", ...fileModificati, "", "### EVAL");
  righe.push(
    "- [x] E1 la risposta copre la richiesta e ne rispetta i vincoli. Evidenza: il risultato risponde per intero alla richiesta",
    "- [x] E2 i disaccordi fra contributi sono risolti oppure dichiarati. Evidenza: non ci sono disaccordi fra i contributi ricevuti",
    "- [x] E3 tutte le parti richieste ci sono, le mancanze sono dichiarate. Evidenza: nessuna parte è rimasta fuori",
    "- [x] E4 la provenienza corrisponde a contributi reali, niente di inventato. Evidenza: ogni riga cita un contributo ricevuto",
  );
  return righe.join("\n");
}

function reclamaFallimento() {
  if (ruoloCheFallisce !== null) return ruoloCheFallisce;
  try {
    closeSync(openSync(join(process.cwd(), "consiglio-fallimento.lock"), "wx"));
    ruoloCheFallisce = true;
  } catch {
    ruoloCheFallisce = false;
  }
  return ruoloCheFallisce;
}

function condottaFallimento(numeroPrompt) {
  if (marcatore("consiglio-429-sempre")) return "Errore del provider: 429 Too Many Requests.";
  // Solo lo scrittore incappa nel limite: serve a fermare il ciclo dopo la
  // raccolta, nel punto in cui il ponte aspetta prima di ripetere.
  if (marcatore("consiglio-429-scrittore")) {
    return ruoloConsiglio === "scrittore" && numeroPrompt === 1
      ? "Errore del provider: 429 Too Many Requests."
      : null;
  }
  if (marcatore("consiglio-uno-fallisce")) {
    return reclamaFallimento() ? "Errore del provider: 429 Too Many Requests." : null;
  }
  if (numeroPrompt > 1) return null;
  if (marcatore("consiglio-429-testo")) {
    return "Errore del provider: 429 Too Many Requests. Please retry after 3 seconds.";
  }
  if (marcatore("consiglio-429-muto")) return "Errore del provider: too many requests.";
  return null;
}

function consumaFallimentoPrimoStato() {
  const marcatore = process.env.PI_GUI_FAKE_FAIL_FIRST_STATE_FILE;
  if (!marcatore) return false;
  try {
    closeSync(openSync(marcatore, "wx"));
    return true;
  } catch {
    return false;
  }
}

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
    if (consumaFallimentoPrimoStato()) return;
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
  if (comando.type === "get_entries") {
    if (process.cwd().includes("leaf-autorevole")) {
      return risposta(comando, { entries: [], leafId: "n-old" });
    }
    if (process.cwd().includes("leaf-tecnico")) {
      return risposta(comando, { entries: [], leafId: "tecnico-leaf" });
    }
    if (process.cwd().includes("leaf-cronologia")) {
      return risposta(comando, { entries: [], leafId: leafIdAttivo });
    }
    return risposta(comando, { entries: [] });
  }
  if (comando.type === "get_available_models") {
    const models = [{ provider: "fake", id: "modello-test", name: "Modello test", contextWindow: 32000 }];
    if (marcatore("consiglio-catalogo-due")) {
      models.push({ provider: "fake", id: "modello-secondo", name: "Modello secondo", contextWindow: 32000 });
    }
    return risposta(comando, { models });
  }
  if (comando.type === "set_model") {
    return risposta(comando, {
      provider: comando.provider,
      id: comando.modelId,
      name: "Modello test",
      contextWindow: 32000,
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
  if (comando.type === "navigate_tree") {
    leafIdAttivo = comando.entryId || null;
    return risposta(comando, { cancelled: false });
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
    promptRicevuti += 1;
    tracciaPrompt(comando.message);
    const user = { role: "user", content: comando.message, timestamp: Date.now() };
    messages.push(user);
    risposta(comando);
    scrivi({ type: "agent_start" });
    if (marcatore("consiglio-auto-retry") && promptRicevuti === 1) {
      // pi ritenta da solo: al ponte arriva soltanto questa notizia.
      scrivi({
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        delayMs: 2000,
        errorMessage: "429 Too Many Requests",
      });
    }
    const fallimento = condottaFallimento(promptRicevuti);
    if (fallimento) {
      scrivi({ type: "error", message: fallimento });
      scrivi({ type: "agent_settled" });
      return;
    }
    if (marcatore("consiglio-stop-error")) {
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: "risposta interrotta" }],
        provider: "fake",
        model: "modello-test",
        stopReason: "error",
        timestamp: Date.now(),
      });
      scrivi({ type: "message_end", message: messages.at(-1) });
      scrivi({ type: "agent_settled" });
      return;
    }
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
    const testo = marcatore("consiglio-uscita-valida") && ruoloConsiglio === "scrittore"
      ? uscitaScrittoreValida(comando.message)
      : (ruoloConsiglio
        ? `risposta con città dal ruolo ${ruoloConsiglio} (${sessioneIdAvvio})`
        : "risposta con città");
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
    // Con questo marcatore il messaggio è già finito ma il turno no: serve a
    // provare che il contributo si raccoglie soltanto su agent_settled, e a
    // tenere aperta una finestra in cui il lavoro si può annullare davvero.
    if (marcatore("consiglio-settled-lento")) setTimeout(() => scrivi({ type: "agent_settled" }), 1500);
    else scrivi({ type: "agent_settled" });
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
