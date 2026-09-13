import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { creaPonte } from "../app/server.mjs";
import {
  creaArchivioConsigli,
  lavoroPerDisco,
  RITENZIONE_LAVORI_MS,
} from "../app/consiglio-store.mjs";
import {
  creaGestoreConsiglio,
  improntaFileCanonica,
  percorsiDaRipristinare,
  rilevaPianoTest,
  secondiAttesaDaErrore,
  sembraLimiteRichieste,
} from "../app/consiglio.mjs";
import { normalizzaPianoManuale } from "../app/consiglio-controlli.mjs";
import { applicaOperazionePreimpostazioni, inizializzaPreimpostazioni } from "../app/consiglio-preimpostazioni.mjs";

async function elencoAgenti(ambiente) {
  return (await ambiente.ponte.consiglio.preimpostazioni(null, { sourceSessionId: ambiente.sorgenteId })).corpo;
}

async function configuraAgenti(ambiente, { nome = "Due assegnazioni", inversa = false, tipo = "testo", soloScrittore = false } = {}) {
  const elenco = await elencoAgenti(ambiente);
  assert.equal(elenco.catalogo.length, 2, "con un solo modello la prova del congelamento non sarebbe significativa");
  const coppia = (indice) => ({ provider: elenco.catalogo[indice].provider, modelId: elenco.catalogo[indice].modelId });
  const ordine = soloScrittore ? ["scrittore"] : ["consigliere-1", "scrittore"];
  const esito = await ambiente.ponte.consiglio.preimpostazioni({
    azione: "crea", versioneArchivioAttesa: elenco.archivio.versioneArchivio,
    preimpostazione: { nome, tipo, istruzioni: "Mantieni i dubbi e le priorità.", ordine,
      livello: Object.fromEntries(ordine.map((id) => [id, id === "scrittore" ? "high" : "low"])),
      assegnazioni: Object.fromEntries(ordine.map((id) => [id, coppia((id === "scrittore") !== inversa ? 1 : 0)])),
    },
  });
  return esito.corpo.archivio.preimpostazioni.at(-1);
}

const riferimentoAgenti = (voce) => ({ id: voce.id, versione: voce.versione });

test("il gestore riceve le preimpostazioni dal ponte e non legge il disco da solo", async () => {
  let archivio = inizializzaPreimpostazioni();
  let letture = 0;
  let scritture = 0;
  const gestore = creaGestoreConsiglio({
    acquisisciMutazione: async () => () => {},
    leggiPreimpostazioni: async () => { letture += 1; return structuredClone(archivio); },
    salvaPreimpostazioni: async (operazione) => { scritture += 1; return archivio = applicaOperazionePreimpostazioni(archivio, operazione); },
    catalogoModelli: async () => [], descriviSessioneSorgente: () => null,
    leggiConfigurazioneRuoli: () => { throw new Error("Non leggere ruoli globali"); },
    leggiFile: () => { throw new Error("Non leggere file"); },
  });
  const letto = await gestore.preimpostazioni();
  assert.deepEqual(letto.corpo.archivio, archivio);
  assert.equal(letture, 1);
  const voce = archivio.preimpostazioni[1];
  const salvato = await gestore.preimpostazioni({ azione: "predefinita", id: voce.id, versioneAttesa: voce.versione, versioneArchivioAttesa: archivio.versioneArchivio });
  assert.equal(salvato.corpo.archivio.predefinita, voce.id);
  assert.equal(scritture, 1);
  assert.equal(letture, 1);
});

test("l'endpoint delle preimpostazioni rifiuta campi non previsti e risponde 409 sulla versione superata", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { senzaSorgente: true });
  const via = "/api/consiglio/preimpostazioni";
  const headers = { "x-pi-gui-token": ambiente.stato.tokenApi };
  assert.equal((await fetch(ambiente.base + via)).status, 403);
  assert.equal((await fetch(ambiente.base + via, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 403);
  const risposta = await fetch(ambiente.base + via, { headers });
  assert.equal(risposta.status, 200);
  const iniziale = await risposta.json();
  assert.deepEqual(iniziale.catalogo, []);
  assert.equal(iniziale.risoluzioni.every((voce) => !voce.avvioPossibile), true);
  assert.equal((await fetch(ambiente.base + via + "?intruso=true", { headers })).status, 400);
  assert.equal((await fetch(ambiente.base + via, { method: "DELETE", headers })).status, 405);
  for (const corpo of [null, [], { azione: "crea", versioneArchivioAttesa: 1, preimpostazione: { nome: "Incompleta" } }]) {
    assert.equal((await ambiente.post(via, corpo)).risposta.status, 400);
  }
  const archivio = iniziale.archivio;
  const voce = archivio.preimpostazioni[0];
  const operazione = { azione: "predefinita", id: voce.id, versioneAttesa: voce.versione, versioneArchivioAttesa: archivio.versioneArchivio };
  const file = join(ambiente.home, ".pi", "gui", "preimpostazioni-agenti.json");
  const prima = await readFile(file, "utf8");
  assert.equal((await ambiente.post(via, { ...operazione, consenso: true })).risposta.status, 400);
  assert.equal(await readFile(file, "utf8"), prima);
  assert.equal((await ambiente.post(via, operazione)).risposta.status, 200);
  const scritto = await readFile(file, "utf8");
  const conflitto = await ambiente.post(via, operazione);
  assert.equal(conflitto.risposta.status, 409, JSON.stringify(conflitto.dati));
  assert.equal(conflitto.dati.codice, "preimpostazione-conflitto");
  assert.equal(await readFile(file, "utf8"), scritto);
});

test("l'avvio con preimpostazione congela le assegnazioni e senza il campo si comporta come prima", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-catalogo-due", maxSessioni: 6 });
  const preset = await configuraAgenti(ambiente);
  const { avvio, finale } = await avviaEAttendi(ambiente, { preimpostazione: riferimentoAgenti(preset), istruzioni: "Un testo estraneo non sostituisce le istruzioni salvate." });
  assert.deepEqual(finale.ruoli.map((voce) => voce.modello), [preset.assegnazioni["consigliere-1"].modelId, preset.assegnazioni.scrittore.modelId]);
  assert.notEqual(finale.ruoli[0].modello, finale.ruoli[1].modello);
  assert.deepEqual(finale.lavoro.preimpostazione, { ...riferimentoAgenti(preset), nome: preset.nome });
  assert.deepEqual(ambiente.ponte.consiglio.schede().find((voce) => voce.consiglio.lavoroId === avvio.lavoroId).consiglio.preimpostazione, finale.lavoro.preimpostazione);
  const disco = JSON.parse(await readFile(join(ambiente.home, ".pi", "gui", "consigli", avvio.lavoroId + ".json"), "utf8"));
  assert.deepEqual(disco.preimpostazione, preset);
  assert.deepEqual(disco.assegnazioniCongelate.map((ruolo) => ruolo.thinking), ["low", "high"]);
  assert.deepEqual(disco.assegnazioniCongelate.map((ruolo) => ruolo.roleId), preset.ordine);
  assert.equal(disco.revisioni[0].istruzioni, preset.istruzioni);
  const legacy = await ambiente.ponte.consiglio.ruoli(null, { sourceSessionId: ambiente.sorgenteId });
  const tradizionale = await avviaEAttendi(ambiente);
  assert.equal(tradizionale.finale.lavoro.preimpostazione, null);
  assert.deepEqual(tradizionale.finale.ruoli.map((voce) => voce.modello), [legacy.corpo.effettive.consiglieri[0].modello, legacy.corpo.effettive.scrittore.modello]);
});

test("due avvii concorrenti con preset diversi non aprono lavori misti e il replay di un lavoro concluso risponde senza riaprire nulla", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-catalogo-due", maxSessioni: 6 });
  const a = await configuraAgenti(ambiente, { nome: "Primo" });
  const b = await configuraAgenti(ambiente, { nome: "Secondo", inversa: true });
  const corpi = [a, b].map((voce) => corpoAvvio(ambiente, { preimpostazione: riferimentoAgenti(voce) }));
  const avvii = await Promise.all(corpi.map((corpo) => ambiente.post("/api/consiglio/avvia", corpo)));
  for (const [indice, esito] of avvii.entries()) {
    assert.equal(esito.risposta.status, 202, JSON.stringify(esito.dati));
    const preset = [a, b][indice];
    assert.deepEqual(esito.dati.ruoli.map((voce) => voce.modello), preset.ordine.map((id) => preset.assegnazioni[id].modelId));
    await attendiStato(ambiente, esito.dati.lavoroId, ["bozza_valida"]);
  }
  assert.notEqual(avvii[0].dati.lavoroId, avvii[1].dati.lavoroId);
  const elenco = await elencoAgenti(ambiente);
  await ambiente.ponte.consiglio.preimpostazioni({ azione: "elimina", id: a.id, versioneAttesa: a.versione, versioneArchivioAttesa: elenco.archivio.versioneArchivio });
  const prima = ambiente.ponte.sessioni.size;
  const replay = await ambiente.post("/api/consiglio/avvia", corpi[0]);
  assert.equal(replay.risposta.status, 202, JSON.stringify(replay.dati));
  assert.equal(replay.dati.lavoroId, avvii[0].dati.lavoroId);
  assert.equal(ambiente.ponte.sessioni.size, prima);
  assert.equal(ambiente.ponte.consiglio.lavori.size, 2);
  const diverso = await ambiente.post("/api/consiglio/avvia", { ...corpi[0], preimpostazione: riferimentoAgenti(b) });
  assert.equal(diverso.risposta.status, 409);
  assert.equal(ambiente.ponte.sessioni.size, prima);
});

test("rifai riusa le assegnazioni congelate e non rilegge i ruoli globali", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-catalogo-due", maxSessioni: 6 });
  const preset = await configuraAgenti(ambiente);
  const { avvio, finale } = await avviaEAttendi(ambiente, { preimpostazione: riferimentoAgenti(preset) });
  const ruoli = await ambiente.ponte.consiglio.ruoli(null, { sourceSessionId: ambiente.sorgenteId });
  const globale = await ambiente.ponte.consiglio.ruoli({ expectedVersion: ruoli.corpo.version,
    consiglieri: Array.from({ length: 4 }, (_, i) => ({ roleId: `nuovo-${i}`, thinking: null, model: preset.assegnazioni.scrittore })),
    scrittore: { roleId: "scrittore", thinking: "minimal", model: preset.assegnazioni["consigliere-1"] },
  }, { sourceSessionId: ambiente.sorgenteId });
  assert.equal(globale.corpo.effettive.consiglieri.length, 4);
  const elenco = await elencoAgenti(ambiente);
  await ambiente.ponte.consiglio.preimpostazioni({ azione: "elimina", id: preset.id, versioneAttesa: preset.versione, versioneArchivioAttesa: elenco.archivio.versioneArchivio });
  const rifatto = await ambiente.post("/api/consiglio/rifai", { lavoroId: avvio.lavoroId, revisioneAttesa: 1 });
  assert.equal(rifatto.risposta.status, 202, JSON.stringify(rifatto.dati));
  const seconda = await attendiStato(ambiente, avvio.lavoroId, ["bozza_valida"]);
  assert.deepEqual(seconda.ruoli.map(({ roleId, modello, ordine }) => ({ roleId, modello, ordine })), finale.ruoli.map(({ roleId, modello, ordine }) => ({ roleId, modello, ordine })));
  assert.equal(seconda.ruoli.length, 2);
  assert.deepEqual(ambiente.ponte.consiglio.lavori.get(avvio.lavoroId).ruoli.map((voce) => voce.thinking), ["low", "high"]);
  assert.equal(ambiente.ponte.consiglio.postiPrenotati(), 0);
});

test("preimpostazione superata o posti insufficienti non aprono nessuna sessione", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-catalogo-due", maxSessioni: 4 });
  const preset = await configuraAgenti(ambiente);
  const prima = ambiente.ponte.sessioni.size;
  const superata = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente, { preimpostazione: { id: preset.id, versione: preset.versione + 1 } }));
  assert.equal(superata.risposta.status, 409);
  assert.equal(superata.dati.codice, "versione-superata");
  const pieno = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente, { preimpostazione: { id: "tre-consiglieri", versione: 1 } }));
  assert.equal(pieno.risposta.status, 409);
  assert.equal(pieno.dati.codice, "posti-insufficienti");
  assert.equal(ambiente.ponte.sessioni.size, prima);
  assert.equal(ambiente.ponte.consiglio.lavori.size, 0);
});

