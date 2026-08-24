import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
  link,
  symlink,
  rename,
} from "node:fs/promises";
import { request as richiestaHttp } from "node:http";
import { createConnection } from "node:net";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  creaPonte,
  caricaCronologiaParzialeDaPi,
  caricaCatalogoBuiltinPi,
  leggiChangelogPi,
  condividiHtmlConGh,
  eseguiGhLimitato,
  argomentiPiTerminale,
  decisioneBonificaLegacy,
  LettoreJsonl,
  SessionePi,
  rigaMessaggioCronologia,
  sembraPonteLegacy,
  sembraPonteCorrente,
  tipoUnitaWindowsConsentito,
  usaCacheTipiUnitaWindows,
  durataAutoStopConfigurata,
  preparaInvocazioneCapacita,
  unificaCatalogoCapacita,
  validaCatalogoBuiltinPi,
} from "../app/server.mjs";
import { BUILTIN_SLASH_COMMANDS } from "../vendor/pi-runtime/pi/dist/core/slash-commands.js";

const QUI = dirname(fileURLToPath(import.meta.url));
const FAKE_PI = join(QUI, "fake-pi.mjs");
const PI_OSTINATO = join(QUI, "stubborn-pi.mjs");
const PI_CON_ALBERO = join(QUI, "tree-pi.mjs");
const RADICE = dirname(QUI);
const CLI_PI_REALE = join(RADICE, "vendor", "pi-runtime", "pi", "dist", "cli.js");

function attendi(ms) {
  return new Promise((risolvi) => setTimeout(risolvi, ms));
}

async function avviaPonteTest({
  maxSessioni = 4,
  preparaHome,
  home: homeEsistente = null,
  conservaHome = false,
  ...opzioni
} = {}) {
  const home = homeEsistente || await mkdtemp(join(tmpdir(), "pi-gui-test-"));
  if (preparaHome) await preparaHome(home);
  const decisioniFiducia = new Map();
  class ArchivioFiduciaTest {
    get(cartella) {
      return decisioniFiducia.get(resolve(cartella)) ?? null;
    }

    set(cartella, decisione) {
      decisioniFiducia.set(resolve(cartella), Boolean(decisione));
    }
  }
  const ponte = creaPonte({
    home,
    cliPi: FAKE_PI,
    maxSessioni,
    elencaDiscendenti: async () => [],
    terminaDiscendenti: async () => true,
    // I test storici del protocollo UI usano /dialog-test come estensione fake.
    // I casi dedicati al confine production riattivano esplicitamente il blocco.
    bloccaComandiEstensione: false,
    caricaCronologia: async ({ sessione }) => {
      const dati = await sessione.inviaEAttendi({ type: "get_messages" });
      return dati.messages || [];
    },
    caricaSupportoRuntime: async () => ({
      versione: "0.84.2",
      getAgentDir: () => join(home, ".pi", "agent"),
      getShareViewerUrl: () => "https://example.test/share",
      ProjectTrustStore: ArchivioFiduciaTest,
      modelliPredefiniti: { fake: "modello-test" },
    }),
    ...opzioni,
  });
  await new Promise((risolvi) => ponte.server.listen(0, "127.0.0.1", risolvi));
  const indirizzo = ponte.server.address();
  const base = `http://127.0.0.1:${indirizzo.port}`;
  const stato = await (await fetch(base + "/api/stato")).json();
  assert.equal(stato.tokenApi, ponte.tokenApi, JSON.stringify(stato));
  const post = async (via, corpo, token = stato.tokenApi, clientId = null) => {
    const risposta = await fetch(base + via, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-pi-gui-token": token } : {}),
        ...(clientId ? { "x-pi-gui-client": clientId } : {}),
      },
      body: JSON.stringify(corpo),
    });
    return { risposta, dati: await risposta.json() };
  };
  const chiudi = async () => {
    await ponte.chiudiTutto();
    if (ponte.server.listening) {
      await new Promise((risolvi) => ponte.server.close(() => risolvi()));
    }
    if (!conservaHome) await rm(home, { recursive: true, force: true });
  };
  return { home, ponte, base, stato, post, chiudi };
}

test("LettoreJsonl conserva UTF-8 spezzato fra due chunk", () => {
  const valori = [];
  const errori = [];
  const lettore = new LettoreJsonl((valore) => valori.push(valore), (riga) => errori.push(riga));
  const riga = Buffer.from('{"type":"prova","testo":"città"}\n', "utf8");
  const posizione = riga.indexOf(Buffer.from("à")) + 1;
  lettore.aggiungi(riga.subarray(0, posizione));
  lettore.aggiungi(riga.subarray(posizione));
  lettore.termina();
  assert.deepEqual(valori, [{ type: "prova", testo: "città" }]);
  assert.deepEqual(errori, []);
});

test("LettoreJsonl limita una riga enorme e riprende dalla successiva", () => {
  const valori = [];
  const errori = [];
  const lettore = new LettoreJsonl(
    (valore) => valori.push(valore),
    (riga) => errori.push(riga),
    24,
  );
  lettore.aggiungi(Buffer.from("x".repeat(40), "utf8"));
  lettore.aggiungi(Buffer.from('\n{"type":"ok"}\n', "utf8"));
  lettore.termina();
  assert.deepEqual(valori, [{ type: "ok" }]);
  assert.equal(errori.length, 1);
  assert.match(errori[0], /scartata/i);
});

test("LettoreJsonl applica il limite anche all'ultima riga senza LF", () => {
  const valori = [];
  const errori = [];
  const lettore = new LettoreJsonl((valore) => valori.push(valore), (riga) => errori.push(riga), 16);
  lettore.aggiungi(Buffer.from('{"type":"prova","testo":"' + "x".repeat(30) + '"}', "utf8"));
  lettore.termina();
  assert.deepEqual(valori, []);
  assert.equal(errori.length, 1);
  assert.match(errori[0], /scartata/i);
});

test("la fotografia parziale usa solo righe JSONL complete", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-prefix-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileSessione = join(cartella, "sessione.jsonl");
  const righe = [
    { type: "session", version: 3, id: "sessione-test", timestamp: "2026-08-24T00:00:00.000Z", cwd: cartella },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-08-24T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "messaggio completo" }], timestamp: 1 } },
  ];
  const prefisso = righe.map((voce) => JSON.stringify(voce)).join("\n") + "\n";
  await writeFile(fileSessione, prefisso + '{"type":"message","id":"incompleto"', "utf8");
  const messaggi = await caricaCronologiaParzialeDaPi({
    cliPi: CLI_PI_REALE,
    fileSessione,
    massimoByte: Buffer.byteLength(prefisso) + 20,
  });
  assert.equal(messaggi.length, 1);
  assert.equal(messaggi[0].content[0].text, "messaggio completo");
});

test("LettoreJsonl rifiuta primitivi, array e response malformate", () => {
  const valori = [];
  const errori = [];
  const lettore = new LettoreJsonl((valore) => valori.push(valore), (riga) => errori.push(riga));
  for (const riga of [
    "null",
    '"testo"',
    "[]",
    '{}',
    '{"type":"response","command":"get_state"}',
    '{"type":"evento_valido"}',
  ]) {
    lettore.aggiungi(Buffer.from(riga + "\n", "utf8"));
  }
  lettore.termina();
  assert.deepEqual(valori, [{ type: "evento_valido" }]);
  assert.equal(errori.length, 5);
});

test("LettoreJsonl misura il limite in byte UTF-8", () => {
  const valori = [];
  const errori = [];
  const lettore = new LettoreJsonl((valore) => valori.push(valore), (riga) => errori.push(riga), 16);
  lettore.aggiungi(Buffer.from('{"type":"éééé"}\n{"type":"x"}\n', "utf8"));
  lettore.termina();
  assert.deepEqual(valori, [{ type: "x" }]);
  assert.equal(errori.length, 1);
  assert.match(errori[0], /byte/i);
});

test("LettoreJsonl rifiuta una sequenza UTF-8 non valida", () => {
  const valori = [];
  const errori = [];
  const lettore = new LettoreJsonl((valore) => valori.push(valore), (riga) => errori.push(riga));
  lettore.aggiungi(Buffer.concat([
    Buffer.from('{"type":"prova","testo":"', "utf8"),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('"}\n', "utf8"),
  ]));
  lettore.termina();
  assert.deepEqual(valori, []);
  assert.equal(errori.length, 1);
});

test("un singolo messaggio enorme viene abbreviato senza perdere il file originale", () => {
  const riga = rigaMessaggioCronologia(
    { role: "user", content: [{ type: "text", text: "x".repeat(2000) }], timestamp: 12 },
    300,
  );
  const record = JSON.parse(riga);
  assert.equal(record.tipo, "messaggio");
  assert.equal(record.messaggio.role, "user");
  assert.equal(record.messaggio.guiContenutoTroncato, true);
  assert.match(record.messaggio.content[0].text, /dati originali restano/i);
});

test("il catalogo builtin viene letto dalla build Pi verificata e unificato in ordine", async () => {
  const cliPi = join(RADICE, "vendor", "pi-runtime", "pi", "dist", "cli.js");
  const caricato = await caricaCatalogoBuiltinPi(cliPi);
  assert.equal(caricato.versione, "0.84.2");
  assert.equal(caricato.comandi.length, 22);
  assert.deepEqual(caricato.comandi.map((voce) => voce.name), BUILTIN_SLASH_COMMANDS.map((voce) => voce.name));
  await assert.rejects(
    caricaCatalogoBuiltinPi(cliPi, { versioneAttesa: "0.84.1" }),
    /richiede pi 0\.84\.1/i,
  );
  assert.throws(
    () => validaCatalogoBuiltinPi([{ ...BUILTIN_SLASH_COMMANDS[0], campoInatteso: true }]),
    /schema/i,
  );

  const unificato = unificaCatalogoCapacita(caricato.comandi, [
    { name: "mia-skill", description: "Skill locale", argumentHint: "<file>", source: "skill" },
    { name: "settings", description: "Non deve oscurare il builtin", source: "prompt" },
    { name: "mia-estensione", description: "Solo TUI", source: "extension" },
    { name: "llama", description: "Estensione integrata verificata", source: "extension" },
  ]);
  assert.deepEqual(unificato.slice(0, 22).map((voce) => voce.source), Array(22).fill("builtin"));
  assert.equal(unificato.filter((voce) => voce.name === "settings").length, 1);
  assert.equal(unificato.find((voce) => voce.name === "mia-skill").dispatch.kind, "prompt");
  assert.equal(unificato.find((voce) => voce.name === "mia-estensione").dispatch.kind, "terminal");
  assert.equal(unificato.find((voce) => voce.name === "llama").availability.surface, "gui");
  assert.equal(unificato.find((voce) => voce.name === "llama").dispatch.kind, "prompt");
});

test("il changelog appartiene al Pi pinato, ha un limite ed esige UTF-8 valido", async (t) => {
  const cliPi = join(RADICE, "vendor", "pi-runtime", "pi", "dist", "cli.js");
  const reale = await leggiChangelogPi(cliPi);
  assert.equal(reale.versione, "0.84.2");
  assert.match(reale.markdown, /^#/);
  await assert.rejects(leggiChangelogPi(cliPi, { limiteByte: 10 }), /limite/i);

  const pacchetto = await mkdtemp(join(tmpdir(), "pi-changelog-test-"));
  t.after(() => rm(pacchetto, { recursive: true, force: true }));
  await mkdir(join(pacchetto, "dist"));
  await writeFile(join(pacchetto, "package.json"), JSON.stringify({ version: "0.84.2" }));
  await writeFile(join(pacchetto, "dist", "cli.js"), "");
  await writeFile(join(pacchetto, "CHANGELOG.md"), Buffer.from([0xff, 0xfe, 0xfd]));
  await assert.rejects(
    leggiChangelogPi(join(pacchetto, "dist", "cli.js")),
    /UTF-8 valido/i,
  );
});

test("la condivisione gh distingue installazione, autenticazione e URL verificato", async () => {
  let spawnOsservato = null;
  const esitoSpawn = await eseguiGhLimitato(["auth", "status"], {
    spawnProcesso: (comando, argomenti, opzioni) => {
      spawnOsservato = { comando, argomenti, opzioni };
      const processo = new EventEmitter();
      processo.stdout = new PassThrough();
      processo.stderr = new PassThrough();
      processo.kill = () => true;
      queueMicrotask(() => {
        processo.stdout.end("autenticato");
        processo.stderr.end();
        processo.emit("close", 0, null);
      });
      return processo;
    },
  });
  assert.equal(esitoSpawn.code, 0);
  assert.deepEqual(spawnOsservato, {
    comando: "gh",
    argomenti: ["auth", "status"],
    opzioni: { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  });
  await assert.rejects(
    condividiHtmlConGh("C:\\temp\\session.html", {
      eseguiGh: async () => { throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }); },
    }),
    /non e installato/i,
  );
  await assert.rejects(
    condividiHtmlConGh("C:\\temp\\session.html", {
      eseguiGh: async () => ({ code: 1, stdout: "", stderr: "not logged in" }),
    }),
    /gh auth login/i,
  );
  const chiamate = [];
  const risultato = await condividiHtmlConGh("C:\\temp\\session.html", {
    eseguiGh: async (argomenti) => {
      chiamate.push(argomenti);
      return argomenti[0] === "auth"
        ? { code: 0, stdout: "ok", stderr: "" }
        : { code: 0, stdout: "https://gist.github.com/utente/abcdef123456\n", stderr: "" };
    },
    getShareViewerUrl: (id) => "https://preview.test/#" + id,
  });
  assert.deepEqual(chiamate, [
    ["auth", "status"],
    ["gist", "create", "--public=false", "C:\\temp\\session.html"],
  ]);
  assert.deepEqual(risultato, {
    gistUrl: "https://gist.github.com/utente/abcdef123456",
    previewUrl: "https://preview.test/#abcdef123456",
  });
});

test("la tabella d'invocazione produce solo RPC note o workflow strutturati", () => {
  const catalogo = unificaCatalogoCapacita(BUILTIN_SLASH_COMMANDS, [
    { name: "mia-skill", source: "skill" },
    { name: "mia-estensione", source: "extension" },
    { name: "llama", source: "extension" },
  ]);
  const voce = (nome) => catalogo.find((comando) => comando.name === nome);
  assert.deepEqual(preparaInvocazioneCapacita(voce("new")), {
    mode: "rpc", command: { type: "new_session" },
  });
  assert.deepEqual(preparaInvocazioneCapacita(voce("compact"), "conserva i test"), {
    mode: "rpc", command: { type: "compact", customInstructions: "conserva i test" },
  });
  assert.deepEqual(preparaInvocazioneCapacita(voce("name"), "lavoro"), {
    mode: "rpc", command: { type: "set_session_name", name: "lavoro" },
  });
  assert.deepEqual(preparaInvocazioneCapacita(voce("model"), "fake/modello-test"), {
    mode: "rpc", command: { type: "set_model", provider: "fake", modelId: "modello-test" },
  });
  assert.equal(preparaInvocazioneCapacita(voce("session")).command.type, "get_session_stats");
  assert.equal(preparaInvocazioneCapacita(voce("clone")).command.type, "clone");
  assert.equal(preparaInvocazioneCapacita(voce("tree")).action, "tree-picker");
  assert.equal(
    preparaInvocazioneCapacita(voce("export"), "sessione.html").arguments,
    "sessione.html",
  );
  assert.equal(preparaInvocazioneCapacita(voce("mia-skill"), "ora").command.message, "/mia-skill ora");
  assert.equal(preparaInvocazioneCapacita(voce("mia-estensione")).mode, "terminal");
  assert.deepEqual(preparaInvocazioneCapacita(voce("llama"), "stato"), {
    mode: "rpc",
    command: { type: "prompt", message: "/llama stato" },
  });
  assert.deepEqual(preparaInvocazioneCapacita(voce("model"), "gemma"), {
    mode: "workflow",
    action: "model-picker",
    rpcType: "set_model",
    arguments: "gemma",
  });
  assert.throws(() => preparaInvocazioneCapacita(voce("quit"), "ora"), /non accetta argomenti/i);
});

test("tutti i comandi che cambiano cronologia rendono subito incerta l'identita", () => {
  for (const tipo of ["new_session", "switch_session", "clone", "fork", "import_jsonl", "navigate_tree"]) {
    const scritte = [];
    const sessione = new SessionePi({ id: tipo, cliPi: FAKE_PI, emetti: () => {} });
    sessione.proc = {
      killed: false,
      exitCode: null,
      signalCode: null,
      stdin: {
        writable: true,
        destroyed: false,
        write: (riga) => { scritte.push(JSON.parse(riga)); },
      },
    };
    sessione.fileSessione = "C:\\prima.jsonl";
    sessione.invia({ type: tipo, id: "cambio" });
    assert.equal(sessione.fileSessioneIncerta, true, tipo);
    assert.equal(sessione.fileSessione, null, tipo);
    assert.equal(scritte[0].type, tipo);
  }
});

