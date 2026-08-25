import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
  link,
  symlink,
  rename,
  utimes,
} from "node:fs/promises";
import { request as richiestaHttp } from "node:http";
import { createConnection } from "node:net";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { basename, join, dirname, resolve, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  creaPonte,
  caricaAlberoCompattoDaPi,
  caricaCronologiaDaPi,
  caricaCronologiaParzialeDaPi,
  caricaCatalogoBuiltinPi,
  leggiChangelogPi,
  condividiHtmlConGh,
  eseguiGhLimitato,
  argomentiPiTerminale,
  avvisoCreazioneSessionePi,
  decisioneBonificaLegacy,
  LettoreJsonl,
  SessionePi,
  rigaMessaggioCronologia,
  sembraPonteLegacy,
  sembraPonteCorrente,
  tipoUnitaWindowsConsentito,
  usaCacheTipiUnitaWindows,
  durataAutoStopConfigurata,
  stessoPercorso,
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

function catalogoGpt56(contextWindow) {
  const models = [];
  for (const provider of ["openai", "openai-codex"]) {
    for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      models.push({ provider, id, name: id, contextWindow });
    }
  }
  return models;
}

function intercettaRpcSessione(sessione, gestisci) {
  const scriviOriginale = sessione.proc.stdin.write;
  sessione.proc.stdin.write = (riga) => {
    const comando = JSON.parse(String(riga).trim());
    const esito = gestisci(comando);
    if (esito !== null && esito !== undefined) {
      queueMicrotask(() => sessione.diffondi({
        type: "response",
        id: comando.id,
        command: comando.type,
        success: esito.success !== false,
        ...(esito.success === false
          ? { error: esito.error || "errore simulato" }
          : { data: esito.data || {} }),
      }));
    }
    return true;
  };
  return () => {
    sessione.proc.stdin.write = scriviOriginale;
  };
}

test("l'avviso previsto di creazione sessione non viene presentato come errore", () => {
  const id = "gui-sessione-123";
  assert.equal(avvisoCreazioneSessionePi(
    `Warning: No project session found with id '${id}'; creating a new session with that id.`,
    id,
  ), true);
  assert.equal(avvisoCreazioneSessionePi("Errore reale del provider", id), false);
  assert.equal(avvisoCreazioneSessionePi(
    "Warning: No project session found with id 'altra'; creating a new session with that id.",
    id,
  ), false);
});

test("il confronto percorsi Windows normalizza solo namespace estesi equivalenti", () => {
  if (process.platform !== "win32") return;
  const file = "C:\\profilo\\allegati\\sessione\\documento.txt";
  const fratello = "C:\\profilo\\allegati\\sessione\\altro.txt";
  const unc = "\\\\server\\condivisione\\allegati\\documento.txt";
  assert.equal(stessoPercorso(file, "\\\\?\\" + file), true);
  assert.equal(stessoPercorso(file, "\\\\?\\" + fratello), false);
  assert.equal(stessoPercorso(unc, "\\\\?\\UNC\\server\\condivisione\\allegati\\documento.txt"), true);
  assert.equal(stessoPercorso(file, "\\\\.\\C:\\profilo\\allegati\\sessione\\documento.txt"), false);
});

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

test("la cronologia compatta segue il leaf scelto e distingue la radice vuota", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-leaf-cronologia-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileSessione = join(cartella, "sessione.jsonl");
  const voci = [
    { type: "session", version: 3, id: "sessione-leaf", timestamp: "2026-08-25T00:00:00.000Z", cwd: cartella },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-08-25T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "domanda ramo" }], timestamp: 1 } },
    { type: "message", id: "a-old", parentId: "u1", timestamp: "2026-08-25T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "risposta scelta" }], timestamp: 2 } },
    { type: "message", id: "u-new", parentId: "a-old", timestamp: "2026-08-25T00:00:03.000Z", message: { role: "user", content: [{ type: "text", text: "ultima riga append" }], timestamp: 3 } },
  ];
  await writeFile(fileSessione, voci.map((voce) => JSON.stringify(voce)).join("\n") + "\n", "utf8");

  const ramo = await caricaCronologiaDaPi({
    cliPi: CLI_PI_REALE,
    fileSessione,
    leafId: "a-old",
  });
  assert.deepEqual(ramo.map((messaggio) => messaggio.content[0].text), [
    "domanda ramo",
    "risposta scelta",
  ]);
  assert.deepEqual(await caricaCronologiaDaPi({
    cliPi: CLI_PI_REALE,
    fileSessione,
    leafId: null,
  }), []);
});

test("la cronologia visuale conserva ogni prompt del ramo ma non il lavoro gia sintetizzato", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-prompt-storici-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileSessione = join(cartella, "sessione.jsonl");
  const messaggio = (id, parentId, role, testo, timestamp, extra = {}) => ({
    type: "message",
    id,
    parentId,
    timestamp: new Date(timestamp * 1000).toISOString(),
    message: {
      role,
      content: [{ type: "text", text: testo }],
      timestamp: timestamp * 1000,
      ...extra,
    },
  });
  const u1 = messaggio("u1", null, "user", "prompt uno originale", 1);
  const a1 = messaggio("a1", "u1", "assistant", "risposta vecchia da non ripetere", 2, {
    provider: "test",
    model: "test",
    stopReason: "toolUse",
  });
  a1.message.content.push({ type: "toolCall", id: "tool-vecchio", name: "read", arguments: {} });
  const tool1 = messaggio("tool1", "a1", "toolResult", "output vecchio da non ripetere", 3, {
    toolCallId: "tool-vecchio",
    toolName: "read",
    isError: false,
  });
  const primaCompattazione = {
    type: "compaction",
    id: "c1",
    parentId: "tool1",
    timestamp: new Date(4_000).toISOString(),
    summary: "riepilogo superato",
    firstKeptEntryId: "u1",
    tokensBefore: 100,
  };
  const u2 = messaggio("u2", "c1", "user", "prompt due originale", 5);
  const a2 = messaggio("a2", "u2", "assistant", "risposta recente conservata", 6, {
    provider: "test",
    model: "test",
    stopReason: "stop",
  });
  const secondaCompattazione = {
    type: "compaction",
    id: "c2",
    parentId: "a2",
    timestamp: new Date(7_000).toISOString(),
    summary: "riepilogo corrente",
    firstKeptEntryId: "u2",
    tokensBefore: 200,
    // Il payload non deve duplicare le voci originali gia presenti nel ramo.
    retainedTail: [u2.message, a2.message],
  };
  const u3 = messaggio("u3", "c2", "user", "prompt tre originale", 8);
  const a3 = messaggio("a3", "u3", "assistant", "risposta nuova", 9, {
    provider: "test",
    model: "test",
    stopReason: "stop",
  });
  const voci = [
    { type: "session", version: 3, id: "sessione-prompt", timestamp: new Date(0).toISOString(), cwd: cartella },
    u1,
    a1,
    tool1,
    primaCompattazione,
    u2,
    a2,
    secondaCompattazione,
    u3,
    a3,
  ];
  await writeFile(fileSessione, voci.map((voce) => JSON.stringify(voce)).join("\n") + "\n", "utf8");

  const cronologia = await caricaCronologiaDaPi({ cliPi: CLI_PI_REALE, fileSessione });
  assert.deepEqual(cronologia.map((voce) => voce.role), [
    "user",
    "user",
    "assistant",
    "compactionSummary",
    "user",
    "assistant",
  ]);
  assert.deepEqual(
    cronologia.filter((voce) => voce.role === "user").map((voce) => voce.content[0].text),
    ["prompt uno originale", "prompt due originale", "prompt tre originale"],
  );
  assert.deepEqual(
    cronologia.filter((voce) => voce.role === "compactionSummary").map((voce) => voce.summary),
    ["riepilogo corrente"],
  );
  assert.equal(
    cronologia.filter((voce) => voce.role === "user" && voce.content[0].text === "prompt due originale").length,
    1,
  );
  assert.doesNotMatch(JSON.stringify(cronologia), /risposta vecchia|output vecchio|riepilogo superato/);
});

test("la cronologia completa non ricarica il base64 delle immagini dei prompt storici", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-immagini-storiche-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileSessione = join(cartella, "sessione.jsonl");
  const base64Storico = "U1RPUklDT19CQVNFNjQ=";
  const base64Corrente = "Q09SUkVOVEVfQkFTRTY0";
  const voci = [
    { type: "session", version: 3, id: "sessione-immagini", timestamp: "2026-08-25T00:00:00.000Z", cwd: cartella },
    {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: "2026-08-25T00:00:01.000Z",
      message: {
        role: "user",
        content: [
          { type: "text", text: "testo storico prima" },
          { type: "image", data: base64Storico, mimeType: "image/png" },
          { type: "text", text: "testo storico dopo" },
        ],
        timestamp: 1,
      },
    },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-25T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "risposta sintetizzata" }], timestamp: 2 } },
    { type: "compaction", id: "c1", parentId: "a1", timestamp: "2026-08-25T00:00:03.000Z", summary: "sintesi", firstKeptEntryId: "assente", tokensBefore: 100 },
    {
      type: "message",
      id: "u2",
      parentId: "c1",
      timestamp: "2026-08-25T00:00:04.000Z",
      message: {
        role: "user",
        content: [
          { type: "text", text: "testo corrente" },
          { type: "image", data: base64Corrente, mimeType: "image/png" },
        ],
        timestamp: 4,
      },
    },
  ];
  await writeFile(fileSessione, voci.map((voce) => JSON.stringify(voce)).join("\n") + "\n", "utf8");

  const cronologia = await caricaCronologiaDaPi({ cliPi: CLI_PI_REALE, fileSessione });
  const utenti = cronologia.filter((voce) => voce.role === "user");
  assert.equal(utenti.length, 2);
  assert.deepEqual(
    utenti[0].content.filter((parte) => parte.type === "text").map((parte) => parte.text),
    [
      "testo storico prima",
      "[Immagine allegata nello storico non ricaricata]",
      "testo storico dopo",
    ],
  );
  assert.equal(utenti[0].guiImmaginiStoricheOmesse, 1);
  assert.equal(utenti[0].content.some((parte) => parte.type === "image"), false);
  assert.doesNotMatch(JSON.stringify(utenti[0]), new RegExp(base64Storico));
  assert.equal(utenti[1].content.find((parte) => parte.type === "image")?.data, base64Corrente);
});

test("la cronologia principale segue soltanto il ramo attivo", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-ramo-attivo-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileSessione = join(cartella, "sessione.jsonl");
  const voce = (id, parentId, role, testo, secondo) => ({
    type: "message",
    id,
    parentId,
    timestamp: `2026-08-25T00:00:${String(secondo).padStart(2, "0")}.000Z`,
    message: { role, content: [{ type: "text", text: testo }], timestamp: secondo },
  });
  const voci = [
    { type: "session", version: 3, id: "sessione-rami", timestamp: "2026-08-25T00:00:00.000Z", cwd: cartella },
    voce("u-root", null, "user", "prompt condiviso", 1),
    voce("a-root", "u-root", "assistant", "risposta condivisa", 2),
    voce("u-sx", "a-root", "user", "prompt ramo sinistro", 3),
    voce("a-sx", "u-sx", "assistant", "risposta ramo sinistro", 4),
    voce("u-dx", "a-root", "user", "prompt ramo destro", 5),
    voce("a-dx", "u-dx", "assistant", "risposta ramo destro", 6),
  ];
  await writeFile(fileSessione, voci.map((elemento) => JSON.stringify(elemento)).join("\n") + "\n", "utf8");

  const sinistro = await caricaCronologiaDaPi({ cliPi: CLI_PI_REALE, fileSessione, leafId: "a-sx" });
  const destro = await caricaCronologiaDaPi({ cliPi: CLI_PI_REALE, fileSessione, leafId: "a-dx" });
  assert.deepEqual(sinistro.map((elemento) => elemento.content[0].text), [
    "prompt condiviso",
    "risposta condivisa",
    "prompt ramo sinistro",
    "risposta ramo sinistro",
  ]);
  assert.deepEqual(destro.map((elemento) => elemento.content[0].text), [
    "prompt condiviso",
    "risposta condivisa",
    "prompt ramo destro",
    "risposta ramo destro",
  ]);
});

test("la cronologia parziale conserva i prompt precedenti alla compattazione una volta sola", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-prefix-compattato-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileSessione = join(cartella, "sessione.jsonl");
  const righe = [
    { type: "session", version: 3, id: "sessione-prefix", timestamp: "2026-08-25T00:00:00.000Z", cwd: cartella },
    {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: "2026-08-25T00:00:01.000Z",
      message: {
        role: "user",
        content: [
          { type: "text", text: "prompt storico" },
          { type: "image", data: "UEFSWklBTEVfU1RPUklDTw==", mimeType: "image/jpeg" },
        ],
        timestamp: 1,
      },
    },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-25T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "risposta sintetizzata" }], timestamp: 2 } },
    { type: "compaction", id: "c1", parentId: "a1", timestamp: "2026-08-25T00:00:03.000Z", summary: "sintesi corrente", firstKeptEntryId: "assente", tokensBefore: 120 },
    { type: "message", id: "u2", parentId: "c1", timestamp: "2026-08-25T00:00:04.000Z", message: { role: "user", content: [{ type: "text", text: "prompt nuovo" }], timestamp: 4 } },
  ];
  const prefisso = righe.map((voce) => JSON.stringify(voce)).join("\n") + "\n";
  await writeFile(fileSessione, prefisso + '{"type":"message","id":"incompleto"', "utf8");

  const cronologia = await caricaCronologiaParzialeDaPi({
    cliPi: CLI_PI_REALE,
    fileSessione,
    massimoByte: Buffer.byteLength(prefisso) + 20,
  });
  assert.deepEqual(cronologia.map((voce) => voce.role), ["user", "compactionSummary", "user"]);
  assert.deepEqual(
    cronologia.filter((voce) => voce.role === "user").map((voce) => voce.content[0].text),
    ["prompt storico", "prompt nuovo"],
  );
  const storico = cronologia.find((voce) => voce.role === "user");
  assert.equal(storico.guiImmaginiStoricheOmesse, 1);
  assert.equal(storico.content.some((parte) => parte.type === "image"), false);
  assert.doesNotMatch(JSON.stringify(storico), /UEFSWklBTEVfU1RPUklDTw==/);
  assert.match(
    storico.content.map((parte) => parte.text || "").join("\n"),
    /Immagine allegata nello storico non ricaricata/,
  );
});

