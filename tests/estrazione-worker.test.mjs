import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { creaGestoreEstrazione } from "../app/estrazione-worker.mjs";
import { creaPonte } from "../app/server.mjs";
import { docxMinimo } from "./fixture-documenti.mjs";

const URL_FIXTURE = new URL("./fixture-estrazione-worker.mjs", import.meta.url);
async function attendiAttivi(gestore, numero) {
  const fine = Date.now() + 3000;
  while (gestore.attivi !== numero && Date.now() < fine) await new Promise((risolvi) => setTimeout(risolvi, 10));
  assert.equal(gestore.attivi, numero);
}

test("worker: timeout termina un parser occupato", async () => {
  const gestore = creaGestoreEstrazione({urlWorker: URL_FIXTURE, timeoutMs: 100});
  const risultato = await gestore.estrai("sessione", {nome: "lento", dati: Buffer.alloc(0)});
  assert.equal(risultato.stato, "errore");
  assert.match(risultato.motivo, /tempo massimo/);
  assert.equal(gestore.attivi, 0);
});

test("worker: errore e uscita senza risultato non lasciano thread attivi", async () => {
  const gestore = creaGestoreEstrazione({urlWorker: URL_FIXTURE});
  for (const nome of ["errore", "uscita"]) {
    const risultato = await gestore.estrai("sessione", {nome, dati: Buffer.alloc(0)});
    assert.equal(risultato.stato, "errore");
    assert.match(risultato.motivo, /Errore di estrazione simulato|senza risultato/);
    assert.equal(gestore.attivi, 0);
  }
});

test("worker: una sola estrazione per sessione, chiusura annulla anche la coda", async () => {
  const gestore = creaGestoreEstrazione({urlWorker: URL_FIXTURE});
  const primo = gestore.estrai("A", {nome: "lento", dati: Buffer.alloc(0)});
  const secondo = gestore.estrai("A", {nome: "lento", dati: Buffer.alloc(0)});
  const terzo = gestore.estrai("B", {nome: "lento", dati: Buffer.alloc(0)});
  await attendiAttivi(gestore, 2);
  await gestore.chiudiSessione("A");
  assert.equal((await primo).annullata, true);
  assert.equal((await secondo).annullata, true);
  assert.equal(gestore.attivi, 1);
  await gestore.chiudi();
  assert.equal((await terzo).annullata, true);
  assert.equal(gestore.attivi, 0);
});

test("worker: estrae davvero Office in un thread e lo termina", async () => {
  const gestore = creaGestoreEstrazione();
  const risultato = await gestore.estrai("A", {nome: "prova.docx", dati: docxMinimo("Città nel worker")});
  assert.equal(risultato.stato, "ok", risultato.motivo);
  assert.equal(risultato.testo, "Città nel worker");
  assert.equal(gestore.attivi, 0);
});

test("worker: chiusura attende la preparazione e rifiuta la generazione precedente", async () => {
  for (const globale of [false, true]) {
    const gestore = creaGestoreEstrazione({urlWorker: URL_FIXTURE});
    const preparazione = gestore.iniziaPreparazione("A");
    let conclusa = false;
    const chiusura = (globale ? gestore.chiudi() : gestore.chiudiSessione("A")).then(() => { conclusa = true; });
    await new Promise((risolvi) => setTimeout(risolvi, 30));
    assert.equal(conclusa, false, "La preparazione deve essere attesa.");
    const risultato = await gestore.estrai("A", {nome: "lento", dati: Buffer.alloc(0), generazione: preparazione.generazione});
    assert.equal(risultato.stato, "errore");
    assert.equal(risultato.motivo, "sessione chiusa");
    preparazione.termina();
    await chiusura;
    assert.equal(gestore.attivi, 0);
    assert.equal((await gestore.estrai("A", {nome: "lento", generazione: preparazione.generazione})).motivo, "sessione chiusa");
  }
});

test("worker: ricontrolla la generazione appena prima di avviare la coda", async () => {
  const gestore = creaGestoreEstrazione({urlWorker: URL_FIXTURE});
  const preparazione = gestore.iniziaPreparazione("A");
  const lavoro = gestore.estrai("A", {nome: "lento", generazione: preparazione.generazione});
  preparazione.termina();
  await gestore.chiudiSessione("A");
  assert.equal((await lavoro).motivo, "sessione chiusa");
  assert.equal(gestore.attivi, 0);
});

test("worker: la preparazione bloccata non prolunga la chiusura oltre due secondi", async () => {
  for (const globale of [false, true]) {
    const gestore = creaGestoreEstrazione({urlWorker: URL_FIXTURE});
    const preparazione = gestore.iniziaPreparazione("A");
    const inizio = Date.now();
    await (globale ? gestore.chiudi() : gestore.chiudiSessione("A"));
    const durata = Date.now() - inizio;
    assert.ok(durata >= 1900 && durata < 3000, "Attesa limitata a 2 secondi: " + durata);
    const risultato = await gestore.estrai("A", {nome: "lento", generazione: preparazione.generazione});
    preparazione.termina();
    assert.equal(risultato.motivo, "sessione chiusa");
    assert.equal(gestore.attivi, 0);
  }
});

test("worker: /api/salute risponde durante estrazione lunga e chiudiTutto termina il worker", async (t) => {
  await mkdir(resolve(".tmp-test"), {recursive: true});
  const cartella = await mkdtemp(resolve(".tmp-test", "worker-ponte-"));
  const gestore = creaGestoreEstrazione({urlWorker: URL_FIXTURE});
  const ponte = creaPonte({home: join(cartella, "home"), radiceSenzaCartella: join(cartella, "neutra"), cliPi: resolve("tests/fake-pi.mjs"), gestoreEstrazione: gestore});
  await new Promise((risolvi) => ponte.server.listen(0, "127.0.0.1", risolvi));
  t.after(async () => {
    await gestore.chiudi();
    await ponte.chiudiTutto({definitiva: false});
    await new Promise((risolvi) => ponte.server.close(risolvi));
    await rm(cartella, {recursive: true, force: true});
  });
  const lavoro = gestore.estrai("A", {nome: "lento", dati: Buffer.alloc(0)});
  await attendiAttivi(gestore, 1);
  const inizio = Date.now();
  const risposta = await fetch("http://127.0.0.1:" + ponte.server.address().port + "/api/salute", {signal: AbortSignal.timeout(3000)});
  assert.equal(risposta.status, 200);
  await risposta.json();
  assert.ok(Date.now() - inizio < 3000);
  await ponte.chiudiTutto({definitiva: false});
  assert.equal(gestore.attivi, 0);
  assert.equal((await lavoro).annullata, true);
});