test("un get_state vecchio non puo sovrascrivere l'identita nuova", async () => {
  const scritte = [];
  const eventi = [];
  const sessione = new SessionePi({
    id: "revisioni",
    cliPi: FAKE_PI,
    emetti: (evento) => eventi.push(evento),
    identificaFile: async (percorso) => ({ percorso, chiave: percorso.toLowerCase() }),
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (riga) => { scritte.push(JSON.parse(riga)); },
    },
  };
  sessione.fileSessione = "C:\\vecchia.jsonl";
  sessione.invia({ type: "get_state", id: "stato-vecchio" });
  sessione.invia({ type: "new_session", id: "cambio" });
  sessione.diffondi({ type: "response", id: "cambio", command: "new_session", success: true, data: { cancelled: false } });
  const statoNuovo = scritte.at(-1);
  assert.equal(statoNuovo.type, "get_state");
  sessione.diffondi({
    type: "response",
    id: statoNuovo.id,
    command: "get_state",
    success: true,
    data: {
      sessionFile: "C:\\nuova.jsonl",
      sessionName: "nuova",
      isStreaming: true,
      model: { provider: "nuovo", id: "modello-nuovo", name: "Modello nuovo" },
    },
  });
  await attendi(0);
  sessione.diffondi({
    type: "response",
    id: "stato-vecchio",
    command: "get_state",
    success: true,
    data: {
      sessionFile: "C:\\vecchia.jsonl",
      sessionName: "vecchia",
      isStreaming: false,
      model: { provider: "vecchio", id: "modello-vecchio", name: "Modello vecchio" },
    },
  });
  assert.equal(sessione.fileSessione, "C:\\nuova.jsonl");
  assert.equal(sessione.fileSessioneIncerta, false);
  assert.equal(sessione.nomeSessione, "nuova");
  assert.equal(sessione.provider, "nuovo");
  assert.equal(sessione.modello, "modello-nuovo");
  assert.equal(sessione.inEsecuzione, true);
  assert.equal(eventi.at(-1).guiObsoleta, true);
});

test("le risposte di lettura precedenti a un cambio sono marcate obsolete", async () => {
  const scritte = [];
  const eventi = [];
  const sessione = new SessionePi({ id: "letture-obsolete", cliPi: FAKE_PI, emetti: (evento) => eventi.push(evento) });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (riga) => { scritte.push(JSON.parse(riga)); },
    },
  };
  sessione.invia({ type: "get_messages", id: "messaggi-vecchi" });
  sessione.invia({ type: "switch_session", id: "cambio", sessionPath: "C:\\nuova.jsonl" });
  sessione.diffondi({ type: "response", id: "cambio", command: "switch_session", success: true, data: {} });
  const controllo = scritte.at(-1);
  sessione.diffondi({
    type: "response",
    id: controllo.id,
    command: "get_state",
    success: true,
    data: { sessionFile: "C:\\nuova.jsonl" },
  });
  await Promise.resolve();
  sessione.invia({ type: "get_messages", id: "messaggi-nuovi" });
  sessione.diffondi({
    type: "response",
    id: "messaggi-nuovi",
    command: "get_messages",
    success: true,
    data: { messages: [{ role: "assistant", content: "nuovo" }] },
  });
  sessione.diffondi({
    type: "response",
    id: "messaggi-vecchi",
    command: "get_messages",
    success: true,
    data: { messages: [{ role: "assistant", content: "vecchio" }] },
  });
  assert.equal(eventi.find((evento) => evento.id === "messaggi-nuovi").guiObsoleta, undefined);
  assert.equal(eventi.find((evento) => evento.id === "messaggi-vecchi").guiObsoleta, true);
  const frontend = await readFile(join(RADICE, "app", "public", "app.js"), "utf8");
  assert.match(frontend, /if \(evento\.guiObsoleta\) return/);
});

test("un nuovo get_state senza sessionFile non riusa il vecchio JSONL", async () => {
  const scritte = [];
  const sessione = new SessionePi({ id: "senza-file", cliPi: FAKE_PI, emetti: () => {} });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (riga) => { scritte.push(JSON.parse(riga)); },
    },
  };
  sessione.fileSessione = "C:\\vecchia.jsonl";
  sessione.invia({ type: "new_session", id: "cambio" });
  sessione.diffondi({ type: "response", id: "cambio", command: "new_session", success: true, data: { cancelled: false } });
  const statoNuovo = scritte.at(-1);
  sessione.diffondi({
    type: "response",
    id: statoNuovo.id,
    command: "get_state",
    success: true,
    data: { sessionFile: null },
  });
  await Promise.resolve();
  assert.equal(sessione.fileSessione, null);
  assert.equal(sessione.fileSessioneIncerta, true);
});

test("due cambi e un prompt vengono serializzati fino al get_state corrente", async () => {
  const scritte = [];
  const sessione = new SessionePi({
    id: "coda-cambi",
    cliPi: FAKE_PI,
    emetti: () => [],
    identificaFile: async (percorso) => ({ percorso, chiave: percorso.toLowerCase() }),
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (riga) => { scritte.push(JSON.parse(riga)); },
    },
  };
  sessione.fileSessione = "C:\\iniziale.jsonl";
  await sessione.inviaDopoCambio({ type: "new_session", id: "nuova" });
  const seconda = sessione.inviaDopoCambio({ type: "clone", id: "clone" });
  const prompt = sessione.inviaDopoCambio({ type: "prompt", id: "prompt", message: "dopo" });
  await Promise.resolve();
  assert.deepEqual(scritte.map((voce) => voce.type), ["new_session"]);

  sessione.diffondi({ type: "response", id: "nuova", command: "new_session", success: true, data: { cancelled: false } });
  const statoUno = scritte.at(-1);
  assert.equal(statoUno.type, "get_state");
  sessione.diffondi({
    type: "response",
    id: statoUno.id,
    command: "get_state",
    success: true,
    data: { sessionFile: "C:\\dopo-nuova.jsonl" },
  });
  await seconda;
  await Promise.resolve();
  assert.deepEqual(scritte.map((voce) => voce.type), ["new_session", "get_state", "clone"]);

  sessione.diffondi({ type: "response", id: "clone", command: "clone", success: true, data: { cancelled: false } });
  const statoDue = scritte.at(-1);
  assert.equal(statoDue.type, "get_state");
  sessione.diffondi({
    type: "response",
    id: statoDue.id,
    command: "get_state",
    success: true,
    data: { sessionFile: "C:\\dopo-clone.jsonl" },
  });
  await prompt;
  assert.deepEqual(
    scritte.map((voce) => voce.type),
    ["new_session", "get_state", "clone", "get_state", "prompt"],
  );
});