test("la cronologia rifiuta in modo chiuso leaf e collegamenti corrotti", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-cronologia-corrotta-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const header = { type: "session", version: 3, id: "sessione-corrotta", timestamp: "2026-08-25T00:00:00.000Z", cwd: cartella };
  const utente = (id, parentId, testo) => ({
    type: "message",
    id,
    parentId,
    timestamp: "2026-08-25T00:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text: testo }], timestamp: 1 },
  });
  const casi = [
    { nome: "ciclo", voci: [utente("u1", "u2", "uno"), utente("u2", "u1", "due")] },
    { nome: "genitore-mancante", voci: [utente("u1", "assente", "uno")] },
    { nome: "id-duplicato", voci: [utente("u1", null, "uno"), utente("u1", null, "due")] },
  ];
  for (const caso of casi) {
    const fileSessione = join(cartella, caso.nome + ".jsonl");
    await writeFile(fileSessione, [header, ...caso.voci].map((voce) => JSON.stringify(voce)).join("\n") + "\n", "utf8");
    await assert.rejects(
      () => caricaCronologiaDaPi({ cliPi: CLI_PI_REALE, fileSessione }),
      (errore) => errore?.statusHttp === 409,
      caso.nome,
    );
  }

  const fileValido = join(cartella, "leaf-sconosciuto.jsonl");
  await writeFile(fileValido, [header, utente("u1", null, "uno")].map((voce) => JSON.stringify(voce)).join("\n") + "\n", "utf8");
  await assert.rejects(
    () => caricaCronologiaDaPi({ cliPi: CLI_PI_REALE, fileSessione: fileValido, leafId: "assente" }),
    (errore) => errore?.statusHttp === 409,
  );
});

test("l'anteprima assistant dell'albero non espone le parti thinking", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-tree-preview-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileSessione = join(cartella, "sessione.jsonl");
  const voci = [
    { type: "session", version: 3, id: "sessione-anteprima", timestamp: "2026-08-25T00:00:00.000Z", cwd: cartella },
    {
      type: "message",
      id: "a1",
      parentId: null,
      timestamp: "2026-08-25T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Planning..." },
          { type: "text", text: "`ottimizzazione: OK`\n\n**orchestrazione: OK**\n\nCOLLAUDO OK" },
        ],
        timestamp: 1,
      },
    },
    {
      type: "message",
      id: "a2",
      parentId: "a1",
      timestamp: "2026-08-25T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Thinking soltanto" },
          { type: "text", text: "__orchestrazione: OK__" },
        ],
        timestamp: 2,
      },
    },
    {
      type: "message",
      id: "a3",
      parentId: "a2",
      timestamp: "2026-08-25T00:00:03.000Z",
      message: {
        role: "assistant",
        content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
        timestamp: 3,
      },
    },
    {
      type: "message",
      id: "a4",
      parentId: "a3",
      timestamp: "2026-08-25T00:00:04.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "orchestrazione: OK — stack e goal confermati\n\nRisultato utile" }],
        timestamp: 4,
      },
    },
    {
      type: "message",
      id: "a5",
      parentId: "a4",
      timestamp: "2026-08-25T00:00:05.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "orchestrazione: OK — ma il collaudo e fallito" }],
        timestamp: 5,
      },
    },
  ];
  await writeFile(fileSessione, voci.map((voce) => JSON.stringify(voce)).join("\n") + "\n", "utf8");

  const albero = await caricaAlberoCompattoDaPi({ cliPi: CLI_PI_REALE, fileSessione });

  assert.deepEqual(albero.nodi.map((nodo) => nodo.descrizione), [
    "assistant: COLLAUDO OK",
    "assistant: [immagine]",
    "assistant: Risultato utile",
    "assistant: ma il collaudo e fallito",
  ]);
  assert.equal(albero.nodi[1].parentId, "a1");
  assert.equal(albero.leafId, "a5");
  assert.equal(albero.totale, 4);
  assert.equal(albero.tecniciNascosti, 1);
  assert.doesNotMatch(albero.nodi[0].descrizione, /Planning/);
  assert.doesNotMatch(albero.nodi[0].descrizione, /ottimizzazione|orchestrazione/i);
});

test("l'albero nasconde le voci tecniche e conserva la struttura dei rami", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-tree-visible-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileSessione = join(cartella, "sessione.jsonl");
  const messaggio = (id, parentId, ruolo, content, secondo) => ({
    type: "message",
    id,
    parentId,
    timestamp: `2026-08-25T00:00:${String(secondo).padStart(2, "0")}.000Z`,
    message: { role: ruolo, content, timestamp: secondo },
  });
  const voci = [
    { type: "session", version: 3, id: "sessione-struttura", timestamp: "2026-08-25T00:00:00.000Z", cwd: cartella },
    messaggio("u1", null, "user", [{ type: "text", text: "Domanda iniziale" }], 1),
    { type: "branch_summary", id: "ramo", parentId: "u1", timestamp: "2026-08-25T00:00:02.000Z", summary: "Ramo alternativo" },
    messaggio("tool-1", "u1", "toolResult", [{ type: "text", text: "blocco tecnico" }], 3),
    { type: "model_change", id: "modello", parentId: "tool-1", timestamp: "2026-08-25T00:00:04.000Z", provider: "test", modelId: "test" },
    { type: "compaction", id: "riepilogo", parentId: "modello", timestamp: "2026-08-25T00:00:05.000Z", summary: "Contesto compattato" },
    { type: "thinking_level_change", id: "livello", parentId: "riepilogo", timestamp: "2026-08-25T00:00:06.000Z", thinkingLevel: "high" },
    { type: "session_info", id: "info", parentId: "livello", timestamp: "2026-08-25T00:00:07.000Z", name: "Titolo tecnico" },
    messaggio("solo-thinking", "info", "assistant", [{ type: "thinking", thinking: "Non mostrare" }], 8),
    messaggio("a1", "solo-thinking", "assistant", [{ type: "text", text: "Risposta utile" }], 9),
    { type: "custom", id: "custom", parentId: "a1", timestamp: "2026-08-25T00:00:10.000Z", customType: "estensione" },
    messaggio("u2", "custom", "user", [{ type: "text", text: "Seconda domanda" }], 11),
    { type: "label", id: "label", parentId: "u2", targetId: "u2", timestamp: "2026-08-25T00:00:12.000Z", label: "ramo scelto" },
    messaggio("a2", "label", "assistant", [{ type: "image", data: "AA==", mimeType: "image/png" }], 13),
    messaggio("tool-leaf", "a2", "toolResult", [{ type: "text", text: "leaf tecnico" }], 14),
  ];
  await writeFile(fileSessione, voci.map((voce) => JSON.stringify(voce)).join("\n") + "\n", "utf8");

  const albero = await caricaAlberoCompattoDaPi({ cliPi: CLI_PI_REALE, fileSessione });

  assert.deepEqual(albero.nodi.map(({ id, parentId, profondita }) => ({ id, parentId, profondita })), [
    { id: "u1", parentId: null, profondita: 0 },
    { id: "ramo", parentId: "u1", profondita: 1 },
    { id: "riepilogo", parentId: "u1", profondita: 1 },
    { id: "a1", parentId: "riepilogo", profondita: 2 },
    { id: "u2", parentId: "a1", profondita: 3 },
    { id: "a2", parentId: "u2", profondita: 4 },
  ]);
  assert.equal(albero.nodi.find((nodo) => nodo.id === "u2")?.label, "ramo scelto");
  assert.equal(albero.leafId, "a2");
  assert.equal(albero.totale, 6);
  assert.equal(albero.tecniciNascosti, 8);
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
    { name: "sistema", description: "Sistema guidato verificato", source: "extension" },
  ]);
  assert.deepEqual(unificato.slice(0, 22).map((voce) => voce.source), Array(22).fill("builtin"));
  assert.equal(unificato.filter((voce) => voce.name === "settings").length, 1);
  assert.equal(unificato.find((voce) => voce.name === "mia-skill").dispatch.kind, "prompt");
  assert.equal(unificato.find((voce) => voce.name === "mia-estensione").dispatch.kind, "terminal");
  assert.equal(unificato.find((voce) => voce.name === "llama").availability.surface, "gui");
  assert.equal(unificato.find((voce) => voce.name === "llama").dispatch.kind, "prompt");
  assert.equal(unificato.find((voce) => voce.name === "sistema").availability.surface, "gui");
  assert.equal(unificato.find((voce) => voce.name === "sistema").dispatch.kind, "prompt");
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
    { name: "sistema", source: "extension" },
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
  assert.deepEqual(preparaInvocazioneCapacita(voce("sistema"), "stato"), {
    mode: "rpc",
    command: { type: "prompt", message: "/sistema stato" },
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

test("compaction_start blocca atomicamente i comandi incompatibili fino a compaction_end", () => {
  const scritte = [];
  const sessione = new SessionePi({ id: "barriera-compattazione", cliPi: FAKE_PI, emetti: () => {} });
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

  sessione.diffondi({ type: "compaction_start", reason: "threshold" });
  assert.equal(sessione.compattazioneInCorso, true);
  for (const comando of [
    { type: "prompt", message: "non inviare" },
    { type: "steer", message: "non intervenire" },
    { type: "follow_up", message: "non accodare" },
    { type: "refresh_models" },
    { type: "set_model", provider: "fake", modelId: "altro" },
    { type: "new_session" },
  ]) {
    assert.throws(
      () => sessione.invia({ ...comando, id: `bloccato-${comando.type}` }),
      (errore) => errore?.statusHttp === 409 && /compattazione/i.test(errore.message),
      comando.type,
    );
  }
  sessione.invia({ type: "get_state", id: "lettura-consentita" });
  assert.equal(scritte.at(-1).type, "get_state");

  sessione.diffondi({ type: "compaction_end", aborted: false });
  assert.equal(sessione.compattazioneInCorso, false);
  sessione.invia({ type: "set_model", id: "modello-consentito", provider: "fake", modelId: "altro" });
  assert.equal(scritte.at(-1).type, "set_model");
});

test("compact prenota atomicamente il canale prima di compaction_start", () => {
  const scritte = [];
  const sessione = new SessionePi({
    id: "prenotazione-compattazione",
    cliPi: FAKE_PI,
    emetti: () => {},
    scadenzaAvvioCompattazioneMs: 5_000,
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (riga) => { scritte.push(JSON.parse(riga)); return true; },
    },
  };

  sessione.invia({ type: "compact", id: "compact-a" }, "finestra-a");
  assert.equal(sessione.riassunto().compattazionePrenotata, true);
  assert.equal(sessione.compattazioneInCorso, true);
  for (const comando of [
    { type: "compact", id: "compact-b" },
    { type: "prompt", id: "prompt-b", message: "non interrompere" },
    { type: "new_session", id: "nuova-b" },
  ]) {
    assert.throws(
      () => sessione.invia(comando, "finestra-b"),
      (errore) => errore?.statusHttp === 409 && /compattazione/i.test(errore.message),
      comando.type,
    );
  }
  assert.deepEqual(scritte.map((voce) => voce.id), ["compact-a"]);

  sessione.diffondi({ type: "compaction_start", reason: "manual" });
  assert.equal(sessione.riassunto().compattazionePrenotata, false);
  assert.equal(sessione.compattazioneInCorso, true,
    "lo start libera la sola prenotazione, non la barriera della compattazione attiva");
  assert.throws(
    () => sessione.invia({ type: "prompt", id: "prompt-durante", message: "ancora no" }),
    /compattazione/i,
  );

  sessione.diffondi({ type: "compaction_end", reason: "manual", aborted: false });
  sessione.invia({ type: "prompt", id: "prompt-dopo", message: "ora si" });
  assert.equal(scritte.at(-1).id, "prompt-dopo");
});

test("la prenotazione compact si libera su response, errore di scrittura, timeout e stop", async () => {
  const creaSessione = (id, write, opzioni = {}) => {
    const eventi = [];
    const sessione = new SessionePi({
      id,
      cliPi: FAKE_PI,
      emetti: (evento) => eventi.push(evento),
      scadenzaAvvioCompattazioneMs: 5_000,
      ...opzioni,
    });
    sessione.proc = {
      killed: false,
      exitCode: null,
      signalCode: null,
      stdin: { writable: true, destroyed: false, write },
    };
    return { sessione, eventi };
  };

  const scritteResponse = [];
  const risposta = creaSessione("compact-response", (riga) => {
    scritteResponse.push(JSON.parse(riga));
    return true;
  });
  risposta.sessione.invia({ type: "compact", id: "compact-response" });
  risposta.sessione.diffondi({
    type: "response",
    id: "compact-response",
    command: "compact",
    success: false,
    error: "rifiuto simulato",
  });
  assert.equal(risposta.sessione.compattazioneInCorso, false);
  risposta.sessione.invia({ type: "prompt", id: "prompt-response", message: "sbloccato" });
  assert.equal(scritteResponse.at(-1).id, "prompt-response");

  const scrittura = creaSessione("compact-write-error", () => {
    throw new Error("EPIPE simulato");
  });
  assert.throws(
    () => scrittura.sessione.invia({ type: "compact", id: "compact-write-error" }),
    /comunicare con pi/i,
  );
  assert.equal(scrittura.sessione.compattazioneInCorso, false);
  assert.equal(scrittura.sessione.prenotazioneCompattazione, null);

  const scritteTimeout = [];
  const scadenza = creaSessione(
    "compact-timeout",
    (riga) => { scritteTimeout.push(JSON.parse(riga)); return true; },
    { scadenzaAvvioCompattazioneMs: 20 },
  );
  scadenza.sessione.invia({ type: "compact", id: "compact-timeout" });
  await attendi(40);
  assert.equal(scadenza.sessione.prenotazioneCompattazione, null,
    "il timer della prenotazione deve essere rilasciato");
  assert.equal(scadenza.sessione.riassunto().compattazioneAvvioIncerto, true);
  assert.equal(scadenza.sessione.compattazioneInCorso, true,
    "il comando gia scritto resta fail-closed finche Pi non ne chiarisce l'esito");
  assert.ok(scadenza.eventi.some((evento) =>
    evento.type === "gui_errore" && /ancora pendente/i.test(evento.messaggio)));
  assert.throws(
    () => scadenza.sessione.invia({ type: "prompt", id: "prompt-timeout-bloccato", message: "ancora no" }),
    /compattazione/i,
  );
  assert.deepEqual(scritteTimeout.map((voce) => voce.id), ["compact-timeout"]);
  scadenza.sessione.diffondi({
    type: "response",
    id: "compact-timeout",
    command: "compact",
    success: false,
    error: "timeout confermato",
  });
  assert.equal(scadenza.sessione.compattazioneInCorso, false);
  scadenza.sessione.invia({ type: "prompt", id: "prompt-timeout", message: "sbloccato" });
  assert.equal(scritteTimeout.at(-1).id, "prompt-timeout");

  const arresto = creaSessione("compact-stop", () => true);
  arresto.sessione.invia({ type: "compact", id: "compact-stop" });
  arresto.sessione.proc = null;
  await arresto.sessione.ferma({ notifica: false });
  assert.equal(arresto.sessione.compattazioneInCorso, false);
  assert.equal(arresto.sessione.prenotazioneCompattazione, null);
});

test("la riserva rebind blocca client concorrenti e si libera sulla response anche di errore", () => {
  const scritte = [];
  const sessione = new SessionePi({
    id: "riserva-rebind",
    cliPi: FAKE_PI,
    emetti: () => {},
    scadenzaRebindModelloMs: 5_000,
  });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (riga) => { scritte.push(JSON.parse(riga)); return true; },
    },
  };

  sessione.invia({ type: "refresh_models", id: "refresh-a" }, "client-a");
  assert.equal(sessione.riassunto().rebindModelloInCorso, true);
  for (const comando of [
    { type: "refresh_models", id: "refresh-b" },
    { type: "set_model", id: "model-b", provider: "fake", modelId: "altro" },
    { type: "prompt", id: "prompt-b", message: "non inviare" },
    { type: "steer", id: "steer-b", message: "non guidare" },
    { type: "follow_up", id: "follow-b", message: "non accodare" },
  ]) {
    assert.throws(
      () => sessione.invia(comando, "client-b"),
      (errore) => errore?.statusHttp === 409 && /ricollegando/i.test(errore.message),
      comando.type,
    );
  }
  assert.deepEqual(scritte.map((voce) => voce.id), ["refresh-a"]);

  sessione.diffondi({
    type: "response",
    id: "refresh-a",
    command: "get_state",
    success: true,
    data: {},
  });
  assert.equal(sessione.riassunto().rebindModelloInCorso, true,
    "una response con lo stesso id ma comando diverso non libera la riserva");

  sessione.diffondi({
    type: "response",
    id: "refresh-a",
    command: "refresh_models",
    success: false,
    error: "provider non disponibile",
  });
  assert.equal(sessione.riassunto().rebindModelloInCorso, false);
  sessione.invia({ type: "prompt", id: "prompt-dopo", message: "ora invia" }, "client-b");
  assert.equal(scritte.at(-1).id, "prompt-dopo");
});

