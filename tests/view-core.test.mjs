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
    vista.pulisciRispostaAgente(
      "`ottimizzazione: OK`\n\n**orchestrazione: OK**\n\n__ottimizzazione: OK__\n\nCOLLAUDO OK",
    ),
    "COLLAUDO OK",
    "i wrapper Markdown completi non devono rendere visibili i marker iniziali",
  );
  assert.equal(
    vista.pulisciRispostaAgente(
      "orchestrazione: OK — stack e goal confermati\n\nAnalisi completata.",
    ),
    "Analisi completata.",
    "anche il suffisso tecnico del marker iniziale va nascosto",
  );
  assert.equal(
    vista.pulisciRispostaAgente(
      "orchestrazione: OK — ma il collaudo è fallito\n\nVerifica i log.",
    ),
    "ma il collaudo è fallito\n\nVerifica i log.",
    "un suffisso sostanziale non deve essere nascosto insieme al marker",
  );
  assert.equal(
    vista.pulisciRispostaAgente("Testo normale\n`ottimizzazione: OK`\n**orchestrazione: OK**"),
    "Testo normale\n`ottimizzazione: OK`\n**orchestrazione: OK**",
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
  assert.match(vista.etichettaRiepilogo("compaction").descrizione, /richieste originali.+visibili/i);
  assert.match(vista.etichettaRiepilogo("compaction").descrizione, /rami.+recuperabili/i);
  assert.match(vista.etichettaRiepilogo("branch").descrizione, /ramo originale.+cronologia/i);
});

test("una conversazione troppo breve e un esito neutro della compattazione", () => {
  assert.deepEqual(
    vista.presentaErroreCompattazione(
      "Compaction failed: Nothing to compact (session too small)",
    ),
    {
      nonNecessaria: true,
      testo: "La conversazione è ancora troppo breve per essere riassunta.",
    },
  );
  assert.deepEqual(
    vista.presentaErroreCompattazione("Provider non disponibile"),
    {
      nonNecessaria: false,
      testo: "Provider non disponibile",
    },
    "gli errori reali non devono essere riclassificati",
  );
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

test("la finestra di contesto segue il modello corrente e non statistiche di un modello precedente", () => {
  const opus = { provider: "anthropic", id: "claude-opus-5" };
  assert.equal(
    vista.finestraContestoModelloCorrente({
      modelloCorrente: opus,
      catalogo: [{ ...opus, contextWindow: 1_000_000 }],
      statistiche: { contextUsage: { contextWindow: 272_000 } },
      modelloStatistiche: { provider: "openai-codex", id: "gpt-5.4" },
    }),
    1_000_000,
  );
});

test("uno stato di un altro modello viene scartato e il catalogo esatto prevale", () => {
  const corrente = { provider: "anthropic", id: "claude-opus-5" };
  assert.equal(
    vista.finestraContestoModelloCorrente({
      modelloCorrente: corrente,
      modelloStato: {
        provider: "openai-codex",
        id: "gpt-5.4",
        contextWindow: 272_000,
      },
      catalogo: [{ ...corrente, contextWindow: 777_777 }],
    }),
    777_777,
  );
});

test("lo stato confermato del modello corrente precede il catalogo", () => {
  const corrente = { provider: "anthropic", id: "claude-opus-5" };
  assert.equal(
    vista.finestraContestoModelloCorrente({
      modelloCorrente: corrente,
      modelloStato: { ...corrente, contextWindow: 900_000 },
      catalogo: [{ ...corrente, contextWindow: 777_777 }],
    }),
    900_000,
  );
});

test("le statistiche sono un fallback solo se taggate con la stessa identita", () => {
  const corrente = { provider: "anthropic", id: "claude-opus-5" };
  const statistiche = { contextUsage: { contextWindow: 654_321 } };
  assert.equal(
    vista.finestraContestoModelloCorrente({
      modelloCorrente: corrente,
      statistiche,
      modelloStatistiche: corrente,
    }),
    654_321,
  );
  assert.equal(
    vista.finestraContestoModelloCorrente({
      modelloCorrente: corrente,
      statistiche,
    }),
    null,
    "una statistica senza identita esplicita non e autorevole",
  );
});

test("provider diversi con lo stesso id non identificano lo stesso modello", () => {
  const corrente = { provider: "anthropic", id: "modello-condiviso" };
  assert.notEqual(
    vista.chiaveModello(corrente),
    vista.chiaveModello({ provider: "openai", id: "modello-condiviso" }),
  );
  assert.equal(
    vista.finestraContestoModelloCorrente({
      modelloCorrente: corrente,
      catalogo: [{ provider: "openai", id: "modello-condiviso", contextWindow: 777_777 }],
      statistiche: { contextUsage: { contextWindow: 272_000 } },
      modelloStatistiche: { provider: "openai", id: "modello-condiviso" },
    }),
    null,
  );
});