test("abort_branch_summary supera la barriera di cambio sessione", async () => {
  const scritte = [];
  const sessione = new SessionePi({
    id: "abort-tree-summary",
    cliPi: FAKE_PI,
    emetti: () => [],
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: { writable: true, destroyed: false, write: (riga) => scritte.push(JSON.parse(riga)) },
  };
  sessione.cambioSessioneInCorso = true;

  await sessione.inviaDopoCambio({ type: "abort_branch_summary", id: "abort-summary" });
  assert.deepEqual(scritte, [{ type: "abort_branch_summary", id: "abort-summary" }]);
});

test("una seconda finestra non puo rubare i dialoghi durante un turno", () => {
  const consegne = [];
  const sessione = new SessionePi({
    id: "proprietari-turni",
    cliPi: FAKE_PI,
    emetti: (evento, opzioni) => {
      consegne.push({ evento, opzioni });
      return [];
    },
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: () => {},
    },
  };

  sessione.invia({ type: "prompt", id: "turno-a", message: "prima" }, "finestra-a");
  sessione.diffondi({
    type: "extension_ui_request",
    id: "preflight-a",
    method: "confirm",
    message: "Confermi prima dell'avvio?",
  });
  assert.equal(
    consegne.find((voce) => voce.evento.id === "preflight-a")?.opzioni?.clientId,
    "finestra-a",
  );
  sessione.diffondi({
    type: "extension_ui_request",
    id: "editor-a",
    method: "set_editor_text",
    text: "testo dell'estensione",
  });
  assert.deepEqual(
    consegne.find((voce) => voce.evento.id === "editor-a")?.opzioni,
    { clientId: "finestra-a", unoSolo: true, richiediClient: true },
  );
  sessione.diffondi({ type: "agent_start" });
  assert.equal(sessione.clientInterazione, "finestra-a");

  assert.throws(() => sessione.invia({
    type: "prompt",
    id: "turno-b",
    message: "dopo",
    streamingBehavior: "followUp",
  }, "finestra-b"), /altra finestra/i);
  assert.equal(sessione.clientInterazione, "finestra-a");
  sessione.diffondi({
    type: "extension_ui_request",
    id: "dialogo-a",
    method: "confirm",
    message: "Confermi il turno A?",
  });
  assert.equal(
    consegne.find((voce) => voce.evento.id === "dialogo-a")?.opzioni?.clientId,
    "finestra-a",
  );

  sessione.invia({
    type: "prompt",
    id: "seguito-a",
    message: "dopo",
    streamingBehavior: "followUp",
  }, "finestra-a");
  sessione.diffondi({ type: "agent_settled" });
  assert.equal(sessione.clientInterazione, null);

  sessione.invia({ type: "prompt", id: "nuovo-b", message: "nuovo" }, "finestra-b");
  assert.equal(sessione.clientInterazione, "finestra-b");
});

test("login_provider assegna i dialoghi alla finestra chiamante e libera l'owner alla response", () => {
  const consegne = [];
  const scritte = [];
  const sessione = new SessionePi({
    id: "login-owner",
    cliPi: FAKE_PI,
    emetti: (evento, opzioni) => {
      consegne.push({ evento, opzioni });
      return [];
    },
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (riga) => scritte.push(JSON.parse(riga)),
    },
  };
  sessione.invia({
    type: "login_provider",
    id: "login-b",
    providerId: "test",
    authType: "oauth",
  }, "finestra-b", "replay-b");
  assert.equal(scritte[0].id, "login-b");
  assert.equal(sessione.clientInterazione, "finestra-b");
  assert.throws(() => sessione.invia({
    type: "login_provider",
    id: "login-a",
    providerId: "test",
    authType: "oauth",
  }, "finestra-a", "replay-a"), /procedura di accesso/i);
  sessione.diffondi({
    type: "extension_ui_request",
    id: "oauth-dialog",
    method: "input",
    message: "Codice OAuth",
  });
  assert.equal(
    consegne.find((voce) => voce.evento.id === "oauth-dialog")?.opzioni?.clientId,
    "finestra-b",
  );
  sessione.diffondi({
    type: "response",
    id: "login-b",
    command: "login_provider",
    success: true,
    data: { providerId: "test", authType: "oauth" },
  });
  assert.equal(sessione.clientInterazione, null);
  assert.equal(sessione.loginProviderInCorso, null);
  assert.equal(sessione.timerLoginProvider, null);
});

test("solo l'owner annulla login_provider e resta owner fino alla response login", async () => {
  const consegne = [];
  const scritte = [];
  const sessione = new SessionePi({
    id: "login-cancel",
    cliPi: FAKE_PI,
    emetti: (evento) => {
      consegne.push(evento);
      return [];
    },
    scadenzaLoginProviderMs: 25,
    attesaAnnullamentoLoginProviderMs: 500,
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (riga) => scritte.push(JSON.parse(riga)),
    },
  };

  sessione.invia({
    type: "login_provider",
    id: "login-uno",
    providerId: "test",
    authType: "oauth",
  }, "finestra-owner");
  assert.throws(
    () => sessione.annullaLoginProvider("login-sbagliato", "finestra-owner"),
    /non e quella attiva/i,
  );
  assert.throws(
    () => sessione.annullaLoginProvider("login-uno", "finestra-estranea"),
    /solo la finestra/i,
  );
  const annullato = sessione.annullaLoginProvider("login-uno", "finestra-owner");
  assert.equal(annullato.annullamentoRichiesto, true);
  assert.equal(annullato.inoltrato, true);
  assert.deepEqual(scritte.slice(0, 2).map((voce) => voce.type), [
    "login_provider",
    "abort_login_provider",
  ]);
  assert.equal(scritte[1].loginCommandId, "login-uno");
  assert.equal(sessione.loginProviderInCorso, "login-uno");
  assert.equal(sessione.clientInterazione, "finestra-owner");
  assert.equal(sessione.timerLoginProvider, null);
  sessione.diffondi({
    type: "response",
    id: scritte[1].id,
    command: "abort_login_provider",
    success: true,
    data: { loginCommandId: "login-uno", cancelled: true },
  });
  assert.equal(sessione.loginProviderInCorso, "login-uno");
  assert.equal(sessione.clientInterazione, "finestra-owner");
  assert.equal(sessione.annullamentoLoginProviderInCorso.confermato, true);
  sessione.diffondi({
    type: "response",
    id: "login-uno",
    command: "login_provider",
    success: false,
    error: "Provider login cancelled by host",
  });
  assert.equal(sessione.loginProviderInCorso, null);
  assert.equal(sessione.clientInterazione, null);
  assert.equal(sessione.annullamentoLoginProviderInCorso, null);

  sessione.invia({
    type: "login_provider",
    id: "login-due",
    providerId: "test",
    authType: "oauth",
  }, "finestra-owner");
  await attendi(50);
  assert.equal(sessione.loginProviderInCorso, "login-due");
  assert.equal(sessione.clientInterazione, "finestra-owner");
  assert.equal(sessione.timerLoginProvider, null);
  assert.equal(scritte.at(-1).type, "abort_login_provider");
  assert.equal(scritte.at(-1).loginCommandId, "login-due");
  assert.ok(consegne.some((evento) =>
    evento.type === "gui_login_provider_annullamento_richiesto"
    && evento.loginCommandId === "login-due"
    && evento.motivo === "timeout"));
  sessione.diffondi({
    type: "response",
    id: "login-due",
    command: "login_provider",
    success: false,
    error: "Provider login cancelled by host",
  });
  assert.equal(sessione.loginProviderInCorso, null);
  assert.equal(sessione.clientInterazione, null);
});

test("annullamento login resta fail-closed se la write fallisce", async () => {
  let scritture = 0;
  let arresti = 0;
  const sessione = new SessionePi({
    id: "login-write-failure",
    cliPi: FAKE_PI,
    emetti: () => [],
    scadenzaLoginProviderMs: 1000,
    attesaAnnullamentoLoginProviderMs: 15,
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: () => {
        scritture += 1;
        if (scritture > 1) throw new Error("pipe interrotta");
      },
    },
  };
  sessione.ferma = async () => { arresti += 1; };

  sessione.invia({
    type: "login_provider", id: "login-write", providerId: "test", authType: "oauth",
  }, "owner-write");
  const esito = sessione.annullaLoginProvider("login-write", "owner-write");
  assert.equal(esito.inoltrato, false);
  assert.match(esito.errore, /comunicare con pi/i);
  assert.equal(sessione.loginProviderInCorso, "login-write");
  assert.equal(sessione.clientInterazione, "owner-write");
  await attendi(35);
  assert.equal(arresti, 1);
  assert.equal(sessione.inChiusura, true);
  assert.equal(sessione.loginProviderInCorso, "login-write");
});

test("annullamento login senza response dell'adapter riserva e arresta la sessione", async () => {
  const scritte = [];
  let arresti = 0;
  const sessione = new SessionePi({
    id: "login-no-ack",
    cliPi: FAKE_PI,
    emetti: () => [],
    scadenzaLoginProviderMs: 1000,
    attesaAnnullamentoLoginProviderMs: 15,
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: { writable: true, destroyed: false, write: (riga) => scritte.push(JSON.parse(riga)) },
  };
  sessione.ferma = async () => { arresti += 1; };

  sessione.invia({
    type: "login_provider", id: "login-no-ack", providerId: "test", authType: "oauth",
  }, "owner-no-ack");
  sessione.annullaLoginProvider("login-no-ack", "owner-no-ack");
  assert.deepEqual(scritte.map((voce) => voce.type), ["login_provider", "abort_login_provider"]);
  assert.equal(sessione.loginProviderInCorso, "login-no-ack");
  await attendi(35);
  assert.equal(arresti, 1);
  assert.equal(sessione.inChiusura, true);
  assert.equal(sessione.loginProviderInCorso, "login-no-ack");
});

test("l'endpoint login cancel e owner-only e il canale RPC generico lo rifiuta", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const scritte = [];
  const sessione = new SessionePi({
    id: "login-route",
    cliPi: FAKE_PI,
    emetti: () => [],
    attesaAnnullamentoLoginProviderMs: 500,
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: { writable: true, destroyed: false, write: (riga) => scritte.push(JSON.parse(riga)) },
  };
  ambiente.ponte.sessioni.set(sessione.id, sessione);
  sessione.invia({
    type: "login_provider", id: "login-route-id", providerId: "test", authType: "oauth",
  }, "finestra-owner");

  const generico = await ambiente.post(
    "/api/comando",
    { sessionId: sessione.id, type: "abort_login_provider", loginCommandId: "login-route-id" },
    ambiente.stato.tokenApi,
    "finestra-owner",
  );
  assert.equal(generico.risposta.status, 409);
  const estraneo = await ambiente.post(
    "/api/annulla-login-provider",
    { sessionId: sessione.id, loginCommandId: "login-route-id" },
    ambiente.stato.tokenApi,
    "finestra-estranea",
  );
  assert.equal(estraneo.risposta.status, 403);
  const owner = await ambiente.post(
    "/api/annulla-login-provider",
    { sessionId: sessione.id, loginCommandId: "login-route-id" },
    ambiente.stato.tokenApi,
    "finestra-owner",
  );
  assert.equal(owner.risposta.status, 200);
  assert.equal(owner.dati.annullamentoRichiesto, true);
  assert.deepEqual(scritte.map((voce) => voce.type), ["login_provider", "abort_login_provider"]);
  assert.equal(sessione.loginProviderInCorso, "login-route-id");

  sessione.diffondi({
    type: "response", id: "login-route-id", command: "login_provider", success: false,
    error: "Provider login cancelled by host",
  });
  assert.equal(sessione.loginProviderInCorso, null);
  sessione.proc = null;
  ambiente.ponte.sessioni.delete(sessione.id);
});

test("un comando estensione senza agent_start libera il controller", async () => {
  const sessione = new SessionePi({
    id: "comando-senza-turno",
    cliPi: FAKE_PI,
    emetti: () => [],
    attesaAvvioTurnoMs: 20,
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: { writable: true, destroyed: false, write: () => {} },
  };
  sessione.invia({ type: "prompt", id: "estensione-a", message: "/estensione" }, "finestra-a");
  sessione.diffondi({
    type: "response",
    id: "estensione-a",
    command: "prompt",
    success: true,
    data: {},
  });
  await attendi(35);
  assert.equal(sessione.clientInterazione, null);
  assert.doesNotThrow(() => {
    sessione.invia({ type: "prompt", id: "nuovo-b", message: "nuovo" }, "finestra-b");
  });
});

test("F5 conserva il page id mentre una scheda duplicata lo ruota", async () => {
  const frontend = await readFile(join(RADICE, "app", "public", "app.js"), "utf8");
  assert.match(frontend, /navigazione === "reload"/);
  assert.match(frontend, /return \{ id: precedente \}/);
  assert.doesNotMatch(frontend, /previousId=/);
});

test("la migrazione riconosce solo lo schema del ponte 1.x", () => {
  assert.equal(
    sembraPonteLegacy({
      attiva: true,
      cartella: "C:\\progetto",
      nomeCartella: "progetto",
      inEsecuzione: false,
      preferite: [],
    }),
    true,
  );
  assert.equal(sembraPonteLegacy({ servizio: "pi-gui-bridge", versione: 3 }), false);
  assert.equal(sembraPonteLegacy({ attiva: true, preferite: [] }), false);
});

test("un ponte corrente resta riconoscibile mentre sta chiudendo", () => {
  assert.equal(sembraPonteCorrente({ servizio: "pi-gui-bridge", versione: 6, stato: "chiusura" }), true);
  assert.equal(sembraPonteCorrente({ servizio: "pi-gui-bridge", versione: "5" }), false);
  assert.equal(sembraPonteCorrente({ servizio: "pi-gui-bridge", versione: 3 }), false);
});

test("la migrazione legacy e fail-closed e non termina mai la versione precedente", () => {
  const stato = {
    attiva: false,
    cartella: null,
    nomeCartella: null,
    inEsecuzione: false,
    preferite: [],
  };
  assert.deepEqual(decisioneBonificaLegacy({ servizio: "pi-gui-bridge", versione: 6 }, null), {
    azione: "riusa",
  });
  assert.deepEqual(decisioneBonificaLegacy({ servizio: "pi-gui-bridge", versione: 3 }, null), {
    azione: "blocca",
    motivo: "ponte-versione-incompatibile",
  });
  assert.equal(decisioneBonificaLegacy({ errore: true }, { pid: 10 }).azione, "blocca");
  assert.equal(decisioneBonificaLegacy({ ...stato, attiva: true }, { pid: 10 }).motivo, "sessione-legacy-attiva");
  assert.equal(decisioneBonificaLegacy(stato, { pid: 10, parentAttivo: true }).motivo, "interfaccia-legacy-aperta");
  assert.equal(decisioneBonificaLegacy(stato, { pid: 10, connessioni: 1 }).motivo, "interfaccia-legacy-aperta");
  assert.deepEqual(decisioneBonificaLegacy(stato, { pid: 10, parentAttivo: false, connessioni: 0 }), {
    azione: "blocca",
    motivo: "ponte-legacy-inattivo",
  });
});

test("la durata di auto-stop rifiuta valori ambigui o fuori limite", () => {
  assert.equal(durataAutoStopConfigurata(undefined), 45000);
  assert.equal(durataAutoStopConfigurata("1200"), 1200);
  assert.throws(() => durataAutoStopConfigurata("NaN"), /PI_GUI_AUTO_STOP_MS/);
  assert.throws(() => durataAutoStopConfigurata("0"), /PI_GUI_AUTO_STOP_MS/);
  assert.throws(() => durataAutoStopConfigurata("999999999"), /PI_GUI_AUTO_STOP_MS/);
});

test("le unita di rete mappate non sono trattate come dischi locali", () => {
  assert.equal(tipoUnitaWindowsConsentito("Fixed"), true);
  assert.equal(tipoUnitaWindowsConsentito("Removable"), true);
  assert.equal(tipoUnitaWindowsConsentito("Network"), false);
  assert.equal(tipoUnitaWindowsConsentito(undefined), false);
});

test("la verifica pre-prompt rinnova il tipo unita in background senza attendere PowerShell", () => {
  assert.equal(usaCacheTipiUnitaWindows({ haCache: true, etaMs: 1_000 }), true);
  assert.equal(usaCacheTipiUnitaWindows({ haCache: true, etaMs: 60_000 }), false,
    "l'apertura di un nuovo percorso deve attendere una fotografia fresca");
  assert.equal(usaCacheTipiUnitaWindows({
    haCache: true,
    etaMs: 60_000,
    consentiCacheScaduta: true,
  }), true, "un file gia pinzato puo rinnovare la cache senza bloccare il prompt");
  assert.equal(usaCacheTipiUnitaWindows({
    haCache: false,
    etaMs: 0,
    consentiCacheScaduta: true,
  }), false, "la prima verifica resta fail-closed");
  assert.match(
    SessionePi.prototype.verificaIdentitaFileSessione.toString(),
    /consentiCacheUnitaScaduta:\s*precedente\.provvisoria\s*===\s*false/,
    "solo un file materializzato con dev/ino puo evitare l'attesa PowerShell",
  );
});

test("pi completo usa un archivio sessioni isolato da quello della GUI", () => {
  const argomenti = argomentiPiTerminale("C:\\pi\\cli.js", "C:\\pi\\terminale-unico");
  assert.deepEqual(argomenti.slice(1), [
    "C:\\pi\\cli.js",
    "--session-dir",
    "C:\\pi\\terminale-unico",
  ]);
  assert.deepEqual(
    argomentiPiTerminale(
      "C:\\pi\\cli.js",
      "C:\\pi\\terminale-unico",
      { sessionPath: "C:\\pi\\sessione.jsonl" },
    ).slice(1),
    ["C:\\pi\\cli.js", "--session", "C:\\pi\\sessione.jsonl"],
  );
});

test("desktop, launcher e ponte condividono porta e protocollo correnti", async () => {
  const [server, launcher, frontend, rust, tauri] = await Promise.all([
    readFile(join(RADICE, "app", "server.mjs"), "utf8"),
    readFile(join(RADICE, "avvia.mjs"), "utf8"),
    readFile(join(RADICE, "app", "public", "app.js"), "utf8"),
    readFile(join(RADICE, "src-tauri", "src", "lib.rs"), "utf8"),
    readFile(join(RADICE, "src-tauri", "tauri.conf.json"), "utf8"),
  ]);
  assert.match(server, /predefinita = 4666/);
  assert.match(server, /VERSIONE_PONTE = 6/);
  assert.match(launcher, /predefinita = 4666/);
  assert.match(launcher, /dati\.versione === 6/);
  assert.match(frontend, /stato\.versione !== 6/);
  assert.match(launcher, /x-pi-gui-client["']:\s*["']launcher-node/);
  assert.match(launcher, /Date\.now\(\) \+ 30_000/);
  assert.match(launcher, /processo\.signalCode !== null/);
  assert.match(launcher, /PI_GUI_PORT: String\(PORTA\)/);
  assert.match(launcher, /arrestaFiglioNonPronto\(ponte\)/);
  assert.match(launcher, /avviaProcesso\(browser/);
  assert.match(launcher, /VERSIONE_NODE_MINIMA = \[22, 19, 0\]/);
  assert.match(launcher, /versioneNodeSupportata\(process\.versions\.node\)/);
  assert.match(launcher, /LIMITE_RISPOSTA_SALUTE = 64 \* 1024/);
  assert.match(frontend, /pi-gui-bozze-v1/);
  assert.match(frontend, /PREFISSO_BOZZA_DOCUMENTO/);
  assert.match(frontend, /PREFISSO_BOZZE_RISOLTE/);
  assert.match(frontend, /lineageModificataLocalmente/);
  assert.match(frontend, /DURATA_BOZZE_MS = 30 \* 24/);
  assert.match(frontend, /beforeunload/);
  assert.match(frontend, /nonceRpc:\s*globalThis\.crypto\.randomUUID\(\)/);
  assert.match(frontend, /APP\.replayId \+ "-" \+ APP\.nonceRpc/);
  assert.match(frontend, /clientId:\s*IDENTITA_DOCUMENTO\.id/);
  assert.match(frontend, /replayId:\s*clientIdPagina\(\)/);
  assert.match(server, /"--no-extensions"/);
  assert.match(server, /VERSIONE_PI_VERIFICATA = "0\.84\.2"/);
  assert.match(server, /estensioniBuiltinConsentite: new Set\(\["llama"\]\)/);
  assert.match(server, /verificaPromptEstensione\(comando\)/);
  assert.match(server, /join\(config, "terminali", randomUUID\(\)\)/);
  assert.match(server, /PI_CODING_AGENT_SESSION_DIR:\s*directorySessioni/);
  assert.match(server, /"\/api\/handoff-terminale"/);
  assert.doesNotMatch(server, /WindowsApps["'],\s*["']wt\.exe/);
  assert.match(server, /"\/api\/cronologia"/);
  assert.match(server, /"\/api\/albero"/);
  assert.match(server, /"\/api\/forche"/);
  assert.match(server, /"\/api\/ultima-risposta"/);
  assert.match(frontend, /caricaCronologiaSessione\(sessione\)/);
  assert.match(frontend, /mostraErroreCronologia\(sessione/);
  assert.doesNotMatch(frontend, /rpc\(\{ type: "get_messages"/);
  assert.doesNotMatch(frontend, /rpc\(\{ type: "get_tree"/);
  assert.doesNotMatch(frontend, /rpc\(\{ type: "get_fork_messages"/);
  assert.doesNotMatch(frontend, /rpc\(\{ type: "get_last_assistant_text"/);
  assert.match(frontend, /await scriviAllegatiInvio\(/);
  assert.match(frontend, /ripristinaAllegatiInvii\(sessione\)/);
  assert.match(frontend, /allegatiBundleId/);
  assert.match(frontend, /ripristinoAllegatiInCorso/);
  assert.match(frontend, /ripristinaAllegatiBozza\(sessione\)/);
  assert.match(frontend, /conservaAllegatiBozza\(sessione\)/);
  assert.doesNotMatch(frontend, /gui_sessione_chiusa[\s\S]{0,350}dimenticaBozza\(sessione\)/);
  assert.match(frontend, /dimenticaCopiaSicurezzaVerificata\(sessione, invio\)/);
  assert.match(frontend, /PREFISSO_INVII_RISOLTI/);
  assert.match(frontend, /persistiInvioPendente\(sessione, invio\)/);
  assert.match(frontend, /PALETTE_CORE\.analizzaComandoDaInviare\(testo\)/);
  assert.match(frontend, /await gestisciComandoComposer\(sessione, bozzaInviata, testo\)/);
  assert.match(frontend, /handoffInCorso:\s*false/);
  assert.match(frontend, /chiusuraInCorso:\s*false/);
  assert.match(frontend, /invioInCorso:\s*false/);
  assert.match(frontend, /sessione\.invioInCorso = true[\s\S]{0,500}await \(sessione\.codaAllegatiBozza/);
  assert.match(server, /LIMITE_RISPOSTA_TESTO_FORK = 2 \* 1024 \* 1024/);
  assert.match(frontend, /sessione\.bozza\.length \|\| sessione\.allegati\.length/);
  assert.match(frontend, /sessione\.handoffInCorso = true/);
  assert.match(frontend, /!sessione\.handoffInCorso/);
  assert.match(frontend, /sessione\.chiusuraInCorso = true/);
  assert.match(frontend, /La bozza e cambiata: la chiusura e stata annullata/);
  assert.match(rust, /const PORTA: u16 = 4666/);
  assert.match(rust, /versione.*== 6/);
  assert.match(rust, /X-Pi-Gui-Client: launcher-tauri/);
  assert.match(rust, /finestra\.navigate\(url\)/);
  assert.match(rust, /if !pronto && ponte_attivo\(\)/);
  assert.doesNotMatch(server, /spawn\(["']cmd\.exe["']/);
  assert.doesNotMatch(server, /spawn\(["']taskkill\.exe["']/);
  const configurazioneTauri = JSON.parse(tauri);
  assert.equal(configurazioneTauri.app.windows[0].url, "index.html");
  assert.match(configurazioneTauri.app.security.csp, /localhost:4666/);
});

test("il ponte richiede il token per ogni operazione POST", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "progetto");
  await mkdir(cartella);
  const { risposta, dati } = await ambiente.post("/api/avvia", { cartella }, null);
  assert.equal(risposta.status, 403);
  assert.match(dati.errore, /autorizzata/i);
});

test("catalogo e invocazione slash usano nomi verificati, non tipi RPC arbitrari", async (t) => {
  const ambiente = await avviaPonteTest({
    caricaCatalogoBuiltin: async () => ({
      versione: "0.84.2",
      comandi: BUILTIN_SLASH_COMMANDS,
    }),
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "catalogo-slash");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200, JSON.stringify(avvio.dati));
  const sessionId = avvio.dati.id;

  const negato = await ambiente.post("/api/capacita", { sessionId }, null);
  assert.equal(negato.risposta.status, 403);
  const catalogo = await ambiente.post("/api/capacita", { sessionId });
  assert.equal(catalogo.risposta.status, 200);
  assert.equal(catalogo.dati.complete, true);
  assert.equal(catalogo.dati.piVersion, "0.84.2");
  assert.deepEqual(
    catalogo.dati.commands.slice(0, 22).map((voce) => voce.name),
    BUILTIN_SLASH_COMMANDS.map((voce) => voce.name),
  );
  assert.deepEqual(
    catalogo.dati.commands.slice(0, 22).map((voce) => voce.source),
    Array(22).fill("builtin"),
  );
  assert.equal(catalogo.dati.commands.find((voce) => voce.name === "skill:test").dispatch.kind, "prompt");
  assert.equal(catalogo.dati.commands.find((voce) => voce.name === "dialog-test").availability.state, "terminal");

  const arbitrario = await ambiente.post("/api/invoca-comando", {
    sessionId,
    name: "session",
    type: "bash",
    operationId: "test-op-arbitrario",
  });
  assert.equal(arbitrario.risposta.status, 400);
  const senzaId = await ambiente.post("/api/invoca-comando", {
    sessionId, name: "session", operationId: "test-op-senza-id",
  });
  assert.equal(senzaId.risposta.status, 400);
  const idNonValido = await ambiente.post("/api/invoca-comando", {
    sessionId, name: "session", id: "spazi vietati", operationId: "test-op-id-non-valido",
  });
  assert.equal(idNonValido.risposta.status, 400);
  const workflow = await ambiente.post("/api/invoca-comando", {
    sessionId, name: "tree", id: "ui-workflow", operationId: "test-op-workflow",
  });
  assert.equal(workflow.risposta.status, 200);
  assert.equal(workflow.dati.mode, "workflow");
  assert.equal(workflow.dati.action, "tree-picker");
  assert.equal(workflow.dati.operation.status, "routed");
  const terminale = await ambiente.post("/api/invoca-comando", {
    sessionId, name: "dialog-test", id: "ui-terminale", operationId: "test-op-terminale",
  });
  assert.equal(terminale.dati.mode, "terminal");
  const nome = await ambiente.post("/api/invoca-comando", {
    sessionId,
    name: "name",
    id: "ui-name",
    operationId: "test-op-name",
    arguments: "sessione verificata",
    catalogRevision: catalogo.dati.catalogRevision,
  });
  assert.equal(nome.risposta.status, 200);
  assert.equal(nome.dati.mode, "rpc");
  assert.equal(nome.dati.id, "ui-name");
  const modelloParziale = await ambiente.post("/api/invoca-comando", {
    sessionId, name: "model", arguments: "gemma", id: "ui-model-filter", operationId: "test-op-model-filter",
  });
  assert.equal(modelloParziale.dati.mode, "workflow");
  assert.equal(modelloParziale.dati.arguments, "gemma");
  const modelloAssente = await ambiente.post("/api/invoca-comando", {
    sessionId, name: "model", arguments: "fake/inesistente", id: "ui-model-missing", operationId: "test-op-model-missing",
  });
  assert.equal(modelloAssente.dati.mode, "workflow");
  const modelloEsatto = await ambiente.post("/api/invoca-comando", {
    sessionId, name: "model", arguments: "fake/modello-test", id: "ui-model-exact", operationId: "test-op-model-exact",
  });
  assert.equal(modelloEsatto.dati.mode, "rpc");
  assert.equal(modelloEsatto.dati.id, "ui-model-exact");
  const skill = await ambiente.post("/api/invoca-comando", {
    sessionId,
    name: "skill:test",
    id: "ui-skill",
    operationId: "test-op-skill",
    arguments: "ora",
  });
  assert.equal(skill.risposta.status, 200);
  assert.equal(skill.dati.mode, "rpc");
});

test("operationId deduplica builtin e shell fra finestre e rileva le collisioni", async (t) => {
  const ambiente = await avviaPonteTest({
    caricaCatalogoBuiltin: async () => ({
      versione: "0.84.2",
      comandi: BUILTIN_SLASH_COMMANDS,
    }),
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "operazioni-esattamente-una-volta");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessionId = avvio.dati.id;
  const sessione = ambiente.ponte.sessioni.get(sessionId);
  const catalogo = await ambiente.post("/api/capacita", { sessionId });
  const scriviOriginale = sessione.proc.stdin.write.bind(sessione.proc.stdin);
  const inoltrati = [];
  sessione.proc.stdin.write = (riga) => {
    const comando = JSON.parse(riga);
    if (["set_session_name", "set_model", "import_jsonl", "bash"].includes(comando.type)) inoltrati.push(comando);
    return scriviOriginale(riga);
  };

  const catalogoObsoleto = await ambiente.post("/api/invoca-comando", {
    sessionId,
    name: "session",
    id: "ui-op-stale-prima",
    operationId: "gui-builtin-test-stale",
    catalogRevision: catalogo.dati.catalogRevision + 1,
  });
  assert.equal(catalogoObsoleto.risposta.status, 409);
  const retryCatalogo = await ambiente.post("/api/invoca-comando", {
    sessionId,
    name: "session",
    id: "ui-op-stale-retry",
    operationId: "gui-builtin-test-stale",
    catalogRevision: catalogo.dati.catalogRevision,
  });
  assert.equal(retryCatalogo.risposta.status, 200);
  assert.equal(retryCatalogo.dati.id, "ui-op-stale-retry");

  const primaBuiltin = await ambiente.post("/api/invoca-comando", {
    sessionId,
    name: "name",
    arguments: "una sola volta",
    id: "ui-op-builtin-prima",
    operationId: "gui-builtin-test-dedup",
  }, undefined, "finestra-a");
  assert.equal(primaBuiltin.risposta.status, 200);
  // Simula una risposta HTTP persa: la seconda finestra conosce l'intento ma
  // propone un correlation id nuovo. Il server deve restituire quello canonico.
  const retryBuiltin = await ambiente.post("/api/invoca-comando", {
    sessionId,
    name: "name",
    arguments: "una sola volta",
    id: "ui-op-builtin-retry",
    operationId: "gui-builtin-test-dedup",
  }, undefined, "finestra-b");
  assert.ok([200, 202].includes(retryBuiltin.risposta.status));
  assert.equal(retryBuiltin.dati.operation.canonicalId, "ui-op-builtin-prima");
  assert.equal(retryBuiltin.dati.operation.replayed, true);
  assert.equal(inoltrati.filter((comando) => comando.type === "set_session_name").length, 1);

  const collisioneBuiltin = await ambiente.post("/api/invoca-comando", {
    sessionId,
    name: "name",
    arguments: "richiesta differente",
    id: "ui-op-builtin-collisione",
    operationId: "gui-builtin-test-dedup",
  });
  assert.equal(collisioneBuiltin.risposta.status, 409);

  const secondaBuiltin = await ambiente.post("/api/invoca-comando", {
    sessionId,
    name: "name",
    arguments: "una sola volta",
    id: "ui-op-builtin-seconda",
    operationId: "gui-builtin-test-distinta",
  });
  assert.equal(secondaBuiltin.risposta.status, 200);
  assert.equal(inoltrati.filter((comando) => comando.type === "set_session_name").length, 2);

  const primaShell = await ambiente.post("/api/comando", {
    sessionId,
    type: "bash",
    command: "echo una-volta",
    excludeFromContext: false,
    id: "ui-op-shell-prima",
    operationId: "gui-shell-test-dedup",
  }, undefined, "finestra-a");
  assert.equal(primaShell.risposta.status, 200);
  const retryShell = await ambiente.post("/api/comando", {
    sessionId,
    type: "bash",
    command: "echo una-volta",
    excludeFromContext: false,
    id: "ui-op-shell-retry",
    operationId: "gui-shell-test-dedup",
  }, undefined, "finestra-b");
  assert.ok([200, 202].includes(retryShell.risposta.status));
  assert.equal(retryShell.dati.operation.canonicalId, "ui-op-shell-prima");
  assert.equal(inoltrati.filter((comando) => comando.type === "bash").length, 1);

  const collisioneShell = await ambiente.post("/api/comando", {
    sessionId,
    type: "bash",
    command: "echo differente",
    excludeFromContext: false,
    id: "ui-op-shell-collisione",
    operationId: "gui-shell-test-dedup",
  });
  assert.equal(collisioneShell.risposta.status, 409);

  const secondaShell = await ambiente.post("/api/comando", {
    sessionId,
    type: "bash",
    command: "echo una-volta",
    excludeFromContext: false,
    id: "ui-op-shell-seconda",
    operationId: "gui-shell-test-distinta",
  });
  assert.equal(secondaShell.risposta.status, 200);
  assert.equal(inoltrati.filter((comando) => comando.type === "bash").length, 2);

  const primaWorkflow = await ambiente.post("/api/comando", {
    sessionId,
    type: "set_model",
    provider: "fake",
    modelId: "modello-test",
    id: "ui-op-workflow-prima",
    operationId: "gui-builtin-workflow.model",
  });
  assert.equal(primaWorkflow.risposta.status, 200);
  const retryWorkflow = await ambiente.post("/api/comando", {
    sessionId,
    type: "set_model",
    provider: "fake",
    modelId: "modello-test",
    id: "ui-op-workflow-retry",
    operationId: "gui-builtin-workflow.model",
  });
  assert.ok([200, 202].includes(retryWorkflow.risposta.status));
  assert.equal(retryWorkflow.dati.operation.canonicalId, "ui-op-workflow-prima");
  assert.equal(inoltrati.filter((comando) => comando.type === "set_model").length, 1);

  const primaRinominaWorkflow = await ambiente.post("/api/comando", {
    sessionId,
    type: "set_session_name",
    name: "rinominata dal workflow",
    id: "ui-op-workflow-name-prima",
    operationId: "gui-builtin-workflow.name",
  });
  assert.equal(primaRinominaWorkflow.risposta.status, 200);
  const retryRinominaWorkflow = await ambiente.post("/api/comando", {
    sessionId,
    type: "set_session_name",
    name: "rinominata dal workflow",
    id: "ui-op-workflow-name-retry",
    operationId: "gui-builtin-workflow.name",
  });
  assert.ok([200, 202].includes(retryRinominaWorkflow.risposta.status));
  assert.equal(
    retryRinominaWorkflow.dati.operation.canonicalId,
    "ui-op-workflow-name-prima",
  );
  assert.equal(inoltrati.filter((comando) => comando.type === "set_session_name").length, 3);

  const sorgenteImport = join(ambiente.home, "workflow-import-once.jsonl");
  await writeFile(sorgenteImport, '{"type":"session"}\n', "utf8");
  const primaImport = await ambiente.post("/api/comando", {
    sessionId,
    type: "import_jsonl",
    inputPath: sorgenteImport,
    cwdOverride: cartella,
    id: "ui-op-import-prima",
    operationId: "gui-builtin-workflow.import",
  });
  assert.equal(primaImport.risposta.status, 200);
  const retryImport = await ambiente.post("/api/comando", {
    sessionId,
    type: "import_jsonl",
    inputPath: sorgenteImport,
    cwdOverride: cartella,
    id: "ui-op-import-retry",
    operationId: "gui-builtin-workflow.import",
  });
  assert.ok([200, 202].includes(retryImport.risposta.status));
  assert.equal(retryImport.dati.operation.canonicalId, "ui-op-import-prima");
  assert.equal(inoltrati.filter((comando) => comando.type === "import_jsonl").length, 1);

  await attendi(30);
  const stato = await ambiente.post("/api/stato-operazione", {
    sessionId,
    operationId: "gui-shell-test-dedup",
  });
  assert.equal(stato.risposta.status, 200);
  assert.equal(stato.dati.operation.status, "completed");
  assert.equal(stato.dati.operation.result.success, true);
  assert.equal(stato.dati.operation.result.command, "bash");
});

test("operationId recupera apertura e chiusura dopo una risposta HTTP persa", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartellaSorgente = join(ambiente.home, "origine-operazione-http");
  const cartellaDestinazione = join(ambiente.home, "destinazione-operazione-http");
  await mkdir(cartellaSorgente);
  await mkdir(cartellaDestinazione);
  const sorgente = await ambiente.post("/api/avvia", { cartella: cartellaSorgente });
  const sessioneSorgenteId = sorgente.dati.id;
  const fileDestinazione = join(cartellaDestinazione, "sessione-da-riprendere.jsonl");
  const fileCollisione = join(cartellaDestinazione, "sessione-diversa.jsonl");
  await writeFile(fileDestinazione, '{"type":"session"}\n', "utf8");
  await writeFile(fileCollisione, '{"type":"session"}\n', "utf8");

  const richiestaApertura = {
    sessionId: sessioneSorgenteId,
    operationId: "gui-builtin-http.resume-new-tab",
    cartella: cartellaDestinazione,
    sessionPath: fileDestinazione,
    forzaNuova: true,
  };
  const primaApertura = await ambiente.post("/api/avvia", richiestaApertura);
  assert.equal(primaApertura.risposta.status, 200);
  assert.equal(primaApertura.dati.operation.status, "completed");
  const nuovaSessioneId = primaApertura.dati.id;

  // La prima risposta viene considerata persa: il retry deve riprodurre lo
  // stesso risultato HTTP senza creare un secondo processo PI.
  const retryApertura = await ambiente.post("/api/avvia", richiestaApertura);
  assert.equal(retryApertura.risposta.status, 200);
  assert.equal(retryApertura.dati.id, nuovaSessioneId);
  assert.equal(retryApertura.dati.operation.replayed, true);
  assert.equal([...ambiente.ponte.sessioni.values()].filter((sessione) => sessione.proc).length, 2);

  const collisioneApertura = await ambiente.post("/api/avvia", {
    ...richiestaApertura,
    sessionPath: fileCollisione,
  });
  assert.equal(collisioneApertura.risposta.status, 409);

  const statoApertura = await ambiente.post("/api/stato-operazione", {
    sessionId: sessioneSorgenteId,
    operationId: richiestaApertura.operationId,
  });
  assert.equal(statoApertura.dati.operation.result.data.id, nuovaSessioneId);

  const richiestaChiusura = {
    sessionId: nuovaSessioneId,
    operationId: "gui-builtin-http.quit-session",
  };
  const primaChiusura = await ambiente.post("/api/chiudi", richiestaChiusura);
  assert.equal(primaChiusura.risposta.status, 200);
  assert.equal(primaChiusura.dati.operation.status, "completed");
  assert.equal(ambiente.ponte.sessioni.has(nuovaSessioneId), false);

  const retryChiusura = await ambiente.post("/api/chiudi", richiestaChiusura);
  assert.equal(retryChiusura.risposta.status, 200);
  assert.equal(retryChiusura.dati.operation.replayed, true);
  assert.equal(retryChiusura.dati.ultimaSessioneId, primaChiusura.dati.ultimaSessioneId);
  const statoChiusura = await ambiente.post("/api/stato-operazione", richiestaChiusura);
  assert.equal(statoChiusura.dati.operation.result.success, true);
});

test("un reload rifiutato conserva catalogo e comandi della sessione", async (t) => {
  const ambiente = await avviaPonteTest({
    caricaCatalogoBuiltin: async () => ({
      versione: "0.84.2",
      comandi: BUILTIN_SLASH_COMMANDS,
    }),
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "reload-rifiutato");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessionId = avvio.dati.id;
  const prima = await ambiente.post("/api/capacita", { sessionId });
  assert.equal(prima.risposta.status, 200);
  const sessione = ambiente.ponte.sessioni.get(sessionId);
  const scriviOriginale = sessione.proc.stdin.write;
  let comandoReload = null;
  sessione.proc.stdin.write = (riga) => {
    comandoReload = JSON.parse(riga);
    return true;
  };
  let richiestaReload;
  try {
    richiestaReload = await ambiente.post("/api/invoca-comando", {
      sessionId,
      name: "reload",
      id: "ui-reload-rifiutato",
      operationId: "test-op-reload-rifiutato",
      catalogRevision: prima.dati.catalogRevision,
    });
  } finally {
    sessione.proc.stdin.write = scriviOriginale;
  }
  assert.equal(richiestaReload.risposta.status, 200);
  assert.equal(comandoReload.type, "reload");
  assert.equal(sessione.catalogoComandiValido, true);
  assert.equal(sessione.revisioneCatalogoComandi, prima.dati.catalogRevision);
  sessione.diffondi({
    type: "response",
    id: "ui-reload-rifiutato",
    command: "reload",
    success: false,
    error: "Cannot reload while streaming",
  });

  const dopo = await ambiente.post("/api/capacita", { sessionId });
  assert.equal(dopo.risposta.status, 200);
  assert.equal(dopo.dati.complete, true);
  assert.equal(dopo.dati.catalogRevision, prima.dati.catalogRevision);
  assert.deepEqual(dopo.dati.commands, prima.dati.commands);
  const statistiche = await ambiente.post("/api/invoca-comando", {
    sessionId,
    name: "session",
    id: "ui-session-dopo-reload-rifiutato",
    operationId: "test-op-session-dopo-reload",
    catalogRevision: dopo.dati.catalogRevision,
  });
  assert.equal(statistiche.risposta.status, 200);
  assert.equal(statistiche.dati.mode, "rpc");
});

test("enableSkillCommands invalida e ricostruisce il catalogo solo dopo ack riuscita", async () => {
  const scritte = [];
  const sessione = new SessionePi({
    id: "settings-skill-catalog",
    cliPi: FAKE_PI,
    emetti: () => [],
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: { writable: true, destroyed: false, write: (riga) => scritte.push(JSON.parse(riga)) },
  };
  const skill = { name: "skill:smoke", source: "skill", description: "Skill smoke" };
  sessione.diffondi({
    type: "response", id: "catalogo-iniziale", command: "get_commands", success: true,
    data: { commands: [skill] },
  });
  const revisioneIniziale = sessione.revisioneCatalogoComandi;
  assert.equal(sessione.catalogoComandiValido, true);

  sessione.invia({
    type: "set_rpc_setting", id: "skill-off", name: "enableSkillCommands", value: false,
  });
  sessione.diffondi({
    type: "response", id: "skill-off", command: "set_rpc_setting", success: true,
    data: { name: "enableSkillCommands", value: false },
  });
  assert.equal(sessione.catalogoComandiValido, false);
  assert.equal(sessione.revisioneCatalogoComandi, revisioneIniziale + 1);
  const refreshOff = scritte.at(-1);
  assert.equal(refreshOff.type, "get_commands");
  sessione.diffondi({
    type: "response", id: refreshOff.id, command: "get_commands", success: true,
    data: { commands: [] },
  });
  assert.equal(sessione.catalogoComandiValido, true);
  assert.equal(sessione.catalogoComandi.some((comando) => comando.source === "skill"), false);
  assert.equal(sessione.revisioneCatalogoComandi, revisioneIniziale + 2);

  sessione.invia({
    type: "set_rpc_setting", id: "skill-on", name: "enableSkillCommands", value: true,
  });
  sessione.diffondi({
    type: "response", id: "skill-on", command: "set_rpc_setting", success: true,
    data: { name: "enableSkillCommands", value: true },
  });
  const refreshOn = scritte.at(-1);
  sessione.diffondi({
    type: "response", id: refreshOn.id, command: "get_commands", success: true,
    data: { commands: [skill] },
  });
  assert.equal(sessione.catalogoComandiValido, true);
  assert.equal(sessione.catalogoComandi.some((comando) => comando.name === "skill:smoke"), true);
  const revisioneDopoSuccessi = sessione.revisioneCatalogoComandi;
  const conteggioScritture = scritte.length;

  sessione.invia({
    type: "set_rpc_setting", id: "skill-fallita", name: "enableSkillCommands", value: false,
  });
  sessione.diffondi({
    type: "response", id: "skill-fallita", command: "set_rpc_setting", success: false,
    error: "setting rejected",
  });
  assert.equal(sessione.catalogoComandiValido, true);
  assert.equal(sessione.catalogoComandi.some((comando) => comando.name === "skill:smoke"), true);
  assert.equal(sessione.revisioneCatalogoComandi, revisioneDopoSuccessi);
  assert.equal(scritte.length, conteggioScritture + 1);
});

test("import_jsonl non puo cambiare la cwd canonica della scheda", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "cwd-import-stabile");
  await mkdir(cartella);
  const sorgente = join(ambiente.home, "sessione-importata.jsonl");
  await writeFile(sorgente, "{\"type\":\"session\"}\n", "utf8");
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessionId = avvio.dati.id;

  const senzaCwd = await ambiente.post("/api/comando", {
    sessionId, type: "import_jsonl", inputPath: sorgente,
  });
  assert.equal(senzaCwd.risposta.status, 400);
  const cwdDiversa = await ambiente.post("/api/comando", {
    sessionId,
    type: "import_jsonl",
    inputPath: sorgente,
    cwdOverride: ambiente.home,
  });
  assert.equal(cwdDiversa.risposta.status, 409);
  const cwdEsatta = await ambiente.post("/api/comando", {
    sessionId,
    type: "import_jsonl",
    inputPath: sorgente,
    cwdOverride: cartella,
  });
  assert.equal(cwdEsatta.risposta.status, 200);
  await attendi(50);
  assert.equal(ambiente.ponte.sessioni.get(sessionId).cartella, await realpath(cartella));
});

test("import_jsonl non sovrascrive sessioni correnti, archiviate o hardlink e rispetta le riserve", async (t) => {
  const ambiente = await avviaPonteTest({ maxSessioni: 4 });
  t.after(ambiente.chiudi);
  const cartellaA = join(ambiente.home, "import-sicuro-a");
  const cartellaB = join(ambiente.home, "import-sicuro-b");
  const esterna = join(ambiente.home, "import-sorgenti");
  await mkdir(cartellaA);
  await mkdir(cartellaB);
  await mkdir(esterna);
  const avvioA = await ambiente.post("/api/avvia", { cartella: cartellaA });
  const avvioB = await ambiente.post("/api/avvia", { cartella: cartellaB });
  const sessioneA = ambiente.ponte.sessioni.get(avvioA.dati.id);
  const sessioneB = ambiente.ponte.sessioni.get(avvioB.dati.id);
  const correnteA = sessioneA.fileSessione;
  const correnteB = sessioneB.fileSessione;
  await writeFile(correnteA, "CORRENTE-A\n", "utf8");
  await writeFile(correnteB, "CORRENTE-B\n", "utf8");
  await sessioneA.verificaIdentitaFileSessione();
  await sessioneB.verificaIdentitaFileSessione();
  const scriviOriginale = sessioneA.proc.stdin.write.bind(sessioneA.proc.stdin);
  let importInoltrati = 0;
  sessioneA.proc.stdin.write = (riga) => {
    if (JSON.parse(riga).type === "import_jsonl") importInoltrati += 1;
    return scriviOriginale(riga);
  };

  const hardlinkCorrente = join(esterna, "corrente-hardlink.jsonl");
  await link(correnteA, hardlinkCorrente);
  const currentHardlink = await ambiente.post("/api/comando", {
    sessionId: sessioneA.id,
    type: "import_jsonl",
    inputPath: hardlinkCorrente,
    cwdOverride: cartellaA,
  });
  assert.equal(currentHardlink.risposta.status, 409);

  const sorgenteCollisione = join(esterna, "archiviata.jsonl");
  const destinazioneArchiviata = join(dirname(correnteA), "archiviata.jsonl");
  await writeFile(sorgenteCollisione, "SORGENTE\n", "utf8");
  await writeFile(destinazioneArchiviata, "ARCHIVIATA-INTATTA\n", "utf8");
  const collisione = await ambiente.post("/api/comando", {
    sessionId: sessioneA.id,
    type: "import_jsonl",
    inputPath: sorgenteCollisione,
    cwdOverride: cartellaA,
  });
  assert.equal(collisione.risposta.status, 409);

  const sorgenteHardlink = join(esterna, "archiviata-hardlink.jsonl");
  const destinazioneHardlink = join(dirname(correnteA), "archiviata-hardlink.jsonl");
  await writeFile(sorgenteHardlink, "HARDLINK-INTATTO\n", "utf8");
  await link(sorgenteHardlink, destinazioneHardlink);
  const collisioneHardlink = await ambiente.post("/api/comando", {
    sessionId: sessioneA.id,
    type: "import_jsonl",
    inputPath: sorgenteHardlink,
    cwdOverride: cartellaA,
  });
  assert.equal(collisioneHardlink.risposta.status, 409);

  const altraScheda = await ambiente.post("/api/comando", {
    sessionId: sessioneA.id,
    type: "import_jsonl",
    inputPath: correnteB,
    cwdOverride: cartellaA,
  });
  assert.equal(altraScheda.risposta.status, 409);

  const sorgenteTerminale = join(esterna, "terminale.jsonl");
  await writeFile(sorgenteTerminale, "TERMINALE-INTATTO\n", "utf8");
  const percorsoTerminale = await realpath(sorgenteTerminale);
  const infoTerminale = await stat(percorsoTerminale, { bigint: true });
  ambiente.ponte.terminali.set("riserva-import-test", {
    identita: {
      percorso: percorsoTerminale,
      chiave: `${infoTerminale.dev}:${infoTerminale.ino}`,
    },
  });
  const riservataTerminale = await ambiente.post("/api/comando", {
    sessionId: sessioneA.id,
    type: "import_jsonl",
    inputPath: sorgenteTerminale,
    cwdOverride: cartellaA,
  });
  ambiente.ponte.terminali.clear();
  assert.equal(riservataTerminale.risposta.status, 409);

  assert.equal(importInoltrati, 0);
  assert.equal(await readFile(correnteA, "utf8"), "CORRENTE-A\n");
  assert.equal(await readFile(correnteB, "utf8"), "CORRENTE-B\n");
  assert.equal(await readFile(destinazioneArchiviata, "utf8"), "ARCHIVIATA-INTATTA\n");
  assert.equal(await readFile(sorgenteCollisione, "utf8"), "SORGENTE\n");
  assert.equal(await readFile(destinazioneHardlink, "utf8"), "HARDLINK-INTATTO\n");
  assert.equal(await readFile(sorgenteHardlink, "utf8"), "HARDLINK-INTATTO\n");
  assert.equal(await readFile(sorgenteTerminale, "utf8"), "TERMINALE-INTATTO\n");
});

test("changelog, fiducia e condivisione usano workflow HTTP autenticati e confinati", async (t) => {
  const decisioni = new Map();
  const chiamateGh = [];
  class ArchivioFiduciaFake {
    constructor(agentDir) {
      assert.equal(agentDir, "agent-dir-test");
    }
    get(cwd) { return decisioni.get(cwd) ?? null; }
    set(cwd, decision) { decisioni.set(cwd, decision); }
  }
  const ambiente = await avviaPonteTest({
    leggiChangelog: async () => ({ versione: "0.84.2", markdown: "# Novita\n" }),
    caricaSupportoRuntime: async () => ({
      versione: "0.84.2",
      getAgentDir: () => "agent-dir-test",
      getShareViewerUrl: (id) => "https://preview.test/#" + id,
      ProjectTrustStore: ArchivioFiduciaFake,
      modelliPredefiniti: { fake: "modello-test" },
    }),
    eseguiGh: async (argomenti) => {
      chiamateGh.push(argomenti);
      return argomenti[0] === "auth"
        ? { code: 0, stdout: "ok", stderr: "" }
        : { code: 0, stdout: "https://gist.github.com/utente/abcdef123456\n", stderr: "" };
    },
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "workflow-integrati");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200);
  const sessionId = avvio.dati.id;

  const changelogNegato = await ambiente.post("/api/changelog", {}, null);
  assert.equal(changelogNegato.risposta.status, 403);
  const changelog = await ambiente.post("/api/changelog", {});
  assert.deepEqual(changelog.dati, { piVersion: "0.84.2", markdown: "# Novita\n" });

  const lettura = await ambiente.post("/api/fiducia-progetto", { sessionId });
  assert.equal(lettura.dati.decision, null);
  const cartellaCanonica = await realpath(cartella);
  assert.equal(lettura.dati.cwd, cartellaCanonica);
  const decisioneAmbigua = await ambiente.post("/api/fiducia-progetto", {
    sessionId, decision: "true",
  });
  assert.equal(decisioneAmbigua.risposta.status, 400);
  const percorsoIniettato = await ambiente.post("/api/fiducia-progetto", {
    sessionId, decision: true, cwd: dirname(cartella),
  });
  assert.equal(percorsoIniettato.risposta.status, 400);
  const salvataggio = await ambiente.post("/api/fiducia-progetto", { sessionId, decision: true });
  assert.equal(salvataggio.risposta.status, 200);
  assert.equal(salvataggio.dati.decision, true);
  assert.deepEqual([...decisioni.entries()], [[cartellaCanonica, true]]);

  const senzaConferma = await ambiente.post("/api/condividi", { sessionId, confirmed: false });
  assert.equal(senzaConferma.risposta.status, 400);
  const sessione = ambiente.ponte.sessioni.get(sessionId);
  sessione.inEsecuzione = true;
  const occupata = await ambiente.post("/api/condividi", {
    sessionId, confirmed: true, operationId: "test-share-occupata",
  });
  assert.equal(occupata.risposta.status, 409);
  sessione.inEsecuzione = false;
  const inviaEAttendiOriginale = sessione.inviaEAttendi.bind(sessione);
  let fileTemporaneo = null;
  sessione.inviaEAttendi = async (comando, timeout) => {
    if (comando.type !== "export_html") return inviaEAttendiOriginale(comando, timeout);
    fileTemporaneo = comando.outputPath;
    assert.match(comando.id, /^ponte-share-/);
    await writeFile(comando.outputPath, "<!doctype html><title>Sessione</title>", "utf8");
    return { path: comando.outputPath };
  };
  const condivisa = await ambiente.post("/api/condividi", {
    sessionId, confirmed: true, operationId: "test-share-successo",
  });
  assert.equal(condivisa.risposta.status, 200);
  assert.equal(condivisa.dati.gistUrl, "https://gist.github.com/utente/abcdef123456");
  assert.equal(condivisa.dati.previewUrl, "https://preview.test/#abcdef123456");
  assert.deepEqual(chiamateGh, [
    ["auth", "status"],
    [
      "gist", "create", "--public=false", "--desc",
      "Pi GUI operation test-share-successo", fileTemporaneo,
    ],
  ]);
  await assert.rejects(readFile(fileTemporaneo), /ENOENT/);
});

test("la condivisione durevole replaya il successo e non duplica un gist ambiguo dopo restart", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pi-gui-share-durevole-"));
  const cartella = join(home, "progetto");
  await mkdir(cartella);
  let primo = null;
  let secondo = null;
  t.after(async () => {
    await primo?.chiudi().catch(() => {});
    await secondo?.chiudi().catch(() => {});
    await rm(home, { recursive: true, force: true });
  });

  class ArchivioFiduciaFake {
    get() { return null; }
    set() {}
  }
  const supporto = async () => ({
    versione: "0.84.2",
    getAgentDir: () => "agent-dir-share-durevole",
    getShareViewerUrl: (id) => "https://preview.test/#" + id,
    ProjectTrustStore: ArchivioFiduciaFake,
    modelliPredefiniti: { fake: "modello-test" },
  });
  let gistTentati = 0;
  primo = await avviaPonteTest({
    home,
    conservaHome: true,
    caricaSupportoRuntime: supporto,
    eseguiGh: async (argomenti) => {
      if (argomenti[0] === "auth") return { code: 0, stdout: "ok", stderr: "" };
      gistTentati += 1;
      if (argomenti.some((argomento) => argomento.includes("test-share-ambiguo"))) {
        throw new Error("connessione interrotta dopo l'avvio di gh");
      }
      return { code: 0, stdout: "https://gist.github.com/utente/abcdef123456\n", stderr: "" };
    },
  });
  const avvio = await primo.post("/api/avvia", { cartella });
  const sessionId = avvio.dati.id;
  const fileSessione = primo.ponte.sessioni.get(sessionId).fileSessione;
  const sessione = primo.ponte.sessioni.get(sessionId);
  const inviaOriginale = sessione.inviaEAttendi.bind(sessione);
  sessione.inviaEAttendi = async (comando, timeout) => {
    if (comando.type !== "export_html") return inviaOriginale(comando, timeout);
    await writeFile(comando.outputPath, "<!doctype html><title>Sessione</title>", "utf8");
    return { path: comando.outputPath };
  };

  const successo = await primo.post("/api/condividi", {
    sessionId,
    confirmed: true,
    operationId: "test-share-durevole",
  });
  assert.equal(successo.risposta.status, 200);
  assert.equal(successo.dati.previewUrl, "https://preview.test/#abcdef123456");
  const retryRispostaPersa = await primo.post("/api/condividi", {
    sessionId,
    confirmed: true,
    operationId: "test-share-durevole",
  });
  assert.equal(retryRispostaPersa.risposta.status, 200);
  assert.equal(retryRispostaPersa.dati.previewUrl, successo.dati.previewUrl);
  assert.equal(retryRispostaPersa.dati.operation.replayed, true);
  assert.equal(gistTentati, 1);

  const ambiguo = await primo.post("/api/condividi", {
    sessionId,
    confirmed: true,
    operationId: "test-share-ambiguo",
  });
  assert.equal(ambiguo.risposta.status, 409);
  assert.equal(ambiguo.dati.code, "SHARE_ESITO_AMBIGUO");
  assert.equal(gistTentati, 2);

  const archivioPath = join(home, ".pi", "gui", "share-operations-v1.json");
  const archivio = await readFile(archivioPath, "utf8");
  assert.equal(archivio.includes(primo.stato.tokenApi), false);
  assert.doesNotMatch(archivio, /progetto|session\.html/i);
  assert.ok(Buffer.byteLength(archivio) < 512 * 1024);

  await primo.chiudi();
  const chiamateDopoRestart = [];
  secondo = await avviaPonteTest({
    home,
    conservaHome: true,
    caricaSupportoRuntime: supporto,
    eseguiGh: async (argomenti) => {
      chiamateDopoRestart.push(argomenti);
      throw new Error("gh non deve essere richiamato durante un replay durevole");
    },
  });
  const riaperta = await secondo.post("/api/avvia", {
    cartella,
    sessionPath: fileSessione,
    forzaNuova: true,
  });
  const nuovaSessioneId = riaperta.dati.id;
  const replaySuccesso = await secondo.post("/api/condividi", {
    sessionId: nuovaSessioneId,
    confirmed: true,
    operationId: "test-share-durevole",
  });
  assert.equal(replaySuccesso.risposta.status, 200);
  assert.equal(replaySuccesso.dati.previewUrl, successo.dati.previewUrl);
  assert.equal(replaySuccesso.dati.operation.replayed, true);

  const replayAmbiguo = await secondo.post("/api/condividi", {
    sessionId: nuovaSessioneId,
    confirmed: true,
    operationId: "test-share-ambiguo",
  });
  assert.equal(replayAmbiguo.risposta.status, 409);
  assert.equal(replayAmbiguo.dati.code, "SHARE_ESITO_AMBIGUO");
  assert.deepEqual(chiamateDopoRestart, []);
});

test("lo stato propone Desktop e Documenti reindirizzati come posizioni rapide", async (t) => {
  const ambiente = await avviaPonteTest({
    preparaHome: async (home) => {
      await mkdir(join(home, "OneDrive", "Desktop"), { recursive: true });
      await mkdir(join(home, "OneDrive", "Documenti"), { recursive: true });
    },
  });
  t.after(ambiente.chiudi);

  const preferite = Object.fromEntries(
    ambiente.stato.preferite.map((voce) => [voce.nome, voce.percorso]),
  );
  assert.equal(preferite.Desktop, join(ambiente.home, "OneDrive", "Desktop"));
  assert.equal(preferite.Documenti, join(ambiente.home, "OneDrive", "Documenti"));
});

test("i body RPC devono essere oggetti con tipi e flag non ambigui", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const nullo = await ambiente.post("/api/sfoglia", null);
  assert.equal(nullo.risposta.status, 400);
  const array = await ambiente.post("/api/sfoglia", []);
  assert.equal(array.risposta.status, 400);
  const tipoOggetto = await ambiente.post("/api/comando", { type: { nome: "get_state" } });
  assert.equal(tipoOggetto.risposta.status, 400);
  const cartella = join(ambiente.home, "flag-ambiguo");
  await mkdir(cartella);
  const flag = await ambiente.post("/api/avvia", { cartella, forzaNuova: "false" });
  assert.equal(flag.risposta.status, 400);
  const fiducia = await ambiente.post("/api/avvia", { cartella, approvaProgetto: "false" });
  assert.equal(fiducia.risposta.status, 400);
  const provider = await ambiente.post("/api/avvia", { cartella, provider: { nome: "fake" } });
  assert.equal(provider.risposta.status, 400);
  const salvate = await ambiente.post("/api/sessioni-salvate", { cartella: { percorso: cartella } });
  assert.equal(salvate.risposta.status, 400);
});

test("solo un client GUI identificato rinnova il lease di auto-stop", async (t) => {
  let segnalaStop;
  const fermato = new Promise((risolvi) => { segnalaStop = risolvi; });
  const ambiente = await avviaPonteTest({ autoStopMs: 140, onAutoStop: segnalaStop });
  t.after(ambiente.chiudi);
  ambiente.ponte.programmaAutoStop();

  // GET semplici sono inviabili anche da una pagina web ostile. Ripeterli non
  // deve tenere vivo il processo locale.
  const martello = setInterval(() => {
    fetch(ambiente.base + "/api/salute").catch(() => {});
  }, 30);
  const fermatoNonostanteGet = await Promise.race([
    fermato.then(() => true),
    attendi(450).then(() => false),
  ]);
  clearInterval(martello);
  assert.equal(fermatoNonostanteGet, true);
});

test("il ponte rifiuta richieste web forgiate e serve una CSP restrittiva", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);

  const testoSemplice = await fetch(ambiente.base + "/api/avvia", {
    method: "POST",
    headers: { "content-type": "text/plain", "x-pi-gui-token": ambiente.stato.tokenApi },
    body: "{}",
  });
  assert.equal(testoSemplice.status, 403);

  const origineEsterna = await fetch(ambiente.base + "/api/avvia", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-gui-token": ambiente.stato.tokenApi,
      origin: "https://pagina-ostile.example",
    },
    body: "{}",
  });
  assert.equal(origineEsterna.status, 403);

  const origineSchemaDiverso = await fetch(ambiente.base + "/api/avvia", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-gui-token": ambiente.stato.tokenApi,
      origin: "https://" + new URL(ambiente.base).host,
    },
    body: "{}",
  });
  assert.equal(origineSchemaDiverso.status, 403);

  const tipoQuasiJson = await fetch(ambiente.base + "/api/avvia", {
    method: "POST",
    headers: {
      "content-type": "application/json-malicious",
      "x-pi-gui-token": ambiente.stato.tokenApi,
    },
    body: "{}",
  });
  assert.equal(tipoQuasiJson.status, 403);

  const statoHostFalsificato = await new Promise((risolvi, rifiuta) => {
    const richiesta = richiestaHttp(ambiente.base + "/api/stato", {
      headers: { host: "pagina-ostile.example" },
    }, (risposta) => {
      risposta.resume();
      risposta.on("end", () => risolvi(risposta.statusCode));
    });
    richiesta.on("error", rifiuta);
    richiesta.end();
  });
  assert.equal(statoHostFalsificato, 403);

  const pagina = await fetch(ambiente.base + "/");
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.match(pagina.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(pagina.headers.get("x-frame-options"), "DENY");
  assert.equal(pagina.headers.get("access-control-allow-origin"), null);

  const sfogliaGet = await fetch(
    ambiente.base + "/api/sfoglia?percorso=" + encodeURIComponent("\\\\server-inesistente\\condivisione"),
  );
  assert.equal(sfogliaGet.status, 405);
  assert.equal(sfogliaGet.headers.get("allow"), "POST");
  const statoPut = await fetch(ambiente.base + "/api/stato", { method: "PUT", body: "non letto" });
  assert.equal(statoPut.status, 405);
  assert.equal(statoPut.headers.get("allow"), "GET");
  const sfogliaSenzaToken = await ambiente.post("/api/sfoglia", { percorso: ambiente.home }, null);
  assert.equal(sfogliaSenzaToken.risposta.status, 403);
  assert.equal(ambiente.stato.versione, 6);
  const salute = await (await fetch(ambiente.base + "/api/salute")).json();
  assert.deepEqual(salute, { servizio: "pi-gui-bridge", versione: 6 });
});

test("i body rifiutati non tengono socket aperti e gli errori JSON hanno status precisi", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const indirizzo = new URL(ambiente.base);

  const rispostaRaw = await new Promise((risolvi, rifiuta) => {
    let ricevuto = "";
    const socket = createConnection(
      { host: indirizzo.hostname, port: Number(indirizzo.port) },
      () => {
        socket.write(
          "POST /api/avvia HTTP/1.1\r\n" +
          `Host: ${indirizzo.host}\r\n` +
          "Content-Type: text/plain\r\n" +
          "Content-Length: 100000000\r\n" +
          "Connection: keep-alive\r\n\r\n" +
          "x",
        );
      },
    );
    const limite = setTimeout(() => {
      socket.destroy();
      rifiuta(new Error("Il ponte ha lasciato aperto un upload rifiutato"));
    }, 1500);
    socket.setEncoding("utf8");
    socket.on("data", (pezzo) => { ricevuto += pezzo; });
    socket.on("error", rifiuta);
    socket.on("close", () => {
      clearTimeout(limite);
      risolvi(ricevuto);
    });
  });
  assert.match(rispostaRaw, /^HTTP\/1\.1 403 /);
  assert.match(rispostaRaw, /Connection: close/i);

  const jsonInvalido = await fetch(ambiente.base + "/api/avvia", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-gui-token": ambiente.stato.tokenApi,
    },
    body: "{",
  });
  assert.equal(jsonInvalido.status, 400);

  const troppoGrande = await fetch(ambiente.base + "/api/avvia", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-gui-token": ambiente.stato.tokenApi,
    },
    body: "x".repeat(16 * 1024 * 1024 + 1),
  });
  assert.equal(troppoGrande.status, 413);
});

test("un request-target malformato riceve 400 senza terminare il ponte", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const indirizzo = new URL(ambiente.base);
  const raw = await new Promise((risolvi, rifiuta) => {
    let ricevuto = "";
    const socket = createConnection(
      { host: indirizzo.hostname, port: Number(indirizzo.port) },
      () => socket.write(
        "GET http://[ HTTP/1.1\r\n"
        + `Host: ${indirizzo.host}\r\nConnection: close\r\n\r\n`,
      ),
    );
    socket.setEncoding("utf8");
    socket.on("data", (pezzo) => { ricevuto += pezzo; });
    socket.on("error", rifiuta);
    socket.on("close", () => risolvi(ricevuto));
  });
  assert.match(raw, /^HTTP\/1\.1 400 /);
  assert.equal((await fetch(ambiente.base + "/api/salute")).status, 200);
});

test("due cartelle mantengono due processi pi indipendenti", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const prima = join(ambiente.home, "prima");
  const seconda = join(ambiente.home, "seconda");
  await mkdir(prima);
  await mkdir(seconda);
  const uno = await ambiente.post("/api/avvia", { cartella: prima, approvaProgetto: false });
  const due = await ambiente.post("/api/avvia", { cartella: seconda, approvaProgetto: false });
  assert.equal(uno.risposta.status, 200);
  assert.equal(due.risposta.status, 200);
  assert.notEqual(uno.dati.id, due.dati.id);
  const stato = await (await fetch(ambiente.base + "/api/stato")).json();
  assert.equal(stato.sessioni.length, 2);
  assert.deepEqual(
    new Set(stato.sessioni.map((sessione) => sessione.cartella)),
    new Set([await realpath(prima), await realpath(seconda)]),
  );
});

test("il passaggio al terminale riserva il JSONL fino alla chiusura del TUI", async (t) => {
  let terminaTerminale;
  const terminato = new Promise((risolvi) => { terminaTerminale = risolvi; });
  let apertura;
  const ambiente = await avviaPonteTest({
    apriTerminale: async (cartella, opzioni) => {
      apertura = { cartella, ...opzioni };
      return { terminato };
    },
  });
  t.after(async () => {
    terminaTerminale();
    await attendi(10);
    await ambiente.chiudi();
  });
  const cartella = join(ambiente.home, "handoff");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const fileSessione = sessione.fileSessione;

  sessione.revisioniComandi.set("ancora-in-corso", sessione.revisioneFileSessione);
  const occupata = await ambiente.post("/api/handoff-terminale", { sessionId: sessione.id });
  assert.equal(occupata.risposta.status, 409);
  assert.match(occupata.dati.errore, /richieste in corso/i);
  sessione.revisioniComandi.clear();

  const handoff = await ambiente.post("/api/handoff-terminale", { sessionId: sessione.id });
  assert.equal(handoff.risposta.status, 200);
  assert.equal(apertura.cartella, await realpath(cartella));
  assert.equal(apertura.sessionPath, fileSessione);
  assert.match(apertura.directorySessioni, /terminali/);
  assert.equal(ambiente.ponte.sessioni.has(sessione.id), false);
  assert.equal(ambiente.ponte.terminali.size, 1);

  const riapertura = await ambiente.post("/api/avvia", {
    cartella,
    sessionPath: fileSessione,
    forzaNuova: true,
  });
  assert.equal(riapertura.risposta.status, 409);
  assert.match(riapertura.dati.errore, /aperta in PI completo/i);

  const secondaCartella = join(ambiente.home, "handoff-seconda");
  const aliasSessione = join(ambiente.home, "handoff-alias.jsonl");
  await mkdir(secondaCartella);
  await link(fileSessione, aliasSessione);
  const seconda = await ambiente.post("/api/avvia", { cartella: secondaCartella });
  const cambio = await ambiente.post("/api/comando", {
    sessionId: seconda.dati.id,
    type: "switch_session",
    sessionPath: aliasSessione,
  });
  assert.equal(cambio.risposta.status, 409);
  assert.match(cambio.dati.errore, /aperta in PI completo/i);

  terminaTerminale();
  for (let tentativo = 0; tentativo < 20 && ambiente.ponte.terminali.size; tentativo += 1) {
    await attendi(5);
  }
  assert.equal(ambiente.ponte.terminali.size, 0);
});

test("il passaggio al terminale si ferma se un'altra finestra puo avere bozze", async (t) => {
  const ambiente = await avviaPonteTest({
    apriTerminale: async () => ({ terminato: Promise.resolve() }),
    durataLeaseClientMs: 750,
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "handoff-due-finestre");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });

  const abortA = new AbortController();
  const abortB = new AbortController();
  t.after(() => { abortA.abort(); abortB.abort(); });
  const token = encodeURIComponent(ambiente.stato.tokenApi);
  const [eventiA, eventiB] = await Promise.all([
    fetch(`${ambiente.base}/api/eventi?token=${token}&clientId=finestra-a`, { signal: abortA.signal }),
    fetch(`${ambiente.base}/api/eventi?token=${token}&clientId=finestra-b`, { signal: abortB.signal }),
  ]);
  assert.equal(eventiA.status, 200);
  assert.equal(eventiB.status, 200);
  assert.equal(ambiente.ponte.numeroAscoltatori(), 2);

  const handoff = await ambiente.post(
    "/api/handoff-terminale",
    { sessionId: avvio.dati.id },
    ambiente.stato.tokenApi,
    "finestra-a",
  );
  assert.equal(handoff.risposta.status, 409);
  assert.match(handoff.dati.errore, /altra finestra.*collegata/i);
  assert.equal(handoff.dati.code, "HANDOFF_OTHER_CLIENT_CONNECTED");
  assert.equal(handoff.dati.blocker, "client_connesso");
  assert.equal(handoff.dati.retryable, true);
  assert.equal(Object.hasOwn(handoff.dati, "retryAfterMs"), false);
  assert.equal(ambiente.ponte.sessioni.has(avvio.dati.id), true);

  const chiudi = await ambiente.post(
    "/api/chiudi",
    { sessionId: avvio.dati.id },
    ambiente.stato.tokenApi,
    "finestra-a",
  );
  assert.equal(chiudi.risposta.status, 409);
  assert.match(chiudi.dati.errore, /altre finestre.*bozze|bozze.*altre finestre/i);
  assert.equal(ambiente.ponte.sessioni.has(avvio.dati.id), true);

  const chiudiTutte = await ambiente.post(
    "/api/chiudi-tutte",
    {},
    ambiente.stato.tokenApi,
    "finestra-a",
  );
  assert.equal(chiudiTutte.risposta.status, 409);
  assert.equal(ambiente.ponte.sessioni.has(avvio.dati.id), true);

  // Il lease deve partire dalla disconnessione reale, non dal momento in cui
  // la finestra ha aperto il suo EventSource. Lasciamo quindi invecchiare la
  // connessione oltre l'intera grace prima di chiuderla.
  await attendi(800);
  await eventiB.body.cancel();
  for (let tentativo = 0; tentativo < 40 && ambiente.ponte.numeroAscoltatori() !== 1; tentativo += 1) {
    await attendi(5);
  }
  assert.equal(ambiente.ponte.numeroAscoltatori(), 1);
  const duranteRiconnessione = await ambiente.post(
    "/api/handoff-terminale",
    { sessionId: avvio.dati.id },
    ambiente.stato.tokenApi,
    "finestra-a",
  );
  assert.equal(duranteRiconnessione.risposta.status, 409);
  assert.match(duranteRiconnessione.dati.errore, /appena disconnessa|riconnett/i);
  assert.equal(duranteRiconnessione.dati.code, "HANDOFF_CLIENT_RECONNECT_GRACE");
  assert.equal(duranteRiconnessione.dati.blocker, "lease_riconnessione");
  assert.equal(duranteRiconnessione.dati.retryable, true);
  assert.ok(duranteRiconnessione.dati.retryAfterMs > 0);
  assert.ok(duranteRiconnessione.dati.retryAfterMs <= 750);
  assert.equal(ambiente.ponte.sessioni.has(avvio.dati.id), true);

  await attendi(duranteRiconnessione.dati.retryAfterMs + 40);
  const dopoGrace = await ambiente.post(
    "/api/handoff-terminale",
    { sessionId: avvio.dati.id },
    ambiente.stato.tokenApi,
    "finestra-a",
  );
  assert.equal(dopoGrace.risposta.status, 200);
  assert.equal(dopoGrace.dati.ok, true);
  assert.equal(ambiente.ponte.sessioni.has(avvio.dati.id), false);

  await eventiA.body.cancel();
});

test("una finestra collegata durante il passaggio vede la sessione riservata", async (t) => {
  const ambiente = await avviaPonteTest({
    apriTerminale: async () => ({ terminato: Promise.resolve() }),
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "handoff-snapshot");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const verificaOriginale = sessione.verificaIdentitaFileSessione.bind(sessione);
  let entraVerifica;
  const verificaIniziata = new Promise((risolvi) => { entraVerifica = risolvi; });
  let continuaVerifica;
  const verificaSbloccata = new Promise((risolvi) => { continuaVerifica = risolvi; });
  sessione.verificaIdentitaFileSessione = async (...argomenti) => {
    entraVerifica();
    await verificaSbloccata;
    return verificaOriginale(...argomenti);
  };

  const handoffPromesso = ambiente.post(
    "/api/handoff-terminale",
    { sessionId: sessione.id },
    ambiente.stato.tokenApi,
    "finestra-a",
  );
  await verificaIniziata;

  const controller = new AbortController();
  t.after(() => controller.abort());
  const eventi = await fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
      + "&clientId=finestra-c",
    { signal: controller.signal },
  );
  const primaLettura = await eventi.body.getReader().read();
  const snapshot = new TextDecoder().decode(primaLettura.value);
  assert.match(snapshot, /"attiva":false/);
  assert.match(snapshot, /"riservata":true/);

  continuaVerifica();
  const handoff = await handoffPromesso;
  assert.equal(handoff.risposta.status, 200);
  controller.abort();
});

test("se il terminale non parte la stessa conversazione torna attiva nella GUI", async (t) => {
  const ambiente = await avviaPonteTest({
    apriTerminale: async () => { throw new Error("terminale indisponibile"); },
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "handoff-rollback");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella, approvaProgetto: false });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const fileSessione = sessione.fileSessione;

  const handoff = await ambiente.post("/api/handoff-terminale", { sessionId: sessione.id });
  assert.equal(handoff.risposta.status, 500);
  assert.match(handoff.dati.errore, /ripristinata nella GUI/i);
  assert.equal(sessione.fileSessione, fileSessione);
  assert.equal(Boolean(sessione.proc), true);
  assert.equal(sessione.riassunto().attiva, true);
});

test("la stessa conversazione salvata non viene aperta da due processi", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "progetto");
  const fileSessione = join(ambiente.home, "sessione.jsonl");
  const aliasSessione = join(ambiente.home, "alias-sessione.jsonl");
  await mkdir(cartella);
  await writeFile(fileSessione, '{"type":"session","id":"salvata"}\n', "utf8");
  await link(fileSessione, aliasSessione);

  const prima = await ambiente.post("/api/avvia", {
    cartella,
    sessionPath: aliasSessione,
    forzaNuova: true,
  });
  const seconda = await ambiente.post("/api/avvia", {
    cartella,
    sessionPath: fileSessione,
    forzaNuova: true,
  });

  assert.equal(prima.risposta.status, 200);
  assert.equal(seconda.risposta.status, 200);
  assert.equal(seconda.dati.id, prima.dati.id);
  assert.equal(seconda.dati.esistente, true);
  assert.equal(ambiente.ponte.sessioni.size, 1);
});

test("un JSONL sostituito fuori da pi viene bloccato prima del prompt successivo", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "file-sostituito");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  assert.equal(sessione.identitaFileSessione?.provvisoria, false);
  const originale = sessione.fileSessione;
  await rename(originale, originale + ".spostato");
  await writeFile(originale, "", "utf8");

  const prompt = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "prompt",
    message: "non deve essere scritto nel file sostitutivo",
  });
  assert.equal(prompt.risposta.status, 409);
  assert.match(prompt.dati.errore, /spostato o sostituito/i);
  assert.equal(sessione.fileSessioneIncerta, true);
  assert.equal(await readFile(originale, "utf8"), "");
});

test("lo stato iniziale chiude la finestra di race prima del resume JSONL", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "stato-lento");
  const fileSessione = join(cartella, "fake-session.jsonl");
  await mkdir(cartella);
  await writeFile(fileSessione, '{"type":"session","id":"race"}\n', "utf8");

  const primaPromessa = ambiente.post("/api/avvia", { cartella, forzaNuova: true });
  await attendi(30);
  const secondaPromessa = ambiente.post("/api/avvia", {
    cartella,
    sessionPath: fileSessione,
    forzaNuova: true,
  });
  const [prima, seconda] = await Promise.all([primaPromessa, secondaPromessa]);
  assert.equal(prima.risposta.status, 200);
  assert.equal(seconda.risposta.status, 200);
  assert.equal(seconda.dati.esistente, true);
  assert.equal(seconda.dati.id, prima.dati.id);
  assert.equal(ambiente.ponte.sessioni.size, 1);
});