test("la riserva rebind si libera su timeout e su errore di scrittura", async () => {
  const sessione = new SessionePi({
    id: "timeout-rebind",
    cliPi: FAKE_PI,
    emetti: () => {},
    scadenzaRebindModelloMs: 20,
  });
  const scritte = [];
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (riga) => { scritte.push(JSON.parse(riga)); return true; },
    },
  };
  sessione.invia({ type: "refresh_models", id: "refresh-timeout" });
  assert.throws(
    () => sessione.invia({ type: "prompt", id: "prima-timeout", message: "no" }),
    /ricollegando/i,
  );
  await attendi(40);
  sessione.invia({ type: "prompt", id: "dopo-timeout", message: "si" });
  assert.equal(scritte.at(-1).id, "dopo-timeout");

  sessione.proc.stdin.write = () => { throw new Error("EPIPE simulato"); };
  assert.throws(
    () => sessione.invia({ type: "set_model", id: "write-error", provider: "fake", modelId: "x" }),
    /comunicare con pi/i,
  );
  assert.equal(sessione.riassunto().rebindModelloInCorso, false);
});

test("la riserva rebind esiste gia quando stdin.write puo rispondere sincronicamente", () => {
  const sessione = new SessionePi({ id: "rebind-sincrono", cliPi: FAKE_PI, emetti: () => {} });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: {
      writable: true,
      destroyed: false,
      write: (riga) => {
        const comando = JSON.parse(riga);
        assert.equal(sessione.riassunto().rebindModelloInCorso, true);
        sessione.diffondi({
          type: "response",
          id: comando.id,
          command: comando.type,
          success: true,
          data: {},
        });
        return true;
      },
    },
  };
  sessione.invia({ type: "refresh_models", id: "risposta-sincrona" });
  assert.equal(sessione.riassunto().rebindModelloInCorso, false);
});

test("la sequenza catalogo blocca login, compattazione e cambio ciclico del modello", () => {
  const sessione = new SessionePi({ id: "sequenza-isolata", cliPi: FAKE_PI, emetti: () => {} });
  sessione.proc = {
    killed: false,
    exitCode: null,
    signalCode: null,
    stdin: { writable: true, destroyed: false, write: () => true },
  };
  sessione.sequenzaCatalogoModelliInCorso = { revisione: 1, contextWindow: 1_050_000 };
  for (const comando of [
    { type: "login_provider", id: "login-race", provider: "openai" },
    { type: "compact", id: "compact-race" },
    { type: "cycle_model", id: "cycle-race" },
  ]) {
    assert.throws(
      () => sessione.invia(comando, "client-race"),
      (errore) => errore?.statusHttp === 409 && /ricollegando/i.test(errore.message),
      comando.type,
    );
  }
  sessione.sequenzaCatalogoModelliInCorso = null;
});

test("la barriera di compattazione vale anche per API comando e configurazione GPT", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "api-compattazione");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  sessione.diffondi({ type: "compaction_start", reason: "threshold" });
  assert.equal(sessione.inEsecuzione, false, "il test copre la race prima di agent_start");

  for (const comando of [
    { type: "prompt", id: "api-prompt-bloccato", message: "non inviare" },
    { type: "refresh_models", id: "api-refresh-bloccato" },
    { type: "set_model", id: "api-model-bloccato", provider: "fake", modelId: "altro" },
    { type: "new_session", id: "api-nuova-bloccata" },
  ]) {
    const esito = await ambiente.post("/api/comando", {
      sessionId: sessione.id,
      ...comando,
    }, ambiente.stato.tokenApi, "finestra-compattazione");
    assert.equal(esito.risposta.status, 409, `${comando.type}: ${JSON.stringify(esito.dati)}`);
    assert.match(esito.dati.errore, /compattazione/i);
  }
  const gptBloccato = await ambiente.post("/api/contesto-esteso-gpt", {
    sessionId: sessione.id,
    enabled: true,
  });
  assert.equal(gptBloccato.risposta.status, 409, JSON.stringify(gptBloccato.dati));
  await assert.rejects(stat(join(ambiente.home, ".pi", "agent", "models.json")), { code: "ENOENT" });

  sessione.diffondi({ type: "compaction_end", aborted: false });
  const consentito = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "refresh_models",
    id: "api-refresh-consentito",
  }, ambiente.stato.tokenApi, "finestra-compattazione");
  assert.equal(consentito.risposta.status, 200, JSON.stringify(consentito.dati));
  const gptConsentito = await ambiente.post("/api/contesto-esteso-gpt", {
    sessionId: sessione.id,
    enabled: true,
  });
  assert.equal(gptConsentito.risposta.status, 200, JSON.stringify(gptConsentito.dati));
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
  assert.equal(sembraPonteCorrente({ servizio: "pi-gui-bridge", versione: 7, stato: "chiusura" }), true);
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
  assert.deepEqual(decisioneBonificaLegacy({ servizio: "pi-gui-bridge", versione: 7 }, null), {
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
  assert.match(server, /VERSIONE_PONTE = 7/);
  assert.match(launcher, /predefinita = 4666/);
  assert.match(launcher, /dati\.versione === 7/);
  assert.match(frontend, /stato\.versione !== 7/);
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
  assert.match(server, /<pi_gui_files_v1>[\s\S]*percorsi assoluti/);
  assert.match(server, /VERSIONE_PI_VERIFICATA = "0\.84\.2"/);
  assert.match(server, /estensioniBuiltinConsentite: new Set\(\["llama", "sistema"\]\)/);
  assert.match(server, /"extensions", "sistema-guidato", "index\.ts"/);
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
  assert.match(rust, /versione.*== 7/);
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

test("il contesto GPT esteso espone lo stato breve e richiede mutazioni esatte autenticate", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  const cartella = join(ambiente.home, "progetto-contesto");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200, JSON.stringify(avvio.dati));

  const senzaToken = await ambiente.post("/api/contesto-esteso-gpt", {}, null);
  assert.equal(senzaToken.risposta.status, 403);
  assert.match(senzaToken.dati.errore, /autorizzata/i);
  const lettura = await ambiente.post("/api/contesto-esteso-gpt", {});
  assert.deepEqual(lettura.dati, {
    mode: "short",
    managed: false,
    mutable: true,
    conflict: false,
    enabled: false,
    contextWindow: 272_000,
    restartRequired: false,
    refreshRequired: false,
  });
  await assert.rejects(stat(percorso), { code: "ENOENT" });

  for (const corpo of [
    { enabled: true },
    { sessionId: avvio.dati.id },
    { enabled: true, sessionId: avvio.dati.id, inatteso: true },
  ]) {
    const esito = await ambiente.post("/api/contesto-esteso-gpt", corpo);
    assert.equal(esito.risposta.status, 400, JSON.stringify(esito.dati));
  }
  const tipoInvalido = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: "true",
    sessionId: avvio.dati.id,
  });
  assert.equal(tipoInvalido.risposta.status, 400);
  const sessioneInesistente = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: "inesistente",
  });
  assert.equal(sessioneInesistente.risposta.status, 404);
  await assert.rejects(stat(percorso), { code: "ENOENT" });
});

test("il contesto GPT esteso esegue un round-trip esatto e preserva campi e contenitori", async (t) => {
  const originale = {
    versioneUtente: 7,
    _interfacciaPi: { preferenzaGrafica: "compatta" },
    providers: {
      openai: {
        apiKey: "segreto-da-preservare",
        headers: { "x-config": "immutata" },
        modelOverrides: {
          "gpt-5.6-sol": { contextWindow: 272_000, maxTokens: 77_000 },
          "gpt-5.6-terra": { reasoning: true },
          "modello-personale": { contextWindow: 99_000 },
        },
      },
      "openai-codex": { notaLocale: "mantienimi" },
      anthropic: {
        apiKey: "altro-segreto",
        modelOverrides: { "claude-opus-5": { contextWindow: 1_000_000 } },
      },
    },
  };
  const ambiente = await avviaPonteTest({
    preparaHome: async (home) => {
      const cartella = join(home, ".pi", "agent");
      await mkdir(cartella, { recursive: true });
      await writeFile(join(cartella, "models.json"), JSON.stringify(originale), "utf8");
    },
  });
  t.after(ambiente.chiudi);
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  const cartella = join(ambiente.home, "round-trip");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const richiesta = (enabled) => ({ enabled, sessionId: avvio.dati.id });

  const attivazione = await ambiente.post("/api/contesto-esteso-gpt", richiesta(true));
  assert.equal(attivazione.risposta.status, 200, JSON.stringify(attivazione.dati));
  assert.deepEqual(attivazione.dati, {
    mode: "extended",
    managed: true,
    mutable: true,
    conflict: false,
    enabled: true,
    contextWindow: 1_050_000,
    restartRequired: false,
    refreshRequired: true,
  });
  assert.doesNotMatch(JSON.stringify(attivazione.dati), /segreto/i);
  const testoAttivo = await readFile(percorso, "utf8");
  const configurazioneAttiva = JSON.parse(testoAttivo);
  const provenienza = configurazioneAttiva._interfacciaPi.gptExtendedContextV1;
  assert.equal(provenienza.version, 1);
  assert.equal(provenienza.managedBy, "interfaccia-pi");
  assert.equal(provenienza.fileExisted, true);
  assert.equal(provenienza.providersContainerExisted, true);
  assert.equal(provenienza.metadataContainerExisted, true);
  assert.deepEqual(provenienza.providers.openai.models["gpt-5.6-sol"], {
    overrideExisted: true,
    contextWindowExisted: true,
    contextWindow: 272_000,
  });
  assert.deepEqual(provenienza.providers.openai.models["gpt-5.6-terra"], {
    overrideExisted: true,
    contextWindowExisted: false,
  });
  assert.equal(provenienza.providers.openai.models["gpt-5.6-luna"].overrideExisted, false);
  assert.equal(provenienza.providers["openai-codex"].providerExisted, true);
  assert.equal(provenienza.providers["openai-codex"].modelOverridesExisted, false);
  for (const providerId of ["openai", "openai-codex"]) {
    for (const modelloId of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      assert.equal(
        configurazioneAttiva.providers[providerId].modelOverrides[modelloId].contextWindow,
        1_050_000,
      );
    }
  }
  assert.equal(
    configurazioneAttiva.providers.openai.modelOverrides["gpt-5.6-sol"].maxTokens,
    77_000,
  );
  assert.deepEqual(configurazioneAttiva._interfacciaPi.preferenzaGrafica, "compatta");

  const idempotente = await ambiente.post("/api/contesto-esteso-gpt", richiesta(true));
  assert.equal(idempotente.dati.refreshRequired, false);
  assert.equal(await readFile(percorso, "utf8"), testoAttivo);
  const disattivazione = await ambiente.post("/api/contesto-esteso-gpt", richiesta(false));
  assert.deepEqual(disattivazione.dati, {
    mode: "short",
    managed: false,
    mutable: true,
    conflict: false,
    enabled: false,
    contextWindow: 272_000,
    restartRequired: false,
    refreshRequired: true,
  });
  assert.deepEqual(JSON.parse(await readFile(percorso, "utf8")), originale);
  const disattivazioneIdempotente = await ambiente.post(
    "/api/contesto-esteso-gpt",
    richiesta(false),
  );
  assert.equal(disattivazioneIdempotente.dati.refreshRequired, false);
  assert.deepEqual(JSON.parse(await readFile(percorso, "utf8")), originale);
});

test("il contesto GPT esteso rimuove file e contenitori creati soltanto dalla GUI", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  const cartella = join(ambiente.home, "contenitori-gpt");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const richiesta = (enabled) => ({ enabled, sessionId: avvio.dati.id });

  const attivazione = await ambiente.post("/api/contesto-esteso-gpt", richiesta(true));
  assert.equal(attivazione.risposta.status, 200, JSON.stringify(attivazione.dati));
  const configurazione = JSON.parse(await readFile(percorso, "utf8"));
  const provenienza = configurazione._interfacciaPi.gptExtendedContextV1;
  assert.equal(provenienza.fileExisted, false);
  assert.equal(provenienza.providersContainerExisted, false);
  assert.equal(provenienza.metadataContainerExisted, false);
  for (const providerId of ["openai", "openai-codex"]) {
    assert.equal(provenienza.providers[providerId].providerExisted, false);
    assert.equal(provenienza.providers[providerId].modelOverridesExisted, false);
  }

  const disattivazione = await ambiente.post("/api/contesto-esteso-gpt", richiesta(false));
  assert.equal(disattivazione.risposta.status, 200, JSON.stringify(disattivazione.dati));
  await assert.rejects(stat(percorso), { code: "ENOENT" });
});

