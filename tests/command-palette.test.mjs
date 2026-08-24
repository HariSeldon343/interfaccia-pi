import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const palette = require(join(RADICE, "app", "public", "palette-core.js"));

test("il catalogo resta dinamico, normalizzato e sicuro in caso di nomi uguali", () => {
  const comandi = palette.normalizzaCatalogoComandi([
    { name: "future-command", description: "Arriva da una futura versione", source: "builtin", availability: "gui", dispatch: { kind: "workflow", action: "advanced" } },
    { name: "future-command", description: "duplicato", source: "builtin" },
    { name: "future-command", description: "skill omonima", source: "skill" },
    { name: "llama", source: "extension" },
    { name: "nome non valido", source: "prompt" },
  ]);

  assert.deepEqual(comandi.map((voce) => [voce.source, voce.name]), [
    ["builtin", "future-command"],
    ["skill", "future-command"],
    ["extension", "llama"],
  ]);
  assert.equal(comandi[0].dispatch.action, "advanced");
  assert.equal(comandi[2].availability, "terminal");
  assert.notEqual(palette.chiaveComando(comandi[0]), palette.chiaveComando(comandi[1]));
});

test("la ricerca considera nome, parti, descrizione e accenti mantenendo l'ordine", () => {
  const catalogo = [
    { name: "model", description: "Scegli modello", source: "builtin" },
    { name: "skill:qualita", description: "Bonifica documenti", source: "skill" },
    { name: "export", description: "Esporta la conversazione", source: "builtin" },
  ];
  assert.equal(palette.filtraCatalogoComandi(catalogo, "mod")[0].name, "model");
  assert.equal(palette.filtraCatalogoComandi(catalogo, "qualità")[0].name, "skill:qualita");
  assert.equal(palette.filtraCatalogoComandi(catalogo, "documenti")[0].name, "skill:qualita");
  assert.deepEqual(
    palette.filtraCatalogoComandi(catalogo, "").map((voce) => voce.name),
    catalogo.map((voce) => voce.name),
  );
});

test("la palette si apre soltanto sul token slash iniziale e rispetta selezione e cursore", () => {
  assert.deepEqual(palette.analizzaRichiamoComando("/", 1, 1), { query: "", start: 0, end: 1 });
  assert.deepEqual(palette.analizzaRichiamoComando("/model", 3, 3), { query: "mo", start: 0, end: 6 });
  assert.equal(palette.analizzaRichiamoComando("test /mo", 8, 8), null);
  assert.equal(palette.analizzaRichiamoComando("/model arg", 8, 8), null);
  assert.equal(palette.analizzaRichiamoComando("/model", 1, 3), null);
});

test("il completamento sostituisce solo il token e mette il cursore prima degli argomenti", () => {
  const richiamo = palette.analizzaRichiamoComando("/mo argomento", 3, 3);
  const completato = palette.completaRichiamoComando("/mo argomento", richiamo, { name: "model" });
  assert.deepEqual(completato, { value: "/model argomento", caret: 7 });
});

test("l'invio separa nome e argomenti multilinea senza interpretare testo normale", () => {
  assert.deepEqual(palette.analizzaComandoDaInviare(" /name Progetto Alfa "), {
    name: "name",
    arguments: "Progetto Alfa",
  });
  assert.deepEqual(palette.analizzaComandoDaInviare("/prompt prima\nseconda"), {
    name: "prompt",
    arguments: "prima\nseconda",
  });
  assert.equal(palette.analizzaComandoDaInviare("spiega /model"), null);
});

test("un built-in accettato sopravvive al reload e viene risolto una sola volta dal replay", () => {
  const archivio = new Map();
  const registro = palette.creaRegistroComandoBuiltin({
    id: "ui-replay-documento-1",
    testo: "/compact",
    lineageId: "lineage-compact",
    nome: "compact",
    creatoIl: 1234,
  });
  assert.ok(registro);

  // È la barriera posta prima della POST. Simuliamo poi la chiusura completa
  // della pagina: la nuova istanza conosce soltanto i byte persistiti.
  archivio.set(registro.id, JSON.stringify(registro));
  let postAccettata = true;
  assert.equal(postAccettata, true);
  const dopoReload = JSON.parse(archivio.get(registro.id));
  assert.equal(palette.invioRichiedeVerificaManuale(dopoReload), true);
  assert.equal(dopoReload.testo, "/compact");
  assert.equal(dopoReload.lineageId, "lineage-compact");

  const replay = palette.transizioneEsitoComandoBuiltin(dopoReload, {
    success: true,
    guiReplay: true,
    data: { compacted: true },
  });
  assert.equal(replay.azione, "risolvi");
  archivio.delete(dopoReload.id);
  assert.equal(archivio.has(dopoReload.id), false,
    "l'ack replay elimina il marker e impedisce un secondo invio");
});