test("un cambio RPC riserva il JSONL finche il nuovo stato non e verificato", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "cambio-lento");
  const destinazione = join(cartella, "destinazione.jsonl");
  await mkdir(cartella);
  await writeFile(destinazione, '{"type":"session","id":"destinazione"}\n', "utf8");
  const aperta = await ambiente.post("/api/avvia", { cartella, forzaNuova: true });
  assert.equal(aperta.risposta.status, 200);

  const cambio = await ambiente.post("/api/comando", {
    sessionId: aperta.dati.id,
    type: "switch_session",
    sessionPath: destinazione,
  });
  assert.equal(cambio.risposta.status, 200);
  const durante = await ambiente.post("/api/avvia", {
    cartella,
    sessionPath: destinazione,
    forzaNuova: true,
  });
  assert.equal(durante.risposta.status, 409);
  assert.match(durante.dati.errore, /cambio di cronologia/i);

  await attendi(260);
  const dopo = await ambiente.post("/api/avvia", {
    cartella,
    sessionPath: destinazione,
    forzaNuova: true,
  });
  assert.equal(dopo.risposta.status, 200);
  assert.equal(dopo.dati.esistente, true);
  assert.equal(dopo.dati.id, aperta.dati.id);
  assert.equal(ambiente.ponte.sessioni.size, 1);
});