test("il contesto GPT esteso classifica custom e mixed e non sovrascrive override esterni", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartellaConfig = join(ambiente.home, ".pi", "agent");
  const percorso = join(cartellaConfig, "models.json");
  await mkdir(cartellaConfig, { recursive: true });
  const cartella = join(ambiente.home, "conflitti-gpt");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const richiesta = (enabled) => ({ enabled, sessionId: avvio.dati.id });

  const personalizzata = {
    providers: {
      openai: { modelOverrides: { "gpt-5.6-sol": { contextWindow: 500_000 } } },
    },
  };
  const testoPersonalizzato = JSON.stringify(personalizzata);
  await writeFile(percorso, testoPersonalizzato, "utf8");
  const statoCustom = await ambiente.post("/api/contesto-esteso-gpt", {});
  assert.equal(statoCustom.dati.mode, "custom");
  assert.equal(statoCustom.dati.managed, false);
  assert.equal(statoCustom.dati.mutable, false);
  assert.equal(statoCustom.dati.conflict, true);
  assert.equal(statoCustom.dati.enabled, false);
  assert.equal(Object.hasOwn(statoCustom.dati, "contextWindow"), false);
  for (const enabled of [true, false]) {
    const esito = await ambiente.post("/api/contesto-esteso-gpt", richiesta(enabled));
    assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
    assert.equal(await readFile(percorso, "utf8"), testoPersonalizzato);
  }

  const mista = {
    providers: {
      openai: { modelOverrides: { "gpt-5.6-sol": { contextWindow: 1_050_000 } } },
    },
  };
  await writeFile(percorso, JSON.stringify(mista), "utf8");
  const statoMixed = await ambiente.post("/api/contesto-esteso-gpt", {});
  assert.equal(statoMixed.dati.mode, "mixed");
  assert.equal(statoMixed.dati.conflict, true);
  assert.equal(Object.hasOwn(statoMixed.dati, "contextWindow"), false);

  const uniforme = { providers: {} };
  for (const providerId of ["openai", "openai-codex"]) {
    uniforme.providers[providerId] = { modelOverrides: {} };
    for (const modelloId of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      uniforme.providers[providerId].modelOverrides[modelloId] = { contextWindow: 500_000 };
    }
  }
  await writeFile(percorso, JSON.stringify(uniforme), "utf8");
  const statoUniforme = await ambiente.post("/api/contesto-esteso-gpt", {});
  assert.equal(statoUniforme.dati.mode, "custom");
  assert.equal(statoUniforme.dati.contextWindow, 500_000);
  assert.equal(statoUniforme.dati.conflict, true);
});

test("il contesto GPT esteso fallisce chiuso se un override gestito cambia esternamente", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  const cartella = join(ambiente.home, "drift-gpt");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const richiesta = (enabled) => ({ enabled, sessionId: avvio.dati.id });
  const attivazione = await ambiente.post("/api/contesto-esteso-gpt", richiesta(true));
  assert.equal(attivazione.risposta.status, 200, JSON.stringify(attivazione.dati));

  const configurazione = JSON.parse(await readFile(percorso, "utf8"));
  configurazione.providers.openai.modelOverrides["gpt-5.6-sol"].contextWindow = 500_000;
  await writeFile(percorso, JSON.stringify(configurazione, null, 2) + "\n", "utf8");
  const testoConDrift = await readFile(percorso, "utf8");
  const stato = await ambiente.post("/api/contesto-esteso-gpt", {});
  assert.equal(stato.dati.mode, "custom");
  assert.equal(stato.dati.managed, true);
  assert.equal(stato.dati.mutable, false);
  assert.equal(stato.dati.conflict, true);
  assert.equal(stato.dati.enabled, false);
  assert.equal(Object.hasOwn(stato.dati, "contextWindow"), false);
  for (const enabled of [true, false]) {
    const esito = await ambiente.post("/api/contesto-esteso-gpt", richiesta(enabled));
    assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
    assert.equal(await readFile(percorso, "utf8"), testoConDrift);
  }
});

test("il contesto GPT esteso richiede una sessione realmente inattiva", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  const cartella = join(ambiente.home, "guardia-gpt");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const richiesta = { enabled: true, sessionId: avvio.dati.id };
  const provaGuardia = async (imposta, ripristina) => {
    imposta();
    try {
      const esito = await ambiente.post("/api/contesto-esteso-gpt", richiesta);
      assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
    } finally {
      ripristina();
    }
    await assert.rejects(stat(percorso), { code: "ENOENT" });
  };
  await provaGuardia(() => { sessione.inEsecuzione = true; }, () => { sessione.inEsecuzione = false; });
  await provaGuardia(
    () => { sessione.proprietariTurni.push({ id: "prenotato" }); },
    () => { sessione.proprietariTurni.length = 0; },
  );
  await provaGuardia(
    () => { sessione.cambioSessioneInCorso = true; },
    () => { sessione.cambioSessioneInCorso = false; },
  );
  await provaGuardia(() => { sessione.inChiusura = true; }, () => { sessione.inChiusura = false; });
  await provaGuardia(() => { sessione.handoffInCorso = true; }, () => { sessione.handoffInCorso = false; });
  await provaGuardia(
    () => { sessione.configurazioneModelliInCorso = true; },
    () => { sessione.configurazioneModelliInCorso = false; },
  );
  await provaGuardia(
    () => { sessione.rebindModelloInCorso = { id: "rebind-pendente", timer: null }; },
    () => { sessione.rebindModelloInCorso = null; },
  );

  sessione.configurazioneModelliInCorso = true;
  const prompt = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "prompt",
    message: "non inoltrare",
  });
  sessione.configurazioneModelliInCorso = false;
  assert.equal(prompt.risposta.status, 409, JSON.stringify(prompt.dati));
  assert.match(prompt.dati.errore, /configurazione dei modelli/i);

  ambiente.ponte.sessioni.set("sessione-inattiva-gpt", {
    id: "sessione-inattiva-gpt",
    proc: null,
  });
  const inattiva = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: "sessione-inattiva-gpt",
  });
  ambiente.ponte.sessioni.delete("sessione-inattiva-gpt");
  assert.equal(inattiva.risposta.status, 409, JSON.stringify(inattiva.dati));
  await assert.rejects(stat(percorso), { code: "ENOENT" });
});

test("il contesto GPT esteso non sovrascrive models.json malformato", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, ".pi", "agent");
  const percorso = join(cartella, "models.json");
  await mkdir(cartella, { recursive: true });
  const workspace = join(ambiente.home, "malformato-gpt");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const mutazione = { enabled: true, sessionId: avvio.dati.id };

  const sintassiInvalida = '{"providers":';
  await writeFile(percorso, sintassiInvalida, "utf8");
  for (const corpo of [{}, mutazione]) {
    const esito = await ambiente.post("/api/contesto-esteso-gpt", corpo);
    assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
    assert.equal(await readFile(percorso, "utf8"), sintassiInvalida);
  }
  for (const configurazioneInvalida of [
    [],
    { providers: null },
    { providers: { openai: null } },
    { providers: { openai: { modelOverrides: [] } } },
    { providers: { openai: { modelOverrides: { "gpt-5.6-sol": null } } } },
    { _interfacciaPi: { gptExtendedContextV1: {} } },
  ]) {
    const testo = JSON.stringify(configurazioneInvalida);
    await writeFile(percorso, testo, "utf8");
    const esito = await ambiente.post("/api/contesto-esteso-gpt", mutazione);
    assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
    assert.equal(await readFile(percorso, "utf8"), testo);
  }
});

test("il CAS di models.json preserva una modifica esterna fra lettura e commit", async (t) => {
  const originale = '{"preferenza":"prima"}\n';
  const esterno = '{"preferenza":"editor-esterno","nuovo":true}\r\n';
  let modifica = true;
  const ambiente = await avviaPonteTest({
    preparaHome: async (home) => {
      const cartella = join(home, ".pi", "agent");
      await mkdir(cartella, { recursive: true });
      await writeFile(join(cartella, "models.json"), originale, "utf8");
    },
    primaCommitConfigurazioneModelli: async ({ percorso, fase }) => {
      if (modifica && fase === "prima-riserva") {
        modifica = false;
        await writeFile(percorso, esterno, "utf8");
      }
    },
  });
  t.after(ambiente.chiudi);
  const workspace = join(ambiente.home, "cas-edit-esterno");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const esito = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: avvio.dati.id,
  });
  assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  assert.equal(await readFile(percorso, "utf8"), esterno);
  const residui = await readdir(dirname(percorso));
  assert.equal(residui.some((nome) => nome.endsWith(".tmp")), false, residui.join(", "));
  assert.equal(residui.some((nome) => nome.endsWith(".cas-backup")), false, residui.join(", "));
});

test("il CAS rileva una scrittura tramite l'handle originale dopo il rename a backup", async (t) => {
  const originale = '{"preferenza":"prima"}\n';
  const esterno = '{"preferenza":"handle-editor","preserva":true}\r\n';
  let handleEsterno = null;
  let modifica = true;
  const ambiente = await avviaPonteTest({
    preparaHome: async (home) => {
      const cartella = join(home, ".pi", "agent");
      await mkdir(cartella, { recursive: true });
      const percorso = join(cartella, "models.json");
      await writeFile(percorso, originale, "utf8");
      handleEsterno = await open(percorso, "r+");
    },
    primaCommitConfigurazioneModelli: async ({ fase }) => {
      if (!modifica || fase !== "prima-installazione") return;
      modifica = false;
      await handleEsterno.truncate(0);
      await handleEsterno.writeFile(esterno, "utf8");
      await handleEsterno.sync();
    },
  });
  t.after(async () => {
    await handleEsterno?.close().catch(() => {});
    await ambiente.chiudi();
  });
  const workspace = join(ambiente.home, "cas-handle-aperto");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const esito = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: avvio.dati.id,
  });
  await handleEsterno.close();
  handleEsterno = null;
  assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  assert.equal(await readFile(percorso, "utf8"), esterno);
  assert.equal(
    ambiente.ponte.sessioni.get(avvio.dati.id).riassunto().catalogoModelliDaRicaricare,
    false,
  );
  const residui = await readdir(dirname(percorso));
  assert.equal(residui.some((nome) => nome.endsWith(".tmp")), false, residui.join(", "));
  assert.equal(residui.some((nome) => nome.endsWith(".cas-backup")), false, residui.join(", "));
  assert.equal(residui.some((nome) => nome.endsWith(".cas-rejected")), false, residui.join(", "));
});

test("un errore di cleanup del backup non annulla il commit ne il latch", async (t) => {
  const ambiente = await avviaPonteTest({
    preparaHome: async (home) => {
      const cartella = join(home, ".pi", "agent");
      await mkdir(cartella, { recursive: true });
      await writeFile(join(cartella, "models.json"), '{"preferenza":"preserva"}\n', "utf8");
    },
    rimuoviBackupConfigurazione: async (percorso, opzioni) => {
      if (percorso.endsWith(".cas-backup")) {
        const errore = new Error("backup occupato");
        errore.code = "EPERM";
        throw errore;
      }
      return rm(percorso, opzioni);
    },
  });
  t.after(ambiente.chiudi);
  const workspace = join(ambiente.home, "cas-cleanup-backup");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const esito = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: avvio.dati.id,
  });
  assert.equal(esito.risposta.status, 200, JSON.stringify(esito.dati));
  assert.equal(esito.dati.refreshRequired, true);
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  const configurazione = JSON.parse(await readFile(percorso, "utf8"));
  for (const provider of ["openai", "openai-codex"]) {
    for (const modello of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      assert.equal(
        configurazione.providers[provider].modelOverrides[modello].contextWindow,
        1_050_000,
      );
    }
  }
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  assert.equal(sessione.riassunto().catalogoModelliDaRicaricare, true);
  const prompt = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "prompt",
    id: "prompt-dopo-cleanup-fallito",
    message: "non inoltrare",
  });
  assert.equal(prompt.risposta.status, 409, JSON.stringify(prompt.dati));
  const residui = await readdir(dirname(percorso));
  assert.equal(residui.filter((nome) => nome.endsWith(".cas-backup")).length, 1, residui.join(", "));
  assert.equal(residui.some((nome) => nome.endsWith(".tmp")), false, residui.join(", "));
});

test("il CAS non sovrascrive un models.json creato mentre il target era assente", async (t) => {
  const esterno = '{"creatoDa":"altro-processo"}\n';
  let crea = true;
  const ambiente = await avviaPonteTest({
    primaCommitConfigurazioneModelli: async ({ percorso, fase }) => {
      if (crea && fase === "prima-riserva") {
        crea = false;
        await writeFile(percorso, esterno, "utf8");
      }
    },
  });
  t.after(ambiente.chiudi);
  const workspace = join(ambiente.home, "cas-creazione-esterna");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const esito = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: avvio.dati.id,
  });
  assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  assert.equal(await readFile(percorso, "utf8"), esterno);
  const residui = await readdir(dirname(percorso));
  assert.equal(residui.some((nome) => nome.endsWith(".tmp")), false, residui.join(", "));
});

test("il CAS non sovrascrive un nuovo target comparso dopo la riserva", async (t) => {
  const originale = '{"preferenza":"prima"}\n';
  const esterno = '{"creatoDopoRename":true}\n';
  let crea = true;
  const ambiente = await avviaPonteTest({
    preparaHome: async (home) => {
      const cartella = join(home, ".pi", "agent");
      await mkdir(cartella, { recursive: true });
      await writeFile(join(cartella, "models.json"), originale, "utf8");
    },
    primaCommitConfigurazioneModelli: async ({ percorso, fase }) => {
      if (crea && fase === "prima-installazione") {
        crea = false;
        await writeFile(percorso, esterno, "utf8");
      }
    },
  });
  t.after(ambiente.chiudi);
  const workspace = join(ambiente.home, "cas-race-installazione");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const esito = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: avvio.dati.id,
  });
  assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  assert.equal(await readFile(percorso, "utf8"), esterno);
  const residui = await readdir(dirname(percorso));
  assert.equal(residui.some((nome) => nome.endsWith(".tmp")), false, residui.join(", "));
  assert.equal(residui.some((nome) => nome.endsWith(".cas-backup")), true,
    "il backup atteso resta recuperabile quando ripristinarlo sovrascriverebbe il nuovo target");
});

test("il CAS protegge anche il ripristino/disattivazione da edit esterni", async (t) => {
  let intercettaDisattivazione = false;
  let giaModificato = false;
  let byteEsterni = null;
  const ambiente = await avviaPonteTest({
    primaCommitConfigurazioneModelli: async ({ percorso, azione, fase }) => {
      if (!intercettaDisattivazione || giaModificato || azione !== "remove" || fase !== "prima-riserva") return;
      giaModificato = true;
      const configurazione = JSON.parse(await readFile(percorso, "utf8"));
      configurazione.editEsterno = { preserva: true };
      byteEsterni = JSON.stringify(configurazione, null, 2) + "\n";
      await writeFile(percorso, byteEsterni, "utf8");
    },
  });
  t.after(ambiente.chiudi);
  const workspace = join(ambiente.home, "cas-disattivazione");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const richiesta = (enabled) => ({ enabled, sessionId: avvio.dati.id });
  const attiva = await ambiente.post("/api/contesto-esteso-gpt", richiesta(true));
  assert.equal(attiva.risposta.status, 200, JSON.stringify(attiva.dati));
  intercettaDisattivazione = true;
  const disattiva = await ambiente.post("/api/contesto-esteso-gpt", richiesta(false));
  assert.equal(disattiva.risposta.status, 409, JSON.stringify(disattiva.dati));
  const percorso = join(ambiente.home, ".pi", "agent", "models.json");
  assert.equal(await readFile(percorso, "utf8"), byteEsterni);
});