test("il piano cambiato durante il consenso della preimpostazione blocca prima delle aperture", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-catalogo-due", maxSessioni: 6 });
  const preset = await configuraAgenti(ambiente, { tipo: "codice" });
  const file = join(ambiente.cartellaLavoro, "package.json");
  await writeFile(file, JSON.stringify({ scripts: { test: "node --test" } }));
  const corpo = corpoAvvio(ambiente, { tipo: "codice", preimpostazione: riferimentoAgenti(preset) });
  const conferma = await ambiente.post("/api/consiglio/avvia", corpo);
  assert.equal(conferma.risposta.status, 409);
  assert.equal(conferma.dati.codice, "consenso-mancante");
  await writeFile(file, JSON.stringify({ scripts: { test: "node --test test-nuovo.mjs" } }));
  const cambiato = await ambiente.post("/api/consiglio/avvia", { ...corpo, consenso: true });
  assert.equal(cambiato.risposta.status, 409, JSON.stringify(cambiato.dati));
  assert.equal(cambiato.dati.codice, "consenso-superato");
  assert.equal(ambiente.ponte.sessioni.size, 1);
  assert.equal(ambiente.ponte.consiglio.lavori.size, 0);
});

test("una preimpostazione solo scrittore apre un solo ruolo e rifai prenota un solo posto", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-catalogo-due", maxSessioni: 2 });
  const preset = await configuraAgenti(ambiente, { nome: "Solo scrittore", soloScrittore: true });
  const { avvio, finale } = await avviaEAttendi(ambiente, { preimpostazione: riferimentoAgenti(preset) });
  assert.equal(finale.lavoro.stato, "bozza_valida");
  assert.equal(finale.ruoli.length, 1);
  assert.equal(finale.ruoli[0].tipo, "scrittore");
  assert.equal(ambiente.conf.componiChiamate, 1);
  const rifatto = await ambiente.post("/api/consiglio/rifai", { lavoroId: avvio.lavoroId, revisioneAttesa: 1 });
  assert.equal(rifatto.risposta.status, 202, JSON.stringify(rifatto.dati));
  await attendiStato(ambiente, avvio.lavoroId, ["bozza_valida"]);
  assert.equal(ambiente.ponte.consiglio.postiPrenotati(), 0);
});

test("la migrazione del ponte conserva i ruoli 2.8 e non rinasce dopo una modifica", async (t) => {
  const configurazione = { schemaVersion: 1, version: 3,
    consiglieri: [{ roleId: "consigliere-1", model: null, thinking: "medium" }],
    scrittore: { roleId: "scrittore", model: null, thinking: "medium" },
  };
  const ambiente = await avviaPonteConsiglio(t, { senzaSorgente: true, primaDelPonte: async ({ home }) => {
    await mkdir(join(home, ".pi", "gui"), { recursive: true });
    await writeFile(join(home, ".pi", "gui", "impostazioni.json"), JSON.stringify({ consiglio: configurazione }));
  } });
  const primo = await elencoAgenti(ambiente);
  assert.equal(primo.archivio.preimpostazioni[0].nome, "Il mio consiglio");
  assert.equal(primo.archivio.predefinita, primo.archivio.preimpostazioni[0].id);
  assert.deepEqual(JSON.parse(await readFile(join(ambiente.home, ".pi", "gui", "impostazioni.json"), "utf8")).consiglio, configurazione);
  assert.deepEqual((await elencoAgenti(ambiente)).archivio, primo.archivio);
});

test("il modello assente blocca la preimpostazione e il catalogo cambiato invalida il consenso", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-catalogo-due", maxSessioni: 6 });
  const preset = await configuraAgenti(ambiente, { tipo: "codice" });
  const corpo = corpoAvvio(ambiente, { tipo: "codice", preimpostazione: riferimentoAgenti(preset) });
  const conferma = await ambiente.post("/api/consiglio/avvia", corpo);
  assert.equal(conferma.dati.codice, "consenso-mancante");
  const s = ambiente.ponte.sessioni.get(ambiente.sorgenteId);
  const invia = s.inviaEAttendi.bind(s);
  let inverti = false;
  s.inviaEAttendi = async (comando, ...resto) => {
    const esito = await invia(comando, ...resto);
    if (comando.type !== "get_available_models") return esito;
    return { ...esito, models: inverti ? [...esito.models].reverse() : esito.models.slice(0, 1) };
  };
  const mancante = await elencoAgenti(ambiente);
  const risolto = mancante.risoluzioni.find((voce) => voce.id === preset.id);
  assert.equal(risolto.avvioPossibile, false);
  assert.equal(risolto.effettive.scrittore.modello, null, "nessuna sostituzione silenziosa");
  const rifiuto = await ambiente.post("/api/consiglio/avvia", { ...corpo, consenso: true });
  assert.equal(rifiuto.risposta.status, 409);
  assert.equal(rifiuto.dati.codice, "ruoli-non-risolvibili");
  inverti = true;
  const elenco = await elencoAgenti(ambiente);
  const automatico = elenco.archivio.preimpostazioni.find((voce) => voce.id === "rapido");
  const { id, versione, ...campi } = automatico;
  await ambiente.ponte.consiglio.preimpostazioni({ azione: "modifica", id, versioneAttesa: versione, versioneArchivioAttesa: elenco.archivio.versioneArchivio,
    preimpostazione: { ...campi, tipo: "codice" } });
  const richiesta = corpoAvvio(ambiente, { tipo: "codice", preimpostazione: { id, versione: versione + 1 } });
  assert.equal((await ambiente.post("/api/consiglio/avvia", richiesta)).dati.codice, "consenso-mancante");
  s.modello = preset.assegnazioni.scrittore.modelId;
  const cambiato = await ambiente.post("/api/consiglio/avvia", { ...richiesta, consenso: true });
  assert.equal(cambiato.dati.codice, "consenso-superato", JSON.stringify(cambiato.dati));
  assert.equal(ambiente.ponte.sessioni.size, 1);
  assert.equal(ambiente.ponte.consiglio.lavori.size, 0);
});

test("il consenso conserva il piano mostrato e un gitBase volatile non lo invalida", async (t) => {
  let versioneStash = 0;
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-catalogo-due", maxSessioni: 6,
    eseguiComandoConsiglio: async (_, args) => {
      if (args.join(" ") === "--version") return { codice: 0, uscita: "git version finto" };
      if (args.join(" ") === "status --porcelain") return { codice: 0, uscita: " M esempio.txt" };
      if (args.join(" ") === "stash create") return { codice: 0, uscita: ++versioneStash === 1 ? "abc123456" : "def123456" };
      return { codice: 0, uscita: "" };
    },
  });
  await mkdir(join(ambiente.cartellaLavoro, ".git"));
  const preset = await configuraAgenti(ambiente, { tipo: "codice" });
  const corpo = corpoAvvio(ambiente, { tipo: "codice", preimpostazione: riferimentoAgenti(preset) });
  const prima = await ambiente.post("/api/consiglio/avvia", { ...corpo, consenso: true });
  assert.equal(prima.dati.codice, "consenso-mancante", "un preset di codice pretende prima la conferma mostrata");
  const avvio = await ambiente.post("/api/consiglio/avvia", { ...corpo, consenso: true });
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  await attendiStato(ambiente, avvio.dati.lavoroId, ["bozza_bloccata"]);
});

test("il livello automatico effettivo resta congelato anche cambiando quello della sorgente", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-catalogo-due", maxSessioni: 6 });
  const { avvio, finale } = await avviaEAttendi(ambiente, { preimpostazione: { id: "rapido", versione: 1 } });
  assert.deepEqual(finale.ruoli.map((voce) => voce.thinking), ["medium", "medium"]);
  ambiente.ponte.sessioni.get(ambiente.sorgenteId).ragionamento = "off";
  const rifatto = await ambiente.post("/api/consiglio/rifai", { lavoroId: avvio.lavoroId, revisioneAttesa: 1 });
  assert.equal(rifatto.risposta.status, 202, JSON.stringify(rifatto.dati));
  const seconda = await attendiStato(ambiente, avvio.lavoroId, ["bozza_valida"]);
  assert.deepEqual(seconda.ruoli.map((voce) => voce.thinking), ["medium", "medium"]);
});

test("il livello automatico nullo resta nel file e nelle sessioni di ruolo anche dopo Rifai", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-catalogo-due", maxSessioni: 6, senzaRagionamento: true });
  const sorgente = ambiente.ponte.sessioni.get(ambiente.sorgenteId);
  assert.equal(sorgente.ragionamento, null, "il processo sorgente non espone un livello di ragionamento");
  const elenco = await elencoAgenti(ambiente);
  const preset = elenco.archivio.preimpostazioni.find((voce) => voce.id === "rapido");
  assert.deepEqual(preset.livello, { "consigliere-1": null, scrittore: null });
  // A fine revisione il ponte rimuove le sessioni chiuse: conserviamo gli stessi oggetti per verificarli.
  const sessioniRuolo = new Map();
  const aggiungiSessione = ambiente.ponte.sessioni.set.bind(ambiente.ponte.sessioni);
  t.mock.method(ambiente.ponte.sessioni, "set", (id, sessione) => {
    sessioniRuolo.set(id, sessione);
    return aggiungiSessione(id, sessione);
  });
  const { avvio, finale } = await avviaEAttendi(ambiente, { preimpostazione: riferimentoAgenti(preset) });
  const file = join(ambiente.home, ".pi", "gui", "consigli", avvio.lavoroId + ".json");
  const verificaLivelliNulli = async (stato, revisione) => {
    assert.equal(stato.lavoro.revisione, revisione);
    assert.deepEqual(stato.ruoli.map((voce) => voce.roleId), preset.ordine);
    assert.deepEqual(stato.ruoli.map((voce) => voce.thinking), [null, null]);
    for (const ruolo of stato.ruoli) {
      const sessione = sessioniRuolo.get(ruolo.guiSessionId);
      assert.ok(sessione, "la sessione del ruolo esiste: " + ruolo.roleId);
      assert.equal(sessione.ragionamento, null, "il ruolo conserva il livello nullo: " + ruolo.roleId);
    }
    const disco = JSON.parse(await readFile(file, "utf8"));
    assert.equal(disco.revisione, revisione);
    assert.deepEqual(disco.preimpostazione.livello, preset.livello);
    assert.deepEqual(disco.assegnazioniCongelate.map((ruolo) => ruolo.thinking), [null, null]);
    assert.deepEqual(disco.ruoli.map((ruolo) => ruolo.thinking), [null, null]);
  };
  await verificaLivelliNulli(finale, 1);
  sorgente.ragionamento = "high";
  const rifatto = await ambiente.post("/api/consiglio/rifai", { lavoroId: avvio.lavoroId, revisioneAttesa: 1 });
  assert.equal(rifatto.risposta.status, 202, JSON.stringify(rifatto.dati));
  const seconda = await attendiStato(ambiente, avvio.lavoroId, ["bozza_valida"]);
  assert.equal(sorgente.ragionamento, "high");
  const sessioniPrecedenti = new Set(finale.ruoli.map((ruolo) => ruolo.guiSessionId));
  assert.equal(seconda.ruoli.every((ruolo) => !sessioniPrecedenti.has(ruolo.guiSessionId)), true);
  await verificaLivelliNulli(seconda, 2);
});

// La cartella temporanea in forma canonica (lunga): il ponte canonicalizza i percorsi con realpath e
// sui runner Windows di GitHub tmpdir() restituisce la forma corta RUNNER~1, che non combacerebbe.
const TMP = realpathSync.native(tmpdir());

const QUI = dirname(fileURLToPath(import.meta.url));
const FAKE_PI = join(QUI, "fake-pi.mjs");

function pausa(ms) {
  return new Promise((risolvi) => setTimeout(risolvi, ms));
}

async function impronta(percorso) {
  return createHash("sha256").update(await readFile(percorso)).digest("hex");
}