test("un get_state iniziale fallito non lascia una scheda fantasma", async (t) => {
  const ambiente = await avviaPonteTest({ timeoutStatoIniziale: 120 });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "stato-muto");
  await mkdir(cartella);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const rispostaEventi = await fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
      + "&clientId=client-rollback",
    { signal: controller.signal },
  );
  const lettore = rispostaEventi.body.getReader();
  const decoder = new TextDecoder();

  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 500);
  let ricevuto = "";
  const scadenza = Date.now() + 1200;
  while (!ricevuto.includes("gui_sessione_chiusa") && Date.now() < scadenza) {
    const esito = await Promise.race([
      lettore.read(),
      attendi(Math.max(1, scadenza - Date.now())).then(() => ({ timeout: true })),
    ]);
    if (esito.timeout || esito.done) break;
    ricevuto += decoder.decode(esito.value, { stream: true });
  }
  assert.match(ricevuto, /gui_sessione_chiusa/);
  assert.doesNotMatch(ricevuto, /gui_sessione_avviata/);
  assert.equal(ambiente.ponte.sessioni.size, 0);
  await lettore.cancel();
});

test("una sessione nuova prenota il JSONL prima che PI lo materializzi", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "file-tardivo");
  await mkdir(cartella);

  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200);
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  assert.equal(sessione.identitaFileSessione?.provvisoria, true);
  assert.equal(sessione.fileSessioneIncerta, false);
  await assert.rejects(readFile(sessione.fileSessione, "utf8"), /ENOENT/);

  const primo = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "prompt",
    message: "crea il primo turno",
  });
  assert.equal(primo.risposta.status, 200);
  const scadenzaPrimo = Date.now() + 1500;
  while (sessione.identitaFileSessione?.provvisoria && Date.now() < scadenzaPrimo) {
    await attendi(20);
  }
  assert.equal(sessione.identitaFileSessione?.provvisoria, false);

  const nuova = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "new_session",
  });
  assert.equal(nuova.risposta.status, 200);
  const scadenzaCambio = Date.now() + 1500;
  while (
    (sessione.cambioSessioneInCorso || !sessione.identitaFileSessione?.provvisoria)
    && Date.now() < scadenzaCambio
  ) {
    await attendi(20);
  }
  assert.equal(sessione.cambioSessioneInCorso, false);
  assert.equal(sessione.identitaFileSessione?.provvisoria, true);

  await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "prompt",
    message: "materializza anche la nuova cronologia",
  });
  const scadenzaSecondo = Date.now() + 1500;
  while (sessione.identitaFileSessione?.provvisoria && Date.now() < scadenzaSecondo) {
    await attendi(20);
  }
  assert.equal(sessione.identitaFileSessione?.provvisoria, false);
});