test("il latch del catalogo e server-side, sopravvive a nuovi client e resta dirty sui fallimenti", async (t) => {
  const ambiente = await avviaPonteTest({
    preparaHome: async (home) => {
      const cartella = join(home, ".pi", "agent");
      await mkdir(cartella, { recursive: true });
      // Il bridge preserva provider estranei; se PI rigetta il loro schema e
      // ripiega sul catalogo builtin, la verifica dei sei target deve fallire.
      await writeFile(join(cartella, "models.json"), JSON.stringify({
        providers: { altro: { models: "schema-estraneo-invalido" } },
      }), "utf8");
    },
    timeoutRicaricaCatalogoModelliMs: 100,
  });
  t.after(ambiente.chiudi);
  const workspaceA = join(ambiente.home, "latch-a");
  const workspaceB = join(ambiente.home, "latch-b");
  const workspaceC = join(ambiente.home, "latch-creata-dopo-config");
  await mkdir(workspaceA);
  await mkdir(workspaceB);
  await mkdir(workspaceC);
  const avvioA = await ambiente.post("/api/avvia", { cartella: workspaceA });
  const avvioB = await ambiente.post("/api/avvia", { cartella: workspaceB });
  const attiva = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: avvioA.dati.id,
  });
  assert.equal(attiva.risposta.status, 200, JSON.stringify(attiva.dati));
  const avvioC = await ambiente.post("/api/avvia", { cartella: workspaceC });
  assert.equal(avvioC.risposta.status, 200, JSON.stringify(avvioC.dati));

  const snapshot = async () => (await (await fetch(ambiente.base + "/api/stato")).json());
  for (const stato of [await snapshot(), await snapshot()]) {
    for (const id of [avvioA.dati.id, avvioB.dati.id, avvioC.dati.id]) {
      const meta = stato.sessioni.find((voce) => voce.id === id);
      assert.equal(meta.catalogoModelliDaRicaricare, true);
      assert.equal(meta.revisioneCatalogoModelliAttesa, 1);
      assert.equal(meta.contextWindowCatalogoModelliAttesa, 1_050_000);
    }
  }

  const sessione = ambiente.ponte.sessioni.get(avvioA.dati.id);
  const getState = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "get_state",
    id: "get-state-non-bypassa-latch",
  }, ambiente.stato.tokenApi, "client-f5");
  assert.equal(getState.risposta.status, 200, JSON.stringify(getState.dati));
  await attendi(20);
  assert.equal((await snapshot()).sessioni.find((voce) => voce.id === sessione.id)
    .catalogoModelliDaRicaricare, true);

  for (const comando of [
    { type: "prompt", id: "prompt-dirty", message: "non inviare" },
    { type: "steer", id: "steer-dirty", message: "non guidare" },
    { type: "follow_up", id: "follow-dirty", message: "non accodare" },
    { type: "set_model", id: "model-dirty", provider: "openai", modelId: "gpt-5.6-sol" },
  ]) {
    const bloccato = await ambiente.post("/api/comando", {
      sessionId: sessione.id,
      ...comando,
    }, ambiente.stato.tokenApi, "client-nuovo");
    assert.equal(bloccato.risposta.status, 409, `${comando.type}: ${JSON.stringify(bloccato.dati)}`);
    assert.match(bloccato.dati.errore, /catalogo modelli/i);
  }

  const ripristinaErroreRefresh = intercettaRpcSessione(sessione, (comando) =>
    comando.type === "refresh_models"
      ? { success: false, error: "refresh provider fallito" }
      : null);
  const refreshFallito = await ambiente.post("/api/ricarica-contesto-gpt", {
    sessionId: sessione.id,
  });
  ripristinaErroreRefresh();
  assert.equal(refreshFallito.risposta.status, 409, JSON.stringify(refreshFallito.dati));
  assert.equal((await snapshot()).sessioni.find((voce) => voce.id === sessione.id)
    .catalogoModelliDaRicaricare, true);

  // Simuliamo un refresh RPC formalmente riuscito seguito dal fallback
  // builtin senza i sei GPT-5.6: la verifica esatta resta fail-closed.
  const ripristinaFallback = intercettaRpcSessione(sessione, (comando) => {
    if (comando.type === "refresh_models") {
      return { data: { aborted: false, timedOut: false, errors: [] } };
    }
    if (comando.type === "get_available_models") {
      return { data: { models: [{ provider: "fake", id: "modello-test", contextWindow: 32_000 }] } };
    }
    return null;
  });
  const fallback = await ambiente.post("/api/ricarica-contesto-gpt", {
    sessionId: sessione.id,
  });
  ripristinaFallback();
  assert.equal(fallback.risposta.status, 409, JSON.stringify(fallback.dati));
  assert.equal((await snapshot()).sessioni.find((voce) => voce.id === sessione.id)
    .catalogoModelliDaRicaricare, true);
});

test("una nuova sessione eredita il latch gestito anche dopo il riavvio del bridge", async (t) => {
  let primo = await avviaPonteTest({
    conservaHome: true,
    preparaHome: async (home) => {
      const cartella = join(home, ".pi", "agent");
      await mkdir(cartella, { recursive: true });
      await writeFile(join(cartella, "models.json"), JSON.stringify({
        providers: { altro: { models: "schema-estraneo-invalido" } },
      }), "utf8");
    },
  });
  const home = primo.home;
  let secondo = null;
  t.after(async () => {
    await secondo?.chiudi();
    await primo?.chiudi();
    await rm(home, { recursive: true, force: true });
  });
  const cartellaPrima = join(home, "latch-prima-del-riavvio");
  await mkdir(cartellaPrima);
  const avvioPrima = await primo.post("/api/avvia", { cartella: cartellaPrima });
  const attiva = await primo.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: avvioPrima.dati.id,
  });
  assert.equal(attiva.risposta.status, 200, JSON.stringify(attiva.dati));
  await primo.chiudi();
  primo = null;

  secondo = await avviaPonteTest({ home, conservaHome: true });
  const cartellaDopo = join(home, "latch-dopo-il-riavvio");
  await mkdir(cartellaDopo);
  const avvioDopo = await secondo.post("/api/avvia", { cartella: cartellaDopo });
  assert.equal(avvioDopo.risposta.status, 200, JSON.stringify(avvioDopo.dati));
  const sessione = secondo.ponte.sessioni.get(avvioDopo.dati.id);
  const meta = sessione.riassunto();
  assert.equal(meta.catalogoModelliDaRicaricare, true);
  assert.equal(meta.revisioneCatalogoModelliAttesa, 1);
  assert.equal(meta.contextWindowCatalogoModelliAttesa, 1_050_000);
  const prompt = await secondo.post("/api/comando", {
    sessionId: sessione.id,
    type: "prompt",
    id: "prompt-dopo-riavvio-dirty",
    message: "non inoltrare",
  }, secondo.stato.tokenApi, "client-dopo-riavvio");
  assert.equal(prompt.risposta.status, 409, JSON.stringify(prompt.dati));
  assert.match(prompt.dati.errore, /catalogo modelli/i);
});

test("OAuth openai-codex verifica solo i provider disponibili e sempre quello corrente", async (t) => {
  const ambiente = await avviaPonteTest({ timeoutRicaricaCatalogoModelliMs: 500 });
  t.after(ambiente.chiudi);
  const workspace = join(ambiente.home, "latch-oauth-codex");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const attiva = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: sessione.id,
  });
  assert.equal(attiva.risposta.status, 200, JSON.stringify(attiva.dati));
  sessione.provider = "openai-codex";
  sessione.modello = "gpt-5.6-sol";
  sessione.nomeModello = "GPT-5.6 Sol";

  let setModelInviati = 0;
  let ripristina = intercettaRpcSessione(sessione, (comando) => {
    if (comando.type === "refresh_models") {
      return { data: { aborted: false, timedOut: false, errors: [] } };
    }
    if (comando.type === "get_available_models") {
      return { data: {
        models: catalogoGpt56(1_050_000).filter((voce) => voce.provider === "openai"),
      } };
    }
    if (comando.type === "set_model") setModelInviati += 1;
    return null;
  });
  const providerCorrenteAssente = await ambiente.post("/api/ricarica-contesto-gpt", {
    sessionId: sessione.id,
  });
  ripristina();
  assert.equal(providerCorrenteAssente.risposta.status, 409, JSON.stringify(providerCorrenteAssente.dati));
  assert.match(providerCorrenteAssente.dati.errore, /provider corrente openai-codex/i);
  assert.equal(setModelInviati, 0);
  assert.equal(sessione.riassunto().catalogoModelliDaRicaricare, true);

  const tipi = [];
  ripristina = intercettaRpcSessione(sessione, (comando) => {
    tipi.push(comando.type);
    if (comando.type === "refresh_models") {
      return { data: {
        aborted: false,
        timedOut: false,
        errors: [{ providerId: "openai", message: "API key non disponibile" }],
      } };
    }
    if (comando.type === "get_available_models") {
      return { data: {
        models: catalogoGpt56(1_050_000).filter((voce) => voce.provider === "openai-codex"),
      } };
    }
    if (comando.type === "set_model") {
      assert.equal(comando.provider, "openai-codex");
      assert.equal(comando.modelId, "gpt-5.6-sol");
      return { data: { provider: comando.provider, id: comando.modelId } };
    }
    if (comando.type === "get_state") {
      return { data: {
        model: {
          provider: "openai-codex",
          id: "gpt-5.6-sol",
          name: "GPT-5.6 Sol",
          contextWindow: 1_050_000,
        },
        sessionFile: sessione.fileSessione,
        isStreaming: false,
        isCompacting: false,
      } };
    }
    return { success: false, error: "comando inatteso" };
  });
  const esito = await ambiente.post("/api/ricarica-contesto-gpt", {
    sessionId: sessione.id,
  });
  ripristina();
  assert.equal(esito.risposta.status, 200, JSON.stringify(esito.dati));
  assert.deepEqual(tipi, ["refresh_models", "get_available_models", "set_model", "get_state"]);
  assert.equal(esito.dati.catalogoModelliDaRicaricare, false);

  const configurazione = JSON.parse(await readFile(
    join(ambiente.home, ".pi", "agent", "models.json"),
    "utf8",
  ));
  for (const provider of ["openai", "openai-codex"]) {
    for (const modello of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      assert.equal(
        configurazione.providers[provider].modelOverrides[modello].contextWindow,
        1_050_000,
      );
    }
  }
});

test("solo la sequenza server verificata chiude il latch e conferma la finestra GPT effettiva", async (t) => {
  const ambiente = await avviaPonteTest({ timeoutRicaricaCatalogoModelliMs: 500 });
  t.after(ambiente.chiudi);
  const workspace = join(ambiente.home, "latch-successo");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const attiva = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: sessione.id,
  });
  assert.equal(attiva.risposta.status, 200, JSON.stringify(attiva.dati));
  sessione.provider = "openai";
  sessione.modello = "gpt-5.6-sol";
  sessione.nomeModello = "GPT-5.6 Sol";

  const cambioPrematuro = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "set_model",
    id: "set-prima-verifica",
    provider: "openai",
    modelId: "gpt-5.6-terra",
  }, ambiente.stato.tokenApi, "client-prima");
  assert.equal(cambioPrematuro.risposta.status, 409, JSON.stringify(cambioPrematuro.dati));

  const tipi = [];
  const ripristina = intercettaRpcSessione(sessione, (comando) => {
    tipi.push(comando.type);
    if (comando.type === "refresh_models") {
      return { data: { aborted: false, timedOut: false, errors: [] } };
    }
    if (comando.type === "get_available_models") {
      return { data: { models: catalogoGpt56(1_050_000), errors: [] } };
    }
    if (comando.type === "set_model") {
      assert.equal(comando.provider, "openai");
      assert.equal(comando.modelId, "gpt-5.6-sol");
      return { data: { provider: comando.provider, id: comando.modelId, name: "GPT-5.6 Sol" } };
    }
    if (comando.type === "get_state") {
      return { data: {
        model: {
          provider: "openai",
          id: "gpt-5.6-sol",
          name: "GPT-5.6 Sol",
          contextWindow: 1_050_000,
        },
        sessionFile: sessione.fileSessione,
        isStreaming: false,
      } };
    }
    return { success: false, error: "comando inatteso" };
  });
  const esito = await ambiente.post("/api/ricarica-contesto-gpt", {
    sessionId: sessione.id,
  });
  ripristina();
  assert.equal(esito.risposta.status, 200, JSON.stringify(esito.dati));
  assert.deepEqual(tipi, [
    "refresh_models",
    "get_available_models",
    "set_model",
    "get_state",
  ]);
  assert.equal(esito.dati.catalogoModelliDaRicaricare, false);
  const stato = await (await fetch(ambiente.base + "/api/stato")).json();
  const meta = stato.sessioni.find((voce) => voce.id === sessione.id);
  assert.equal(meta.catalogoModelliDaRicaricare, false);
  assert.equal(meta.rebindModelloInCorso, false);

  const prompt = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "prompt",
    id: "prompt-dopo-verifica",
    message: "ora puoi inviare",
  }, ambiente.stato.tokenApi, "client-dopo");
  assert.equal(prompt.risposta.status, 200, JSON.stringify(prompt.dati));
});

test("refresh abortito e target duplicati restano dirty, mentre un modello non GPT completa il rebind", async (t) => {
  const ambiente = await avviaPonteTest({ timeoutRicaricaCatalogoModelliMs: 500 });
  t.after(ambiente.chiudi);
  const workspace = join(ambiente.home, "latch-casi-limite");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const attiva = await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: sessione.id,
  });
  assert.equal(attiva.risposta.status, 200, JSON.stringify(attiva.dati));

  let ripristina = intercettaRpcSessione(sessione, (comando) => comando.type === "refresh_models"
    ? { data: { aborted: true, timedOut: false, errors: [] } }
    : null);
  const abortito = await ambiente.post("/api/ricarica-contesto-gpt", { sessionId: sessione.id });
  ripristina();
  assert.equal(abortito.risposta.status, 409, JSON.stringify(abortito.dati));
  assert.equal(sessione.riassunto().catalogoModelliDaRicaricare, true);
  assert.equal(sessione.riassunto().rebindModelloInCorso, false);

  ripristina = intercettaRpcSessione(sessione, (comando) => {
    if (comando.type === "refresh_models") {
      return { data: { aborted: false, timedOut: false, errors: [] } };
    }
    if (comando.type === "get_available_models") {
      const modelli = catalogoGpt56(1_050_000);
      return { data: { models: [...modelli, { ...modelli[0] }], errors: [] } };
    }
    return null;
  });
  const duplicato = await ambiente.post("/api/ricarica-contesto-gpt", { sessionId: sessione.id });
  ripristina();
  assert.equal(duplicato.risposta.status, 409, JSON.stringify(duplicato.dati));
  assert.equal(sessione.riassunto().catalogoModelliDaRicaricare, true);
  assert.equal(sessione.riassunto().rebindModelloInCorso, false);

  sessione.provider = "anthropic";
  sessione.modello = "claude-opus-5";
  sessione.nomeModello = "Claude Opus 5";
  ripristina = intercettaRpcSessione(sessione, (comando) => {
    if (comando.type === "refresh_models") {
      return { data: { aborted: false, timedOut: false, errors: [] } };
    }
    if (comando.type === "get_available_models") {
      return { data: { models: catalogoGpt56(1_050_000), errors: [] } };
    }
    if (comando.type === "set_model") {
      return { data: { provider: comando.provider, id: comando.modelId } };
    }
    if (comando.type === "get_state") {
      return { data: {
        model: {
          provider: "anthropic",
          id: "claude-opus-5",
          name: "Claude Opus 5",
          contextWindow: 1_000_000,
        },
        sessionFile: sessione.fileSessione,
        isStreaming: false,
        isCompacting: false,
      } };
    }
    return null;
  });
  const nonGpt = await ambiente.post("/api/ricarica-contesto-gpt", { sessionId: sessione.id });
  ripristina();
  assert.equal(nonGpt.risposta.status, 200, JSON.stringify(nonGpt.dati));
  assert.equal(nonGpt.dati.catalogoModelliDaRicaricare, false);
  assert.equal(sessione.riassunto().rebindModelloInCorso, false);
});

