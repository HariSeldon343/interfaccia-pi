import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const vista = require(join(RADICE, "app", "public", "view-core.js"));

test("i marker di orchestrazione iniziali non sporcano la risposta visibile", () => {
  assert.equal(
    vista.pulisciRispostaAgente(
      "ottimizzazione: OK\n\norchestrazione: OK\n\nSono circa all'80%.",
    ),
    "Sono circa all'80%.",
  );
  assert.equal(
    vista.pulisciRispostaAgente("Testo normale\nottimizzazione: OK"),
    "Testo normale\nottimizzazione: OK",
    "un riferimento nel corpo della risposta non va cancellato",
  );
});

test("i tentativi tecnici falliti restano avvisi distinti dagli errori finali", () => {
  assert.deepEqual(
    vista.statoAttivita({ tentativiFalliti: 4, finalizzato: true }),
    { testo: "completate · 4 tentativi non riusciti", livello: "avviso" },
  );
  assert.deepEqual(
    vista.statoAttivita({ tentativiFalliti: 2, inCorso: true }),
    { testo: "in corso · 2 tentativi non riusciti", livello: "avviso" },
  );
  assert.deepEqual(
    vista.statoAttivita({ tentativiFalliti: 0, finalizzato: true }),
    { testo: "completate", livello: "ok" },
  );
});

test("la compattazione spiega che la cronologia non viene eliminata", () => {
  assert.match(vista.etichettaRiepilogo("compaction").titolo, /compattata/i);
  assert.match(vista.etichettaRiepilogo("compaction").descrizione, /rami.+recuperabili/i);
  assert.match(vista.etichettaRiepilogo("branch").descrizione, /ramo originale.+cronologia/i);
});

test("il costo OAuth e presentato come equivalente e non come fattura API", () => {
  const oauth = vista.presentaCosto(28.006074, "openai-codex");
  assert.equal(oauth.oauthAbbonamento, true);
  assert.match(oauth.testo, /≈28,0061 \$ eq\. · OAuth attuale/);
  assert.match(oauth.spiegazione, /non una fattura/i);
  assert.match(oauth.spiegazione, /altri provider o API/i);
  const api = vista.presentaCosto(1.25, "openai");
  assert.equal(api.oauthAbbonamento, false);
  assert.match(api.testo, /stimati/);
  assert.equal(vista.presentaCosto(0, "openai-codex"), null);
});