// Ponte di prova con i punti di aggancio del consiglio sostituiti da doppi:
// la fusione e i controlli veri appartengono a un altro passaggio.
async function avviaPonteConsiglio(t, {
  maxSessioni = 4,
  cartella = "consiglio-base",
  autoStopMs = 0,
  senzaSorgente = false,
  senzaRagionamento = false,
  senzaDoppi = false,
  primaDelPonte = null,
  ...opzioni
} = {}) {
  const home = await mkdtemp(join(TMP, "pi-gui-consiglio-"));
  const cartellaLavoro = join(home, cartella);
  await mkdir(cartellaLavoro, { recursive: true });
  // Serve a chi deve trovare qualcosa già sul disco quando il ponte nasce, per
  // esempio i lavori del consiglio che la riapertura deve rileggere.
  if (primaDelPonte) await primaDelPonte({ home, cartellaLavoro });
  let cliPi = FAKE_PI;
  if (senzaRagionamento) {
    const finto = await readFile(FAKE_PI, "utf8");
    const livelloFinto = 'thinkingLevel: "medium"';
    assert.equal(finto.split(livelloFinto).length, 2, "il finto dichiara un solo livello da sostituire");
    cliPi = join(home, "fake-pi-senza-ragionamento.mjs");
    await writeFile(cliPi, finto.replace(livelloFinto, "thinkingLevel: null"), "utf8");
  }
  const conf = {
    controllo: { tipo: "eval", esito: "pass", motivi: [] },
    fileModificati: [],
    attese: [],
    componiChiamate: 0,
    analizzaChiamate: 0,
    controlloChiamate: 0,
    ultimoInputFusione: null,
    opzioniControllo: null,
    discendentiRichiesti: [],
    discendentiTerminati: [],
  };
  const ponte = creaPonte({
    home,
    cliPi,
    maxSessioni,
    autoStopMs,
    bloccaComandiEstensione: false,
    elencaDiscendenti: async (pid) => {
      conf.discendentiRichiesti.push(pid);
      return conf.discendenti || [];
    },
    terminaDiscendenti: async (processi) => {
      conf.discendentiTerminati.push(processi);
      return true;
    },
    caricaCronologia: async ({ sessione }) => {
      const dati = await sessione.inviaEAttendi({ type: "get_messages" });
      return dati.messages || [];
    },
    caricaSupportoRuntime: async () => ({
      versione: "0.84.2",
      getAgentDir: () => join(home, ".pi", "agent"),
      getShareViewerUrl: () => "https://example.test/share",
      ProjectTrustStore: class { get() { return null; } set() {} },
      modelliPredefiniti: { fake: "modello-test" },
    }),
    attendi: async (ms) => { conf.attese.push(ms); },
    ...(senzaDoppi ? {} : {
    fondiRisultato: {
      componiPrompt: (input) => {
        conf.componiChiamate += 1;
        conf.ultimoInputFusione = input;
        return "CONTRATTO per " + input.contributi.map((voce) => voce.roleId).join(", ");
      },
      analizzaUscita: (testo, contributi) => {
        conf.analizzaChiamate += 1;
        return {
          ok: true,
          motivi: [],
          risultato: {
            testo,
            provenienza: contributi.map((voce) => ({ roleId: voce.roleId })),
            scartati: [],
            fileModificati: conf.fileModificati,
            eval: [],
          },
        };
      },
    },
    verificaControlli: async (dati) => {
      conf.controlloChiamate += 1;
      conf.opzioniControllo = dati;
      return typeof conf.controllo === "function" ? conf.controllo(dati) : conf.controllo;
    },
    guardStrumenti: async () => ({ consentito: false, motivo: "Il file del piano è protetto." }),
    }),
    ...opzioni,
  });
  await new Promise((risolvi) => ponte.server.listen(0, "127.0.0.1", risolvi));
  const base = `http://127.0.0.1:${ponte.server.address().port}`;
  const stato = await (await fetch(base + "/api/stato")).json();
  assert.equal(stato.tokenApi, ponte.tokenApi, JSON.stringify(stato));
  const post = async (via, corpo) => {
    const risposta = await fetch(base + via, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pi-gui-token": stato.tokenApi },
      body: JSON.stringify(corpo),
    });
    return { risposta, dati: await risposta.json() };
  };
  const chiudi = async () => {
    await ponte.chiudiTutto().catch(() => {});
    if (ponte.server.listening) await new Promise((risolvi) => ponte.server.close(() => risolvi()));
    await rm(home, { recursive: true, force: true }).catch(() => {});
  };
  t.after(chiudi);
  const ambiente = { home, cartellaLavoro, ponte, base, stato, post, conf, chiudi };
  if (!senzaSorgente) {
    const avvio = await post("/api/avvia", { cartella: cartellaLavoro });
    assert.equal(avvio.risposta.status, 200, JSON.stringify(avvio.dati));
    ambiente.sorgenteId = avvio.dati.id;
  }
  return ambiente;
}

function corpoAvvio(ambiente, extra = {}) {
  return {
    operationId: "op-" + randomUUID(),
    sourceSessionId: ambiente.sorgenteId,
    prompt: "Scrivi una nota breve sul rischio residuo.",
    tipo: "testo",
    ...extra,
  };
}

async function attendiStato(ambiente, lavoroId, stati, timeout = 20_000) {
  const fine = Date.now() + timeout;
  let ultimo = null;
  while (Date.now() < fine) {
    const esito = await ambiente.post("/api/consiglio/stato", { lavoroId });
    if (esito.risposta.status === 200) {
      ultimo = esito.dati;
      if (stati.includes(ultimo.lavoro.stato)) return ultimo;
    }
    await pausa(25);
  }
  throw new Error(`Il lavoro non ha raggiunto ${stati.join(" o ")}: ${JSON.stringify(ultimo?.lavoro)}`);
}

async function avviaEAttendi(ambiente, extra = {}, stati = ["bozza_valida", "bozza_bloccata"]) {
  const avvio = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente, extra));
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  const finale = await attendiStato(ambiente, avvio.dati.lavoroId, stati);
  return { avvio: avvio.dati, finale };
}

function ascoltaEventi(t, ambiente) {
  const controller = new AbortController();
  const eventi = [];
  const pronto = fetch(
    ambiente.base + "/api/eventi?token=" + encodeURIComponent(ambiente.stato.tokenApi) + "&clientId=prova",
    { signal: controller.signal },
  ).then(async (risposta) => {
    const lettore = risposta.body.getReader();
    const decodificatore = new TextDecoder();
    let resto = "";
    while (true) {
      const { value, done } = await lettore.read().catch(() => ({ done: true }));
      if (done) break;
      resto += decodificatore.decode(value, { stream: true });
      let indice;
      while ((indice = resto.indexOf("\n\n")) >= 0) {
        const blocco = resto.slice(0, indice);
        resto = resto.slice(indice + 2);
        if (!blocco.startsWith("data: ")) continue;
        try {
          eventi.push(JSON.parse(blocco.slice("data: ".length)));
        } catch {
          // Il battito non è un evento JSON.
        }
      }
    }
  }).catch(() => {});
  t.after(() => {
    controller.abort();
    return pronto;
  });
  return eventi;
}

async function attendiEvento(eventi, predicato, timeout = 15_000) {
  const fine = Date.now() + timeout;
  while (Date.now() < fine) {
    const trovato = eventi.find(predicato);
    if (trovato) return trovato;
    await pausa(10);
  }
  throw new Error("L'evento atteso non è arrivato entro il tempo previsto");
}

test("il file del lavoro si rilegge identico dopo la scrittura atomica", async (t) => {
  const radice = await mkdtemp(join(TMP, "pi-gui-consigli-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const archivio = creaArchivioConsigli({ radice });
  const lavoro = {
    lavoroId: "lavoro-prova",
    stato: "bozza_valida",
    revisione: 2,
    creatoIl: new Date(1000).toISOString(),
    aggiornatoIl: new Date(2000).toISOString(),
    revisioni: [{ numero: 1, prompt: "città e perché", istruzioni: null, allegati: [] }],
    contributi: [{ roleId: "consigliere-1", testo: "una città", incluso: true }],
  };
  const scritto = await archivio.salva(lavoro);
  const riletto = await archivio.carica("lavoro-prova");
  assert.deepEqual(riletto, scritto);
  assert.deepEqual(riletto, JSON.parse(JSON.stringify(lavoroPerDisco(lavoro))));
  assert.equal(riletto.revisioni[0].prompt, "città e perché");
  assert.equal((await archivio.elenca()).length, 1);
  await assert.rejects(archivio.salva({ lavoroId: "../fuori" }), /non è valido/);
});

test("gli allegati non finiscono nel file del lavoro", async (t) => {
  const radice = await mkdtemp(join(TMP, "pi-gui-consigli-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const archivio = creaArchivioConsigli({ radice, limiteLog: 32 });
  await archivio.salva({
    lavoroId: "lavoro-allegati",
    stato: "raccolta",
    revisioni: [{
      numero: 1,
      prompt: "analizza",
      allegati: [{ percorso: "C:/dati/segreto.txt", nome: "segreto.txt", contenuto: "contenuto riservato" }],
    }],
    revisioneCorrente: {
      numero: 1,
      allegati: [{ percorso: "C:/dati/segreto.txt", contenuto: "contenuto riservato" }],
    },
    controllo: { tipo: "test", esito: "fail", logTroncato: "x".repeat(500) },
  });
  const grezzo = await readFile(join(radice, "lavoro-allegati.json"), "utf8");
  assert.equal(grezzo.includes("contenuto riservato"), false, "il contenuto dell'allegato non deve essere scritto");
  const riletto = JSON.parse(grezzo);
  assert.equal(riletto.revisioni[0].allegati[0].percorso, "C:/dati/segreto.txt");
  assert.equal(riletto.revisioni[0].allegati[0].dimensione, 19);
  assert.match(riletto.revisioni[0].allegati[0].impronta, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(riletto.revisioni[0].allegati[0], "contenuto"), false);
  assert.equal(riletto.controllo.logTroncato.length < 500, true);
  assert.match(riletto.controllo.logTroncato, /registro troncato/);
});

test("i lavori oltre la ritenzione vengono rimossi all'avvio", async (t) => {
  const home = await mkdtemp(join(TMP, "pi-gui-ritenzione-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const radice = join(home, ".pi", "gui", "consigli");
  await mkdir(radice, { recursive: true });
  const adesso = Date.now();
  const scrivi = async (id, stato, giorniFa) => {
    await writeFile(join(radice, id + ".json"), JSON.stringify({
      lavoroId: id,
      stato,
      aggiornatoIl: new Date(adesso - giorniFa * 24 * 60 * 60 * 1000).toISOString(),
    }), "utf8");
  };
  await scrivi("lavoro-vecchio-approvato", "approvato", 45);
  await scrivi("lavoro-vecchio-annullato", "annullato", 31);
  await scrivi("lavoro-vecchio-aperto", "bozza_valida", 90);
  await scrivi("lavoro-recente", "approvato", 1);
  assert.equal(RITENZIONE_LAVORI_MS, 30 * 24 * 60 * 60 * 1000);

  const primo = creaPonte({ home, cliPi: FAKE_PI });
  t.after(() => primo.chiudiTutto().catch(() => {}));
  await pausa(200);
  const rimasti = (await readdir(radice)).map((nome) => nome.replace(/\.json$/u, ""));
  assert.equal(rimasti.includes("lavoro-vecchio-approvato"), false, "un approvato oltre trenta giorni va via");
  assert.equal(rimasti.includes("lavoro-vecchio-annullato"), false, "un annullato oltre trenta giorni va via");
  assert.equal(rimasti.includes("lavoro-vecchio-aperto"), true, "un lavoro ancora aperto non si cancella per anzianità");
  assert.equal(rimasti.includes("lavoro-recente"), true);
  assert.equal(rimasti.length, 2);

  for (let indice = 0; indice < 55; indice += 1) {
    await scrivi(`lavoro-riempitivo-${indice}`, "approvato", 2 + indice / 100);
  }
  const secondo = creaPonte({ home, cliPi: FAKE_PI });
  t.after(() => secondo.chiudiTutto().catch(() => {}));
  await pausa(200);
  const dopoIlTetto = await readdir(radice);
  assert.equal(dopoIlTetto.length, 50, "restano al massimo cinquanta lavori");
  assert.equal(dopoIlTetto.includes("lavoro-recente.json"), true, "il più recente resta");
});

test("con posti insufficienti avvia risponde 409 e non apre nessuna sessione", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { maxSessioni: 2 });
  const esito = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente));
  assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
  assert.equal(esito.dati.codice, "posti-insufficienti");
  assert.equal(esito.dati.recuperabile, true);
  assert.match(esito.dati.messaggio, /2 conversazioni libere/);
  assert.equal(ambiente.ponte.sessioni.size, 1, "nessuna sessione di ruolo deve essere aperta");
  assert.equal(ambiente.ponte.consiglio.lavori.size, 0);
  assert.equal(ambiente.ponte.consiglio.postiPrenotati(), 0);
});

test("due avvii concorrenti con lo stesso operationId creano un solo lavoro e aprono le sessioni una volta sola", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-concorrenza" });
  const corpo = corpoAvvio(ambiente);
  const [primo, secondo] = await Promise.all([
    ambiente.post("/api/consiglio/avvia", corpo),
    ambiente.post("/api/consiglio/avvia", corpo),
  ]);
  assert.deepEqual(
    [primo.risposta.status, secondo.risposta.status],
    [202, 202],
    JSON.stringify([primo.dati, secondo.dati]),
  );
  const lavoroId = primo.dati.lavoroId;
  assert.equal(secondo.dati.lavoroId, lavoroId, "la seconda chiamata rilegge l'esito già registrato");
  assert.deepEqual(
    secondo.dati.ruoli.map((ruolo) => ruolo.guiSessionId),
    primo.dati.ruoli.map((ruolo) => ruolo.guiSessionId),
    "le stesse sessioni, non una seconda coppia",
  );
  assert.equal(ambiente.ponte.consiglio.lavori.size, 1);
  assert.equal(ambiente.ponte.sessioni.size, 3, "una sorgente più due ruoli, aperti una volta sola");
  await attendiStato(ambiente, lavoroId, ["bozza_valida", "bozza_bloccata"]);
});

test("stesso operationId con corpo diverso dà 409", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-impronta" });
  const corpo = corpoAvvio(ambiente);
  const primo = await ambiente.post("/api/consiglio/avvia", corpo);
  assert.equal(primo.risposta.status, 202, JSON.stringify(primo.dati));
  const secondo = await ambiente.post("/api/consiglio/avvia", { ...corpo, prompt: "un'altra richiesta" });
  assert.equal(secondo.risposta.status, 409, JSON.stringify(secondo.dati));
  assert.match(secondo.dati.messaggio, /gia associato a una richiesta diversa/);
  assert.equal(ambiente.ponte.consiglio.lavori.size, 1);
  await attendiStato(ambiente, primo.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);

  // Due piani a mano che si appiattiscono nella stessa riga di comando sono due
  // esecuzioni diverse: "-e" e "process.exit(0)" come argomenti separati, oppure
  // "-e process.exit(0)" come argomento solo. Se l'impronta guardasse la riga
  // ricomposta, il secondo avvio tornerebbe 202 con l'esito del primo e l'utente
  // riceverebbe il risultato di un comando che non ha chiesto.
  const corpoPiano = corpoAvvio(ambiente, {
    tipo: "codice",
    consenso: true,
    piano: { eseguibile: process.execPath, argomenti: ["-e", "process.exit(0)"] },
  });
  const conPiano = await ambiente.post("/api/consiglio/avvia", corpoPiano);
  assert.equal(conPiano.risposta.status, 202, JSON.stringify(conPiano.dati));
  const stessaRiga = await ambiente.post("/api/consiglio/avvia", {
    ...corpoPiano,
    piano: { eseguibile: process.execPath, argomenti: ["-e process.exit(0)"] },
  });
  assert.equal(stessaRiga.risposta.status, 409, JSON.stringify(stessaRiga.dati));
  assert.match(stessaRiga.dati.messaggio, /gia associato a una richiesta diversa/);
  assert.equal(ambiente.ponte.consiglio.lavori.size, 2, "il secondo corpo non deve creare un lavoro suo");
  await attendiStato(ambiente, conPiano.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);
});