test("la verifica del catalogo non invia set_model se il JSONL e stato sostituito", async (t) => {
  const ambiente = await avviaPonteTest({ timeoutRicaricaCatalogoModelliMs: 500 });
  t.after(ambiente.chiudi);
  const workspace = join(ambiente.home, "latch-jsonl-sostituito");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  await ambiente.post("/api/contesto-esteso-gpt", {
    enabled: true,
    sessionId: sessione.id,
  });
  sessione.provider = "openai-codex";
  sessione.modello = "gpt-5.6-sol";
  const originale = sessione.fileSessione;
  await rename(originale, originale + ".spostato");
  await writeFile(originale, "", "utf8");

  let setModelInviati = 0;
  const ripristina = intercettaRpcSessione(sessione, (comando) => {
    if (comando.type === "refresh_models") {
      return { data: { aborted: false, timedOut: false, errors: [] } };
    }
    if (comando.type === "get_available_models") {
      return { data: { models: catalogoGpt56(1_050_000), errors: [] } };
    }
    if (comando.type === "set_model") setModelInviati += 1;
    return null;
  });
  const esito = await ambiente.post("/api/ricarica-contesto-gpt", { sessionId: sessione.id });
  ripristina();
  assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
  assert.match(esito.dati.errore, /file diverso|spostato o sostituito/i);
  assert.equal(setModelInviati, 0);
  assert.equal(sessione.riassunto().catalogoModelliDaRicaricare, true);
  assert.equal(sessione.riassunto().rebindModelloInCorso, false);
  assert.equal(await readFile(originale, "utf8"), "");
});

test("catalogo esatto ma get_state GPT con finestra errata non puo chiudere il latch", async (t) => {
  const ambiente = await avviaPonteTest({ timeoutRicaricaCatalogoModelliMs: 500 });
  t.after(ambiente.chiudi);
  const workspace = join(ambiente.home, "latch-stato-errato");
  await mkdir(workspace);
  const avvio = await ambiente.post("/api/avvia", { cartella: workspace });
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  await ambiente.post("/api/contesto-esteso-gpt", { enabled: true, sessionId: sessione.id });
  sessione.provider = "openai-codex";
  sessione.modello = "gpt-5.6-luna";
  const ripristina = intercettaRpcSessione(sessione, (comando) => {
    if (comando.type === "refresh_models") {
      return { data: { aborted: false, timedOut: false, errors: [] } };
    }
    if (comando.type === "get_available_models") {
      return { data: { models: catalogoGpt56(1_050_000) } };
    }
    if (comando.type === "set_model") {
      return { data: { provider: comando.provider, id: comando.modelId } };
    }
    if (comando.type === "get_state") {
      return { data: {
        model: { provider: "openai-codex", id: "gpt-5.6-luna", contextWindow: 272_000 },
        sessionFile: sessione.fileSessione,
        isStreaming: false,
      } };
    }
    return null;
  });
  const esito = await ambiente.post("/api/ricarica-contesto-gpt", { sessionId: sessione.id });
  ripristina();
  assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
  assert.match(esito.dati.errore, /finestra attesa/i);
  assert.equal(sessione.riassunto().catalogoModelliDaRicaricare, true);
  assert.throws(
    () => sessione.invia({ type: "prompt", id: "ancora-dirty", message: "no" }),
    (errore) => errore?.statusHttp === 409,
  );
});

test("l'endpoint allega file salva soltanto payload autenticati e rigorosamente validi", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "progetto-allegati");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200, JSON.stringify(avvio.dati));

  const contenuto = Buffer.from("contenuto allegato \u03c0", "utf8");
  const payload = {
    sessionId: avvio.dati.id,
    nome: "..\\segreto\\rapporto:<Q1>?.txt. ",
    mimeType: "text/plain",
    dimensione: contenuto.length,
    data: contenuto.toString("base64"),
  };
  const senzaToken = await ambiente.post("/api/allega-file", payload, null);
  assert.equal(senzaToken.risposta.status, 403);
  assert.match(senzaToken.dati.errore, /autorizzata/i);

  const sessioneInesistente = await ambiente.post("/api/allega-file", {
    ...payload,
    sessionId: "sessione-inesistente",
  });
  assert.equal(sessioneInesistente.risposta.status, 404);
  ambiente.ponte.sessioni.set("sessione-inattiva", {
    id: "sessione-inattiva",
    proc: null,
    inChiusura: false,
  });
  const sessioneInattiva = await ambiente.post("/api/allega-file", {
    ...payload,
    sessionId: "sessione-inattiva",
  });
  ambiente.ponte.sessioni.delete("sessione-inattiva");
  assert.equal(sessioneInattiva.risposta.status, 409);
  assert.match(sessioneInattiva.dati.errore, /non e attiva/i);

  const salvato = await ambiente.post("/api/allega-file", payload);
  assert.equal(salvato.risposta.status, 200, JSON.stringify(salvato.dati));
  assert.equal(salvato.dati.allegato.tipo, "file");
  assert.match(salvato.dati.allegato.id, /^[0-9a-f-]{36}$/i);
  assert.equal(salvato.dati.allegato.nome, "rapporto__Q1__.txt");
  assert.equal(salvato.dati.allegato.mimeType, "text/plain");
  assert.equal(salvato.dati.allegato.dimensione, contenuto.length);
  assert.equal(isAbsolute(salvato.dati.allegato.percorso), true);
  const radiceAllegati = resolve(ambiente.home, ".pi", "gui", "allegati");
  const scarto = relative(radiceAllegati, resolve(salvato.dati.allegato.percorso));
  assert.equal(scarto === "" || scarto === ".." || scarto.startsWith(".." + sep), false);
  assert.match(scarto, /^[0-9a-f]{64}[\\/][0-9a-f-]{36}-rapporto__Q1__\.txt$/i);
  assert.deepEqual(await readFile(salvato.dati.allegato.percorso), contenuto);

  const riservato = await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome: "C:\\cartella\\CON.txt",
    mimeType: "",
    dimensione: 0,
    data: "",
  });
  assert.equal(riservato.risposta.status, 200, JSON.stringify(riservato.dati));
  assert.equal(riservato.dati.allegato.nome, "_CON.txt");
  assert.equal(riservato.dati.allegato.mimeType, "application/octet-stream");
  assert.deepEqual(await readFile(riservato.dati.allegato.percorso), Buffer.alloc(0));

  const extra = await ambiente.post("/api/allega-file", { ...payload, inatteso: true });
  assert.equal(extra.risposta.status, 400);
  assert.match(extra.dati.errore, /campi/i);
  const mancante = { ...payload };
  delete mancante.mimeType;
  const senzaCampo = await ambiente.post("/api/allega-file", mancante);
  assert.equal(senzaCampo.risposta.status, 400);
  const mimeNonStringa = await ambiente.post("/api/allega-file", { ...payload, mimeType: null });
  assert.equal(mimeNonStringa.risposta.status, 400);

  const base64NonCanonico = await ambiente.post("/api/allega-file", {
    ...payload,
    dimensione: 1,
    data: "YQ",
  });
  assert.equal(base64NonCanonico.risposta.status, 400);
  assert.match(base64NonCanonico.dati.errore, /base64/i);
  const base64Illegale = await ambiente.post("/api/allega-file", {
    ...payload,
    dimensione: 3,
    data: "****",
  });
  assert.equal(base64Illegale.risposta.status, 400);
  const dimensioneDiscorde = await ambiente.post("/api/allega-file", {
    ...payload,
    dimensione: contenuto.length + 1,
  });
  assert.equal(dimensioneDiscorde.risposta.status, 400);
  assert.match(dimensioneDiscorde.dati.errore, /dimensione dichiarata/i);
  const dimensioneNonIntera = await ambiente.post("/api/allega-file", {
    ...payload,
    dimensione: 1.5,
  });
  assert.equal(dimensioneNonIntera.risposta.status, 400);
  const oltreLimiteDichiarato = await ambiente.post("/api/allega-file", {
    ...payload,
    dimensione: 10 * 1024 * 1024 + 1,
  });
  assert.equal(oltreLimiteDichiarato.risposta.status, 413);
  assert.match(oltreLimiteDichiarato.dati.errore, /10 MiB/i);
  const oltreLimiteCodificato = await ambiente.post("/api/allega-file", {
    ...payload,
    dimensione: 10 * 1024 * 1024,
    data: "A".repeat(Math.ceil((10 * 1024 * 1024) / 3) * 4 + 4),
  });
  assert.equal(oltreLimiteCodificato.risposta.status, 413);
  assert.match(oltreLimiteCodificato.dati.errore, /10 MiB/i);
});

test("i file pending si cancellano, mentre un prompt accettato li finalizza in modo irreversibile", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "ciclo-vita-allegati");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessionId = avvio.dati.id;
  const carica = (nome) => ambiente.post("/api/allega-file", {
    sessionId,
    nome,
    mimeType: "text/plain",
    dimensione: 4,
    data: Buffer.from("test").toString("base64"),
  });

  const daRimuovere = (await carica("rimuovi.txt")).dati.allegato;
  assert.match(daRimuovere.token, /^[0-9a-f-]{36}$/i);
  const directory = dirname(daRimuovere.percorso);
  assert.ok((await readdir(directory)).includes(`${daRimuovere.id}.pending.json`));
  const riferimentoRimozione = [{ id: daRimuovere.id, token: daRimuovere.token }];

  const extra = await ambiente.post("/api/gestisci-file-allegati", {
    sessionId,
    azione: "elimina",
    allegati: riferimentoRimozione,
    inatteso: true,
  });
  assert.equal(extra.risposta.status, 400);
  const tokenErrato = daRimuovere.token.slice(0, -1)
    + (daRimuovere.token.endsWith("0") ? "1" : "0");
  const nonProprietario = await ambiente.post("/api/gestisci-file-allegati", {
    sessionId,
    azione: "elimina",
    allegati: [{ id: daRimuovere.id, token: tokenErrato }],
  });
  assert.equal(nonProprietario.risposta.status, 403);
  assert.deepEqual(await readFile(daRimuovere.percorso), Buffer.from("test"));
  const traversal = await ambiente.post("/api/gestisci-file-allegati", {
    sessionId,
    azione: "elimina",
    allegati: [{ id: "../../segreto", token: daRimuovere.token }],
  });
  assert.equal(traversal.risposta.status, 400);

  const eliminato = await ambiente.post("/api/gestisci-file-allegati", {
    sessionId,
    azione: "elimina",
    allegati: riferimentoRimozione,
  });
  assert.equal(eliminato.risposta.status, 200, JSON.stringify(eliminato.dati));
  await assert.rejects(stat(daRimuovere.percorso), { code: "ENOENT" });
  await assert.rejects(stat(join(directory, `${daRimuovere.id}.pending.json`)), { code: "ENOENT" });

  const inviato = (await carica("inviato.txt")).dati.allegato;
  const riferimentoInvio = [{ id: inviato.id, token: inviato.token }];
  const prompt = await ambiente.post("/api/comando", {
    sessionId,
    type: "prompt",
    id: "prompt-con-file",
    message: "Analizza il file allegato",
    piGuiFileRefs: riferimentoInvio,
  }, ambiente.stato.tokenApi, "finestra-allegati");
  assert.equal(prompt.risposta.status, 200, JSON.stringify(prompt.dati));
  assert.equal(prompt.dati.allegatiFinalizzati, undefined);
  assert.ok((await readdir(directory)).includes(`${inviato.id}.final.json`));
  assert.equal((await readdir(directory)).includes(`${inviato.id}.pending.json`), false);

  const eliminaDopoInvio = await ambiente.post("/api/gestisci-file-allegati", {
    sessionId,
    azione: "elimina",
    allegati: riferimentoInvio,
  });
  assert.equal(eliminaDopoInvio.risposta.status, 409);
  assert.match(eliminaDopoInvio.dati.errore, /gia preparato o inviato/i);
  assert.deepEqual(await readFile(inviato.percorso), Buffer.from("test"));

  await ambiente.ponte.sessioni.get(sessionId).ferma({ notifica: false });
  ambiente.ponte.sessioni.delete(sessionId);
  await ambiente.ponte.pulisciFileAllegatiPendentiOrfani(
    Date.now() + 31 * 24 * 60 * 60 * 1000,
    { forza: true },
  );
  assert.deepEqual(await readFile(inviato.percorso), Buffer.from("test"));
});

test("gli allegati restano validi se il profilo usa un alias del percorso canonico", async (t) => {
  const contenitore = await mkdtemp(join(tmpdir(), "pi-gui-home-alias-"));
  const homeReale = join(contenitore, "home-reale");
  const homeAlias = join(contenitore, "home-alias");
  await mkdir(homeReale);
  await symlink(
    homeReale,
    homeAlias,
    process.platform === "win32" ? "junction" : "dir",
  );
  const ambiente = await avviaPonteTest({ home: homeAlias, conservaHome: true });
  t.after(async () => {
    await ambiente.chiudi().catch(() => {});
    await rm(contenitore, { recursive: true, force: true });
  });
  const cartella = join(homeReale, "progetto-alias");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const caricato = await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome: "alias.txt",
    mimeType: "text/plain",
    dimensione: 5,
    data: Buffer.from("alias").toString("base64"),
  });
  assert.equal(caricato.risposta.status, 200, JSON.stringify(caricato.dati));
  const file = caricato.dati.allegato;
  const eliminato = await ambiente.post("/api/gestisci-file-allegati", {
    sessionId: avvio.dati.id,
    azione: "elimina",
    allegati: [{ id: file.id, token: file.token }],
  });
  assert.equal(eliminato.risposta.status, 200, JSON.stringify(eliminato.dati));
  await assert.rejects(stat(file.percorso), { code: "ENOENT" });

  const candidatoTtl = await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome: "alias-ttl.txt",
    mimeType: "text/plain",
    dimensione: 3,
    data: Buffer.from("ttl").toString("base64"),
  });
  assert.equal(candidatoTtl.risposta.status, 200, JSON.stringify(candidatoTtl.dati));
  const fileTtl = candidatoTtl.dati.allegato;
  const pulizia = await ambiente.ponte.pulisciFileAllegatiPendentiOrfani(
    Date.now() + 31 * 24 * 60 * 60 * 1000,
    { forza: true },
  );
  assert.equal(pulizia.eliminati, 1);
  await assert.rejects(stat(fileTtl.percorso), { code: "ENOENT" });
});

