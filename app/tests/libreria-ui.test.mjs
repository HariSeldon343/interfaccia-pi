import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import libreria from "../public/library-core.js";

const frontend = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

function contestoFunzioni(extra = {}) {
  const inizio = frontend.indexOf("async function raccogliIngressiAllegati(");
  const fine = frontend.indexOf("function disegnaAllegati(", inizio);
  assert.ok(inizio >= 0 && fine > inizio, "Mancano le funzioni del flusso libreria.");
  const contesto = createContext({LIBRARY_CORE: libreria, ...extra});
  runInContext(frontend.slice(inizio, fine), contesto);
  return contesto;
}

function fileFinto(nome, tipo = "text/plain", dimensione = 1) {
  return {name: nome, type: tipo, size: dimensione};
}

function voceFile(file, letture = []) {
  return {name: file.name, isFile: true, isDirectory: false, file(risolvi) { letture.push(file.name); risolvi(file); }};
}

function voceCartella(nome, gruppi, letture = []) {
  return {name: nome, isDirectory: true, isFile: false, createReader() {
    let indice = 0;
    return {readEntries(risolvi) { letture.push(nome); risolvi(gruppi[indice++] || []); }};
  }};
}

function elementoFinto(tag = "div", classe = "", testo = "") {
  return {
    tagName: tag.toUpperCase(), className: classe, textContent: testo, children: [], hidden: false, checked: false, isConnected: true, disabled: false,
    append(...elementi) { this.children.push(...elementi); },
    appendChild(elemento) { this.append(elemento); return elemento; },
    replaceChildren(...elementi) { this.children = elementi; },
    setAttribute(nome, valore) { this[nome] = valore; },
    focus() { this.focusRicevuto = true; },
    remove() { this.isConnected = false; },
    cloneNode() { return elementoFinto(tag, classe, testo); },
  };
}

function elementiDiscendenti(elemento) {
  return [elemento, ...elemento.children.flatMap(elementiDiscendenti)];
}

function ambienteUi(extra = {}) {
  const sessione = {id: "origine", chiaveBozza: "bozza", allegati: [], allegatiLibreria: []};
  const APP = {attivaId: sessione.id, sessioni: new Map([[sessione.id, sessione]]), modale: null};
  const DOM = {input: elementoFinto("textarea"), modale: elementoFinto(), modaleCorpo: elementoFinto(), modalePiede: elementoFinto(), toastArea: elementoFinto(), progressoLibreria: elementoFinto(), modaleLibreria: {content: {firstElementChild: elementoFinto()}}};
  const avvisi = [];
  const ambiente = {
    APP, DOM, crea: elementoFinto, queueMicrotask, setTimeout: () => 1, clearTimeout() {},
    sessioneAttiva: () => APP.sessioni.get(APP.attivaId),
    tipoImmagineSupportato: (tipo) => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(tipo),
    aggiornaInterfacciaAttiva() {}, disegnaAllegati() {}, conservaAllegatiBozza() {}, ramificaLineageBozza() {},
    dimensioneFile: (numero) => numero + " B", testoErrore: (errore) => errore.message,
    toast: (testo) => avvisi.push(testo), crypto: {randomUUID: () => "operazione-unica"},
    apriModale(titolo, opzioni) { APP.modale = opzioni; DOM.modaleCorpo.replaceChildren(); DOM.modalePiede.replaceChildren(); return DOM.modaleCorpo; },
    chiudiModale({annulla = true} = {}) { if (annulla) APP.modale?.onCancel?.(); APP.modale = null; },
    ...extra,
  };
  return {contesto: contestoFunzioni(ambiente), sessione, APP, DOM, avvisi};
}

