import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const avvio = require(join(RADICE, "app", "public", "startup-core.js"));

test("il bootstrap riusa una sessione gia attiva senza altre richieste", async () => {
  const esistente = { id: "viva", attiva: true };
  let aggiornamenti = 0;
  let creazioni = 0;
  const esito = await avvio.assicuraSessioneIniziale({
    elencaSessioni: () => [esistente],
    aggiornaSnapshot: async () => { aggiornamenti += 1; },
    avviaSessione: async () => { creazioni += 1; },
  });

  assert.deepEqual(esito, { sessione: esistente, creata: false });
  assert.equal(aggiornamenti, 0);
  assert.equal(creazioni, 0);
});

test("una risposta di avvio persa viene recuperata dallo snapshot senza duplicati", async () => {
  const sessioni = [];
  const recuperata = { id: "recuperata", attiva: true };
  let creazioni = 0;
  const esito = await avvio.assicuraSessioneIniziale({
    elencaSessioni: () => sessioni,
    aggiornaSnapshot: async () => { sessioni.push(recuperata); },
    avviaSessione: async () => {
      creazioni += 1;
      return { id: "duplicata", attiva: true };
    },
  });

  assert.deepEqual(esito, { sessione: recuperata, creata: false });
  assert.equal(creazioni, 0);
});

test("una sessione visibile ma ancora in bootstrap non viene accettata come pronta", async () => {
  const inAvvio = { id: "in-avvio", attiva: true, avvioCompletato: false };
  const pronta = { id: "pronta", attiva: true, avvioCompletato: true };
  let creazioni = 0;
  const esito = await avvio.assicuraSessioneIniziale({
    elencaSessioni: () => [inAvvio],
    aggiornaSnapshot: async () => {},
    avviaSessione: async () => {
      creazioni += 1;
      return pronta;
    },
  });

  assert.equal(creazioni, 1,
    "la POST idempotente deve attendere il mutex server e confermare l'avvio reale");
  assert.deepEqual(esito, { sessione: pronta, creata: true });
});

test("uno snapshot vuoto crea esattamente una sessione iniziale verificata", async () => {
  const sessioni = [];
  let creazioni = 0;
  const esito = await avvio.assicuraSessioneIniziale({
    elencaSessioni: () => sessioni,
    aggiornaSnapshot: async () => {},
    avviaSessione: async () => {
      creazioni += 1;
      const creata = { id: "nuova", attiva: true };
      sessioni.push(creata);
      return creata;
    },
  });

  assert.equal(creazioni, 1);
  assert.deepEqual(esito, { sessione: sessioni[0], creata: true });
});

test("un avvio fallito non viene scambiato per un bootstrap completato", async () => {
  await assert.rejects(
    avvio.assicuraSessioneIniziale({
      elencaSessioni: () => [],
      aggiornaSnapshot: async () => {},
      avviaSessione: async () => null,
    }),
    /conversazione iniziale utilizzabile/i,
  );
});