test("durante lo streaming la cronologia espone solo una fotografia parziale esplicita", async (t) => {
  const messaggi = [
    { role: "user", content: [{ type: "text", text: "gia salvato" }], timestamp: 1 },
    { role: "assistant", content: [{ type: "text", text: "prefisso stabile" }], timestamp: 2 },
  ];
  const ambiente = await avviaPonteTest({
    caricaCronologiaParziale: async () => messaggi,
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "cronologia-parziale");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200);
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  sessione.inEsecuzione = true;
  const numeroSessioni = ambiente.ponte.sessioni.size;

  const senzaConsenso = await ambiente.post("/api/cronologia", { sessionId: sessione.id });
  assert.equal(senzaConsenso.risposta.status, 423);
  const tipoInvalido = await ambiente.post("/api/cronologia", {
    sessionId: sessione.id,
    consentiParziale: "si",
  });
  assert.equal(tipoInvalido.risposta.status, 400);

  const risposta = await fetch(ambiente.base + "/api/cronologia", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-gui-token": ambiente.stato.tokenApi,
    },
    body: JSON.stringify({ sessionId: sessione.id, consentiParziale: true }),
  });
  assert.equal(risposta.status, 200);
  const record = (await risposta.text())
    .trim()
    .split("\n")
    .map((riga) => JSON.parse(riga));
  assert.equal(record[0].tipo, "inizio");
  assert.equal(record[0].parziale, true);
  assert.deepEqual(
    record.filter((voce) => voce.tipo === "messaggio").map((voce) => voce.messaggio),
    messaggi,
  );
  assert.equal(record.at(-1).tipo, "fine");
  assert.equal(record.at(-1).parziale, true);
  assert.equal(ambiente.ponte.sessioni.size, numeroSessioni);
});