test("libreria UI: traversata legge tutti i batch, conserva origine e rileva cartelle vuote", async () => {
  const letture = [];
  const esclusa = voceCartella("node_modules", [[voceFile(fileFinto("interno.txt"))]], letture);
  const cartella = voceCartella("Documenti", [[voceFile(fileFinto("uno.txt")), esclusa], [voceFile(fileFinto("due.txt")), voceCartella("Vuota", [[]], letture)], []], letture);
  const contesto = contestoFunzioni();
  const risultato = await contesto.raccogliIngressiAllegati([], {voci: [{voce: cartella}]});
  assert.equal(risultato.daCartella, true);
  assert.deepEqual(Array.from(risultato.ingressi, (voce) => voce.percorsoRelativo), ["Documenti/uno.txt", "Documenti/due.txt"]);
  assert.ok(risultato.ingressi.every((voce) => voce.daCartella));
  assert.equal(risultato.esclusi[0].motivo, "cartella");
  assert.equal(letture.filter((nome) => nome === "Documenti").length, 3);
  assert.equal(letture.includes("node_modules"), false);
  const vuota = await contesto.raccogliIngressiAllegati([], {voci: [{voce: voceCartella("Vuota", [[]])}]});
  assert.equal(vuota.daCartella, true);
  assert.equal(vuota.ingressi.length, 0);
});

test("libreria UI: Esc del drop misto annulla senza leggere contenuti né caricare immagini", async () => {
  const azioni = [];
  const {contesto, APP, DOM} = ambienteUi({
    leggiFileBase64() { azioni.push("lettura"); },
    chiedi() { azioni.push("upload"); },
    accodaAggiuntaFile() { azioni.push("file"); return 0; },
    accodaAggiuntaImmagini() { azioni.push("immagini"); return 0; },
  });
  const operazione = contesto.accodaAggiuntaAllegati([fileFinto("documento.txt"), fileFinto("foto.png", "image/png")]);
  for (let indice = 0; indice < 20 && !APP.modale; indice += 1) await Promise.resolve();
  assert.ok(APP.modale);
  assert.deepEqual(azioni, []);
  const pulsanti = elementiDiscendenti(DOM.modalePiede).filter((voce) => voce.tagName === "BUTTON");
  assert.ok(pulsanti.some((voce) => voce.textContent === "[1] Sì, indicizza tutti"));
  assert.ok(pulsanti.some((voce) => voce.textContent === "[2] Scelgo"));
  assert.ok(pulsanti.some((voce) => voce.textContent === "[3] No, solo nella chat"));
  contesto.chiudiModale();
  assert.equal(await operazione, null);
  assert.deepEqual(azioni, []);
  assert.equal(DOM.input.focusRicevuto, true);
});

test("libreria UI: cartelle vuote, di immagini o con sola .git mostrano toast senza modale", async () => {
  for (const tipo of ["vuota", "immagini", "git"]) {
    const accodate = [];
    const {contesto, APP, avvisi} = ambienteUi({
      accodaAggiuntaImmagini: async (immagini) => { accodate.push(...immagini); return immagini.length; },
    });
    contesto.chiediIndicizzazioneLibreria = () => assert.fail("Non deve essere aperta la domanda con zero documenti.");
    const foto = fileFinto("foto.png", "image/png");
    const figli = tipo === "immagini" ? [voceFile(foto)]
      : tipo === "git" ? [voceCartella(".git", [[voceFile(fileFinto("config"))]])] : [];
    const aggiunti = await contesto.accodaAggiuntaAllegati([], {voci: [{voce: voceCartella("Cartella", [figli])}]});
    assert.equal(APP.modale, null);
    assert.equal(avvisi.length, 1);
    assert.match(avvisi[0], /^La cartella non conteneva documenti da indicizzare/);
    if (tipo === "git") assert.match(avvisi[0], /Esclusi 1 elementi \(cartella: 1\)/);
    assert.deepEqual(accodate, tipo === "immagini" ? [foto] : []);
    assert.equal(aggiunti, tipo === "immagini" ? 1 : 0);
  }
});

