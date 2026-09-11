import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { creaPonte, validaImpostazioniGui } from "../app/server.mjs";
import {
  configurazioneConsiglioPredefinita,
  modelliPredefinitiConsiglio,
  risolviRuoliConsiglio,
  validaConfigurazioneConsiglio,
} from "../app/consiglio-ruoli.mjs";

const QUI = dirname(fileURLToPath(import.meta.url));
const FAKE_PI = join(QUI, "fake-pi.mjs");

const UN_MODELLO = [{ provider: "fake", id: "modello-test", name: "Modello test" }];
const DUE_MODELLI = [
  { provider: "fake", id: "modello-test", name: "Modello test" },
  { provider: "fake", id: "modello-secondo", name: "Modello secondo" },
];

async function avviaPonteRuoli(t, opzioni = {}) {
  const home = await mkdtemp(join(tmpdir(), "pi-gui-consiglio-ruoli-"));
  const ponte = creaPonte({
    home,
    cliPi: FAKE_PI,
    maxSessioni: 4,
    elencaDiscendenti: async () => [],
    terminaDiscendenti: async () => true,
    caricaSupportoRuntime: async () => ({
      versione: "0.84.2",
      getAgentDir: () => join(home, ".pi", "agent"),
      getShareViewerUrl: () => "https://example.test/share",
      ProjectTrustStore: class { get() { return null; } set() {} },
      modelliPredefiniti: { fake: "modello-test" },
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
  t.after(async () => {
    await ponte.chiudiTutto().catch(() => {});
    if (ponte.server.listening) await new Promise((risolvi) => ponte.server.close(() => risolvi()));
    await rm(home, { recursive: true, force: true });
  });
  return { home, ponte, base, post };
}

test("default con un solo modello usa lo stesso per i due ruoli", () => {
  const risolti = risolviRuoliConsiglio({ catalogo: UN_MODELLO });
  assert.equal(risolti.avvioPossibile, true);
  assert.equal(risolti.effettive.consiglieri.length, 1);
  assert.deepEqual(
    [risolti.effettive.consiglieri[0].provider, risolti.effettive.consiglieri[0].modello],
    ["fake", "modello-test"],
  );
  assert.deepEqual(
    [risolti.effettive.scrittore.provider, risolti.effettive.scrittore.modello],
    ["fake", "modello-test"],
  );
  assert.equal(risolti.effettive.scrittore.automatico, true);
  assert.deepEqual(risolti.problemi, []);

  const senzaModelli = risolviRuoliConsiglio({ catalogo: [] });
  assert.equal(senzaModelli.avvioPossibile, false);
  assert.equal(senzaModelli.problemi.some((problema) => problema.codice === "catalogo-vuoto"), true);
});

test("default con due o più modelli separa scrittore e consigliere", () => {
  const senzaSorgente = modelliPredefinitiConsiglio({ catalogo: DUE_MODELLI });
  assert.equal(senzaSorgente.scrittore.modelId, "modello-test");
  assert.equal(senzaSorgente.consigliere.modelId, "modello-secondo");

  const risolti = risolviRuoliConsiglio({
    catalogo: DUE_MODELLI,
    modelloSorgente: { provider: "fake", modelId: "modello-secondo" },
  });
  assert.equal(risolti.effettive.scrittore.modello, "modello-secondo");
  assert.equal(risolti.effettive.consiglieri[0].modello, "modello-test");
  assert.notEqual(risolti.effettive.scrittore.modello, risolti.effettive.consiglieri[0].modello);
});

test("un modello assegnato e sparito torna al default con avviso", () => {
  const configurazione = validaConfigurazioneConsiglio({
    schemaVersion: 1,
    version: 3,
    consiglieri: [{ roleId: "consigliere-1", model: { provider: "fake", modelId: "modello-sparito" }, thinking: null }],
    scrittore: { roleId: "scrittore", model: { provider: "fake", modelId: "modello-test" }, thinking: null },
  });
  const risolti = risolviRuoliConsiglio({ configurazione, catalogo: UN_MODELLO });
  assert.equal(risolti.effettive.consiglieri[0].modello, "modello-test");
  assert.equal(risolti.effettive.consiglieri[0].automatico, true);
  assert.equal(risolti.effettive.consiglieri[0].nonDisponibile, "fake/modello-sparito");
  assert.equal(risolti.effettive.scrittore.automatico, false);
  assert.equal(risolti.problemi.length, 1);
  assert.equal(risolti.problemi[0].codice, "modello-non-disponibile");
  assert.match(risolti.problemi[0].messaggio, /non è più disponibile/);
  assert.equal(risolti.avvioPossibile, true);
});

test("il validatore accetta soglia e consiglio insieme", () => {
  const configurazione = configurazioneConsiglioPredefinita();
  const entrambi = validaImpostazioniGui({ sogliaCompattazionePercento: 80, consiglio: configurazione });
  assert.equal(entrambi.sogliaCompattazionePercento, 80);
  assert.equal(entrambi.consiglio.consiglieri.length, 1);
  assert.deepEqual(Object.keys(validaImpostazioniGui({ consiglio: configurazione })), ["consiglio"]);
  assert.deepEqual(validaImpostazioniGui({ sogliaCompattazionePercento: 90 }), { sogliaCompattazionePercento: 90 });
  assert.throws(() => validaImpostazioniGui({}), /almeno un campo/);
  assert.throws(() => validaImpostazioniGui({ sogliaCompattazionePercento: 90, extra: 1 }), /soltanto/);
  assert.throws(
    () => validaImpostazioniGui({ consiglio: { ...configurazione, consiglieri: [] } }),
    /consiglieri devono essere/,
  );
  assert.throws(
    () => validaImpostazioniGui({ consiglio: { ...configurazione, scrittore: { roleId: "altro", model: null } } }),
    /identificativo "scrittore"/,
  );
});

test("salvare solo la soglia non cancella i ruoli", async (t) => {
  const ambiente = await avviaPonteRuoli(t);
  const configurazione = {
    ...configurazioneConsiglioPredefinita(),
    version: 1,
    consiglieri: [
      { roleId: "consigliere-1", model: { provider: "fake", modelId: "modello-test" }, thinking: null },
      { roleId: "consigliere-2", model: null, thinking: null },
    ],
  };
  const primo = await ambiente.post("/api/impostazioni", { consiglio: configurazione });
  assert.equal(primo.risposta.status, 200, JSON.stringify(primo.dati));
  assert.equal(primo.dati.consiglio.consiglieri.length, 2);
  assert.equal(primo.dati.sogliaCompattazionePercento, 90);

  const secondo = await ambiente.post("/api/impostazioni", { sogliaCompattazionePercento: 75 });
  assert.equal(secondo.risposta.status, 200, JSON.stringify(secondo.dati));
  assert.equal(secondo.dati.sogliaCompattazionePercento, 75);
  assert.equal(secondo.dati.consiglio.consiglieri.length, 2, "i ruoli non devono sparire");

  const letto = await (await fetch(ambiente.base + "/api/impostazioni")).json();
  assert.equal(letto.sogliaCompattazionePercento, 75);
  assert.equal(letto.consiglio.consiglieri[0].model.modelId, "modello-test");

  const suDisco = JSON.parse(
    await readFile(join(ambiente.home, ".pi", "gui", "impostazioni.json"), "utf8"),
  );
  assert.equal(suDisco.sogliaCompattazionePercento, 75);
  assert.equal(suDisco.consiglio.consiglieri.length, 2);
});

test("due salvataggi sovrapposti non si cancellano a vicenda", async (t) => {
  const ambiente = await avviaPonteRuoli(t);
  const configurazione = {
    ...configurazioneConsiglioPredefinita(),
    version: 1,
    consiglieri: [
      { roleId: "consigliere-1", model: { provider: "fake", modelId: "modello-test" }, thinking: null },
      { roleId: "consigliere-2", model: null, thinking: null },
    ],
  };
  // Le due richieste partono insieme: senza la fusione dentro il serializzatore
  // leggerebbero la stessa base e l'ultima cancellerebbe la chiave dell'altra.
  const [soglia, ruoli] = await Promise.all([
    ambiente.post("/api/impostazioni", { sogliaCompattazionePercento: 70 }),
    ambiente.post("/api/impostazioni", { consiglio: configurazione }),
  ]);
  assert.equal(soglia.risposta.status, 200, JSON.stringify(soglia.dati));
  assert.equal(ruoli.risposta.status, 200, JSON.stringify(ruoli.dati));

  const letto = await (await fetch(ambiente.base + "/api/impostazioni")).json();
  assert.equal(letto.sogliaCompattazionePercento, 70, "la soglia non deve sparire");
  assert.equal(letto.consiglio.consiglieri.length, 2, "i ruoli non devono sparire");

  const suDisco = JSON.parse(
    await readFile(join(ambiente.home, ".pi", "gui", "impostazioni.json"), "utf8"),
  );
  assert.equal(suDisco.sogliaCompattazionePercento, 70);
  assert.equal(suDisco.consiglio.consiglieri.length, 2);
});
