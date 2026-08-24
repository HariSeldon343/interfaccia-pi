import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { creaPonte, verificaProviderLocale } from "../app/server.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = dirname(QUI);
const FAKE_PI = join(QUI, "fake-pi.mjs");

async function homeTemporanea(t, prefisso, { pulisci = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), prefisso));
  if (pulisci) t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

async function scriviModelli(home, providers) {
  const cartella = join(home, ".pi", "agent");
  await mkdir(cartella, { recursive: true });
  await writeFile(join(cartella, "models.json"), JSON.stringify({ providers }), "utf8");
}

async function avviaPonteTest(t, opzioni = {}) {
  const home = await homeTemporanea(t, "pi-gui-provider-", { pulisci: false });
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
    elencaDiscendenti: async () => [],
    terminaDiscendenti: async () => true,
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
  t.after(async () => {
    await ponte.chiudiTutto();
    if (ponte.server.listening) {
      await new Promise((risolvi) => ponte.server.close(() => risolvi()));
    }
    await rm(home, { recursive: true, force: true });
  });
  const indirizzo = ponte.server.address();
  const base = `http://127.0.0.1:${indirizzo.port}`;
  const stato = await (await fetch(base + "/api/stato")).json();
  const post = async (via, corpo) => {
    const risposta = await fetch(base + via, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-gui-token": stato.tokenApi,
      },
      body: JSON.stringify(corpo),
    });
    return { risposta, dati: await risposta.json() };
  };
  return { home, ponte, post };
}

function corpoFunzione(sorgente, nome) {
  const inizio = sorgente.indexOf(`function ${nome}(`);
  assert.notEqual(inizio, -1, `manca la funzione ${nome}`);
  const aperturaParametri = sorgente.indexOf("(", inizio);
  let profonditaParametri = 0;
  let fineParametri = -1;
  for (let indice = aperturaParametri; indice < sorgente.length; indice += 1) {
    if (sorgente[indice] === "(") profonditaParametri += 1;
    if (sorgente[indice] === ")") profonditaParametri -= 1;
    if (profonditaParametri === 0) {
      fineParametri = indice;
      break;
    }
  }
  assert.notEqual(fineParametri, -1, `la firma di ${nome} non e chiusa`);
  const apertura = sorgente.indexOf("{", fineParametri);
  let profondita = 0;
  for (let indice = apertura; indice < sorgente.length; indice += 1) {
    if (sorgente[indice] === "{") profondita += 1;
    if (sorgente[indice] === "}") profondita -= 1;
    if (profondita === 0) return sorgente.slice(apertura + 1, indice);
  }
  assert.fail(`la funzione ${nome} non e chiusa`);
}

test("verificaProviderLocale interroga LM Studio su /v1/models e accetta una risposta sana", async (t) => {
  const home = await homeTemporanea(t, "pi-gui-lmstudio-");
  await scriviModelli(home, {
    lmstudio: { baseUrl: "http://127.0.0.1:1234/v1" },
  });
  const chiamate = [];
  let corpoAnnullato = false;
  const esito = await verificaProviderLocale({
    home,
    provider: "lmstudio",
    timeoutMs: 321,
    fetchImpl: async (url, opzioni) => {
      chiamate.push({ url: String(url), opzioni });
      return {
        ok: true,
        status: 200,
        body: { cancel: async () => { corpoAnnullato = true; } },
      };
    },
  });

  assert.deepEqual(esito, {
    controllato: true,
    disponibile: true,
    provider: "lmstudio",
    nome: "LM Studio",
    motivo: null,
  });
  assert.equal(chiamate.length, 1);
  assert.equal(chiamate[0].url, "http://127.0.0.1:1234/v1/models");
  assert.equal(chiamate[0].opzioni.method, "GET");
  assert.equal(chiamate[0].opzioni.headers.accept, "application/json");
  assert.equal(chiamate[0].opzioni.redirect, "error");
  assert.ok(chiamate[0].opzioni.signal instanceof AbortSignal);
  assert.equal(corpoAnnullato, true);
});

test("verificaProviderLocale rifiuta una baseUrl non loopback senza effettuare fetch", async (t) => {
  const home = await homeTemporanea(t, "pi-gui-provider-remoto-");
  await scriviModelli(home, {
    lmstudio: { baseUrl: "http://192.0.2.20:1234/v1" },
  });
  let chiamate = 0;
  const esito = await verificaProviderLocale({
    home,
    provider: "lmstudio",
    fetchImpl: async () => {
      chiamate += 1;
      return { ok: true, status: 200 };
    },
  });

  assert.equal(chiamate, 0, "un endpoint non loopback non deve mai ricevere il probe");
  assert.deepEqual(esito, {
    controllato: true,
    disponibile: false,
    provider: "lmstudio",
    nome: "LM Studio",
    motivo: "configurazione",
  });
});