test("il piano si congela all'avvio con l'impronta del file che lo definisce", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-piano" });
  const npmCli = join(ambiente.home, "npm-cli.js");
  await writeFile(npmCli, "// finto npm\n", "utf8");
  const pacchetto = join(ambiente.cartellaLavoro, "package.json");
  await writeFile(pacchetto, JSON.stringify({ name: "prova", scripts: { test: "node --test" } }, null, 2), "utf8");

  const piano = await rilevaPianoTest({
    workspace: ambiente.cartellaLavoro,
    tipo: "codice",
    execPath: process.execPath,
    percorsoNpmCli: npmCli,
    esisteFile: async () => true,
    leggiFile: (percorso, codifica) => readFile(percorso, codifica),
    improntaFile: impronta,
  });
  assert.equal(piano.origine, "npm");
  assert.equal(piano.eseguibile, process.execPath);
  assert.deepEqual(piano.argomenti, [npmCli, "run", "test"]);
  assert.equal(piano.filePiano, pacchetto);
  assert.equal(piano.pianoHash, await impronta(pacchetto));
  assert.match(piano.comando, /npm-cli\.js run test$/);

  const senzaScript = await rilevaPianoTest({
    workspace: ambiente.home,
    tipo: "codice",
    execPath: process.execPath,
    percorsoNpmCli: npmCli,
    esisteFile: async () => true,
    leggiFile: (percorso, codifica) => readFile(percorso, codifica),
    improntaFile: impronta,
  });
  assert.equal(senzaScript.origine, "assente");
});

test("un piano cambiato dopo il consenso non viene eseguito e il controllo esce fail", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, {
    cartella: "consiglio-settled-lento-piano",
    percorsoNpmCli: null,
    eseguiComandoConsiglio: async () => ({ codice: 1, uscita: "git non disponibile", scaduto: false }),
  });
  const npmCli = join(ambiente.home, "npm-cli.js");
  await writeFile(npmCli, "// finto npm\n", "utf8");
  const pacchetto = join(ambiente.cartellaLavoro, "package.json");
  await writeFile(pacchetto, JSON.stringify({ name: "prova", scripts: { test: "node --test" } }), "utf8");
  ambiente.ponte.consiglio.lavori.clear();

  const ponteConPiano = ambiente;
  const avvio = await ponteConPiano.post("/api/consiglio/avvia", corpoAvvio(ambiente, {
    tipo: "codice",
    consenso: true,
  }));
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  assert.equal(avvio.dati.piano.origine, "npm");
  // Lo scrittore riscrive lo script dopo il consenso: il comando congelato non
  // deve essere eseguito.
  await writeFile(pacchetto, JSON.stringify({ name: "prova", scripts: { test: "node -e \"process.exit(0)\"" } }), "utf8");
  const finale = await attendiStato(ambiente, avvio.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);
  assert.equal(finale.lavoro.stato, "bozza_bloccata");
  assert.equal(finale.controllo.esito, "fail");
  assert.match(finale.controllo.motivi[0], /piano dei test è cambiato dopo il consenso/);
  assert.equal(ambiente.conf.controlloChiamate, 0, "il controllo vero non deve partire");
});

test("la sessione di un ruolo riceve ruolo e workspace nell'ambiente", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-ambiente" });
  const { finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.ruoli.length, 2);
  const tracce = (await readdir(ambiente.cartellaLavoro))
    .filter((nome) => nome.startsWith("consiglio-ambiente-"));
  assert.equal(tracce.length, 2, "una traccia per ogni sessione di ruolo");
  const contenuti = [];
  for (const nome of tracce) {
    contenuti.push(JSON.parse(await readFile(join(ambiente.cartellaLavoro, nome), "utf8")));
  }
  const ruoli = contenuti.map((voce) => voce.ruolo).sort();
  assert.deepEqual(ruoli, ["consigliere", "scrittore"]);
  for (const voce of contenuti) {
    assert.equal(voce.workspace, ambiente.cartellaLavoro);
    assert.equal(voce.piano, "");
    const posizione = voce.argomenti.indexOf("--extension");
    assert.notEqual(posizione, -1, "la guardia deve essere agganciata anche con la cartella");
    assert.match(voce.argomenti[posizione + 1], /consiglio-guard\.mjs$/u);
  }
});

test("sulla sessione di un ruolo il prompt manuale è rifiutato", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-settled-lento-manuale" });
  const avvio = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente));
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  const ruolo = avvio.dati.ruoli[0];
  const manuale = await ambiente.post("/api/comando", {
    sessionId: ruolo.guiSessionId,
    type: "prompt",
    message: "dimmi altro",
  });
  assert.equal(manuale.risposta.status, 409, JSON.stringify(manuale.dati));
  assert.match(manuale.dati.errore, /comandi manuali sono rifiutati/);
  const lettura = await ambiente.post("/api/comando", {
    sessionId: ruolo.guiSessionId,
    type: "get_state",
  });
  assert.equal(lettura.risposta.status, 200, "le letture restano ammesse");
  await attendiStato(ambiente, avvio.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);
});

test("il cambio modello su una sessione di ruolo è rifiutato", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-settled-lento-modello" });
  const avvio = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente));
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  const ruolo = avvio.dati.ruoli[0];
  const cambio = await ambiente.post("/api/comando", {
    sessionId: ruolo.guiSessionId,
    type: "set_model",
    provider: "fake",
    modelId: "modello-secondo",
  });
  assert.equal(cambio.risposta.status, 409, JSON.stringify(cambio.dati));
  assert.match(cambio.dati.errore, /consiglio/);
  const scheda = await ambiente.post("/api/consiglio/stato", { lavoroId: avvio.dati.lavoroId });
  assert.equal(scheda.dati.ruoli[0].modello, "modello-test");
  await attendiStato(ambiente, avvio.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);
});

test("il prompt di ruolo non passa dalla compattazione preventiva del ponte", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-compattazione" });
  const eventi = ascoltaEventi(t, ambiente);
  const { avvio, finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  const idRuoli = new Set(finale.ruoli.map((ruolo) => ruolo.guiSessionId));
  const preventive = eventi.filter((evento) => evento.type === "gui_compattazione_preventiva");
  assert.equal(
    preventive.some((evento) => idRuoli.has(evento.guiSessionId)),
    false,
    "nessuna compattazione preventiva del ponte sulle sessioni di ruolo",
  );
  // Controprova: sulla conversazione sorgente il prompt normale ci passa.
  const manuale = await ambiente.post("/api/comando", {
    sessionId: ambiente.sorgenteId,
    type: "prompt",
    message: "una domanda normale",
  });
  assert.equal(manuale.risposta.status, 200, JSON.stringify(manuale.dati));
  const fine = Date.now() + 5000;
  while (Date.now() < fine
    && !eventi.some((evento) => evento.type === "gui_compattazione_preventiva"
      && evento.guiSessionId === ambiente.sorgenteId)) {
    await pausa(25);
  }
  assert.equal(
    eventi.some((evento) => evento.type === "gui_compattazione_preventiva"
      && evento.guiSessionId === ambiente.sorgenteId),
    true,
    "la controprova deve vedere la compattazione preventiva sulla sorgente",
  );
  assert.equal(avvio.ruoli.length, 2);
});

test("il contributo si raccoglie solo dopo agent_settled", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-settled-lento" });
  const eventi = ascoltaEventi(t, ambiente);
  const avvio = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente));
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  const consigliere = avvio.dati.ruoli.find((ruolo) => ruolo.tipo === "consigliere");
  assert.ok(consigliere?.guiSessionId, JSON.stringify(avvio.dati));
  // Il messaggio dell'assistente è già arrivato per intero: se la raccolta
  // avvenisse su message_end il contributo sarebbe già qui.
  const fineMessaggio = await attendiEvento(
    eventi,
    (evento) => evento.type === "message_end" && evento.guiSessionId === consigliere.guiSessionId,
  );
  assert.match(
    JSON.stringify(fineMessaggio.message?.content || []),
    /ruolo consigliere/,
    "message_end porta già il testo della risposta",
  );
  const inCorso = await attendiStato(ambiente, avvio.dati.lavoroId, ["raccolta"], 5000);
  assert.equal(
    eventi.some((evento) => evento.type === "agent_settled" && evento.guiSessionId === consigliere.guiSessionId),
    false,
    "la prova vale solo finché agent_settled non è ancora arrivato",
  );
  assert.equal(inCorso.contributi.length, 0, "il messaggio è già finito ma agent_settled non è arrivato");
  assert.equal(
    inCorso.ruoli.find((ruolo) => ruolo.roleId === consigliere.roleId).stato,
    "in_corso",
    "il ruolo resta in corso finché il turno non è concluso",
  );
  await attendiEvento(
    eventi,
    (evento) => evento.type === "agent_settled" && evento.guiSessionId === consigliere.guiSessionId,
  );
  const finale = await attendiStato(ambiente, avvio.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  assert.equal(finale.contributi.length, 1);
  assert.equal(finale.contributi[0].incluso, true);
  assert.match(finale.contributi[0].testo, /ruolo consigliere/);
});

test("una risposta con stopReason error non entra nella fusione", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-stop-error" });
  const { finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_bloccata");
  assert.equal(finale.contributi.length, 1);
  assert.equal(finale.contributi[0].incluso, false);
  assert.match(finale.contributi[0].errore, /stopReason error/);
  assert.equal(ambiente.conf.componiChiamate, 0, "la fusione non deve partire senza contributi validi");
  assert.match(finale.lavoro.motivo, /Nessun consigliere/);
});

test("credito o accesso richiede un codice del provider e una parola riconoscibile", async () => {
  const { sembraErroreCreditoOAccesso } = await import("../app/consiglio.mjs");
  for (const codice of [400, 401, 402, 403]) {
    for (const parola of ["credit", "billing", "insufficient", "quota", "unauthorized", "authentication", "forbidden"]) {
      const messaggio = `Errore del provider: ${codice} ${parola.toUpperCase()}`;
      assert.equal(sembraErroreCreditoOAccesso(messaggio), true, messaggio);
    }
  }
  for (const messaggio of [null, "", "insufficient credit", "1400 insufficient credit", "400 invalid request", "429 quota exceeded", "500 billing unavailable"]) {
    assert.equal(sembraErroreCreditoOAccesso(messaggio), false, String(messaggio));
  }
});