test("libreria UI: il riepilogo del duplicato espone il motivo indice riparato", async () => {
  const {contesto, sessione, DOM} = ambienteUi({
    leggiFileBase64: async () => "YQ==",
    chiedi: async () => ({...rispostaIndicizzata("dato.docx"), esito: "duplicato", motivo: "indice riparato"}),
  });
  const risultato = await contesto.indicizzaIngressiLibreria([{file: fileFinto("dato.docx"), percorsoRelativo: "dato.docx"}], sessione, sessione.chiaveBozza);
  assert.equal(risultato.duplicati, 1);
  assert.equal(risultato.indicizzati, 0);
  assert.ok(elementiDiscendenti(DOM.toastArea).some((voce) => voce.textContent.includes("dato.docx: indice riparato")));
});

test("libreria UI: file nascosto conteggiato fra i file saltati, distinto dalle cartelle", async () => {
  const {contesto, sessione, DOM} = ambienteUi();
  const raccolta = await contesto.raccogliIngressiAllegati([fileFinto(".nota.txt")]);
  assert.equal(raccolta.esclusi[0].motivo, "nascosto");
  const riepilogo = await contesto.indicizzaIngressiLibreria([], sessione, sessione.chiaveBozza, raccolta.esclusi);
  assert.equal(riepilogo.saltati, 1);
  assert.equal(riepilogo.nascosto, 1);
  assert.equal(riepilogo.cartella, 0);
  assert.ok(elementiDiscendenti(DOM.toastArea).some((voce) => voce.textContent.includes("File nascosti esclusi: 1")));
});

test("libreria UI: Scelgo con zero file mantiene immagini, No esclude soltanto origine cartella", async () => {
  const azioni = [];
  const {contesto} = ambienteUi({
    accodaAggiuntaFile(file) { azioni.push(...file.map((voce) => voce.name)); return file.length; },
    accodaAggiuntaImmagini(file) { azioni.push(...file.map((voce) => voce.name)); return file.length; },
  });
  contesto.chiediIndicizzazioneLibreria = async () => ({scelta: "scelgo", selezionati: []});
  assert.equal(await contesto.accodaAggiuntaAllegati([fileFinto("nota.txt"), fileFinto("foto.png", "image/png")]), 1);
  assert.deepEqual(azioni, ["foto.png"]);
  azioni.length = 0;
  contesto.chiediIndicizzazioneLibreria = async () => ({scelta: "no", selezionati: []});
  await contesto.accodaAggiuntaAllegati([], {voci: [{voce: voceCartella("Cartella", [[voceFile(fileFinto("interno.txt"))]])}, {file: fileFinto("singolo.txt")}]});
  assert.deepEqual(azioni, ["singolo.txt"]);
});

test("libreria UI: elenco Scelgo accessibile, tutto selezionato, contatore e zero distinti da Annulla", async () => {
  const {contesto, DOM} = ambienteUi();
  const ingressi = [{file: fileFinto("a.docx"), percorsoRelativo: "Cartella/a.docx"}, {file: fileFinto("b.txt"), percorsoRelativo: "Cartella/b.txt"}];
  const scelta = contesto.chiediIndicizzazioneLibreria(ingressi);
  DOM.modalePiede.children.find((voce) => voce.textContent === "[2] Scelgo").onclick();
  const elementi = elementiDiscendenti(DOM.modaleCorpo);
  const caselle = elementi.filter((voce) => voce.type === "checkbox");
  assert.equal(caselle.length, 2);
  assert.ok(caselle.every((voce) => voce.checked));
  const contatore = elementi.find((voce) => voce.className === "libreria-contatore");
  assert.equal(contatore.textContent, "2 di 2 selezionati");
  assert.ok(elementi.some((voce) => voce.textContent === "Cartella/a.docx"));
  assert.ok(elementi.some((voce) => voce.textContent === "DOCX · 1 B"));
  for (const casella of caselle) { casella.checked = false; casella.onchange(); }
  assert.equal(contatore.textContent, "0 di 2 selezionati");
  DOM.modalePiede.children.find((voce) => voce.textContent === "Indicizza selezionati").onclick();
  const risultato = await scelta;
  assert.equal(risultato.scelta, "scelgo");
  assert.equal(risultato.selezionati.length, 0);
});