test("un prompt verso un provider locale spento riceve 503 prima di stdin, ma set_model resta possibile", async (t) => {
  const providerControllati = [];
  const ambiente = await avviaPonteTest(t, {
    verificaProvider: async ({ provider }) => {
      providerControllati.push(provider);
      return {
        controllato: true,
        disponibile: false,
        provider,
        nome: provider === "ollama" ? "Ollama" : provider,
        motivo: "connessione",
      };
    },
  });
  const cartella = join(ambiente.home, "sessione-provider-spento");
  await mkdir(cartella);
  const avvio = await ambiente.post("/api/avvia", { cartella });
  assert.equal(avvio.risposta.status, 200, avvio.dati.errore || "avvio della sessione fallito");
  const sessione = ambiente.ponte.sessioni.get(avvio.dati.id);
  assert.ok(sessione?.proc?.stdin);
  sessione.provider = "ollama";

  const scritturaOriginale = sessione.proc.stdin.write.bind(sessione.proc.stdin);
  let scrittureStdin = 0;
  sessione.proc.stdin.write = (...argomenti) => {
    scrittureStdin += 1;
    return scritturaOriginale(...argomenti);
  };

  const prompt = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "prompt",
    message: "non deve raggiungere pi",
  });
  assert.equal(prompt.risposta.status, 503);
  assert.match(prompt.dati.errore, /Ollama non risponde.*11434/i);
  assert.equal(scrittureStdin, 0, "il guard deve fermare il prompt prima della RPC stdin");
  assert.deepEqual(providerControllati, ["ollama"]);

  const cambio = await ambiente.post("/api/comando", {
    sessionId: sessione.id,
    type: "set_model",
    provider: "lmstudio",
    modelId: "gemma-4-31b-it",
  });
  assert.equal(cambio.risposta.status, 200);
  assert.ok(scrittureStdin > 0, "set_model deve continuare a raggiungere PI");
  assert.deepEqual(providerControllati, ["ollama"], "set_model non deve essere preflightato");

  const messaggi = await sessione.inviaEAttendi({ type: "get_messages" });
  assert.deepEqual(messaggi.messages, [], "il prompt rifiutato non deve comparire nella cronologia PI");
});

test("il frontend spiega per provider gli errori di connessione e sopprime i duplicati", async () => {
  const frontend = await readFile(join(RADICE, "app", "public", "app.js"), "utf8");
  const spiegazione = corpoFunzione(frontend, "spiegaErrorePi");
  for (const [provider, testo] of [
    ["ollama", /Ollama non risponde sulla porta locale 11434/],
    ["lmstudio", /LM Studio non risponde sulla porta locale 1234/],
    ["llama.cpp", /llama\.cpp non risponde sulla porta locale 8080/],
  ]) {
    assert.match(spiegazione, new RegExp(`sessione\\?\\.provider === ["']${provider.replace(".", "\\.")}["']`));
    assert.match(spiegazione, testo);
  }
  assert.match(spiegazione, /connection error|econnrefused/i);
  assert.match(spiegazione, /LM Studio e Ollama sono servizi diversi/i);

  const dedup = corpoFunzione(frontend, "mostraErrorePi");
  assert.match(dedup, /spiegaErrorePi\(errore,\s*sessione\)/);
  assert.match(dedup, /ultimoErrorePi\s*===\s*firma/);
  assert.match(dedup, /adesso\s*-\s*sessione\.ultimoErrorePiIl\s*<\s*45_000/);
  assert.match(dedup, /return false/);
  assert.match(dedup, /aggiungiMessaggio\(sessione,\s*["']errore["'],\s*messaggio/);
  assert.ok(
    dedup.indexOf("return false") < dedup.indexOf("aggiungiMessaggio"),
    "il duplicato deve essere scartato prima di creare la card",
  );

  const inizioErrore = frontend.indexOf('} else if (evento.type === "gui_errore")');
  const fineErrore = frontend.indexOf("} else if", inizioErrore + 12);
  const ramoErrore = frontend.slice(inizioErrore, fineErrore);
  assert.match(ramoErrore, /mostraErrorePi\(sessione,\s*evento\.messaggio\)/);
  assert.doesNotMatch(ramoErrore, /aggiungiMessaggio/,
    "gli errori retry devono attraversare il deduplicatore comune");
});

test("il picker rende non selezionabili i provider locali offline e mostra uno stato leggibile", async () => {
  const frontend = await readFile(join(RADICE, "app", "public", "app.js"), "utf8");
  const picker = corpoFunzione(frontend, "apriSceltaModello");
  const preparazione = corpoFunzione(frontend, "preparaCatalogoModelliDinamico");
  assert.match(preparazione, /chiedi\(["']\/api\/provider-locali["']/,
    "il picker deve chiedere lo stato reale dei provider locali");
  assert.match(picker, /statoProvider\?\.controllato\s*&&\s*!statoProvider\.disponibile/);
  assert.match(picker, /bottone\.disabled\s*=\s*nonDisponibile/);
  assert.match(picker, /classList\.add\(["']provider-offline["']\)/);
  assert.match(picker, /["']non attivo["']/);
  assert.match(picker, /dettaglioModello\(modello,\s*statoProvider\)/);

  const dettaglio = corpoFunzione(frontend, "dettaglioModello");
  assert.match(dettaglio, /statoProvider\.disponibile\s*\?\s*["']pronto["']\s*:\s*["']non in esecuzione["']/);
});
