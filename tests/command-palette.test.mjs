import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const palette = require(join(RADICE, "app", "public", "palette-core.js"));
const navigazione = require(join(RADICE, "app", "public", "navigazione-core.js"));

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


test("ogni tasto raggiunge un solo gestore e Esc non interrompe la sessione", async () => {
  const frontend = await readFile(join(RADICE, "app", "public", "app.js"), "utf8");
  function funzione(nome) {
    const trovata = frontend.match(new RegExp("(?:^|\\n)function " + nome + "\\([^]*?\\n\\}", "u"));
    assert.ok(trovata, "manca la funzione reale " + nome);
    return trovata[0];
  }
  const tabella = frontend.match(/const INSTRADAMENTO_TASTIERA = Object\.freeze\(\[[\s\S]*?\]\);/u)?.[0];
  assert.ok(tabella, "la tabella di instradamento deve essere esplicita");
  const corpi = ["tastieraDiAgenti", "trattieniFuoco", "gestisciTastiFinestra", "gestisciTastiMenuConversazione", "gestisciTastiMenuPalette", "gestisciScorciatoia", "gestisciInvioOrdinario", "instradaTastiera"].map(funzione).join("\n");
  const traccia = [];
  const documento = {
    activeElement: null,
    dialogoAgenti: null,
    querySelector() { return this.dialogoAgenti; },
    getElementById(id) { return id === "elenco-preimpostazioni-agenti" ? menuAgenti : null; },
    body: { classList: new Set() },
  };
  documento.body.classList.contains = documento.body.classList.has;
  function nodo(id) {
    return { id, hidden: false, disabled: false, inert: false, tabIndex: 0, figli: [],
      focus() { documento.activeElement = this; traccia.push("fuoco:" + id); },
      click() { traccia.push("clic:" + id); },
      contains(target) { return target === this || this.figli.includes(target); },
      querySelectorAll() { return this.figli; },
      closest() { return this.hidden || this.inert ? this : null; },
      getClientRects() { return this.hidden ? [] : [{}]; },
    };
  }
  const menuAgenti = nodo("menu-agenti"); menuAgenti.hidden = true;
  const menuConversazione = nodo("menu-conversazione"); menuConversazione.hidden = true;
  menuConversazione.figli = [nodo("rinomina"), nodo("duplica"), nodo("avanzati")];
  const DOM = { input: nodo("input"), btnAllega: nodo("allega"), composerShell: nodo("composer"), velo: nodo("velo"), modale: nodo("modale"), pannelloOspite: nodo("ospite") };
  DOM.composerShell.figli = [DOM.input, DOM.btnAllega];
  DOM.velo.hidden = true; DOM.pannelloOspite.hidden = true;
  DOM.modale.figli = [nodo("campo-modale"), nodo("chiudi-modale")];
  DOM.pannelloOspite.figli = [nodo("chiudi-ospite")];
  const pannelloLaterale = nodo("laterale"); pannelloLaterale.figli = [nodo("ricerca-laterale")];
  const btnMenu = nodo("toggle-laterale");
  const APP = { modale: null, attivaId: "prima", sessioni: new Map([["prima", { id: "prima" }], ["seconda", { id: "seconda" }]]),
    paletteComandi: { aperta: false, risultati: ["model"] }, menuAzioniComposer: { aperto: false, indiceAttivo: 0 } };
  const mediaMenuLaterale = { matches: false };
  const vociAllegati = [nodo("allega-file"), nodo("allega-cartella")];
  const dipendenze = {
    DOM, APP, document: documento, mediaMenuLaterale, pannelloLaterale, btnMenu, composizioneInputInCorso: false,
    NAVIGAZIONE_CORE: navigazione, NAVIGAZIONE: { salvate: [], ricerca: "" },
    $: (selettore) => { assert.equal(selettore, "#menu-conversazione"); return menuConversazione; },
    chiudiModale: () => { traccia.push("chiudi-modale"); DOM.velo.hidden = true; APP.modale = null; },
    chiudiPannelloOspite: () => { traccia.push("chiudi-ospite"); DOM.pannelloOspite.hidden = true; },
    chiudiMenuLaterale: () => { traccia.push("chiudi-laterale"); documento.body.classList.delete("menu-aperto"); },
    chiudiMenuConversazione: () => { traccia.push("chiudi-menu"); menuConversazione.hidden = true; },
    vociMenuAzioniComposer: () => vociAllegati,
    spostaFocusMenuAzioniComposer: (direzione) => traccia.push("sposta-allegati:" + direzione),
    chiudiMenuAzioniComposer: () => { traccia.push("chiudi-allegati"); APP.menuAzioniComposer.aperto = false; },
    spostaSelezionePalette: (direzione) => traccia.push("sposta-palette:" + direzione),
    chiudiPaletteComandi: () => { traccia.push("chiudi-palette"); APP.paletteComandi.aperta = false; },
    completaSelezionePalette: () => traccia.push("scegli-palette"),
    apriRicercaComandi: () => { traccia.push("ricerca"); APP.paletteComandi.aperta = true; },
    avviaNuovaSchedaNelContestoCorrente: () => traccia.push("nuova"),
    attivaSessione: (id) => { traccia.push("attiva:" + id); APP.attivaId = id; },
    invia: () => traccia.push("invia"),
    interrompi: () => traccia.push("ferma"),
  };
  const banco = new Function(...Object.keys(dipendenze), corpi + "\n" + tabella
    + "\nreturn { instradaTastiera, livelli: INSTRADAMENTO_TASTIERA.map(([nome]) => nome), composizione(v) { composizioneInputInCorso = v; } }; ")(...Object.values(dipendenze));
  assert.deepEqual(banco.livelli, ["finestra", "menu o palette", "scorciatoia", "invio ordinario"]);
  function premi(key, dettagli = {}) {
    traccia.length = 0;
    const evento = { key, target: DOM.input, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
      isComposing: false, defaultPrevented: false, consumi: 0, arresti: 0,
      preventDefault() { this.defaultPrevented = true; this.consumi++; },
      stopImmediatePropagation() { this.arresti++; }, ...dettagli };
    const esito = banco.instradaTastiera(evento);
    assert.equal(evento.consumi, esito === true ? 1 : 0, key + ": un solo consumo dell'evento gestito");
    assert.equal(evento.arresti, esito === true ? 1 : 0, key + ": propagazione interrotta soltanto dal gestore proprietario");
    assert.ok(!traccia.includes("ferma"), "Esc e le altre scorciatoie non fermano Pi");
    return { esito, azioni: [...traccia] };
  }
  assert.deepEqual(premi("Enter").azioni, ["invia"]);
  assert.deepEqual(premi("Enter", { shiftKey: true }).azioni, []);
  assert.deepEqual(premi("v", { ctrlKey: true }).azioni, [], "incolla conserva il comportamento nativo");
  assert.deepEqual(premi("Escape").azioni, []);
  assert.deepEqual(premi("Enter", { isComposing: true }).azioni, []);
  banco.composizione(true);
  assert.deepEqual(premi("Enter").azioni, []);
  banco.composizione(false);
  assert.deepEqual(premi("Enter", { defaultPrevented: true }).azioni, []);
  assert.deepEqual(premi("Enter", { target: btnMenu }).azioni, []);
  assert.deepEqual(premi("n", { ctrlKey: true, altKey: true }).azioni, ["nuova"]);
  assert.deepEqual(premi("ArrowDown", { ctrlKey: true, altKey: true }).azioni, ["attiva:seconda"]);
  assert.deepEqual(premi("ArrowUp", { ctrlKey: true, altKey: true }).azioni, ["attiva:prima"]);
  assert.deepEqual(premi("k", { ctrlKey: true }).azioni, ["chiudi-laterale", "ricerca"]);
  assert.deepEqual(premi("Enter").azioni, ["scegli-palette"], "la palette vince sull'invio ordinario");
  assert.deepEqual(premi("Escape").azioni, ["chiudi-palette"]);
  APP.menuAzioniComposer.aperto = true;
  assert.deepEqual(premi("ArrowDown").azioni, ["sposta-allegati:1"]);
  assert.deepEqual(premi("Escape").azioni, ["chiudi-allegati"]);
  menuConversazione.hidden = false;
  documento.activeElement = menuConversazione.figli[0];
  assert.deepEqual(premi("ArrowDown").azioni, ["fuoco:duplica"]);
  assert.deepEqual(menuConversazione.figli.map((voce) => voce.tabIndex), [-1, 0, -1]);
  assert.deepEqual(premi(" ").azioni, ["clic:duplica"]);
  assert.deepEqual(premi("Escape").azioni, ["chiudi-menu"]);

  // Finestre sovrapposte: prima la più interna, poi l'ospite, mai Pi.
  DOM.velo.hidden = false; APP.modale = { chiudibile: true }; DOM.pannelloOspite.hidden = false;
  assert.equal(premi("k", { ctrlKey: true }).esito, "nativo");
  assert.deepEqual(traccia, []);
  documento.activeElement = DOM.modale.figli.at(-1);
  assert.deepEqual(premi("Tab").azioni, ["fuoco:campo-modale"]);
  assert.deepEqual(premi("Tab", { shiftKey: true }).azioni, ["fuoco:chiudi-modale"]);
  assert.deepEqual(premi("Escape").azioni, ["chiudi-modale"]);
  assert.equal(DOM.pannelloOspite.hidden, false);
  assert.deepEqual(premi("Escape").azioni, ["chiudi-ospite"]);

  // P2 mantiene i suoi gestori: l'app delega senza preventDefault o un avvio proprio.
  assert.equal(premi("Enter", { ctrlKey: true, shiftKey: true }).esito, "delegato");
  assert.deepEqual(traccia, []);
  assert.equal(premi("Enter", { ctrlKey: true, shiftKey: true, target: btnMenu }).esito, false);
  menuAgenti.hidden = false;
  assert.equal(premi("Escape").esito, "delegato");
  menuAgenti.hidden = true;
  documento.dialogoAgenti = nodo("gestisci-agenti");
  assert.equal(premi("Tab").esito, "delegato");
  documento.dialogoAgenti = null;

  // Il drawer è il livello esterno: un menu aperto sopra deve chiudersi prima.
  mediaMenuLaterale.matches = true;
  for (const [apri, chiusura] of [
    [() => { menuConversazione.hidden = false; }, "chiudi-menu"],
    [() => { APP.menuAzioniComposer.aperto = true; }, "chiudi-allegati"],
    [() => { APP.paletteComandi.aperta = true; }, "chiudi-palette"],
  ]) {
    documento.body.classList.add("menu-aperto"); apri();
    assert.deepEqual(premi("Escape").azioni, [chiusura]);
    assert.equal(documento.body.classList.contains("menu-aperto"), true);
    assert.deepEqual(premi("Escape").azioni, ["chiudi-laterale"]);
  }
  const registrazione = frontend.indexOf('document.addEventListener("keydown", instradaTastiera, true)');
  const montaggioP2 = frontend.indexOf('globalThis.PiGuiAgentiCore?.montaAgenti?.');
  assert.ok(registrazione >= 0 && montaggioP2 > registrazione, "la priorita della tabella precede la delega al listener originale P2");
});