test("libreria UI: metadati esclusi e sessione cambiata durante domanda non leggono contenuti", async () => {
  const {contesto, APP, sessione} = ambienteUi();
  const raccolta = await contesto.raccogliIngressiAllegati([fileFinto("programma.exe"), fileFinto("grande.txt", "text/plain", 10 * 1024 * 1024 + 1), {...fileFinto("nota.txt"), webkitRelativePath: "Cartella/nota.txt"}]);
  assert.deepEqual(Array.from(raccolta.esclusi, (voce) => voce.motivo), ["tipo", "dimensione"]);
  assert.equal(raccolta.ingressi[0].daCartella, true);
  const azioni = [];
  contesto.leggiFileBase64 = () => azioni.push("lettura");
  contesto.accodaAggiuntaImmagini = () => azioni.push("immagini");
  contesto.chiediIndicizzazioneLibreria = async (ingressi) => {
    APP.attivaId = "subentrante";
    return {scelta: "si", selezionati: ingressi};
  };
  assert.equal(await contesto.accodaAggiuntaAllegati([fileFinto("nota.txt"), fileFinto("foto.png", "image/png")]), null);
  assert.deepEqual(azioni, []);
  assert.equal(sessione.importazioniLibreriaInCorso, 0);
});

test("libreria UI: input cartella, menu, guscio e cattura HTML5 precedono app.js", () => {
  assert.match(html, /id="scegli-cartella"[^>]*webkitdirectory/);
  assert.match(html, /id="azione-allega-cartella"/);
  assert.match(html, /Allega cartella/);
  assert.match(html, /<template id="modale-libreria"/);
  assert.ok(html.indexOf("/library-core.js") < html.indexOf("/app.js"));
  assert.match(frontend, /webkitGetAsEntry/);
  assert.match(frontend, /accodaAggiuntaAllegati\(evento\.dataTransfer\?\.files[^;]+\{voci\}/);
});

function rispostaIndicizzata(nome, sha256 = "a".repeat(64)) {
  return {esito: "indicizzato", motivo: "", voce: {sha256}, radice: "/libreria", percorsoIndice: "/libreria/.ingest-index.json", riferimento: {nome, percorso: "/libreria/raw/" + nome + ".testo.md", mimeType: "text/markdown", dimensione: 20}, avvisi: []};
}

test("libreria UI: il chip viene ridisegnato dopo la fine del caricamento per riabilitare la rimozione", async () => {
  const disegni = [];
  const {contesto, sessione} = ambienteUi({
    disegnaAllegati: () => disegni.push(sessione.importazioniLibreriaInCorso),
    leggiFileBase64: async () => "YQ==",
    chiedi: async () => rispostaIndicizzata("uno.pdf"),
  });
  contesto.chiediIndicizzazioneLibreria = async (ingressi) => ({scelta: "si", selezionati: ingressi});
  await contesto.accodaAggiuntaAllegati([fileFinto("uno.pdf")]);
  assert.equal(disegni.at(-1), 0, "Il pulsante del chip resta disabilitato se disegnato soltanto durante il caricamento");
});

test("libreria UI: il system prompt spiega sidecar, indice e lettura dei documenti lunghi", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /I file \.testo\.md contengono il testo estratto da PDF o Office/);
  assert.match(server, /al posto del binario accanto/);
  assert.match(server, /L'indice \.ingest-index\.json elenca l'intera libreria/);
  assert.match(server, /documenti lunghi si leggono con offset e limit/);
});