test("la cronologia oltre 32 MB arriva per record senza usare get_messages monolitico", async (t) => {
  const testoGrande = "x".repeat(1024 * 1024);
  const messaggi = Array.from({ length: 34 }, (_, indice) => ({
    role: indice % 2 ? "assistant" : "user",
    content: [{ type: "text", text: testoGrande }],
    timestamp: indice,
  }));
  const ambiente = await avviaPonteTest({
    caricaCronologia: async () => messaggi,
    caricaAlbero: async () => ({
      nodi: [{ id: "n1", type: "message", descrizione: "user: anteprima", profondita: 0 }],
      leafId: "n1",
      totale: 1,
    }),
    caricaForche: async () => ({
      messages: [{ entryId: "n1", text: "anteprima" }],
      totale: 1,
      troncati: 0,
    }),
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "cronologia-grande");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);

  sessione.inEsecuzione = true;
  const occupata = await ambiente.post("/api/cronologia", { sessionId: sessione.id });
  assert.equal(occupata.risposta.status, 423);
  sessione.inEsecuzione = false;

  const monolitica = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "get_messages",
  });
  assert.equal(monolitica.risposta.status, 409);
  assert.match(monolitica.dati.errore, /canale sicuro dedicato/i);

  for (const tipo of ["get_entries", "get_tree", "get_fork_messages", "get_last_assistant_text"]) {
    const nonPaginata = await ambiente.post("/api/comando", { sessionId: sessione.id, type: tipo });
    assert.equal(nonPaginata.risposta.status, 409);
  }
  const albero = await ambiente.post("/api/albero", { sessionId: sessione.id });
  assert.equal(albero.risposta.status, 200);
  assert.equal(albero.dati.nodi[0].descrizione, "user: anteprima");
  const forche = await ambiente.post("/api/forche", { sessionId: sessione.id });
  assert.equal(forche.risposta.status, 200);
  assert.equal(forche.dati.messages[0].entryId, "n1");
  const ultima = await fetch(ambiente.base + "/api/ultima-risposta", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-gui-token": ambiente.stato.tokenApi,
    },
    body: JSON.stringify({ sessionId: sessione.id }),
  });
  assert.equal(ultima.status, 200);
  assert.equal((await ultima.text()).length, testoGrande.length);

  const risposta = await fetch(ambiente.base + "/api/cronologia", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-gui-token": ambiente.stato.tokenApi,
    },
    body: JSON.stringify({ sessionId: sessione.id }),
  });
  assert.equal(risposta.status, 200);
  assert.match(risposta.headers.get("content-type"), /ndjson/);
  const lettore = risposta.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let ricevuti = 0;
  let caratteri = 0;
  let fine = null;
  while (true) {
    const esito = await lettore.read();
    if (esito.done) break;
    buffer += decoder.decode(esito.value, { stream: true });
    let separatore;
    while ((separatore = buffer.indexOf("\n")) >= 0) {
      const riga = buffer.slice(0, separatore);
      buffer = buffer.slice(separatore + 1);
      if (!riga) continue;
      const record = JSON.parse(riga);
      if (record.tipo === "messaggio") {
        ricevuti += 1;
        caratteri += record.messaggio.content[0].text.length;
      }
      if (record.tipo === "fine") fine = record;
    }
  }
  assert.equal(ricevuti, messaggi.length);
  assert.ok(caratteri > 32 * 1024 * 1024);
  assert.equal(fine?.conteggio, messaggi.length);
});

test("un fork fra 2 e 16 MiB viene fermato prima di cambiare il JSONL", async (t) => {
  const ambiente = await avviaPonteTest({
    caricaForche: async () => ({
      messages: [{
        entryId: "messaggio-enorme",
        text: "anteprima",
        dimensioneTesto: 3 * 1024 * 1024,
        forkConsentito: false,
      }],
      totale: 1,
      troncati: 0,
    }),
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "fork-enorme");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);

  const risposta = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "fork",
    entryId: "messaggio-enorme",
  });
  assert.equal(risposta.risposta.status, 413);
  assert.match(risposta.dati.errore, /troppo grande.*terminale/i);
  assert.equal(sessione.cambioSessioneInCorso, false);
  assert.equal(sessione.fileSessioneIncerta, false);
});

test("i comandi extension sono bloccati prima di stdin ma skill e template restano disponibili", async (t) => {
  const ambiente = await avviaPonteTest({
    bloccaComandiEstensione: true,
    estensioniBuiltinConsentite: new Set(["dialog-test"]),
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "confine-estensioni");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200);
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);

  const estensione = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "prompt",
    message: "/dialog-test",
  });
  assert.equal(estensione.risposta.status, 409);
  assert.match(estensione.dati.errore, /Pi completo/i);
  assert.deepEqual((await sessione.inviaEAttendi({ type: "get_messages" })).messages, []);

  for (const messaggio of ["/skill:test", "/template-test argomento"]) {
    const consentito = await ambiente.post("/api/comando", {
      sessionId: sessione.id,
      type: "prompt",
      message: messaggio,
    });
    assert.equal(consentito.risposta.status, 200);
    await attendi(40);
  }
});

test("un catalogo comandi non verificabile o inatteso impedisce l'avvio", async (t) => {
  const ambiente = await avviaPonteTest({
    bloccaComandiEstensione: true,
    estensioniBuiltinConsentite: new Set(["llama"]),
    timeoutStatoIniziale: 150,
  });
  t.after(ambiente.chiudi);
  for (const nome of ["comandi-invalidi", "comandi-muti", "comandi-inattesi"]) {
    const cartella = join(ambiente.home, nome);
    await mkdir(cartella);
    const avvio = await ambiente.post("/api/avvia", { cartella, forzaNuova: true });
    assert.equal(avvio.risposta.status, 409);
    assert.match(avvio.dati.errore, /comand|risposto in tempo|estensioni integrate/i);
  }
});

test("un alias junction della cartella riusa il processo esistente", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "progetto-reale");
  const alias = join(ambiente.home, "progetto-alias");
  await mkdir(cartella);
  await symlink(cartella, alias, process.platform === "win32" ? "junction" : "dir");
  const prima = await ambiente.post("/api/avvia", { cartella });
  const seconda = await ambiente.post("/api/avvia", { cartella: alias });
  assert.equal(seconda.dati.id, prima.dati.id);
  assert.equal(seconda.dati.esistente, true);
  assert.equal(ambiente.ponte.sessioni.size, 1);
});

test("le sessioni terminate non consumano il limite e il fallback sceglie una sessione viva", async (t) => {
  const ambiente = await avviaPonteTest({ maxSessioni: 2 });
  t.after(ambiente.chiudi);
  const primaCartella = join(ambiente.home, "prima-viva");
  const secondaCartella = join(ambiente.home, "seconda-morta");
  const terzaCartella = join(ambiente.home, "terza-viva");
  await mkdir(primaCartella);
  await mkdir(secondaCartella);
  await mkdir(terzaCartella);
  const prima = await ambiente.post("/api/avvia", { cartella: primaCartella });
  const seconda = await ambiente.post("/api/avvia", { cartella: secondaCartella });
  await ambiente.post("/api/comando", { sessionId: seconda.dati.id, type: "terminate_test" });
  await attendi(120);
  const fallback = await ambiente.post("/api/comando", { type: "get_state" });
  assert.equal(fallback.risposta.status, 200);
  const terza = await ambiente.post("/api/avvia", { cartella: terzaCartella });
  assert.equal(terza.risposta.status, 200);
  assert.notEqual(terza.dati.id, prima.dati.id);
});

test("le mutazioni concorrenti non perdono processi durante una chiusura", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const primaCartella = join(ambiente.home, "prima");
  const secondaCartella = join(ambiente.home, "seconda");
  await mkdir(primaCartella);
  await mkdir(secondaCartella);
  await ambiente.post("/api/avvia", { cartella: primaCartella });

  const chiusura = ambiente.post("/api/chiudi-tutte", {});
  await attendi(5);
  const apertura = ambiente.post("/api/avvia", { cartella: secondaCartella });
  assert.equal((await chiusura).risposta.status, 200);
  assert.equal((await apertura).risposta.status, 200);
  assert.equal([...ambiente.ponte.sessioni.values()].filter((sessione) => sessione.proc).length, 1);
});

test("la chiusura definitiva rifiuta nuove sessioni concorrenti", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "progetto");
  await mkdir(cartella);
  const chiusura = ambiente.ponte.chiudiTutto();
  const statoInChiusura = await fetch(ambiente.base + "/api/stato");
  assert.equal(statoInChiusura.status, 503);
  const saluteInChiusura = await fetch(ambiente.base + "/api/salute");
  assert.equal(saluteInChiusura.status, 503);
  assert.deepEqual(await saluteInChiusura.json(), {
    servizio: "pi-gui-bridge",
    versione: 6,
    stato: "chiusura",
    errore: "Il ponte si sta chiudendo",
  });
  const eventiInChiusura = await fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi),
  );
  assert.equal(eventiInChiusura.status, 503);
  const apertura = await ambiente.post("/api/avvia", { cartella });
  const comando = await ambiente.post("/api/comando", { type: "get_state" });
  const terminale = await ambiente.post("/api/apri-terminale", { sessionId: "inesistente" });
  await chiusura;
  assert.equal(apertura.risposta.status, 503);
  assert.equal(comando.risposta.status, 503);
  assert.equal(terminale.risposta.status, 503);
  assert.equal(ambiente.ponte.sessioni.size, 0);
});

test("un vecchio shutdown fallito non riapre il gate durante quello successivo", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);

  let chiamate = 0;
  let sbloccaSecondo;
  let segnalaSecondo;
  const secondoEntrato = new Promise((risolvi) => { segnalaSecondo = risolvi; });
  const bloccoSecondo = new Promise((risolvi) => { sbloccaSecondo = risolvi; });
  ambiente.ponte.sessioni.set("ostinata", {
    proc: { pid: 123 },
    riassunto: () => ({ id: "ostinata", attiva: false, riservata: true }),
    ferma: async () => {
      chiamate += 1;
      if (chiamate === 1) {
        await attendi(40);
        throw new Error("primo arresto fallito");
      }
      segnalaSecondo();
      await bloccoSecondo;
      throw new Error("secondo arresto fallito");
    },
  });

  const primo = ambiente.ponte.chiudiTutto({ ripristinaSuErrore: true });
  await attendi(5);
  const secondo = ambiente.ponte.chiudiTutto({ ripristinaSuErrore: true });
  await assert.rejects(primo, /primo arresto fallito/);
  await secondoEntrato;
  assert.equal((await fetch(ambiente.base + "/api/stato")).status, 503);
  sbloccaSecondo();
  await assert.rejects(secondo, /secondo arresto fallito/);
  assert.equal((await fetch(ambiente.base + "/api/stato")).status, 200);
  ambiente.ponte.sessioni.delete("ostinata");
});

test("un avvio col body in ritardo non supera uno spegnimento definitivo", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "progetto-ritardato");
  await mkdir(cartella);
  const body = JSON.stringify({ cartella });
  let richiesta;
  const rispostaAvvio = new Promise((risolvi, rifiuta) => {
    richiesta = richiestaHttp(ambiente.base + "/api/avvia", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-gui-token": ambiente.stato.tokenApi,
        "content-length": Buffer.byteLength(body),
      },
    }, (risposta) => {
      let testo = "";
      risposta.setEncoding("utf8");
      risposta.on("data", (pezzo) => { testo += pezzo; });
      risposta.on("end", () => risolvi({ status: risposta.statusCode, dati: JSON.parse(testo) }));
    });
    richiesta.on("error", rifiuta);
    richiesta.write(body.slice(0, 5));
  });
  await attendi(30);
  const chiusura = ambiente.ponte.chiudiTutto();
  richiesta.end(body.slice(5));
  const avvio = await rispostaAvvio;
  await chiusura;
  assert.equal(avvio.status, 503);
  assert.equal(ambiente.ponte.sessioni.size, 0);
});

test("un comando col body in ritardo non supera uno spegnimento definitivo", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "comando-ritardato");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const body = JSON.stringify({ sessionId: avvio.dati.id, type: "prompt", message: "non partire" });
  let richiesta;
  const rispostaComando = new Promise((risolvi, rifiuta) => {
    richiesta = richiestaHttp(ambiente.base + "/api/comando", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-gui-token": ambiente.stato.tokenApi,
        "content-length": Buffer.byteLength(body),
      },
    }, (risposta) => {
      let testo = "";
      risposta.setEncoding("utf8");
      risposta.on("data", (pezzo) => { testo += pezzo; });
      risposta.on("end", () => risolvi({ status: risposta.statusCode, dati: JSON.parse(testo) }));
    });
    richiesta.on("error", rifiuta);
    richiesta.write(body.slice(0, 8));
  });
  await attendi(30);
  const chiusura = ambiente.ponte.chiudiTutto();
  richiesta.end(body.slice(8));
  const comando = await rispostaComando;
  await chiusura;
  assert.equal(comando.status, 503);
  assert.equal(ambiente.ponte.sessioni.size, 0);
});

test("la response finale precede sempre la notifica di processo chiuso", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-close-order-"));
  const eventi = [];
  const sessione = new SessionePi({ id: "ordine", cliPi: FAKE_PI, emetti: (evento) => eventi.push(evento) });
  t.after(async () => {
    await sessione.ferma({ notifica: false });
    await rm(cartella, { recursive: true, force: true });
  });
  await sessione.avvia({ cartella, approvaProgetto: false });
  const id = sessione.invia({ type: "final_response_then_exit" });
  const scadenza = Date.now() + 6000;
  while (!eventi.some((evento) => evento.type === "gui_processo_finito") && Date.now() < scadenza) {
    await attendi(20);
  }
  const indiceRisposta = eventi.findIndex((evento) => evento.type === "response" && evento.id === id);
  const indiceFine = eventi.findIndex((evento) => evento.type === "gui_processo_finito");
  assert.ok(indiceRisposta >= 0);
  assert.ok(indiceFine > indiceRisposta);
});

test("un arresto di sistema fallito non libera la sessione mentre il PID e vivo", {
  skip: process.platform !== "win32",
}, async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-stubborn-"));
  const eventi = [];
  const sessione = new SessionePi({
    id: "ostinata",
    cliPi: PI_OSTINATO,
    emetti: (evento) => eventi.push(evento),
    taskkillWindows: join(cartella, "taskkill-mancante.exe"),
    dopoArrestoForzatoMs: 30,
    scadenzaArrestoMs: 160,
    // Questo caso verifica la riserva del processo radice. L'inventario WMI
    // dell'albero e coperto dai test dedicati qui sotto e renderebbe il tempo
    // di rilascio dipendente dal carico della macchina Windows.
    elencaDiscendenti: async () => [],
    terminaDiscendenti: async () => true,
  });
  t.after(async () => {
    if (sessione.proc?.pid) {
      try { process.kill(sessione.proc.pid); } catch {}
    }
    await attendi(80);
    await rm(cartella, { recursive: true, force: true });
  });

  await sessione.avvia({ cartella, approvaProgetto: false });
  const pid = sessione.proc.pid;
  await assert.rejects(
    sessione.ferma({ notifica: false }),
    /sessione resta riservata/i,
  );
  assert.equal(sessione.proc.pid, pid);
  assert.equal(sessione.riassunto().attiva, false);
  assert.equal(sessione.riassunto().riservata, true);

  process.kill(pid);
  const scadenza = Date.now() + 6000;
  while (sessione.proc && Date.now() < scadenza) await attendi(20);
  assert.equal(sessione.proc, null);
  assert.ok(eventi.some((evento) => evento.type === "gui_processo_finito"));
});