for (const messaggioProvider of [
  "Errore del provider: 400 insufficient credit",
  "Errore del provider: 403 forbidden, rate limit, retry after 3 seconds",
]) {
  test(`credito o accesso termina il ruolo senza ripetizione: ${messaggioProvider}`, async (t) => {
    const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-429-sempre" });
    const eventi = ascoltaEventi(t, ambiente);
    const osserva = ambiente.ponte.consiglio.osservaEvento;
    let erroriRicevuti = 0;
    // Il fake produce un errore e agent_settled a ogni prompt. Sostituiamo
    // soltanto il testo all'ingresso del canale reale degli eventi di ruolo.
    ambiente.ponte.consiglio.osservaEvento = (guiSessionId, evento) => {
      if (evento.type === "error") {
        erroriRicevuti += 1;
        evento = { ...evento, message: messaggioProvider };
      }
      osserva(guiSessionId, evento);
    };
    const { avvio, finale } = await avviaEAttendi(ambiente);
    const consigliere = finale.ruoli.find((ruolo) => ruolo.tipo === "consigliere");
    const atteso = "Il provider fake non ha risposto per credito o accesso. Scegli un altro modello in Gestisci.";
    assert.equal(consigliere.stato, "errore");
    assert.equal(consigliere.errore, atteso);
    assert.equal(consigliere.tentativo, 0);
    assert.equal(consigliere.attesaFinoA, null);
    assert.equal(erroriRicevuti, 1, "il ponte invia un solo prompt al consigliere");
    assert.deepEqual(ambiente.conf.attese, []);
    assert.equal(finale.contributi[0].incluso, false);
    assert.equal(finale.contributi[0].errore, atteso);
    assert.equal(finale.lavoro.stato, "bozza_bloccata");
    const eventoErrore = await attendiEvento(eventi, (evento) => evento.type === "gui_consiglio_ruolo"
      && evento.lavoroId === avvio.lavoroId && evento.roleId === consigliere.roleId && evento.stato === "errore");
    assert.equal(eventoErrore.errore, atteso, "la scheda riceve lo stesso messaggio dello stato");
    assert.equal(eventoErrore.tentativo, 0);
    assert.equal(eventi.some((evento) => evento.type === "gui_consiglio_ruolo"
      && evento.lavoroId === avvio.lavoroId && evento.stato === "attesa_provider"), false);
  });
}

test("una sola ripetizione dopo l'attesa indicata dal provider", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-429-testo" });
  const { finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  assert.equal(ambiente.conf.attese.length > 0, true);
  assert.deepEqual([...new Set(ambiente.conf.attese)], [3000], "i secondi vanno letti dal testo dell'errore");
  const consigliere = finale.ruoli.find((ruolo) => ruolo.tipo === "consigliere");
  assert.equal(consigliere.tentativo, 1, "una sola ripetizione del ponte");
  assert.equal(consigliere.stato, "completato");
  assert.equal(finale.contributi[0].incluso, true);
  assert.equal(secondiAttesaDaErrore("429 Too Many Requests. Please retry after 3 seconds"), 3);
  assert.equal(secondiAttesaDaErrore("Server requested 12 s"), 12);
  assert.equal(secondiAttesaDaErrore("nessun numero utile"), null);
});

test("senza indicazione aspetta venti secondi con l'orologio sostituito", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-429-muto" });
  const inizio = Date.now();
  const { finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  assert.deepEqual([...new Set(ambiente.conf.attese)], [20_000]);
  assert.equal(Date.now() - inizio < 20_000, true, "l'attesa e iniettata, non reale");
  assert.equal(sembraLimiteRichieste("Errore del provider: too many requests."), true);
  assert.equal(sembraLimiteRichieste("errore di rete"), false);
});

test("gli auto_retry_start non contano come ripetizione", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-auto-retry" });
  const eventi = ascoltaEventi(t, ambiente);
  const { finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  assert.deepEqual(ambiente.conf.attese, [], "il ponte non aspetta per i ritentativi di pi");
  for (const ruolo of finale.ruoli) assert.equal(ruolo.tentativo, 0);
  const attesaProvider = eventi.filter((evento) => evento.type === "gui_consiglio_ruolo"
    && evento.attesaProvider);
  assert.equal(attesaProvider.length >= 1, true, "l'attesa del provider va mostrata");
  assert.equal(attesaProvider[0].attesaProvider.attempt, 1);
  assert.equal(attesaProvider[0].attesaProvider.maxAttempts, 3);
});

test("al secondo fallimento il ruolo chiude in errore e gli altri proseguono", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-uno-fallisce", maxSessioni: 6 });
  const configurazione = await ambiente.post("/api/impostazioni", {
    consiglio: {
      schemaVersion: 1,
      version: 1,
      consiglieri: [
        { roleId: "consigliere-1", model: null, thinking: null },
        { roleId: "consigliere-2", model: null, thinking: null },
      ],
      scrittore: { roleId: "scrittore", model: null, thinking: null },
    },
  });
  assert.equal(configurazione.risposta.status, 200, JSON.stringify(configurazione.dati));
  const { finale } = await avviaEAttendi(ambiente);
  const inErrore = finale.ruoli.filter((ruolo) => ruolo.stato === "errore");
  assert.equal(inErrore.length, 1, JSON.stringify(finale.ruoli));
  assert.equal(inErrore[0].tentativo, 1, "ha ripetuto una sola volta prima di arrendersi");
  assert.equal(finale.contributi.filter((contributo) => contributo.incluso).length, 1);
  assert.equal(finale.lavoro.stato, "bozza_valida", "gli altri ruoli proseguono");
  assert.equal(ambiente.conf.componiChiamate, 1);
});

test("zero contributi validi porta a bozza bloccata", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-429-sempre" });
  const { finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_bloccata");
  assert.match(finale.lavoro.motivo, /Nessun consigliere ha prodotto un contributo valido/);
  assert.equal(finale.ruoli[0].stato, "errore");
  assert.equal(finale.azioni.approva, false);
  assert.equal(finale.azioni.rifai, true);
  assert.equal(ambiente.conf.componiChiamate, 0);
});

test("stato restituisce risultato, controllo e azioni consentite", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-stato" });
  const { finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  assert.match(finale.risultato.testo, /ruolo scrittore/);
  assert.match(finale.risultato.risultatoHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(finale.risultato.provenienza, [{ roleId: "consigliere-1" }]);
  assert.equal(finale.controllo.esito, "pass");
  assert.equal(finale.controllo.tipo, "eval");
  assert.deepEqual(finale.azioni, { approva: true, rifai: true, annulla: true });
  assert.equal(finale.lavoro.consenso, null, "un lavoro di solo testo non chiede consenso");
  assert.equal(typeof finale.seq, "number");
});

test("un evento con seq minore non sovrascrive lo stato", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-seq" });
  const eventi = ascoltaEventi(t, ambiente);
  const { avvio, finale } = await avviaEAttendi(ambiente);
  const delLavoro = eventi.filter((evento) => String(evento.type || "").startsWith("gui_consiglio_")
    && evento.lavoroId === avvio.lavoroId);
  assert.equal(delLavoro.length >= 4, true, JSON.stringify(delLavoro.map((evento) => evento.type)));
  const sequenze = delLavoro.map((evento) => evento.seq);
  assert.deepEqual(sequenze, [...sequenze].sort((a, b) => a - b), "le sequenze non tornano indietro");
  assert.equal(new Set(sequenze).size, sequenze.length, "nessuna sequenza ripetuta");
  assert.equal(sequenze[0] > 0, true);
  assert.equal(finale.seq >= sequenze.at(-1), true, "lo stato conosce almeno l'ultimo evento emesso");
  for (const evento of delLavoro) {
    assert.equal(typeof evento.at, "string");
    assert.equal(evento.revisione, 1);
  }
});

test("la scheda risultato compare nello snapshot e sopravvive a due snapshot di fila", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-scheda" });
  const { avvio, finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  const leggi = async () => (await (await fetch(ambiente.base + "/api/stato")).json()).sessioni;
  for (const tentativo of [1, 2]) {
    const sessioni = await leggi();
    const scheda = sessioni.find((voce) => voce.id === "consiglio:" + avvio.lavoroId);
    assert.ok(scheda, `la scheda deve esserci allo snapshot ${tentativo}`);
    assert.equal(scheda.attiva, false);
    assert.equal(scheda.riservata, false);
    assert.equal(scheda.avvioCompletato, true);
    assert.equal(scheda.nomeSessione, "Risultato");
    assert.equal(scheda.cartella, ambiente.cartellaLavoro);
    assert.equal(scheda.consiglio.lavoroId, avvio.lavoroId);
    assert.equal(scheda.consiglio.stato, "bozza_valida");
    assert.equal(scheda.consiglio.azioni.approva, true);
  }
  const annulla = await ambiente.post("/api/consiglio/annulla", { lavoroId: avvio.lavoroId });
  assert.equal(annulla.risposta.status, 200, JSON.stringify(annulla.dati));
  const dopo = await leggi();
  assert.equal(dopo.some((voce) => voce.id === "consiglio:" + avvio.lavoroId), false);
});

test("la scheda risultato non consuma un posto nel tetto delle sessioni", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-posti", maxSessioni: 3 });
  const { avvio, finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  assert.equal(ambiente.ponte.sessioni.size, 1, "le sessioni di ruolo si chiudono a bozza pronta");
  const sessioni = (await (await fetch(ambiente.base + "/api/stato")).json()).sessioni;
  assert.equal(sessioni.length, 2, "sorgente più scheda Risultato");
  assert.equal(sessioni.some((voce) => voce.id === "consiglio:" + avvio.lavoroId), true);
  for (const nome of ["altra-uno", "altra-due"]) {
    const cartella = join(ambiente.home, nome);
    await mkdir(cartella, { recursive: true });
    const esito = await ambiente.post("/api/avvia", { cartella });
    assert.equal(esito.risposta.status, 200, `${nome}: ${JSON.stringify(esito.dati)}`);
  }
  const cartellaTroppa = join(ambiente.home, "altra-tre");
  await mkdir(cartellaTroppa, { recursive: true });
  const troppa = await ambiente.post("/api/avvia", { cartella: cartellaTroppa });
  assert.equal(troppa.risposta.status, 409, "il tetto resta quello dei processi veri");
});

test("approva è rifiutata con 409 quando il controllo è fail", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-approva-fail" });
  ambiente.conf.controllo = { tipo: "eval", esito: "fail", motivi: ["La casella E2 non è dimostrata."] };
  const { avvio, finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_bloccata");
  assert.equal(finale.controllo.esito, "fail");
  assert.equal(finale.azioni.approva, false);
  const esito = await ambiente.post("/api/consiglio/approva", {
    operationId: "op-" + randomUUID(),
    lavoroId: avvio.lavoroId,
    revisione: 1,
    risultatoHash: finale.risultato.risultatoHash,
  });
  assert.equal(esito.risposta.status, 409, JSON.stringify(esito.dati));
  assert.equal(esito.dati.codice, "controllo-non-valido");
});

test("approva due volte con lo stesso operationId non duplica", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-approva" });
  const { avvio, finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  const corpo = {
    operationId: "op-" + randomUUID(),
    lavoroId: avvio.lavoroId,
    revisione: 1,
    risultatoHash: finale.risultato.risultatoHash,
  };
  const primo = await ambiente.post("/api/consiglio/approva", corpo);
  assert.equal(primo.risposta.status, 200, JSON.stringify(primo.dati));
  assert.equal(primo.dati.stato, "approvato");
  assert.equal(primo.dati.testo, finale.risultato.testo);
  const secondo = await ambiente.post("/api/consiglio/approva", corpo);
  assert.equal(secondo.risposta.status, 200, JSON.stringify(secondo.dati));
  assert.equal(secondo.dati.approvatoIl, primo.dati.approvatoIl, "la seconda chiamata rilegge l'esito registrato");
  const dopo = await ambiente.post("/api/consiglio/stato", { lavoroId: avvio.lavoroId });
  assert.equal(dopo.dati.lavoro.stato, "approvato");
  assert.equal(dopo.dati.azioni.approva, false);
  const suDisco = JSON.parse(await readFile(
    join(ambiente.home, ".pi", "gui", "consigli", avvio.lavoroId + ".json"),
    "utf8",
  ));
  assert.equal(suDisco.approvazione.operationId, corpo.operationId);
  assert.equal(suDisco.stato, "approvato");
  for (const ruolo of suDisco.ruoli) {
    assert.equal(Object.hasOwn(ruolo, "sessione"), false, "la sessione viva non finisce su disco");
    assert.equal(typeof ruolo.guiSessionId, "string");
  }
});

test("rifai apre una revisione nuova e conserva la precedente", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-rifai" });
  const { avvio, finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  const rifai = await ambiente.post("/api/consiglio/rifai", {
    lavoroId: avvio.lavoroId,
    revisioneAttesa: 1,
    istruzioni: "più corto, e cita le fonti",
    ripristina: false,
  });
  assert.equal(rifai.risposta.status, 202, JSON.stringify(rifai.dati));
  assert.equal(rifai.dati.revisione, 2);
  const superata = await ambiente.post("/api/consiglio/rifai", {
    lavoroId: avvio.lavoroId,
    revisioneAttesa: 1,
    ripristina: false,
  });
  assert.equal(superata.risposta.status, 409, JSON.stringify(superata.dati));
  assert.equal(superata.dati.codice, "revisione-superata");
  const secondaFine = await attendiStato(ambiente, avvio.lavoroId, ["bozza_valida", "bozza_bloccata"]);
  assert.equal(secondaFine.lavoro.revisione, 2);
  const suDisco = JSON.parse(await readFile(
    join(ambiente.home, ".pi", "gui", "consigli", avvio.lavoroId + ".json"),
    "utf8",
  ));
  assert.equal(suDisco.revisioni.length, 2);
  assert.equal(suDisco.revisioni[0].numero, 1);
  assert.equal(suDisco.revisioni[0].istruzioni, null, "la revisione precedente resta com'era");
  assert.equal(suDisco.revisioni[1].istruzioni, "più corto, e cita le fonti");
  assert.equal(suDisco.revisioni[1].prompt, suDisco.revisioni[0].prompt);
});