test("libreria UI: Ferma completa la richiesta corrente e non legge il file successivo", async () => {
  const letture = [];
  const richieste = [];
  let completa;
  const {contesto, sessione, DOM} = ambienteUi({
    leggiFileBase64: async (file) => { letture.push(file.name); return "YQ=="; },
    chiedi: async (via, opzioni) => { richieste.push({via, opzioni}); return new Promise((risolvi) => { completa = risolvi; }); },
  });
  const ingressi = ["uno.pdf", "due.pdf"].map((nome) => ({file: fileFinto(nome), percorsoRelativo: nome}));
  const operazione = contesto.indicizzaIngressiLibreria(ingressi, sessione, sessione.chiaveBozza, []);
  for (let indice = 0; indice < 20 && !completa; indice += 1) await Promise.resolve();
  const ferma = elementiDiscendenti(DOM.progressoLibreria).find((voce) => voce.textContent === "Ferma");
  assert.ok(ferma);
  ferma.onclick();
  assert.equal(richieste.length, 1);
  completa(rispostaIndicizzata("uno.pdf"));
  const risultato = await operazione;
  assert.deepEqual(letture, ["uno.pdf"]);
  assert.equal(risultato.indicizzati, 1);
  assert.equal(risultato.fermati, 1);
  assert.equal(sessione.allegatiLibreria.length, 1);
  assert.equal(sessione.allegatiLibreria[0].origineLibreria, true);
  assert.equal(sessione.allegatiLibreria[0].token, undefined);
  assert.equal(richieste[0].via, "/api/libreria/indicizza");
  assert.equal("signal" in richieste[0].opzioni, false);
});

test("libreria UI: cambio sessione e chiusura fermano dopo il file corrente senza contaminare la nuova", async () => {
  for (const chiusa of [false, true]) {
    const letture = [];
    let completa;
    const {contesto, sessione, APP} = ambienteUi({
      leggiFileBase64: async (file) => { letture.push(file.name); return "YQ=="; },
      chiedi: async () => new Promise((risolvi) => { completa = risolvi; }),
    });
    const nuova = {id: "nuova", allegatiLibreria: []};
    APP.sessioni.set(nuova.id, nuova);
    const operazione = contesto.indicizzaIngressiLibreria(["uno.pdf", "due.pdf"].map((nome) => ({file: fileFinto(nome), percorsoRelativo: nome})), sessione, sessione.chiaveBozza);
    for (let indice = 0; indice < 20 && !completa; indice += 1) await Promise.resolve();
    APP.attivaId = nuova.id;
    if (chiusa) sessione.chiusuraInCorso = true;
    completa(rispostaIndicizzata("uno.pdf"));
    const risultato = await operazione;
    assert.deepEqual(letture, ["uno.pdf"]);
    assert.equal(risultato.fermati, 1);
    assert.equal(nuova.allegatiLibreria.length, 0);
    assert.equal(sessione.allegatiLibreria.length, chiusa ? 0 : 1);
  }
});

test("libreria UI: quote 200 file e 300 MiB sono applicate prima di leggere i contenuti", async () => {
  for (const [numero, dimensione, attesi] of [[201, 1, 200], [31, 10 * 1024 * 1024, 30]]) {
    const letture = [];
    const {contesto, sessione} = ambienteUi({
      leggiFileBase64: async (file) => { letture.push(file.name); return "YQ=="; },
      chiedi: async (via, opzioni) => rispostaIndicizzata(opzioni.corpo.nome, letture.length.toString(16).padStart(64, "0")),
    });
    const ingressi = Array.from({length: numero}, (_, indice) => ({file: fileFinto("file" + indice + ".txt", "text/plain", dimensione), percorsoRelativo: "file" + indice + ".txt"}));
    const risultato = await contesto.indicizzaIngressiLibreria(ingressi, sessione, sessione.chiaveBozza);
    assert.equal(letture.length, attesi);
    assert.equal(risultato.quota, 1);
    assert.equal(risultato.saltati, 1);
  }
});