test("la chiusura attende anche uno strumento discendente di pi", {
  skip: process.platform !== "win32",
}, async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-tree-"));
  const sessione = new SessionePi({
    id: "albero",
    cliPi: PI_CON_ALBERO,
    emetti: () => [],
    scadenzaArrestoMs: 5000,
  });
  let pidStrumento = null;
  t.after(async () => {
    if (sessione.proc?.pid && sessione.proc.exitCode === null) {
      try { process.kill(sessione.proc.pid); } catch {}
    }
    if (pidStrumento) {
      try { process.kill(pidStrumento); } catch {}
    }
    await attendi(100);
    await rm(cartella, { recursive: true, force: true });
  });

  await sessione.avvia({ cartella, approvaProgetto: false });
  const filePid = join(cartella, "tree-child.pid");
  const scadenza = Date.now() + 3000;
  while (!pidStrumento && Date.now() < scadenza) {
    try {
      pidStrumento = Number(await readFile(filePid, "utf8"));
    } catch {
      await attendi(30);
    }
  }
  assert.ok(Number.isInteger(pidStrumento) && pidStrumento > 0);
  assert.doesNotThrow(() => process.kill(pidStrumento, 0));

  await sessione.ferma({ notifica: false });
  assert.equal(sessione.proc, null);
  assert.throws(() => process.kill(pidStrumento, 0));
});

test("un'uscita spontanea di pi non lascia strumenti discendenti", {
  skip: process.platform !== "win32",
}, async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-tree-exit-"));
  const eventi = [];
  const sessione = new SessionePi({
    id: "albero-spontaneo",
    cliPi: PI_CON_ALBERO,
    emetti: (evento) => eventi.push(evento),
  });
  let pidStrumento = null;
  t.after(async () => {
    if (sessione.proc?.pid && sessione.proc.exitCode === null) {
      try { process.kill(sessione.proc.pid); } catch {}
    }
    if (pidStrumento) {
      try { process.kill(pidStrumento); } catch {}
    }
    await attendi(100);
    await rm(cartella, { recursive: true, force: true });
  });

  await sessione.avvia({ cartella, approvaProgetto: false });
  const filePid = join(cartella, "tree-child.pid");
  const scadenzaPid = Date.now() + 3000;
  while (!pidStrumento && Date.now() < scadenzaPid) {
    try { pidStrumento = Number(await readFile(filePid, "utf8")); } catch { await attendi(30); }
  }
  sessione.invia({ type: "exit_root", id: "esci" });
  const scadenza = Date.now() + 8000;
  while (sessione.proc && Date.now() < scadenza) await attendi(30);
  assert.equal(sessione.proc, null);
  assert.ok(eventi.some((evento) => evento.type === "gui_processo_finito"));
  assert.throws(() => process.kill(pidStrumento, 0));
});

test("un processo terminato non resta dichiarato attivo", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "progetto");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200);
  await ambiente.post("/api/comando", { sessionId: avvio.dati.id, type: "terminate_test" });
  await attendi(150);
  const stato = await (await fetch(ambiente.base + "/api/stato")).json();
  assert.equal(stato.sessioni[0].attiva, false);
  const comando = await ambiente.post("/api/comando", { sessionId: avvio.dati.id, type: "get_state" });
  assert.equal(comando.risposta.status, 409);
  assert.match(comando.dati.errore, /non e attiva/i);
});

test("gli eventi SSE conservano UTF-8, sessione e dialoghi delle estensioni", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "progetto");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const senzaToken = await fetch(ambiente.base + "/api/eventi");
  assert.equal(senzaToken.status, 403);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const clientA = "client-finestra-a";
  const clientB = "client-finestra-b";
  const rispostaEventi = await fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
      + "&clientId=" + clientA + "&replayId=scheda-duplicata-condivisa",
    { signal: controller.signal },
  );
  const rispostaEventiB = await fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
      + "&clientId=" + clientB + "&replayId=scheda-duplicata-condivisa",
    { signal: controller.signal },
  );
  const lettore = rispostaEventi.body.getReader();
  const lettoreB = rispostaEventiB.body.getReader();
  const decoder = new TextDecoder();
  const decoderB = new TextDecoder();
  let ricevuto = "";

  async function finoA(testo, limiteMs = 3000) {
    const scadenza = Date.now() + limiteMs;
    while (!ricevuto.includes(testo) && Date.now() < scadenza) {
      const rimasto = Math.max(1, scadenza - Date.now());
      const esito = await Promise.race([
        lettore.read(),
        attendi(rimasto).then(() => ({ timeout: true })),
      ]);
      if (esito.timeout || esito.done) break;
      ricevuto += decoder.decode(esito.value, { stream: true });
    }
    assert.match(ricevuto, new RegExp(testo));
  }

  await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "prompt",
    message: "prova utf8",
  }, ambiente.stato.tokenApi, clientA);
  await finoA("città");
  assert.match(ricevuto, new RegExp(avvio.dati.id));

  ricevuto = "";
  await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "prompt",
    message: "/dialog-test",
  }, ambiente.stato.tokenApi, clientA);
  await finoA("extension_ui_request");

  // La seconda finestra riceve gli eventi generali dello stesso agente, ma non
  // la domanda interattiva destinata alla finestra che ha avviato il turno.
  let ricevutoB = "";
  const fineB = Date.now() + 300;
  while (Date.now() < fineB) {
    const esito = await Promise.race([
      lettoreB.read(),
      attendi(Math.max(1, fineB - Date.now())).then(() => ({ timeout: true })),
    ]);
    if (esito.timeout || esito.done) break;
    ricevutoB += decoderB.decode(esito.value, { stream: true });
  }
  assert.doesNotMatch(ricevutoB, /extension_ui_request/);

  await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "extension_ui_response",
    id: "ext-1",
    confirmed: true,
  }, ambiente.stato.tokenApi, clientA);
  await finoA("Risposta ricevuta");
  await lettore.cancel();
  controller.abort();
});

test("un reload riceve l'ack perso senza condividere l'ownership della scheda", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "replay-ack");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const replayId = "replay-stabile";
  const id = `ui-${replayId}-documento-vecchio-1`;

  const comando = await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "prompt",
    id,
    message: "ack da recuperare",
  }, ambiente.stato.tokenApi, "pagina-vecchia");
  assert.equal(comando.risposta.status, 200);
  await attendi(80);

  const controller = new AbortController();
  t.after(() => controller.abort());
  const rispostaEventi = await fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
      + "&clientId=pagina-nuova&replayId=" + replayId,
    { signal: controller.signal },
  );
  const lettore = rispostaEventi.body.getReader();
  const decoder = new TextDecoder();
  let testo = "";
  const scadenza = Date.now() + 2000;
  while (!testo.includes(id) && Date.now() < scadenza) {
    const esito = await lettore.read();
    if (esito.done) break;
    testo += decoder.decode(esito.value, { stream: true });
  }
  assert.match(testo, new RegExp(id));
  assert.match(testo, /"guiReplay":true/);
  assert.equal(ambiente.ponte.sessioni.get(avvio.dati.id).clientInterazione, null);
  await lettore.cancel();
});

test("una domanda interattiva persa durante la disconnessione viene riproposta", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "dialogo-riconnessione");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const clientId = "client-ricollegato";

  await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "prompt",
    message: "/dialog-test",
  }, ambiente.stato.tokenApi, clientId);
  await attendi(80);
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  assert.equal(sessione.richiesteInterattivePendenti.get("ext-1")?.evento?.id, "ext-1");

  const controller = new AbortController();
  t.after(() => controller.abort());
  const rispostaEventi = await fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
      + "&clientId=" + clientId,
    { signal: controller.signal },
  );
  const lettore = rispostaEventi.body.getReader();
  const decoder = new TextDecoder();
  let testo = "";
  const scadenza = Date.now() + 2000;
  while (!testo.includes("extension_ui_request") && Date.now() < scadenza) {
    const esito = await lettore.read();
    if (esito.done) break;
    testo += decoder.decode(esito.value, { stream: true });
  }
  assert.match(testo, /extension_ui_request/);

  const risposta = await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "extension_ui_response",
    id: "ext-1",
    confirmed: true,
  }, ambiente.stato.tokenApi, clientId);
  assert.equal(risposta.risposta.status, 200);
  assert.equal(sessione.richiesteInterattivePendenti.has("ext-1"), false);
  await lettore.cancel();
});

test("un reload sostituisce il vecchio flusso e riceve il dialogo una sola volta", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "dialogo-sovrapposto");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const clientId = "client-sovrapposto";
  const url = ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
    + "&clientId=" + clientId;
  const controllerVecchio = new AbortController();
  const controllerNuovo = new AbortController();
  t.after(() => {
    controllerVecchio.abort();
    controllerNuovo.abort();
  });
  const vecchio = await fetch(url, { signal: controllerVecchio.signal });
  const lettoreVecchio = vecchio.body.getReader();
  const decodificaVecchio = new TextDecoder();
  let testoVecchio = "";

  await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "prompt",
    message: "/dialog-test",
  }, ambiente.stato.tokenApi, clientId);
  const fineVecchio = Date.now() + 2000;
  while (!testoVecchio.includes("extension_ui_request") && Date.now() < fineVecchio) {
    const esito = await lettoreVecchio.read();
    if (esito.done) break;
    testoVecchio += decodificaVecchio.decode(esito.value, { stream: true });
  }
  assert.match(testoVecchio, /extension_ui_request/);

  // Un vero F5 riusa lo stesso page id. Il nuovo EventSource deve sostituire
  // subito quello vecchio e ricevere l'eventuale dialogo pendente: aspettare la
  // chiusura del socket precedente lascerebbe PI bloccato durante il reload.
  const nuovo = await fetch(url, { signal: controllerNuovo.signal });
  const lettoreNuovo = nuovo.body.getReader();
  const decoderNuovo = new TextDecoder();
  let testoNuovo = "";
  const fineNuovo = Date.now() + 2000;
  while (!testoNuovo.includes("extension_ui_request") && Date.now() < fineNuovo) {
    const rimasto = Math.max(1, fineNuovo - Date.now());
    const esito = await Promise.race([
      lettoreNuovo.read(),
      attendi(rimasto).then(() => ({ timeout: true })),
    ]);
    if (esito.timeout || esito.done) break;
    testoNuovo += decoderNuovo.decode(esito.value, { stream: true });
  }
  assert.match(testoNuovo, /extension_ui_request/);

  // Il ponte tiene un solo flusso per page id; quello precedente viene chiuso.
  const chiusuraVecchio = await Promise.race([
    lettoreVecchio.read().catch(() => ({ done: true, chiusoDalPonte: true })),
    attendi(1000).then(() => ({ timeout: true })),
  ]);
  assert.notEqual(chiusuraVecchio.timeout, true);
  assert.equal(chiusuraVecchio.done, true);

  await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "extension_ui_response",
    id: "ext-1",
    confirmed: true,
  }, ambiente.stato.tokenApi, clientId);
  await lettoreNuovo.cancel();
});

test("piu dialoghi concorrenti vengono conservati e riprodotti tutti", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "dialoghi-multipli");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  sessione.diffondi({
    type: "extension_ui_request",
    id: "ext-prima",
    method: "confirm",
    message: "Prima domanda",
  });
  sessione.diffondi({
    type: "extension_ui_request",
    id: "ext-seconda",
    method: "input",
    message: "Seconda domanda",
  });
  assert.equal(sessione.richiesteInterattivePendenti.size, 2);

  const controller = new AbortController();
  t.after(() => controller.abort());
  const rispostaEventi = await fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
      + "&clientId=client-dialoghi-multipli",
    { signal: controller.signal },
  );
  const lettore = rispostaEventi.body.getReader();
  const decoder = new TextDecoder();
  let testo = "";
  const scadenza = Date.now() + 2000;
  while ((!testo.includes("ext-prima") || !testo.includes("ext-seconda")) && Date.now() < scadenza) {
    const esito = await lettore.read();
    if (esito.done) break;
    testo += decoder.decode(esito.value, { stream: true });
  }
  assert.match(testo, /ext-prima/);
  assert.match(testo, /ext-seconda/);

  for (const id of ["ext-prima", "ext-seconda"]) {
    await ambiente.post("/api/comando", {
      sessionId: avvio.dati.id,
      type: "extension_ui_response",
      id,
      confirmed: true,
    }, ambiente.stato.tokenApi, "client-dialoghi-multipli");
  }
  assert.equal(sessione.richiesteInterattivePendenti.size, 0);
  assert.equal(sessione.revisioniComandi.size, 0);
  await lettore.cancel();
});

test("stato, widget e titolo vengono riprodotti senza sovrascrivere una bozza", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "stato-estensioni");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const eventi = [
    { id: "s1", method: "setStatus", statusKey: "build", statusText: "Compilo" },
    { id: "w1", method: "setWidget", widgetKey: "info", widgetLines: ["Riga"] },
    { id: "t1", method: "setTitle", title: "pi - Titolo estensione" },
    { id: "e1", method: "set_editor_text", text: "Bozza estensione" },
  ];
  for (const evento of eventi) sessione.diffondi({ type: "extension_ui_request", ...evento });
  assert.equal(sessione.statoUiEstensioni.size, 3);

  const controller = new AbortController();
  t.after(() => controller.abort());
  const rispostaEventi = await fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
      + "&clientId=client-stato-estensioni",
    { signal: controller.signal },
  );
  const lettore = rispostaEventi.body.getReader();
  const decoder = new TextDecoder();
  let testo = "";
  const scadenza = Date.now() + 2000;
  while (!testo.includes("Titolo estensione") && Date.now() < scadenza) {
    const esito = await lettore.read();
    if (esito.done) break;
    testo += decoder.decode(esito.value, { stream: true });
  }
  for (const metodo of ["setStatus", "setWidget", "setTitle"]) {
    assert.match(testo, new RegExp(metodo));
  }
  assert.doesNotMatch(testo, /set_editor_text|Bozza estensione/);

  sessione.diffondi({ type: "extension_ui_request", id: "s2", method: "setStatus", statusKey: "build", statusText: "" });
  sessione.diffondi({ type: "extension_ui_request", id: "w2", method: "setWidget", widgetKey: "info" });
  assert.equal(sessione.statoUiEstensioni.has("status:build"), false);
  assert.equal(sessione.statoUiEstensioni.has("widget:aboveEditor:info"), false);

  sessione.diffondi({ type: "extension_ui_request", id: "vecchia", method: "confirm" });
  sessione.comandiCambioSessione.add("cambio-test");
  sessione.diffondi({
    type: "response",
    id: "cambio-test",
    command: "new_session",
    success: true,
    data: {},
  });
  assert.equal(sessione.statoUiEstensioni.size, 0);
  assert.equal(sessione.richiesteInterattivePendenti.size, 0);
  await lettore.cancel();
});

test("un evento SSE oltre l'high-water mark arriva integro a un client veloce", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const risposta = await fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
      + "&clientId=client-grande",
    { signal: controller.signal },
  );
  const lettore = risposta.body.getReader();
  const decoder = new TextDecoder();
  const testoGrande = "x".repeat(20_000);
  ambiente.ponte.emetti({ type: "prova_grande", testo: testoGrande });

  let buffer = "";
  let evento = null;
  const scadenza = Date.now() + 2500;
  while (!evento && Date.now() < scadenza) {
    const esito = await Promise.race([
      lettore.read(),
      attendi(Math.max(1, scadenza - Date.now())).then(() => ({ timeout: true })),
    ]);
    if (esito.timeout || esito.done) break;
    buffer += decoder.decode(esito.value, { stream: true });
    for (const blocco of buffer.split("\n\n")) {
      const riga = blocco.split("\n").find((voce) => voce.startsWith("data: "));
      if (!riga) continue;
      const candidato = JSON.parse(riga.slice(6));
      if (candidato.type === "prova_grande") evento = candidato;
    }
  }
  assert.equal(evento?.testo, testoGrande);
  assert.equal(ambiente.ponte.numeroAscoltatori(), 1);
  await lettore.cancel();
});

test("un consumer SSE che supera il limite di coda viene disconnesso", async (t) => {
  const ambiente = await avviaPonteTest({ limiteCodaSse: 48 * 1024 });
  t.after(ambiente.chiudi);
  const indirizzo = new URL(ambiente.base);
  let socket;
  await new Promise((risolvi, rifiuta) => {
    socket = createConnection(
      { host: indirizzo.hostname, port: Number(indirizzo.port) },
      () => {
        socket.write(
          "GET /api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi)
          + "&clientId=client-lento HTTP/1.1\r\n"
          + `Host: ${indirizzo.host}\r\nConnection: keep-alive\r\n\r\n`,
        );
      },
    );
    const limite = setTimeout(() => rifiuta(new Error("SSE lento non collegato")), 1500);
    socket.once("error", rifiuta);
    socket.once("data", () => {
      clearTimeout(limite);
      socket.pause();
      risolvi();
    });
  });
  t.after(() => socket.destroy());
  assert.equal(ambiente.ponte.numeroAscoltatori(), 1);

  for (let indice = 0; indice < 300 && ambiente.ponte.numeroAscoltatori(); indice++) {
    ambiente.ponte.emetti({ type: "raffica", indice, testo: "z".repeat(20_000) });
  }
  assert.equal(ambiente.ponte.numeroAscoltatori(), 0);
});