test("annullare durante la fusione lascia il lavoro annullato e non esegue i test", async (t) => {
  // L'attesa del limite di richieste ferma il ciclo in un punto preciso, dopo
  // la raccolta: così l'annullamento arriva sempre prima della ripresa e la
  // prova non dipende da una corsa fra promesse.
  let sblocca = null;
  const atteseViste = [];
  const ambiente = await avviaPonteConsiglio(t, {
    cartella: "consiglio-429-scrittore",
    attendi: (ms) => {
      atteseViste.push(ms);
      return new Promise((risolvi) => { sblocca = risolvi; });
    },
  });
  t.after(() => sblocca?.());
  const avvio = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente));
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  const lavoroId = avvio.dati.lavoroId;
  const fine = Date.now() + 15_000;
  while (Date.now() < fine && atteseViste.length === 0) await pausa(10);
  assert.equal(atteseViste.length, 1, "lo scrittore deve essere fermo in attesa del provider");
  const durante = await ambiente.post("/api/consiglio/stato", { lavoroId });
  assert.equal(durante.dati.lavoro.stato, "fusione", "il lavoro e nella fase di fusione");
  assert.equal(durante.dati.contributi.length, 1, "il contributo del consigliere è già raccolto");

  const annulla = await ambiente.post("/api/consiglio/annulla", { lavoroId });
  assert.equal(annulla.risposta.status, 200, JSON.stringify(annulla.dati));
  assert.equal(annulla.dati.stato, "annullato");

  // Il ciclo riprende adesso, a consenso già revocato: non deve toccare nulla.
  sblocca();
  await pausa(600);
  const dopo = await ambiente.post("/api/consiglio/stato", { lavoroId });
  assert.equal(dopo.dati.lavoro.stato, "annullato", "lo stato non deve risorgere in bozza bloccata");
  assert.deepEqual(dopo.dati.azioni, { approva: false, rifai: false, annulla: false });
  assert.equal(ambiente.conf.controlloChiamate, 0, "nessun controllo dopo la revoca del consenso");
  assert.equal(dopo.dati.controllo, null);
  const sessioni = (await (await fetch(ambiente.base + "/api/stato")).json()).sessioni;
  assert.equal(
    sessioni.some((voce) => voce.id === "consiglio:" + lavoroId),
    false,
    "la scheda Risultato di un lavoro annullato non torna nello snapshot",
  );
  const suDisco = JSON.parse(await readFile(
    join(ambiente.home, ".pi", "gui", "consigli", lavoroId + ".json"),
    "utf8",
  ));
  assert.equal(suDisco.stato, "annullato");
});

test("due rifai concorrenti creano una sola revisione", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-rifai-concorrenti" });
  const { avvio, finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  const corpo = {
    lavoroId: avvio.lavoroId,
    revisioneAttesa: 1,
    istruzioni: "riscrivi più corto",
    ripristina: false,
  };
  const esiti = await Promise.all([
    ambiente.post("/api/consiglio/rifai", { ...corpo }),
    ambiente.post("/api/consiglio/rifai", { ...corpo }),
  ]);
  const codici = esiti.map((esito) => esito.risposta.status).sort();
  assert.deepEqual(codici, [202, 409], JSON.stringify(esiti.map((esito) => esito.dati)));
  const rifiutato = esiti.find((esito) => esito.risposta.status === 409);
  assert.equal(
    ["revisione-superata", "lavoro-in-corso"].includes(rifiutato.dati.codice),
    true,
    JSON.stringify(rifiutato.dati),
  );
  const secondaFine = await attendiStato(ambiente, avvio.lavoroId, ["bozza_valida", "bozza_bloccata"]);
  assert.equal(secondaFine.lavoro.revisione, 2, "una sola revisione nuova");
  const lavoro = ambiente.ponte.consiglio.lavori.get(avvio.lavoroId);
  assert.equal(lavoro.revisioni.length, 2);
  assert.equal(lavoro.ruoli.length, 2, "un solo gruppo di ruoli per la revisione nuova");
  assert.equal(ambiente.ponte.sessioni.size, 1, "nessuna sessione di ruolo orfana");
});

test("senza eseguibile git rifai avvisa che il ripristino non è possibile", async (t) => {
  const comandi = [];
  const ambiente = await avviaPonteConsiglio(t, {
    cartella: "consiglio-git-assente",
    eseguiComandoConsiglio: async (eseguibile, argomenti) => {
      comandi.push([eseguibile, ...argomenti].join(" "));
      return { codice: -1, uscita: "git non trovato", scaduto: false };
    },
  });
  await mkdir(join(ambiente.cartellaLavoro, ".git"), { recursive: true });
  await writeFile(join(ambiente.cartellaLavoro, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  const npmCli = join(ambiente.home, "npm-cli.js");
  await writeFile(npmCli, "// finto npm\n", "utf8");
  ambiente.conf.fileModificati = ["a.txt"];

  const senzaConsenso = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente, { tipo: "codice" }));
  assert.equal(senzaConsenso.risposta.status, 409, JSON.stringify(senzaConsenso.dati));
  assert.equal(senzaConsenso.dati.codice, "consenso-mancante");
  assert.match(senzaConsenso.dati.consenso, /Il ripristino con git non è possibile/);

  const { avvio, finale } = await avviaEAttendi(ambiente, { tipo: "codice", consenso: true });
  assert.equal(finale.lavoro.git.disponibile, false);
  assert.equal(comandi.some((comando) => comando.includes("git --version")), true);
  const rifai = await ambiente.post("/api/consiglio/rifai", {
    lavoroId: avvio.lavoroId,
    revisioneAttesa: 1,
    ripristina: true,
    confermaRipristino: true,
  });
  assert.equal(rifai.risposta.status, 202, JSON.stringify(rifai.dati));
  assert.equal(rifai.dati.ripristino.possibile, false);
  assert.match(rifai.dati.ripristino.motivo, /git/i);
  assert.equal(comandi.some((comando) => comando.includes("checkout")), false, "nessun ripristino eseguito");
  await attendiStato(ambiente, avvio.lavoroId, ["bozza_valida", "bozza_bloccata"]);
});