test("un pending sopravvive al riavvio del bridge adottandolo con owner e token nuovi", async (t) => {
  const primo = await avviaPonteTest({ conservaHome: true });
  const home = primo.home;
  let secondo = null;
  t.after(async () => {
    if (secondo) await secondo.chiudi().catch(() => {});
    else await primo.chiudi().catch(() => {});
    await rm(home, { recursive: true, force: true });
  });
  const cartella = join(home, "adozione-dopo-restart");
  await mkdir(cartella);
  const avvioA = await primo.post("/api/avvia", { cartella });
  const originale = (await primo.post("/api/allega-file", {
    sessionId: avvioA.dati.id,
    nome: "persistente.txt",
    mimeType: "text/plain",
    dimensione: 7,
    data: Buffer.from("riavvio").toString("base64"),
  })).dati.allegato;
  assert.equal(originale.ownerSessionId, avvioA.dati.id);
  await primo.chiudi();

  secondo = await avviaPonteTest({ home, conservaHome: true });
  const avvioB = await secondo.post("/api/avvia", { cartella });
  const extra = await secondo.post("/api/adotta-file-allegati", {
    sessionId: avvioB.dati.id,
    allegati: [{
      ownerSessionId: originale.ownerSessionId,
      id: originale.id,
      token: originale.token,
    }],
    inatteso: true,
  });
  assert.equal(extra.risposta.status, 400);
  const adozione = await secondo.post("/api/adotta-file-allegati", {
    sessionId: avvioB.dati.id,
    allegati: [{
      ownerSessionId: originale.ownerSessionId,
      id: originale.id,
      token: originale.token,
    }],
  });
  assert.equal(adozione.risposta.status, 200, JSON.stringify(adozione.dati));
  const adottato = adozione.dati.allegati[0];
  assert.equal(adottato.ownerSessionId, avvioB.dati.id);
  assert.notEqual(adottato.id, originale.id);
  assert.notEqual(adottato.token, originale.token);
  assert.deepEqual(await readFile(adottato.percorso), Buffer.from("riavvio"));

  const prompt = await secondo.post("/api/comando", {
    sessionId: avvioB.dati.id,
    type: "prompt",
    id: "prompt-file-adottato",
    message: "usa il file recuperato",
    piGuiFileRefs: [{ id: adottato.id, token: adottato.token }],
  });
  assert.equal(prompt.risposta.status, 200, JSON.stringify(prompt.dati));
  assert.ok((await stat(join(dirname(adottato.percorso), `${adottato.id}.final.json`))).isFile());
});

test("la copia pending di una seconda finestra resta inviabile dopo la rimozione dell'originale", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartellaA = join(ambiente.home, "finestra-a-file");
  const cartellaB = join(ambiente.home, "finestra-b-file");
  await mkdir(cartellaA);
  await mkdir(cartellaB);
  const avvioA = await ambiente.post("/api/avvia", { cartella: cartellaA });
  const avvioB = await ambiente.post("/api/avvia", { cartella: cartellaB });
  const originale = (await ambiente.post("/api/allega-file", {
    sessionId: avvioA.dati.id,
    nome: "condiviso.txt",
    mimeType: "text/plain",
    dimensione: 6,
    data: Buffer.from("copia!").toString("base64"),
  })).dati.allegato;
  const riferimentoOriginale = {
    ownerSessionId: avvioA.dati.id,
    id: originale.id,
    token: originale.token,
  };
  const riferimentoExtra = await ambiente.post("/api/adotta-file-allegati", {
    sessionId: avvioB.dati.id,
    allegati: [{ ...riferimentoOriginale, percorso: originale.percorso }],
  });
  assert.equal(riferimentoExtra.risposta.status, 400);
  const tokenErrato = originale.token.slice(0, -1)
    + (originale.token.endsWith("0") ? "1" : "0");
  const tokenForzato = await ambiente.post("/api/adotta-file-allegati", {
    sessionId: avvioB.dati.id,
    allegati: [{ ...riferimentoOriginale, token: tokenErrato }],
  });
  assert.equal(tokenForzato.risposta.status, 403);
  const ownerForzato = await ambiente.post("/api/adotta-file-allegati", {
    sessionId: avvioB.dati.id,
    allegati: [{ ...riferimentoOriginale, ownerSessionId: "../../altra-sessione" }],
  });
  assert.equal(ownerForzato.risposta.status, 404);
  const adozione = await ambiente.post("/api/adotta-file-allegati", {
    sessionId: avvioB.dati.id,
    allegati: [riferimentoOriginale],
  });
  assert.equal(adozione.risposta.status, 200, JSON.stringify(adozione.dati));
  const copia = adozione.dati.allegati[0];
  assert.notEqual(copia.percorso, originale.percorso);

  const rimozioneA = await ambiente.post("/api/gestisci-file-allegati", {
    sessionId: avvioA.dati.id,
    azione: "elimina",
    allegati: [{ id: originale.id, token: originale.token }],
  });
  assert.equal(rimozioneA.risposta.status, 200, JSON.stringify(rimozioneA.dati));
  await assert.rejects(stat(originale.percorso), { code: "ENOENT" });
  assert.deepEqual(await readFile(copia.percorso), Buffer.from("copia!"));

  const promptB = await ambiente.post("/api/comando", {
    sessionId: avvioB.dati.id,
    type: "prompt",
    id: "prompt-copia-finestra-b",
    message: "usa la copia isolata",
    piGuiFileRefs: [{ id: copia.id, token: copia.token }],
  });
  assert.equal(promptB.risposta.status, 200, JSON.stringify(promptB.dati));
  assert.deepEqual(await readFile(copia.percorso), Buffer.from("copia!"));
});

test("la chiusura elimina i pending soltanto dopo l'arresto riuscito della sessione", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "chiusura-con-pending");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const caricato = await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome: "bozza-da-eliminare.txt",
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  });
  const file = caricato.dati.allegato;
  const manifesto = join(dirname(file.percorso), `${file.id}.pending.json`);
  const chiusura = await ambiente.post("/api/chiudi", {
    sessionId: avvio.dati.id,
    filePendenti: [{ id: file.id, token: file.token }],
  });
  assert.equal(chiusura.risposta.status, 200, JSON.stringify(chiusura.dati));
  assert.equal(ambiente.ponte.sessioni.has(avvio.dati.id), false);
  await assert.rejects(stat(file.percorso), { code: "ENOENT" });
  await assert.rejects(stat(manifesto), { code: "ENOENT" });
});

test("la chiusura riuscita segnala il cleanup parziale senza riaprire una sessione mutilata", async (t) => {
  let idDaFallire = null;
  const ambiente = await avviaPonteTest({
    rimuoviFileAllegato: async (percorso, opzioni) => {
      if (idDaFallire && basename(percorso).startsWith(idDaFallire + "-")) {
        const errore = new Error("rimozione simulata non riuscita");
        errore.code = "EACCES";
        throw errore;
      }
      return rm(percorso, opzioni);
    },
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "chiusura-cleanup-parziale");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const carica = async (nome) => (await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome,
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  })).dati.allegato;
  const primo = await carica("primo.txt");
  const secondo = await carica("secondo.txt");
  idDaFallire = secondo.id;

  const chiusura = await ambiente.post("/api/chiudi", {
    sessionId: avvio.dati.id,
    filePendenti: [primo, secondo].map(({ id, token }) => ({ id, token })),
  });
  assert.equal(chiusura.risposta.status, 200, JSON.stringify(chiusura.dati));
  assert.equal(chiusura.dati.pendingNonEliminati, 1);
  assert.match(chiusura.dati.avviso, /cleanup automatico/i);
  assert.equal(ambiente.ponte.sessioni.has(avvio.dati.id), false);
  await assert.rejects(stat(primo.percorso), { code: "ENOENT" });
  assert.deepEqual(await readFile(secondo.percorso), Buffer.from("x"));
  assert.ok((await stat(join(dirname(secondo.percorso), `${secondo.id}.pending.json`))).isFile());
});

test("una chiusura fallita conserva file e manifesto pending della bozza", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "chiusura-fallita-pending");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const caricato = await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome: "bozza-da-preservare.txt",
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  });
  const file = caricato.dati.allegato;
  const manifesto = join(dirname(file.percorso), `${file.id}.pending.json`);
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const fermaOriginale = sessione.ferma.bind(sessione);
  sessione.ferma = async () => {
    throw new Error("arresto simulato non riuscito");
  };
  const chiusura = await ambiente.post("/api/chiudi", {
    sessionId: avvio.dati.id,
    filePendenti: [{ id: file.id, token: file.token }],
  });
  sessione.ferma = fermaOriginale;

  assert.equal(chiusura.risposta.status, 500, JSON.stringify(chiusura.dati));
  assert.equal(ambiente.ponte.sessioni.has(avvio.dati.id), true);
  assert.deepEqual(await readFile(file.percorso), Buffer.from("x"));
  assert.ok((await stat(manifesto)).isFile());
});

test("la preparazione multi-file torna tutta pending se una rinomina intermedia fallisce", async (t) => {
  let rinominePending = 0;
  const ambiente = await avviaPonteTest({
    rinominaFileAllegato: async (sorgente, destinazione) => {
      if (sorgente.endsWith(".pending.json") && destinazione.endsWith(".prepared.json")) {
        rinominePending += 1;
        if (rinominePending === 2) throw new Error("seconda rinomina simulata non riuscita");
      }
      return rename(sorgente, destinazione);
    },
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "rollback-preparazione-file");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const carica = async (nome) => (await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome,
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  })).dati.allegato;
  const file = [await carica("uno.txt"), await carica("due.txt")];
  const riferimenti = file.map(({ id, token }) => ({ id, token }));
  const prompt = await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "prompt",
    id: "prompt-rollback-file",
    message: "non deve entrare nel canale",
    piGuiFileRefs: riferimenti,
  });
  assert.equal(prompt.risposta.status, 409, JSON.stringify(prompt.dati));
  for (const allegato of file) {
    const voci = await readdir(dirname(allegato.percorso));
    assert.ok(voci.includes(`${allegato.id}.pending.json`));
    assert.equal(voci.includes(`${allegato.id}.prepared.json`), false);
  }
  const eliminazione = await ambiente.post("/api/gestisci-file-allegati", {
    sessionId: avvio.dati.id,
    azione: "elimina",
    allegati: riferimenti,
  });
  assert.equal(eliminazione.risposta.status, 200, JSON.stringify(eliminazione.dati));
});

test("il rollback dell'inoltro ripristina solo i pending preparati dal tentativo corrente", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "rollback-selettivo-file");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const carica = async (nome) => (await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome,
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  })).dati.allegato;
  const giaPreparato = await carica("gia-preparato.txt");
  const preparatoOra = await carica("preparato-ora.txt");
  const directory = dirname(giaPreparato.percorso);
  await rename(
    join(directory, `${giaPreparato.id}.pending.json`),
    join(directory, `${giaPreparato.id}.prepared.json`),
  );

  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  sessione.diffondi({ type: "compaction_start", reason: "test" });
  const prompt = await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "prompt",
    id: "prompt-rollback-selettivo",
    message: "non inoltrare durante la compattazione",
    piGuiFileRefs: [giaPreparato, preparatoOra]
      .map(({ id, token }) => ({ id, token })),
  });
  sessione.diffondi({ type: "compaction_end", aborted: false });

  assert.equal(prompt.risposta.status, 409, JSON.stringify(prompt.dati));
  assert.match(prompt.dati.errore, /compattazione/i);
  let voci = await readdir(directory);
  assert.ok(voci.includes(`${giaPreparato.id}.prepared.json`));
  assert.equal(voci.includes(`${giaPreparato.id}.pending.json`), false);
  assert.ok(voci.includes(`${preparatoOra.id}.pending.json`));
  assert.equal(voci.includes(`${preparatoOra.id}.prepared.json`), false);

  const riconciliazione = await ambiente.ponte.pulisciFileAllegatiPendentiOrfani(
    Date.now(),
    { forza: true },
  );
  assert.equal(riconciliazione.finalizzati, 1);
  voci = await readdir(directory);
  assert.ok(voci.includes(`${giaPreparato.id}.final.json`));
  assert.ok(voci.includes(`${preparatoOra.id}.pending.json`));
});

test("un rollback prepare incompleto viene segnalato e il prepared e riconciliato senza cancellarlo", async (t) => {
  let rinominePending = 0;
  const ambiente = await avviaPonteTest({
    rinominaFileAllegato: async (sorgente, destinazione) => {
      if (sorgente.endsWith(".pending.json") && destinazione.endsWith(".prepared.json")) {
        rinominePending += 1;
        if (rinominePending === 2) throw new Error("forward simulato non riuscito");
      }
      if (sorgente.endsWith(".prepared.json") && destinazione.endsWith(".pending.json")) {
        throw new Error("rollback simulato non riuscito");
      }
      return rename(sorgente, destinazione);
    },
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "rollback-incompleto-file");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const carica = async (nome) => (await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome,
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  })).dati.allegato;
  const file = [await carica("uno.txt"), await carica("due.txt")];
  const riferimenti = file.map(({ id, token }) => ({ id, token }));
  const prompt = await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "prompt",
    id: "prompt-rollback-incompleto",
    message: "non inoltrare",
    piGuiFileRefs: riferimenti,
  });
  assert.equal(prompt.risposta.status, 409, JSON.stringify(prompt.dati));
  assert.match(prompt.dati.errore, /rollback.*non e completo/i);
  const directory = dirname(file[0].percorso);
  assert.ok((await readdir(directory)).includes(`${file[0].id}.prepared.json`));

  const riconciliazione = await ambiente.ponte.pulisciFileAllegatiPendentiOrfani(
    Date.now(),
    { forza: true },
  );
  assert.equal(riconciliazione.finalizzati, 1);
  assert.ok((await readdir(directory)).includes(`${file[0].id}.final.json`));
  assert.deepEqual(await readFile(file[0].percorso), Buffer.from("x"));
});