test("libreria UI: replay conteggiato duplicato, riferimento unico e riepilogo con percorso copiabile", async () => {
  const copie = [];
  const durate = [];
  const {contesto, sessione, DOM} = ambienteUi({
    leggiFileBase64: async () => "YQ==",
    chiedi: async () => rispostaIndicizzata("stesso.pdf"),
    copiaTesto: (testo) => copie.push(testo),
    setTimeout: (funzione, durata) => { durate.push(durata); return 1; },
  });
  const ingresso = {file: fileFinto("stesso.pdf"), percorsoRelativo: "stesso.pdf"};
  const risultato = await contesto.indicizzaIngressiLibreria([ingresso, ingresso], sessione, sessione.chiaveBozza, [{nome: "dist", motivo: "cartella"}, {nome: "x.exe", motivo: "tipo"}]);
  assert.equal(risultato.indicizzati, 1);
  assert.equal(risultato.duplicati, 1);
  assert.equal(risultato.saltati, 1);
  assert.equal(risultato.cartella, 1);
  assert.equal(sessione.allegatiLibreria.length, 1);
  assert.equal(sessione.allegatiLibreria[0].percorsoIndice, "/libreria/.ingest-index.json");
  const elementi = elementiDiscendenti(DOM.toastArea);
  assert.ok(elementi.some((voce) => voce.textContent.includes("indicizzati 1, duplicati 1, saltati 1")));
  elementi.find((voce) => voce.textContent === "Copia percorso della libreria").onclick();
  assert.deepEqual(copie, ["/libreria"]);
  assert.ok(durate.includes(30000));
});

test("libreria UI: Sì legge e carica dopo una sola domanda, poi aggiunge immagini alla sessione origine", async () => {
  const azioni = [];
  const {contesto, sessione} = ambienteUi({
    leggiFileBase64: async () => { azioni.push("lettura"); return "YQ=="; },
    chiedi: async () => { azioni.push("POST"); return rispostaIndicizzata("documento.pdf"); },
    accodaAggiuntaImmagini: async (immagini, origine) => { assert.equal(origine.id, "origine"); azioni.push("immagini"); return immagini.length; },
  });
  contesto.chiediIndicizzazioneLibreria = async (ingressi) => { azioni.push("domanda"); return {scelta: "si", selezionati: ingressi}; };
  assert.equal(await contesto.accodaAggiuntaAllegati([fileFinto("documento.pdf"), fileFinto("foto.png", "image/png")]), 2);
  assert.deepEqual(azioni, ["domanda", "lettura", "POST", "immagini"]);
  assert.equal(sessione.allegatiLibreria.length, 1);
  await sessione.codaIngressiLibreria;
  assert.equal(sessione.importazioniLibreriaInCorso, 0);
});

test("libreria UI: una bozza risolta durante POST o domanda non riceve riferimenti tardivi", async () => {
  let completa;
  const {contesto, sessione} = ambienteUi({
    leggiFileBase64: async () => "YQ==",
    chiedi: async () => new Promise((risolvi) => { completa = risolvi; }),
  });
  sessione.generazioneIngressiLibreria = 0;
  const ingresso = {file: fileFinto("documento.pdf"), percorsoRelativo: "documento.pdf"};
  const importazione = contesto.indicizzaIngressiLibreria([ingresso], sessione, sessione.chiaveBozza);
  for (let indice = 0; indice < 20 && !completa; indice += 1) await Promise.resolve();
  assert.equal(typeof completa, "function");
  sessione.generazioneIngressiLibreria += 1;
  sessione.allegatiLibreria = [];
  completa(rispostaIndicizzata("documento.pdf"));
  await importazione;
  assert.equal(sessione.allegatiLibreria.length, 0, "Una risposta alla vecchia bozza non deve ricreare i riferimenti dopo il reset.");

  const azioni = [];
  contesto.leggiFileBase64 = async () => { azioni.push("lettura"); return "YQ=="; };
  contesto.chiedi = async () => { azioni.push("POST"); return rispostaIndicizzata("documento.pdf"); };
  contesto.chiediIndicizzazioneLibreria = async (ingressi) => {
    sessione.generazioneIngressiLibreria += 1;
    return {scelta: "si", selezionati: ingressi};
  };
  assert.equal(await contesto.accodaAggiuntaAllegati([fileFinto("documento.pdf")]), null);
  assert.deepEqual(azioni, []);
  assert.equal(sessione.allegatiLibreria.length, 0);
});