test("con albero sporco all'avvio il ripristino riporta lo stato sporco e non HEAD", async (t) => {
  const comandi = [];
  const ambiente = await avviaPonteConsiglio(t, {
    cartella: "consiglio-git-sporco",
    eseguiComandoConsiglio: async (eseguibile, argomenti) => {
      const riga = argomenti.join(" ");
      comandi.push(riga);
      if (riga === "--version") return { codice: 0, uscita: "git version 2.45.0", scaduto: false };
      if (riga === "status --porcelain") return { codice: 0, uscita: " M a.txt\n", scaduto: false };
      if (riga === "stash create") return { codice: 0, uscita: "abc1234def5678\n", scaduto: false };
      if (riga === "rev-parse HEAD") return { codice: 0, uscita: "0000000head000\n", scaduto: false };
      return { codice: 0, uscita: "", scaduto: false };
    },
  });
  await mkdir(join(ambiente.cartellaLavoro, ".git"), { recursive: true });
  await writeFile(join(ambiente.cartellaLavoro, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  const npmCli = join(ambiente.home, "npm-cli.js");
  await writeFile(npmCli, "// finto npm\n", "utf8");

  const { avvio, finale } = await avviaEAttendi(ambiente, { tipo: "codice", consenso: true });
  assert.equal(finale.lavoro.git.disponibile, true);
  assert.match(finale.lavoro.consenso.testo, /posso riportare allo stato di adesso/);
  const lavoro = ambiente.ponte.consiglio.lavori.get(avvio.lavoroId);
  assert.equal(lavoro.gitBase, "abc1234def5678", "la base è lo stash dello stato sporco");
  assert.equal(comandi.includes("stash create"), true);
  assert.equal(comandi.includes("rev-parse HEAD"), false, "con albero sporco HEAD non è la base");
});

test("solo file non tracciati, la base è HEAD e il ripristino resta possibile", async (t) => {
  const comandi = [];
  const ambiente = await avviaPonteConsiglio(t, {
    cartella: "consiglio-git-non-tracciati",
    eseguiComandoConsiglio: async (eseguibile, argomenti) => {
      const riga = argomenti.join(" ");
      comandi.push(riga);
      if (riga === "--version") return { codice: 0, uscita: "git version 2.45.0", scaduto: false };
      // Un file non tracciato sporca lo stato ma non entra in uno stash.
      if (riga === "status --porcelain") return { codice: 0, uscita: "?? nuovo.txt\n", scaduto: false };
      if (riga === "stash create") return { codice: 0, uscita: "", scaduto: false };
      if (riga === "rev-parse HEAD") return { codice: 0, uscita: "cafe1234cafe\n", scaduto: false };
      return { codice: 0, uscita: "", scaduto: false };
    },
  });
  await mkdir(join(ambiente.cartellaLavoro, ".git"), { recursive: true });
  await writeFile(join(ambiente.cartellaLavoro, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  await writeFile(join(ambiente.home, "npm-cli.js"), "// finto npm\n", "utf8");

  const { avvio, finale } = await avviaEAttendi(ambiente, { tipo: "codice", consenso: true });
  assert.equal(finale.lavoro.git.disponibile, true, "un file non tracciato non deve togliere il ripristino");
  assert.match(finale.lavoro.consenso.testo, /posso riportare allo stato di adesso/);
  const lavoro = ambiente.ponte.consiglio.lavori.get(avvio.lavoroId);
  assert.equal(lavoro.gitBase, "cafe1234cafe", "senza stash la base sono i file tracciati a HEAD");
  assert.equal(comandi.includes("stash create"), true);
  assert.equal(comandi.includes("rev-parse HEAD"), true, "il ripiego su HEAD deve essere stato chiesto");
});

test("un avviso di git su stderr non falsifica la base", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, {
    cartella: "consiglio-git-avviso",
    eseguiComandoConsiglio: async (eseguibile, argomenti) => {
      const riga = argomenti.join(" ");
      if (riga === "--version") return { codice: 0, uscita: "git version 2.45.0", scaduto: false };
      if (riga === "status --porcelain") return { codice: 0, uscita: "", scaduto: false };
      if (riga === "rev-parse HEAD") {
        return {
          codice: 0,
          uscita: "warning: in the working copy of 'a.txt', LF will be replaced by CRLF\nfeed5678feed\n",
          scaduto: false,
        };
      }
      return { codice: 0, uscita: "", scaduto: false };
    },
  });
  await mkdir(join(ambiente.cartellaLavoro, ".git"), { recursive: true });
  await writeFile(join(ambiente.cartellaLavoro, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  await writeFile(join(ambiente.home, "npm-cli.js"), "// finto npm\n", "utf8");

  const { avvio, finale } = await avviaEAttendi(ambiente, { tipo: "codice", consenso: true });
  assert.equal(finale.lavoro.git.disponibile, true, "un avviso su stderr non deve disattivare il ripristino");
  const lavoro = ambiente.ponte.consiglio.lavori.get(avvio.lavoroId);
  assert.equal(lavoro.gitBase, "feed5678feed", "la base è lo SHA, non la prima parola dell'avviso");
});

test("il comando del consiglio tiene separati stdout e stderr", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-flussi" });
  let esito = null;
  ambiente.conf.controllo = async (dati) => {
    esito = await dati.esegui(
      process.execPath,
      ["-e", "process.stderr.write('warning: attenzione\\n'); process.stdout.write('abc1234def5678\\n')"],
      { timeoutMs: 20_000 },
    );
    return { tipo: "eval", esito: "pass", motivi: [] };
  };
  const { finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  assert.ok(esito, "il doppio del controllo deve avere eseguito il comando");
  assert.equal(esito.codice, 0);
  assert.equal(esito.stdout.trim(), "abc1234def5678", "stdout non deve contenere l'avviso");
  assert.match(esito.stderr, /warning: attenzione/);
  assert.match(esito.uscita, /abc1234def5678/, "il registro completo resta disponibile per il log");
});

test("rifai non tocca un file tracciato che il consiglio non ha dichiarato", async (t) => {
  const comandi = [];
  const ambiente = await avviaPonteConsiglio(t, {
    cartella: "consiglio-git-selettivo",
    eseguiComandoConsiglio: async (eseguibile, argomenti) => {
      const riga = argomenti.join(" ");
      comandi.push(argomenti);
      if (riga === "--version") return { codice: 0, uscita: "git version 2.45.0", scaduto: false };
      if (riga === "status --porcelain") return { codice: 0, uscita: "", scaduto: false };
      if (riga === "rev-parse HEAD") return { codice: 0, uscita: "beef1234beef\n", scaduto: false };
      // Anche se git elencasse più file, il ripristino resta sull'intersezione.
      if (argomenti[0] === "ls-files") return { codice: 0, uscita: "a.txt\nb.txt\n", scaduto: false };
      return { codice: 0, uscita: "", scaduto: false };
    },
  });
  await mkdir(join(ambiente.cartellaLavoro, ".git"), { recursive: true });
  await writeFile(join(ambiente.cartellaLavoro, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  const npmCli = join(ambiente.home, "npm-cli.js");
  await writeFile(npmCli, "// finto npm\n", "utf8");
  ambiente.conf.fileModificati = ["a.txt"];

  const { avvio } = await avviaEAttendi(ambiente, { tipo: "codice", consenso: true });
  const lavoro = ambiente.ponte.consiglio.lavori.get(avvio.lavoroId);
  assert.equal(lavoro.gitBase, "beef1234beef", "con albero pulito la base è HEAD");

  const conferma = await ambiente.post("/api/consiglio/rifai", {
    lavoroId: avvio.lavoroId,
    revisioneAttesa: 1,
    ripristina: true,
  });
  assert.equal(conferma.risposta.status, 200, JSON.stringify(conferma.dati));
  assert.equal(conferma.dati.ripristino.conferma, "richiesta");
  assert.deepEqual(conferma.dati.ripristino.file, ["a.txt"]);
  assert.equal(comandi.some((voce) => voce[0] === "checkout"), false, "senza conferma non si tocca il disco");

  const eseguito = await ambiente.post("/api/consiglio/rifai", {
    lavoroId: avvio.lavoroId,
    revisioneAttesa: 1,
    ripristina: true,
    confermaRipristino: true,
  });
  assert.equal(eseguito.risposta.status, 202, JSON.stringify(eseguito.dati));
  const checkout = comandi.find((voce) => voce[0] === "checkout");
  assert.ok(checkout, "il ripristino confermato usa checkout");
  assert.deepEqual(checkout, ["checkout", "beef1234beef", "--", "a.txt"]);
  assert.equal(checkout.includes("b.txt"), false, "un file tracciato non dichiarato resta com'è");
  assert.equal(comandi.some((voce) => voce.includes("--hard") || voce[0] === "clean"), false);
  assert.deepEqual(percorsiDaRipristinare({ dichiarati: ["a.txt"], tracciati: ["a.txt", "b.txt"] }), ["a.txt"]);
  await attendiStato(ambiente, avvio.lavoroId, ["bozza_valida", "bozza_bloccata"]);
});

test("con un lavoro di codice in corso l'auto stop non parte", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, {
    cartella: "consiglio-settled-lento-autostop",
    autoStopMs: 1000,
    eseguiComandoConsiglio: async () => ({ codice: 1, uscita: "git assente", scaduto: false }),
  });
  await writeFile(join(ambiente.cartellaLavoro, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf8");
  const avvio = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente, { tipo: "codice", consenso: true }));
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  await attendiStato(ambiente, avvio.dati.lavoroId, ["raccolta"], 5000);
  assert.equal(ambiente.ponte.consiglio.lavoriInCorso().length, 1);
  ambiente.ponte.programmaAutoStop();
  await pausa(120);
  assert.equal(ambiente.ponte.consiglio.lavoriInCorso().length, 1, "il lavoro deve essere ancora in corso");
  assert.equal(ambiente.ponte.server.listening, true, "il ponte non si spegne sotto un lavoro in corso");
  assert.equal(ambiente.ponte.sessioni.size, 3);
  await attendiStato(ambiente, avvio.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);
});

test("la chiusura termina il processo dei test e i suoi discendenti", async (t) => {
  let figlio = null;
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-chiusura" });
  ambiente.conf.discendenti = [{ pid: 424242, creatoIl: "2026-09-11T10:00:00Z" }];
  ambiente.conf.controllo = (dati) => {
    figlio = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    dati.registraProcesso(figlio);
    return { tipo: "test", esito: "pass", motivi: [], logTroncato: "registro dei test" };
  };
  const { finale } = await avviaEAttendi(ambiente);
  assert.equal(finale.lavoro.stato, "bozza_valida");
  assert.ok(figlio?.pid, "il doppio deve avere registrato un processo");
  assert.equal(figlio.exitCode, null, "il processo dei test è ancora vivo prima della chiusura");
  const uscita = new Promise((risolvi) => figlio.once("exit", risolvi));
  await ambiente.ponte.chiudiTutto();
  await uscita;
  assert.notEqual(figlio.exitCode === null && figlio.signalCode === null, true, "il processo dei test deve essere terminato");
  assert.equal(ambiente.conf.discendentiRichiesti.includes(figlio.pid), true, "i discendenti vanno cercati dal pid del processo dei test");
  assert.deepEqual(ambiente.conf.discendentiTerminati.at(-1), ambiente.conf.discendenti);
});

test("senza doppi il ponte usa i moduli dello scrittore e dei controlli", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-moduli-veri", senzaDoppi: true });
  const { avvio, finale } = await avviaEAttendi(ambiente);
  // Il Pi finto non risponde nel formato a cinque sezioni: il parser dello
  // scrittore deve rifiutarlo e la bozza resta bloccata, non approvabile.
  assert.equal(finale.lavoro.stato, "bozza_bloccata");
  assert.equal(finale.contributi[0].incluso, true, "il contributo del consigliere è stato raccolto");
  assert.match(finale.lavoro.motivo, /intestazione "### RISULTATO"/);
  assert.equal(finale.azioni.approva, false);
  const lavoro = ambiente.ponte.consiglio.lavori.get(avvio.lavoroId);
  assert.match(lavoro.testoGrezzoScrittore, /ruolo scrittore/, "il testo grezzo dello scrittore resta conservato");
});

test("gli allegati arrivano ai ruoli per riferimento e non per contenuto", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-allegati" });
  const segreto = "contenuto riservato del cliente";
  const improntaAllegato = createHash("sha256").update(segreto, "utf8").digest("hex");
  const { avvio, finale } = await avviaEAttendi(ambiente, {
    allegati: [{ percorso: "C:/dati/nota.txt", nome: "nota.txt", contenuto: segreto }],
  });
  assert.equal(finale.lavoro.stato, "bozza_valida");
  const tracce = (await readdir(ambiente.cartellaLavoro))
    .filter((nome) => nome.startsWith("consiglio-prompt-"));
  assert.equal(tracce.length, 2, "una traccia dei prompt per ogni sessione di ruolo");
  let testoRicevuto = "";
  for (const nome of tracce) {
    testoRicevuto += await readFile(join(ambiente.cartellaLavoro, nome), "utf8");
  }
  assert.match(testoRicevuto, /^### ALLEGATI$/mu, "il consigliere deve vedere la sezione degli allegati");
  assert.match(testoRicevuto, /C:\/dati\/nota\.txt/, "il percorso arriva al ruolo");
  assert.equal(testoRicevuto.includes(improntaAllegato), true, "l'impronta arriva al ruolo");
  assert.equal(testoRicevuto.includes(segreto), false, "il contenuto non deve mai arrivare al ruolo");
  // Alla fusione i riferimenti arrivano dentro le istruzioni aggiuntive, che è
  // il campo previsto dal contratto dello scrittore: il ponte non aggiunge
  // campi né sezioni a un modulo che non è suo.
  const istruzioniFusione = String(ambiente.conf.ultimoInputFusione.istruzioni || "");
  assert.match(istruzioniFusione, /^### ALLEGATI$/mu, "anche la fusione riceve i soli riferimenti");
  assert.match(istruzioniFusione, /C:\/dati\/nota\.txt/);
  assert.equal(istruzioniFusione.includes(improntaAllegato), true, "l'impronta arriva alla fusione");
  assert.equal(istruzioniFusione.includes(segreto), false, "alla fusione non arriva il contenuto");
  assert.equal(
    Object.hasOwn(ambiente.conf.ultimoInputFusione, "allegati"),
    false,
    "il ponte non passa un campo che il contratto dello scrittore non prevede",
  );
  assert.deepEqual(finale.lavoro.allegati, [{
    percorso: "C:/dati/nota.txt",
    nome: "nota.txt",
    dimensione: Buffer.byteLength(segreto, "utf8"),
    impronta: improntaAllegato,
  }], "lo stato del lavoro espone i soli riferimenti");
  const suDisco = await readFile(
    join(ambiente.home, ".pi", "gui", "consigli", avvio.lavoroId + ".json"),
    "utf8",
  );
  assert.equal(suDisco.includes(segreto), false, "il contenuto non finisce nel file del lavoro");
  assert.equal(suDisco.includes(improntaAllegato), true);
});

test("un allegato senza percorso ferma l'avvio", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-allegati-rotti" });
  const esito = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente, {
    allegati: [{ nome: "senza-percorso.txt", contenuto: "testo" }],
  }));
  assert.equal(esito.risposta.status, 400, JSON.stringify(esito.dati));
  assert.match(esito.dati.messaggio, /percorso del file/);
  assert.equal(ambiente.ponte.consiglio.lavori.size, 0);
  assert.equal(ambiente.ponte.sessioni.size, 1, "nessuna sessione di ruolo aperta");
});

test("il piano indicato a mano rifiuta la riga di shell e non apre niente", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-piano-shell" });
  const casi = [
    ["npm test", /riga di comando da interpretare con la shell/],
    [{ comando: "npm test" }, /campo comando come riga di shell/],
    [{ eseguibile: "node && del tutto" }, /caratteri da shell/],
    [{ eseguibile: "prova.cmd" }, /\.cmd o \.bat/],
    [{ eseguibile: "node", argomenti: "--test" }, /devono essere una lista/],
  ];
  for (const [piano, atteso] of casi) {
    const esito = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente, {
      tipo: "codice",
      consenso: true,
      piano,
    }));
    assert.equal(esito.risposta.status, 400, JSON.stringify(esito.dati));
    assert.equal(esito.dati.codice, "piano-non-valido");
    assert.match(esito.dati.messaggio, atteso);
    assert.equal(
      esito.dati.messaggio,
      normalizzaPianoManuale(piano, ambiente.cartellaLavoro).motivo,
      "il motivo arriva dal modulo dei controlli, non da una copia nel ponte",
    );
  }
  assert.equal(ambiente.ponte.consiglio.lavori.size, 0, "nessun lavoro creato");
  assert.equal(ambiente.ponte.sessioni.size, 1, "nessuna sessione di ruolo aperta");
  const suTesto = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente, {
    piano: { eseguibile: process.execPath, argomenti: [] },
  }));
  assert.equal(suTesto.risposta.status, 400, JSON.stringify(suTesto.dati));
  assert.match(suTesto.dati.messaggio, /lavoro di solo testo non esegue comandi/);
});

test("il piano indicato a mano entra nel consenso e nel controllo", async (t) => {
  const ambiente = await avviaPonteConsiglio(t, { cartella: "consiglio-piano-a-mano" });
  const piano = { eseguibile: process.execPath, argomenti: ["-e", "process.exit(0)"] };
  const avvio = await ambiente.post("/api/consiglio/avvia", corpoAvvio(ambiente, {
    tipo: "codice",
    consenso: true,
    piano,
  }));
  assert.equal(avvio.risposta.status, 202, JSON.stringify(avvio.dati));
  assert.equal(avvio.dati.piano.origine, "manuale");
  assert.deepEqual(avvio.dati.piano.argomenti, ["-e", "process.exit(0)"]);
  assert.equal(avvio.dati.piano.eseguibile, process.execPath);
  const finale = await attendiStato(ambiente, avvio.dati.lavoroId, ["bozza_valida", "bozza_bloccata"]);
  assert.equal(finale.lavoro.stato, "bozza_valida", JSON.stringify(finale.lavoro));
  assert.match(finale.lavoro.consenso.testo, /senza passare da una shell/);
  assert.match(finale.lavoro.consenso.testo, /-e process\.exit\(0\)/);
  assert.equal(ambiente.conf.opzioniControllo.piano.origine, "manuale");
  assert.equal(ambiente.conf.opzioniControllo.piano.cwd, ambiente.cartellaLavoro);
  assert.equal(ambiente.conf.opzioniControllo.piano.filePiano, null, "un piano a mano non ha un file da congelare");
});