test("una finalizzazione transitoriamente fallita viene ritentata dal cleanup", async (t) => {
  let fallisciFinalizzazione = true;
  const ambiente = await avviaPonteTest({
    rinominaFileAllegato: async (sorgente, destinazione) => {
      if (
        fallisciFinalizzazione
        && sorgente.endsWith(".prepared.json")
        && destinazione.endsWith(".final.json")
      ) {
        fallisciFinalizzazione = false;
        throw new Error("finalizzazione simulata non riuscita");
      }
      return rename(sorgente, destinazione);
    },
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "retry-finalizzazione-file");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const file = (await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome: "inviato-con-retry.txt",
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  })).dati.allegato;
  const prompt = await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "prompt",
    id: "prompt-finalizzazione-retry",
    message: "invia una volta sola",
    piGuiFileRefs: [{ id: file.id, token: file.token }],
  });
  assert.equal(prompt.risposta.status, 200, JSON.stringify(prompt.dati));
  assert.equal(prompt.dati.allegatiFinalizzati, false);
  const directory = dirname(file.percorso);
  assert.ok((await readdir(directory)).includes(`${file.id}.prepared.json`));

  const riconciliazione = await ambiente.ponte.pulisciFileAllegatiPendentiOrfani(
    Date.now(),
    { forza: true },
  );
  assert.equal(riconciliazione.finalizzati, 1);
  assert.ok((await readdir(directory)).includes(`${file.id}.final.json`));
  assert.equal((await readdir(directory)).includes(`${file.id}.prepared.json`), false);
  assert.deepEqual(await readFile(file.percorso), Buffer.from("x"));
});

test("la quota pending limita count e byte e raccoglie gli orfani scaduti anche a sessione attiva", async (t) => {
  const quotaCount = await avviaPonteTest({
    maxFileAllegatiPendentiPerSessione: 2,
    maxByteFileAllegatiPendentiPerSessione: 100,
  });
  t.after(quotaCount.chiudi);
  const cartellaCount = join(quotaCount.home, "quota-count-file");
  await mkdir(cartellaCount);
  const avvioCount = await quotaCount.post("/api/avvia", { cartella: cartellaCount });
  const payloadCount = {
    sessionId: avvioCount.dati.id,
    nome: "quota.txt",
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  };
  assert.equal((await quotaCount.post("/api/allega-file", payloadCount)).risposta.status, 200);
  assert.equal((await quotaCount.post("/api/allega-file", payloadCount)).risposta.status, 200);
  const oltreCount = await quotaCount.post("/api/allega-file", payloadCount);
  assert.equal(oltreCount.risposta.status, 429, JSON.stringify(oltreCount.dati));

  const quotaByte = await avviaPonteTest({
    maxFileAllegatiPendentiPerSessione: 40,
    maxByteFileAllegatiPendentiPerSessione: 3,
  });
  t.after(quotaByte.chiudi);
  const cartellaByte = join(quotaByte.home, "quota-byte-file");
  await mkdir(cartellaByte);
  const avvioByte = await quotaByte.post("/api/avvia", { cartella: cartellaByte });
  const payloadByte = {
    sessionId: avvioByte.dati.id,
    nome: "quota-byte.txt",
    mimeType: "text/plain",
    dimensione: 2,
    data: "eHg=",
  };
  assert.equal((await quotaByte.post("/api/allega-file", payloadByte)).risposta.status, 200);
  const oltreByte = await quotaByte.post("/api/allega-file", payloadByte);
  assert.equal(oltreByte.risposta.status, 413, JSON.stringify(oltreByte.dati));

  const raccolta = await avviaPonteTest({
    ttlFileAllegatoPendenteMs: 50,
    maxFileAllegatiPendentiPerSessione: 1,
  });
  t.after(raccolta.chiudi);
  const cartellaRaccolta = join(raccolta.home, "raccolta-attiva-file");
  await mkdir(cartellaRaccolta);
  const avvioRaccolta = await raccolta.post("/api/avvia", { cartella: cartellaRaccolta });
  const payloadRaccolta = {
    sessionId: avvioRaccolta.dati.id,
    nome: "orfano.txt",
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  };
  const vecchio = (await raccolta.post("/api/allega-file", payloadRaccolta)).dati.allegato;
  await attendi(80);
  const recente = await raccolta.post("/api/allega-file", {
    ...payloadRaccolta,
    nome: "recente.txt",
  });
  assert.equal(recente.risposta.status, 200, JSON.stringify(recente.dati));
  await assert.rejects(stat(vecchio.percorso), { code: "ENOENT" });
});

test("il cleanup TTL elimina soltanto pending orfani vecchi e conserva le bozze recenti", async (t) => {
  const ambiente = await avviaPonteTest({
    ttlFileAllegatoPendenteMs: 1000,
    intervalloPuliziaFileAllegatiMs: 0,
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "ttl-allegati");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const sessionId = avvio.dati.id;
  const carica = async (nome) => (await ambiente.post("/api/allega-file", {
    sessionId,
    nome,
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  })).dati.allegato;

  const vecchio = await carica("vecchio.txt");
  const recente = await carica("recente.txt");
  const manifestoVecchio = join(dirname(vecchio.percorso), `${vecchio.id}.pending.json`);
  const recordVecchio = JSON.parse(await readFile(manifestoVecchio, "utf8"));
  const istanteVecchio = Date.now() - 2_000;
  await writeFile(manifestoVecchio, JSON.stringify({
    ...recordVecchio,
    creatoIl: istanteVecchio,
    toccatoIl: istanteVecchio,
  }));
  await utimes(manifestoVecchio, new Date(istanteVecchio), new Date(istanteVecchio));
  await ambiente.ponte.sessioni.get(sessionId).ferma({ notifica: false });
  ambiente.ponte.sessioni.delete(sessionId);

  const pulizia = await ambiente.ponte.pulisciFileAllegatiPendentiOrfani(
    Date.now(),
    { forza: true },
  );
  assert.equal(pulizia.eliminati, 1);
  await assert.rejects(stat(vecchio.percorso), { code: "ENOENT" });
  assert.deepEqual(await readFile(recente.percorso), Buffer.from("x"));
  assert.ok((await readdir(dirname(recente.percorso))).includes(`${recente.id}.pending.json`));
});

test("il cleanup parte col ponte e rimuove un pending orfano senza attendere un nuovo upload", async (t) => {
  const primo = await avviaPonteTest({
    conservaHome: true,
    ttlFileAllegatoPendenteMs: 50,
    intervalloPuliziaFileAllegatiMs: 10_000,
  });
  const home = primo.home;
  let secondo = null;
  t.after(async () => {
    if (secondo) await secondo.chiudi().catch(() => {});
    else await primo.chiudi().catch(() => {});
    await rm(home, { recursive: true, force: true });
  });
  const cartella = join(home, "cleanup-avvio-file");
  await mkdir(cartella);
  const avvio = await primo.post("/api/avvia", { cartella });
  const vecchio = (await primo.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome: "orfano-avvio.txt",
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  })).dati.allegato;
  await primo.chiudi();
  await attendi(80);

  secondo = await avviaPonteTest({
    home,
    conservaHome: true,
    ttlFileAllegatoPendenteMs: 50,
    intervalloPuliziaFileAllegatiMs: 10_000,
  });
  const scadenza = Date.now() + 1000;
  while (Date.now() < scadenza) {
    try {
      await stat(vecchio.percorso);
      await attendi(20);
    } catch (errore) {
      if (errore?.code === "ENOENT") break;
      throw errore;
    }
  }
  await assert.rejects(stat(vecchio.percorso), { code: "ENOENT" });
  await assert.rejects(
    stat(join(dirname(vecchio.percorso), `${vecchio.id}.pending.json`)),
    { code: "ENOENT" },
  );
});

test("il timer TTL raccoglie un pending scaduto anche se la sessione resta attiva", async (t) => {
  const ambiente = await avviaPonteTest({
    ttlFileAllegatoPendenteMs: 50,
    intervalloPuliziaFileAllegatiMs: 20,
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "cleanup-attivo-senza-upload");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const vecchio = (await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome: "orfano-sessione-attiva.txt",
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  })).dati.allegato;

  const scadenza = Date.now() + 1000;
  while (Date.now() < scadenza) {
    try {
      await stat(vecchio.percorso);
      await attendi(20);
    } catch (errore) {
      if (errore?.code === "ENOENT") break;
      throw errore;
    }
  }
  assert.equal(ambiente.ponte.sessioni.has(avvio.dati.id), true);
  await assert.rejects(stat(vecchio.percorso), { code: "ENOENT" });
  await assert.rejects(
    stat(join(dirname(vecchio.percorso), `${vecchio.id}.pending.json`)),
    { code: "ENOENT" },
  );
});

test("una junction non puo spostare gli upload fuori dalla radice della sessione", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "symlink-allegati");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  const radice = join(ambiente.home, ".pi", "gui", "allegati");
  const esterna = join(ambiente.home, "fuori-radice-allegati");
  await mkdir(radice, { recursive: true });
  await mkdir(esterna);
  const hashSessione = createHash("sha256").update(avvio.dati.id, "utf8").digest("hex");
  await symlink(esterna, join(radice, hashSessione), process.platform === "win32" ? "junction" : "dir");

  const esito = await ambiente.post("/api/allega-file", {
    sessionId: avvio.dati.id,
    nome: "evasione.txt",
    mimeType: "text/plain",
    dimensione: 1,
    data: "eA==",
  });
  assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
  assert.match(esito.dati.errore, /non e sicura/i);
  assert.deepEqual(await readdir(esterna), []);
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
  assert.equal(ambiente.stato.versione, 7);
  const salute = await (await fetch(ambiente.base + "/api/salute")).json();
  assert.deepEqual(salute, { servizio: "pi-gui-bridge", versione: 7 });
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
  await mkdir(cartella);

  const primaPromessa = ambiente.post("/api/avvia", { cartella, forzaNuova: true });
  await attendi(30);
  const sessioneInAvvio = [...ambiente.ponte.sessioni.values()][0];
  assert.ok(sessioneInAvvio, "la prima sessione deve aver prenotato il proprio identificativo");
  const fileSessione = join(cartella, `fake-session-${sessioneInAvvio.id}.jsonl`);
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

test("l'albero usa il leaf autorevole di Pi dopo una navigazione senza append", async (t) => {
  const ambiente = await avviaPonteTest({
    caricaAlbero: async () => ({
      nodi: [
        { id: "n-old", parentId: null, type: "message", descrizione: "nodo precedente", profondita: 0 },
        { id: "n-new", parentId: "n-old", type: "message", descrizione: "ultima riga append", profondita: 1 },
      ],
      leafId: "n-new",
      totale: 2,
    }),
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "leaf-autorevole");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200);

  const albero = await ambiente.post("/api/albero", { sessionId: avvio.dati.id });
  assert.equal(albero.risposta.status, 200);
  assert.equal(albero.dati.leafId, "n-old");
  assert.equal(albero.dati.totale, 2);
});

test("l'endpoint mappa un leaf tecnico autorevole sul suo antenato visibile", async (t) => {
  const ambiente = await avviaPonteTest({
    caricaAlbero: ({ fileSessione }) => caricaAlberoCompattoDaPi({
      cliPi: CLI_PI_REALE,
      fileSessione,
    }),
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "leaf-tecnico");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200);
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const voci = [
    { type: "session", version: 3, id: "sessione-leaf-tecnico", timestamp: "2026-08-25T00:00:00.000Z", cwd: cartella },
    { type: "message", id: "u1", parentId: null, timestamp: "2026-08-25T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "Punto visibile" }], timestamp: 1 } },
    { type: "model_change", id: "tecnico-leaf", parentId: "u1", timestamp: "2026-08-25T00:00:02.000Z", provider: "test", modelId: "test" },
  ];
  await writeFile(sessione.fileSessione, voci.map((voce) => JSON.stringify(voce)).join("\n") + "\n", "utf8");

  const albero = await ambiente.post("/api/albero", { sessionId: avvio.dati.id });

  assert.equal(albero.risposta.status, 200);
  assert.equal(albero.dati.leafId, "u1");
  assert.equal(albero.dati.totale, 1);
  assert.equal(albero.dati.tecniciNascosti, 1);
  assert.equal(sessione.leafIdAttivo, "tecnico-leaf");
});

test("dopo navigate_tree anche la cronologia segue il leaf autorevole", async (t) => {
  const leafRicevuti = [];
  const ambiente = await avviaPonteTest({
    caricaAlbero: async () => ({
      nodi: [
        { id: "n-old", parentId: null, type: "message", descrizione: "ramo scelto", profondita: 0 },
        { id: "n-new", parentId: "n-old", type: "message", descrizione: "ultimo append", profondita: 1 },
      ],
      leafId: "n-new",
      totale: 2,
    }),
    caricaCronologia: async ({ leafId }) => {
      leafRicevuti.push(leafId);
      return [];
    },
  });
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "leaf-cronologia");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200);

  const albero = await ambiente.post("/api/albero", { sessionId: avvio.dati.id });
  assert.equal(albero.risposta.status, 200);
  assert.equal(albero.dati.leafId, "n-new");
  const navigazione = await ambiente.post("/api/comando", {
    sessionId: avvio.dati.id,
    type: "navigate_tree",
    entryId: "n-old",
    options: { summarize: false },
  });
  assert.equal(navigazione.risposta.status, 200);
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  const scadenza = Date.now() + 1500;
  while (sessione.cambioSessioneInCorso && Date.now() < scadenza) await attendi(20);
  assert.equal(sessione.cambioSessioneInCorso, false);

  const cronologia = await fetch(ambiente.base + "/api/cronologia", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-gui-token": ambiente.stato.tokenApi,
    },
    body: JSON.stringify({ sessionId: avvio.dati.id }),
  });
  assert.equal(cronologia.status, 200);
  await cronologia.text();
  assert.equal(leafRicevuti.at(-1), "n-old");
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

test("forzaNuova apre processi distinti nella stessa cartella ma con JSONL distinti", async (t) => {
  const ambiente = await avviaPonteTest();
  t.after(ambiente.chiudi);
  const cartella = join(ambiente.home, "progetto-sessioni-parallele");
  await mkdir(cartella);

  const prima = await ambiente.post("/api/avvia", { cartella, forzaNuova: true });
  const seconda = await ambiente.post("/api/avvia", { cartella, forzaNuova: true });

  assert.equal(prima.risposta.status, 200, JSON.stringify(prima.dati));
  assert.equal(seconda.risposta.status, 200, JSON.stringify(seconda.dati));
  assert.notEqual(seconda.dati.id, prima.dati.id);
  const primaSessione = ambiente.ponte.sessioni.get(prima.dati.id);
  const secondaSessione = ambiente.ponte.sessioni.get(seconda.dati.id);
  assert.equal(primaSessione.cartella, secondaSessione.cartella);
  assert.notEqual(primaSessione.fileSessione, secondaSessione.fileSessione);
  assert.equal([...ambiente.ponte.sessioni.values()].filter((sessione) => sessione.proc).length, 2);
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
    versione: 7,
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
  // La risposta HTTP conferma l'accettazione della scelta; l'ack RPC del fake
  // puo arrivare nel tick immediatamente successivo. Attendiamo il vero drain
  // invece di dipendere dalla velocita dello scheduler Windows.
  const scadenzaRevisioni = Date.now() + 2000;
  while (sessione.revisioniComandi.size && Date.now() < scadenzaRevisioni) {
    await attendi(10);
  }
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
