import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applicaOperazionePreimpostazioni,
  configurazioneDaPreimpostazione,
  inizializzaPreimpostazioni,
  leggiArchivioPreimpostazioni,
  scriviArchivioPreimpostazioni,
  validaArchivioPreimpostazioni,
  validaOperazionePreimpostazioni,
} from "../app/consiglio-preimpostazioni.mjs";

async function ambiente(t) {
  const cartella = await mkdtemp(join(tmpdir(), "pi-gui-preimpostazioni-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return { cartella, file: join(cartella, "preimpostazioni-agenti.json") };
}

function dati(voce, modifiche = {}) {
  const { id: _id, versione: _versione, ...resto } = voce;
  return { ...resto, ...modifiche };
}

function operazione(archivio, azione, id, preimpostazione) {
  return { azione, versioneArchivioAttesa: archivio.versioneArchivio,
    ...(id ? { id, versioneAttesa: archivio.preimpostazioni.find((voce) => voce.id === id).versione } : {}),
    ...(preimpostazione === undefined ? {} : { preimpostazione }) };
}

test("l'archivio assente nasce con le preimpostazioni iniziali e si scrive in modo atomico", async (t) => {
  const { cartella, file } = await ambiente(t);
  assert.equal(await leggiArchivioPreimpostazioni(file), null);
  const iniziale = inizializzaPreimpostazioni(await leggiArchivioPreimpostazioni(file));
  assert.deepEqual(iniziale.preimpostazioni.map((voce) => voce.nome), ["Rapido", "Tre consiglieri"]);
  assert.equal(iniziale.predefinita, "rapido");
  assert.equal(iniziale.preimpostazioni[0].ordine.length, 2);
  assert.equal(iniziale.preimpostazioni[1].ordine.length, 4);
  let pubblicazioni = 0;
  await scriviArchivioPreimpostazioni(file, iniziale, {
    versioneArchivioAttesa: 0,
    primaPubblicazione: async () => {
      pubblicazioni += 1;
      assert.equal(await leggiArchivioPreimpostazioni(file), null, "il nome finale resta assente fino alla pubblicazione completa");
      if (pubblicazioni === 2) {
        const temporanei = (await readdir(cartella)).filter((nome) => nome.endsWith(".tmp"));
        assert.equal(temporanei.length, 1);
        assert.deepEqual(JSON.parse(await readFile(join(cartella, temporanei[0]), "utf8")), iniziale);
      }
    },
  });
  assert.equal(pubblicazioni, 2);
  assert.deepEqual(await leggiArchivioPreimpostazioni(file), iniziale);
  assert.deepEqual(await readdir(cartella), ["preimpostazioni-agenti.json"]);

  const aggiornato = applicaOperazionePreimpostazioni(iniziale,
    operazione(iniziale, "modifica", "rapido", dati(iniziale.preimpostazioni[0], { nome: "Rapido nuovo" })));
  let passaggi = 0;
  await assert.rejects(scriviArchivioPreimpostazioni(file, aggiornato, {
    versioneArchivioAttesa: iniziale.versioneArchivio,
    primaPubblicazione: async () => {
      assert.deepEqual(await leggiArchivioPreimpostazioni(file), iniziale);
      if (++passaggi === 2) throw new Error("pubblicazione interrotta");
    },
  }), /pubblicazione interrotta/);
  assert.deepEqual(await leggiArchivioPreimpostazioni(file), iniziale);
  assert.deepEqual(await readdir(cartella), ["preimpostazioni-agenti.json"], "il temporaneo incompleto viene rimosso");
});

test("la migrazione dei ruoli 2.8 e idempotente, produce Il mio consiglio come predefinita e non cancella la configurazione di partenza", async (t) => {
  const { cartella, file } = await ambiente(t);
  const precedente = { schemaVersion: 1, version: 7,
    consiglieri: [
      { roleId: "analista", model: { provider: "prova", modelId: "uno" }, thinking: "low" },
      { roleId: "revisore", model: null, thinking: null },
    ], scrittore: { roleId: "scrittore", model: { provider: "prova", modelId: "due" }, thinking: "high" } };
  const originale = JSON.stringify({ sogliaCompattazionePercento: 80, consiglio: precedente }, null, 2);
  const fileOriginale = join(cartella, "impostazioni.json");
  await writeFile(fileOriginale, originale, "utf8");
  const copia = structuredClone(precedente);
  const migrato = inizializzaPreimpostazioni(null, precedente);
  assert.equal(migrato.predefinita, "il-mio-consiglio");
  assert.deepEqual(migrato.preimpostazioni.map((voce) => voce.nome), ["Il mio consiglio", "Rapido", "Tre consiglieri"]);
  assert.deepEqual(configurazioneDaPreimpostazione(migrato.preimpostazioni[0]), { ...precedente, version: 1 });
  await scriviArchivioPreimpostazioni(file, migrato, { versioneArchivioAttesa: 0 });
  assert.deepEqual(inizializzaPreimpostazioni(await leggiArchivioPreimpostazioni(file), precedente), migrato);
  assert.deepEqual(precedente, copia, "la migrazione non modifica l'oggetto dei ruoli ricevuto");
  assert.equal(await readFile(fileOriginale, "utf8"), originale, "il file 2.8 resta identico byte per byte");
  const senzaMigrata = applicaOperazionePreimpostazioni(migrato, operazione(migrato, "elimina", "il-mio-consiglio"));
  assert.deepEqual(inizializzaPreimpostazioni(senzaMigrata, precedente), senzaMigrata, "la voce eliminata non ricompare");
});

test("una modifica con versione superata viene rifiutata e l'archivio resta intatto", async (t) => {
  const { file } = await ambiente(t);
  const iniziale = inizializzaPreimpostazioni();
  await scriviArchivioPreimpostazioni(file, iniziale, { versioneArchivioAttesa: 0 });
  const richiesta = operazione(iniziale, "modifica", "rapido", dati(iniziale.preimpostazioni[0], { nome: "Prima modifica" }));
  const aggiornato = applicaOperazionePreimpostazioni(iniziale, richiesta);
  await scriviArchivioPreimpostazioni(file, aggiornato, { versioneArchivioAttesa: iniziale.versioneArchivio });
  const prima = await readFile(file, "utf8");
  const conflitto = (errore) => errore.statusHttp === 409 && errore.codiceConsiglio === "preimpostazione-conflitto";
  assert.throws(() => applicaOperazionePreimpostazioni(aggiornato, richiesta), conflitto);
  assert.throws(() => applicaOperazionePreimpostazioni(aggiornato, { ...richiesta,
    versioneArchivioAttesa: aggiornato.versioneArchivio }), conflitto, "anche la sola versione della voce protegge la modifica");
  await assert.rejects(scriviArchivioPreimpostazioni(file, iniziale, { versioneArchivioAttesa: 1 }), conflitto);
  assert.equal(await readFile(file, "utf8"), prima);
  assert.equal(iniziale.preimpostazioni[0].nome, "Rapido", "l'applicazione non muta l'archivio ricevuto");
});

test("crea duplica rinomina elimina e predefinita rispettano entrambe le versioni", () => {
  let archivio = inizializzaPreimpostazioni();
  const soloScrittore = { nome: "Solo scrittore", tipo: "codice", istruzioni: "Verifica la bozza.",
    ordine: ["scrittore"], livello: { scrittore: "high" },
    assegnazioni: { scrittore: { provider: "prova", modelId: "due" } } };
  archivio = applicaOperazionePreimpostazioni(archivio, operazione(archivio, "crea", null, soloScrittore), { creaId: () => "solo-scrittore" });
  assert.equal(archivio.versioneArchivio, 2);
  assert.deepEqual(configurazioneDaPreimpostazione(archivio.preimpostazioni.at(-1)).consiglieri, []);
  archivio = applicaOperazionePreimpostazioni(archivio, operazione(archivio, "duplica", "solo-scrittore", { nome: "Copia" }), { creaId: () => "copia" });
  assert.equal(archivio.preimpostazioni.at(-1).versione, 1);
  assert.deepEqual(archivio.preimpostazioni.at(-1).assegnazioni, soloScrittore.assegnazioni);
  archivio = applicaOperazionePreimpostazioni(archivio, operazione(archivio, "modifica", "copia", { ...soloScrittore, nome: "Rinominata" }));
  assert.equal(archivio.preimpostazioni.at(-1).versione, 2);
  archivio = applicaOperazionePreimpostazioni(archivio, operazione(archivio, "predefinita", "copia"));
  assert.equal(archivio.predefinita, "copia");
  archivio = applicaOperazionePreimpostazioni(archivio, operazione(archivio, "elimina", "copia"));
  assert.equal(archivio.predefinita, "rapido");
  for (const id of ["rapido", "tre-consiglieri", "solo-scrittore"]) {
    archivio = applicaOperazionePreimpostazioni(archivio, operazione(archivio, "elimina", id));
  }
  assert.equal(archivio.predefinita, null);
  assert.deepEqual(archivio.preimpostazioni, []);
  assert.deepEqual(inizializzaPreimpostazioni(archivio), archivio);
});

test("gli schemi chiusi rifiutano consenso testo allegati e ruoli incoerenti", () => {
  const archivio = inizializzaPreimpostazioni();
  const richiesta = operazione(archivio, "crea", null, dati(archivio.preimpostazioni[0]));
  for (const campo of ["consenso", "prompt", "allegati", "operationId"]) {
    assert.throws(() => validaOperazionePreimpostazioni({ ...richiesta, [campo]: true }), /campo non previsto/);
    assert.throws(() => validaOperazionePreimpostazioni({ ...richiesta,
      preimpostazione: { ...richiesta.preimpostazione, [campo]: true } }), /campo non previsto/);
  }
  assert.throws(() => validaArchivioPreimpostazioni({ ...archivio, extra: true }), /campo non previsto/);
  assert.throws(() => validaOperazionePreimpostazioni({ ...richiesta, preimpostazione: {
    ...richiesta.preimpostazione, ordine: ["scrittore", "consigliere-1"],
  } }), /scrittore come ultimo/);
  assert.throws(() => validaOperazionePreimpostazioni({ ...richiesta, preimpostazione: {
    ...richiesta.preimpostazione, assegnazioni: { scrittore: null },
  } }), /deve dichiarare/);
});

test("due scritture concorrenti con la stessa versione pubblicano un solo archivio", async (t) => {
  const { file } = await ambiente(t);
  const archivio = inizializzaPreimpostazioni();
  await scriviArchivioPreimpostazioni(file, archivio, { versioneArchivioAttesa: 0 });
  const alternative = ["Prima", "Seconda"].map((nome) => applicaOperazionePreimpostazioni(archivio,
    operazione(archivio, "modifica", "rapido", dati(archivio.preimpostazioni[0], { nome }))));
  const esiti = await Promise.allSettled(alternative.map((valore) => scriviArchivioPreimpostazioni(file, valore, { versioneArchivioAttesa: 1 })));
  assert.equal(esiti.filter((esito) => esito.status === "fulfilled").length, 1);
  assert.equal(esiti.find((esito) => esito.status === "rejected").reason.statusHttp, 409);
  assert.deepEqual(await leggiArchivioPreimpostazioni(file), alternative[0]);
});

test("un archivio illeggibile non viene sostituito dalle preimpostazioni iniziali", async (t) => {
  const { file } = await ambiente(t);
  await writeFile(file, "{ contenuto incompleto", "utf8");
  await assert.rejects(leggiArchivioPreimpostazioni(file), /JSON valido/);
  assert.equal(await readFile(file, "utf8"), "{ contenuto incompleto");
});