test("le impronte dei file dichiarati si confrontano in una forma sola", () => {
  const daiControlli = improntaFileCanonica({
    dichiarato: "a.txt",
    percorso: "C:/lavoro/a.txt",
    fuoriCartella: false,
    stato: "presente",
    dimensione: 12,
    sha256: "ab".repeat(32),
  });
  assert.equal(daiControlli.impronta, "ab".repeat(32));
  assert.equal(daiControlli.percorso, "C:/lavoro/a.txt");
  const dalRipiego = improntaFileCanonica({ percorso: "a.txt", impronta: "cd".repeat(32) });
  assert.equal(dalRipiego.impronta, "cd".repeat(32));
  const assente = improntaFileCanonica({ dichiarato: "b.txt", percorso: "C:/lavoro/b.txt", stato: "assente", sha256: null });
  assert.equal(assente.impronta, null);
  assert.equal(improntaFileCanonica(null), null);
  assert.equal(improntaFileCanonica({ stato: "presente" }), null);
});

test("i lavori interrotti tornano dal disco con la proposta di ripristino", async (t) => {
  const home = await mkdtemp(join(TMP, "pi-gui-ricarica-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cartellaLavoro = join(home, "progetto");
  await mkdir(cartellaLavoro, { recursive: true });
  const radice = join(home, ".pi", "gui", "consigli");
  await mkdir(radice, { recursive: true });
  const adesso = new Date().toISOString();
  const revisione = { numero: 1, prompt: "sistema il modulo", istruzioni: null, allegati: [] };
  await writeFile(join(radice, "lavoro-interrotto.json"), JSON.stringify({
    lavoroId: "lavoro-interrotto",
    sourceSessionId: "sessione-di-ieri",
    workspace: cartellaLavoro,
    tipo: "codice",
    stato: "verifica",
    revisione: 1,
    generazione: 1,
    seq: 7,
    creatoIl: adesso,
    aggiornatoIl: adesso,
    git: { disponibile: true, motivo: null },
    gitBase: "abc1234abc1234",
    revisioni: [revisione],
    revisioneCorrente: revisione,
    ruoli: [
      { roleId: "consigliere-1", tipo: "consigliere", ordine: 1, stato: "completato", guiSessionId: "vecchia-1" },
      { roleId: "scrittore", tipo: "scrittore", ordine: 2, stato: "in_corso", guiSessionId: "vecchia-2" },
    ],
    contributi: [],
    risultato: { testo: "bozza", provenienza: [], scartati: [], fileModificati: ["a.txt"], eval: [], risultatoHash: "x" },
    controllo: null,
    problemi: [],
  }, null, 2), "utf8");
  await writeFile(join(radice, "lavoro-chiuso.json"), JSON.stringify({
    lavoroId: "lavoro-chiuso",
    stato: "approvato",
    tipo: "testo",
    revisione: 1,
    creatoIl: adesso,
    aggiornatoIl: adesso,
    workspace: null,
    ruoli: [],
    contributi: [],
    risultato: { testo: "approvato ieri", provenienza: [], scartati: [], fileModificati: [], eval: [] },
  }, null, 2), "utf8");

  const comandi = [];
  // La rilettura del disco interroga git per la proposta di ripristino: qui la
  // teniamo ferma finché la richiesta di stato è già partita. Così la scheda
  // può comparire solo se il ponte aspetta la rilettura prima di rispondere,
  // che è la stessa cosa che vede l'utente quando apre la finestra.
  let sbloccaGit = () => {};
  const gitFermo = new Promise((risolvi) => { sbloccaGit = risolvi; });
  const ponte = creaPonte({
    home,
    cliPi: FAKE_PI,
    autoStopMs: 0,
    eseguiComandoConsiglio: async (eseguibile, argomenti) => {
      comandi.push(argomenti);
      await gitFermo;
      return { codice: 0, uscita: "a.txt\nb.txt\n", stdout: "a.txt\nb.txt\n", stderr: "", scaduto: false };
    },
    caricaSupportoRuntime: async () => ({
      versione: "0.84.2",
      getAgentDir: () => join(home, ".pi", "agent"),
      getShareViewerUrl: () => "https://example.test/share",
      ProjectTrustStore: class { get() { return null; } set() {} },
      modelliPredefiniti: { fake: "modello-test" },
    }),
  });
  t.after(async () => {
    await ponte.chiudiTutto().catch(() => {});
    if (ponte.server.listening) await new Promise((risolvi) => ponte.server.close(() => risolvi()));
  });
  await new Promise((risolvi) => ponte.server.listen(0, "127.0.0.1", risolvi));
  const base = `http://127.0.0.1:${ponte.server.address().port}`;
  const statoInVolo = fetch(base + "/api/stato").then((risposta) => risposta.json());
  await pausa(50);
  sbloccaGit();
  const stato = await statoInVolo;
  const scheda = stato.sessioni.find((voce) => voce.id === "consiglio:lavoro-interrotto");
  assert.ok(scheda, JSON.stringify(stato.sessioni));
  assert.equal(scheda.consiglio.stato, "interrotto");
  assert.equal(scheda.attiva, false);
  assert.deepEqual(scheda.consiglio.ripristino, { proposto: true, file: ["a.txt"], motivo: null });
  assert.deepEqual(scheda.consiglio.azioni, { approva: false, rifai: true, annulla: true });
  assert.equal(
    stato.sessioni.some((voce) => voce.id === "consiglio:lavoro-chiuso"),
    false,
    "un lavoro già chiuso non torna a occupare una scheda",
  );
  const leggi = async (lavoroId) => {
    const risposta = await fetch(base + "/api/consiglio/stato", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pi-gui-token": stato.tokenApi },
      body: JSON.stringify({ lavoroId }),
    });
    return { risposta, dati: await risposta.json() };
  };
  const interrotto = await leggi("lavoro-interrotto");
  assert.equal(interrotto.risposta.status, 200, JSON.stringify(interrotto.dati));
  assert.equal(interrotto.dati.lavoro.stato, "interrotto");
  assert.match(interrotto.dati.lavoro.motivo, /Il ponte si è chiuso/);
  assert.equal(interrotto.dati.lavoro.ricaricato, true);
  // Il file su disco si ferma a 7: un seq più alto vuol dire che la ricarica ha
  // annunciato lo stato con un evento, per un client già collegato.
  assert.ok(interrotto.dati.seq > 7, "la ricarica annuncia il lavoro ripreso: seq " + interrotto.dati.seq);
  assert.equal(interrotto.dati.ruoli[0].stato, "completato", "un ruolo già concluso resta com'era");
  assert.equal(interrotto.dati.ruoli[1].stato, "errore");
  assert.match(interrotto.dati.ruoli[1].errore, /si è chiuso mentre il ruolo/);
  const chiuso = await leggi("lavoro-chiuso");
  assert.equal(chiuso.risposta.status, 200, JSON.stringify(chiuso.dati));
  assert.equal(chiuso.dati.lavoro.stato, "approvato", "il lavoro concluso resta leggibile");

  assert.equal(comandi.some((voce) => voce[0] === "ls-files"), true, "la proposta guarda i file tracciati");
  assert.equal(comandi.some((voce) => voce[0] === "checkout"), false, "la proposta non tocca il disco");
  const suDisco = JSON.parse(await readFile(join(radice, "lavoro-interrotto.json"), "utf8"));
  assert.equal(suDisco.stato, "interrotto", "lo stato interrotto resta anche dopo una seconda riapertura");
  assert.equal(suDisco.ruoli[1].stato, "errore");
});

test("rifai su un lavoro ripreso non riesegue un piano non rivalidato", async (t) => {
  const adesso = new Date().toISOString();
  const revisione = { numero: 1, prompt: "sistema il modulo", istruzioni: null, allegati: [] };
  const scheletro = (lavoroId, workspace, piano) => ({
    lavoroId,
    sourceSessionId: "sessione-di-ieri",
    workspace,
    tipo: "codice",
    stato: "bozza_valida",
    revisione: 1,
    generazione: 1,
    seq: 3,
    creatoIl: adesso,
    aggiornatoIl: adesso,
    git: { disponibile: false, motivo: "Git non disponibile in questa prova." },
    gitBase: null,
    consenso: { accettato: true, at: adesso, testo: "Consenso raccolto in un'altra sessione del ponte." },
    piano,
    revisioni: [revisione],
    revisioneCorrente: revisione,
    ruoli: [
      { roleId: "consigliere-1", tipo: "consigliere", ordine: 1, stato: "completato", guiSessionId: "vecchia-1", provider: "fake", modello: "modello-test", thinking: null },
      { roleId: "scrittore", tipo: "scrittore", ordine: 2, stato: "completato", guiSessionId: "vecchia-2", provider: "fake", modello: "modello-test", thinking: null },
    ],
    contributi: [],
    risultato: {
      testo: "bozza di ieri", provenienza: [], scartati: [], fileModificati: [], eval: [], risultatoHash: "x",
    },
    controllo: { tipo: "test", esito: "pass", motivi: [], logTroncato: null, impronteFile: [], at: adesso },
    problemi: [],
  });
  const ambiente = await avviaPonteConsiglio(t, {
    cartella: "consiglio-ripresa-piano",
    primaDelPonte: async ({ home, cartellaLavoro }) => {
      const radice = join(home, ".pi", "gui", "consigli");
      await mkdir(radice, { recursive: true });
      // Sul disco c'è un piano che oggi non passerebbe il controllo di "avvia":
      // l'eseguibile porta un carattere da shell. Senza rivalidazione alla
      // riapertura, Rifai lo rieseguirebbe così come sta scritto nel file.
      await writeFile(join(radice, "lavoro-manomesso.json"), JSON.stringify(scheletro(
        "lavoro-manomesso",
        cartellaLavoro,
        {
          origine: "manuale",
          eseguibile: "cmd.exe & del /q .",
          argomenti: ["-e", "process.exit(0)"],
          cwd: cartellaLavoro,
          filePiano: null,
          pianoHash: null,
          comando: "cmd.exe & del /q . -e process.exit(0)",
        },
      ), null, 2), "utf8");
      // Accanto, un piano a mano regolare: la rivalidazione non deve toglierlo.
      await writeFile(join(radice, "lavoro-sano.json"), JSON.stringify(scheletro(
        "lavoro-sano",
        cartellaLavoro,
        {
          origine: "manuale",
          eseguibile: process.execPath,
          argomenti: ["-e", "process.exit(0)"],
          cwd: cartellaLavoro,
          filePiano: null,
          pianoHash: null,
          comando: process.execPath + " -e process.exit(0)",
        },
      ), null, 2), "utf8");
    },
  });

  const manomesso = await ambiente.post("/api/consiglio/stato", { lavoroId: "lavoro-manomesso" });
  assert.equal(manomesso.risposta.status, 200, JSON.stringify(manomesso.dati));
  assert.equal(manomesso.dati.lavoro.ricaricato, true);
  assert.equal(manomesso.dati.lavoro.piano.origine, "assente", "il piano a mano si rivalida alla riapertura");
  assert.match(manomesso.dati.lavoro.piano.motivo, /non supera il controllo alla riapertura/);
  assert.match(manomesso.dati.lavoro.piano.motivo, /caratteri da shell/);

  const sano = await ambiente.post("/api/consiglio/stato", { lavoroId: "lavoro-sano" });
  assert.equal(sano.risposta.status, 200, JSON.stringify(sano.dati));
  assert.equal(sano.dati.lavoro.piano.origine, "manuale", "un piano regolare torna intero");
  assert.equal(sano.dati.lavoro.piano.eseguibile, process.execPath);
  assert.deepEqual(sano.dati.lavoro.piano.argomenti, ["-e", "process.exit(0)"]);

  const senzaConsenso = await ambiente.post("/api/consiglio/rifai", {
    operationId: "op-" + randomUUID(),
    lavoroId: "lavoro-manomesso",
    revisioneAttesa: 1,
    ripristina: false,
  });
  assert.equal(senzaConsenso.risposta.status, 409, JSON.stringify(senzaConsenso.dati));
  assert.equal(senzaConsenso.dati.codice, "consenso-mancante");
  assert.match(senzaConsenso.dati.consenso, /Non è stato riconosciuto un comando di test/);
  assert.equal(ambiente.ponte.consiglio.lavori.get("lavoro-manomesso").revisione, 1, "niente revisione nuova");

  const conConsenso = await ambiente.post("/api/consiglio/rifai", {
    operationId: "op-" + randomUUID(),
    lavoroId: "lavoro-manomesso",
    revisioneAttesa: 1,
    ripristina: false,
    consenso: true,
  });
  assert.equal(conConsenso.risposta.status, 202, JSON.stringify(conConsenso.dati));
  const finale = await attendiStato(ambiente, "lavoro-manomesso", ["bozza_valida", "bozza_bloccata"]);
  assert.equal(finale.lavoro.stato, "bozza_bloccata", JSON.stringify(finale.lavoro));
  assert.match(finale.controllo.motivi[0], /non supera il controllo alla riapertura/);
  assert.equal(ambiente.conf.controlloChiamate, 0, "il modulo dei controlli non viene nemmeno chiamato");
  assert.equal(ambiente.conf.opzioniControllo, null, "nessun comando arriva all'esecuzione");
  assert.match(
    finale.lavoro.consenso.testo,
    /Non è stato riconosciuto un comando di test/,
    "il consenso appena dato vale per il piano di adesso",
  );
});