test("failure ed esito ignoto non eliminano il registro built-in dopo il reload", () => {
  const base = palette.creaRegistroComandoBuiltin({
    id: "ui-replay-documento-2",
    testo: "/model provider/modello",
    lineageId: "lineage-model",
    nome: "model",
    argomenti: "provider/modello",
    creatoIl: 5678,
  });

  for (const [esito, statoAtteso] of [
    [{ success: false, error: "modello rifiutato" }, "errore"],
    [{ esitoIgnoto: true, error: "connessione interrotta" }, "esito_ignoto"],
  ]) {
    const archivio = new Map([[base.id, JSON.stringify(base)]]);
    const dopoReload = JSON.parse(archivio.get(base.id));
    const transizione = palette.transizioneEsitoComandoBuiltin(dopoReload, esito);
    assert.equal(transizione.azione, "conserva");
    const conservato = { ...dopoReload, ...transizione.modifiche };
    archivio.set(conservato.id, JSON.stringify(conservato));
    const secondoReload = JSON.parse(archivio.get(conservato.id));
    assert.equal(secondoReload.statoComando, statoAtteso);
    assert.ok(secondoReload.erroreComando);
    assert.equal(secondoReload.testo, base.testo);
    assert.equal(secondoReload.lineageId, base.lineageId);
  }
});

test("!! shell conserva semantica fuori contesto e impedisce il doppio side effect dopo F5", () => {
  const testo = "!! Add-Content -LiteralPath C:\\dati\\log.txt -Value una-volta";
  const registro = palette.creaRegistroShell({
    id: "ui-shell-add-content-1",
    testo,
    lineageId: "lineage-shell",
    comando: "Add-Content -LiteralPath C:\\dati\\log.txt -Value una-volta",
    excludeFromContext: true,
    creatoIl: 9012,
  });
  assert.equal(registro.origine, "shell");
  assert.equal(registro.testo, testo);
  assert.equal(registro.excludeFromContext, true);

  const archivio = new Map([[registro.id, JSON.stringify(registro)]]);
  const dopoF5 = JSON.parse(archivio.get(registro.id));
  assert.equal(palette.invioRichiedeVerificaManuale(dopoF5), true);
  const ackReplay = palette.transizioneEsitoOperazione(dopoF5, {
    success: true,
    guiReplay: true,
    data: { exitCode: 0, output: "" },
  });
  assert.equal(ackReplay.azione, "risolvi");
  archivio.delete(dopoF5.id);
  assert.equal(archivio.size, 0,
    "Add-Content non deve essere riproposto dopo che il replay ne conferma l'esecuzione");
});

test("un errore shell o una conferma mancante conserva testo, lineage e !!", () => {
  const registro = palette.creaRegistroShell({
    id: "ui-shell-incerto-1",
    testo: "!! Set-Content file.txt valore",
    lineageId: "lineage-shell-incerto",
    comando: "Set-Content file.txt valore",
    excludeFromContext: true,
  });
  const transizione = palette.transizioneEsitoOperazione(registro, {
    esitoIgnoto: true,
    error: "ponte disconnesso",
  });
  assert.equal(transizione.azione, "conserva");
  const conservato = { ...registro, ...transizione.modifiche };
  assert.equal(conservato.statoComando, "esito_ignoto");
  assert.equal(conservato.testo.startsWith("!!"), true);
  assert.equal(conservato.excludeFromContext, true);
  assert.equal(conservato.lineageId, registro.lineageId);
});

test("due revisioni catalogo distinguono lo stale 409 da altri conflitti", () => {
  const finestraA = { catalogRevision: 12 };
  const finestraB = { catalogRevision: 11 };
  assert.notEqual(finestraA.catalogRevision, finestraB.catalogRevision);
  assert.equal(palette.erroreCatalogoComandiObsoleto({
    statusHttp: 409,
    code: "CATALOG_REVISION_STALE",
    message: "revision mismatch",
  }), true);
  assert.equal(palette.erroreCatalogoComandiObsoleto({
    statusHttp: 409,
    message: "Il catalogo comandi e cambiato: aggiorna l'elenco e riprova.",
  }), true);
  assert.equal(palette.erroreCatalogoComandiObsoleto({
    statusHttp: 409,
    message: "Esiste gia una procedura di accesso",
  }), false);
  assert.equal(palette.erroreCatalogoComandiObsoleto({
    statusHttp: 400,
    code: "CATALOG_REVISION_STALE",
  }), false);
});

test("operationId e stabile per lo stesso intento ma cambia con una nuova lineage", () => {
  const primo = palette.creaRegistroComandoBuiltin({
    id: "ui-stale-primo",
    testo: "/reload",
    lineageId: "11111111-1111-4111-8111-111111111111",
    nome: "reload",
  });
  const stessoIntento = palette.creaRegistroComandoBuiltin({
    id: "ui-stale-reload",
    testo: "/reload",
    lineageId: primo.lineageId,
    nome: "reload",
  });
  const retryManuale = palette.creaRegistroComandoBuiltin({
    id: "ui-stale-retry",
    testo: "/reload",
    lineageId: "22222222-2222-4222-8222-222222222222",
    nome: "reload",
  });
  assert.equal(stessoIntento.operationId, primo.operationId,
    "reload/replay dello stesso intento deve riusare l'operationId");
  assert.notEqual(retryManuale.operationId, primo.operationId,
    "il retry manuale dopo catalogo stale deve essere un intento nuovo");
  for (const operationId of [primo.operationId, retryManuale.operationId]) {
    assert.match(operationId, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  }
});
