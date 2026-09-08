import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import allegatiCore from "../public/attachment-core.js";
import paletteCore from "../public/palette-core.js";
import libreriaCore from "../public/library-core.js";

const frontend = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function funzione(nome) {
  const inizio = frontend.search(new RegExp("^(?:async )?function " + nome + "\\(", "m"));
  assert.ok(inizio >= 0, "Manca la funzione " + nome);
  const fine = frontend.indexOf("\n}", inizio);
  assert.ok(fine > inizio, "Manca la fine della funzione " + nome);
  return frontend.slice(inizio, fine + 2);
}

function fileLibreria(numero = 1) {
  return {tipo: "file", origineLibreria: true, nome: "documento-" + numero + ".pdf.testo.md", percorso: "C:/lavoro/raw/documenti/documento-" + numero + ".pdf.testo.md", percorsoIndice: "C:/lavoro/.ingest-index.json", mimeType: "text/markdown", dimensione: 40 + numero};
}

function filePendente(numero = 1, proprietario = "sessione") {
  return {tipo: "file", id: "pending-" + numero, token: "token-" + numero, ownerSessionId: proprietario, nome: "dato-" + numero + ".txt", percorso: "C:/allegati/dato-" + numero + ".txt", mimeType: "text/plain", dimensione: 20 + numero};
}

function elemento(tag = "div", classe = "", testo = "") {
  return {tagName: tag.toUpperCase(), className: classe, textContent: testo, children: [], value: "", disabled: false,
    classList: {add() {}, remove() {}, toggle() {}},
    append(...figli) { this.children.push(...figli); },
    appendChild(figlio) { this.append(figlio); return figlio; },
    replaceChildren(...figli) { this.children = figli; },
    setAttribute(nome, valore) { this[nome] = valore; },
    focus() {}, remove() {},
  };
}

function discendenti(radice) {
  return [radice, ...radice.children.flatMap(discendenti)];
}

function ambiente(nomi, extra = {}) {
  const sessione = {id: "sessione", chiaveBozza: "bozza", lineageId: "lineage", bozza: "Analizza.", allegati: [], allegatiLibreria: [], inviiPendenti: [], inviiNascosti: new Set(), comandi: [], byteImmaginiCronologia: 0};
  const APP = {attivaId: sessione.id, clientId: "documento", sessioni: new Map([[sessione.id, sessione]])};
  const DOM = {input: elemento("textarea"), allegati: elemento(), btnInvia: elemento("button"), modoCoda: elemento("select")};
  DOM.input.value = sessione.bozza;
  DOM.modoCoda.value = "followUp";
  const avvisi = [];
  const chiamate = [];
  const salvati = [];
  const contesto = createContext({
    ...allegatiCore, APP, DOM, TextEncoder, structuredClone, queueMicrotask,
    LIBRARY_CORE: libreriaCore, PALETTE_CORE: paletteCore,
    LIMITE_TESTO_RICHIESTA: 2 * 1024 * 1024, LIMITE_IMMAGINI_RICHIESTA: 4 * 1024 * 1024,
    ARCHIVIO_ALLEGATI_INVII: "allegati", timerSalvaBozza: new Map(),
    crypto: {randomUUID: () => "uuid-di-prova"}, clearTimeout() {},
    crea: elemento, document: {createElement: elemento},
    sessioneAttiva: () => APP.sessioni.get(APP.attivaId),
    toast: (testo) => avvisi.push(testo), testoErrore: (errore) => errore.message,
    aggiornaInterfacciaAttiva() {}, disegnaAllegati() {}, disegnaInviiDaVerificare() {}, adattaAltezza() {},
    ramificaLineageBozza() {}, salvaBozza() {}, avvisa() {},
    avvisaModelloSenzaImmagini: () => false, gestisciComandoComposer: async () => false,
    conservaAllegatiBozza: async () => true, conservaFotografiaAllegati: async () => true,
    rinnovaFilePendentiBestEffort: async () => {}, eliminaFilePendentiBestEffort: async () => {},
    scriviAllegatiInvio: async (...argomenti) => { salvati.push(structuredClone(argomenti)); return true; },
    aggiungiMessaggio: () => ({autore: elemento(), msg: elemento()}),
    idRpc: () => "rpc-di-prova", rpc: async (comando) => { chiamate.push(structuredClone(comando)); },
    registraInvioPendente: (destinazione, invio) => { destinazione.inviiPendenti.push(invio); return true; },
    dimenticaInvioPendente: (destinazione, id) => { destinazione.inviiPendenti = destinazione.inviiPendenti.filter((invio) => invio.id !== id); },
    segnaLineageRisolta: () => true,
    leggiRecordBozza: () => ({lineageId: "lineage", documentoId: APP.clientId, allegatiBundleId: "bundle", testo: "Analizza."}),
    leggiRecordBozzaProprio: () => null, lineageRecordBozza: (record) => record?.lineageId,
    lineageRisolta: () => false, versioneRecordBozza: () => "versione",
    scriviRecordBozzaSessione: () => true, bundleBozzaReferenziato: () => false, eliminaAllegatiInvio: async () => {},
    dimensioneFile: (numero) => numero + " B",
    ...extra,
  });
  const facoltative = ["allegatoLibreriaValido"].filter((nome) => frontend.includes("function " + nome + "("));
  runInContext([...new Set([...facoltative, ...nomi])].map(funzione).join("\n\n"), contesto);
  return {contesto, sessione, APP, DOM, avvisi, chiamate, salvati};
}

function databaseFinto() {
  const record = new Map();
  return {transaction() {
    const transazione = {objectStore() {
      return {
        put(valore) { record.set(valore.id, structuredClone(valore)); queueMicrotask(() => transazione.oncomplete?.()); },
        get(id) {
          const richiesta = {};
          queueMicrotask(() => { richiesta.result = structuredClone(record.get(id)); richiesta.onsuccess?.(); });
          return richiesta;
        },
      };
    }};
    return transazione;
  }};
}

test("libreria invio: IndexedDB conserva origine e indice senza richiedere token", async () => {
  const db = databaseFinto();
  const {contesto} = ambiente(["scriviAllegatiInvio", "leggiStatoAllegatiInvio"], {databaseInvii: async () => db});
  assert.equal(await contesto.scriviAllegatiInvio("bundle", "bozza", [fileLibreria()]), true);
  const risultato = await contesto.leggiStatoAllegatiInvio("bundle");
  assert.equal(risultato.trovato, true);
  assert.equal(risultato.allegati[0].origineLibreria, true);
  assert.equal(risultato.allegati[0].percorsoIndice, fileLibreria().percorsoIndice);
  assert.equal(risultato.allegati[0].token, undefined);
  assert.equal(risultato.allegati[0].ownerSessionId, undefined);
});

test("libreria invio: fotografia bozza conserva insieme pending e libreria", async () => {
  let fotografia;
  const {contesto, sessione} = ambiente(["conservaAllegatiBozza"], {conservaFotografiaAllegati: async (_sessione, _chiave, allegati) => { fotografia = structuredClone(allegati); return true; }});
  sessione.allegati = [filePendente()];
  sessione.allegatiLibreria = [fileLibreria()];
  await contesto.conservaAllegatiBozza(sessione);
  assert.equal(fotografia.length, 2);
  assert.equal(fotografia[0].token, "token-1");
  assert.equal(fotografia[1].origineLibreria, true);
  assert.equal(fotografia[1].percorsoIndice, fileLibreria().percorsoIndice);
});

test("libreria invio: ripristino separa dodici voci libreria e adotta soltanto il pending", async () => {
  const richieste = [];
  const libreria = Array.from({length: 12}, (_, indice) => fileLibreria(indice + 1));
  const {contesto, sessione} = ambiente(["riferimentiFileServer", "adottaFilePendentiBozza", "ripristinaFotografiaAllegatiBozza"], {
    leggiStatoAllegatiInvio: async () => ({trovato: true, errore: null, allegati: [filePendente(1, "vecchia-sessione"), ...libreria]}),
    chiedi: async (via, {corpo}) => {
      richieste.push({via, corpo: structuredClone(corpo)});
      return {allegati: [{...filePendente(2), nome: "dato-1.txt"}]};
    },
  });
  await contesto.ripristinaFotografiaAllegatiBozza(sessione, "bozza");
  assert.equal(sessione.erroreAllegatiBozza, null);
  assert.equal(sessione.allegati.length, 1);
  assert.equal(sessione.allegati[0].id, "pending-2");
  assert.equal(sessione.allegatiLibreria.length, 12);
  assert.equal(sessione.allegatiLibreria[0].percorsoIndice, libreria[0].percorsoIndice);
  assert.equal(richieste.length, 1);
  assert.equal(richieste[0].via, "/api/adotta-file-allegati");
  assert.deepEqual(richieste[0].corpo.allegati, [{ownerSessionId: "vecchia-sessione", id: "pending-1", token: "token-1"}]);
  const riferimenti = contesto.riferimentiFileServer([...sessione.allegati, ...sessione.allegatiLibreria]);
  assert.deepEqual(structuredClone(riferimenti), [{id: "pending-2", token: "token-2"}]);
});

test("libreria invio: chip rimuove i riferimenti senza cancellare file sul ponte", async () => {
  const eliminazioni = [];
  let salvataggi = 0;
  const {contesto, sessione, DOM} = ambiente(["rimuoviAllegatiLibreria", "disegnaAllegati"], {
    conservaAllegatiBozza: async () => { salvataggi += 1; return true; },
    eliminaFilePendentiBestEffort: async (...argomenti) => eliminazioni.push(argomenti),
    chiedi: async (...argomenti) => eliminazioni.push(argomenti),
  });
  sessione.allegati = [filePendente()];
  sessione.allegatiLibreria = [fileLibreria(1), fileLibreria(2)];
  contesto.disegnaAllegati();
  const tutti = discendenti(DOM.allegati);
  assert.ok(tutti.some((voce) => voce.textContent.includes("2 file in libreria")));
  const pulsante = tutti.find((voce) => voce.tagName === "BUTTON" && /libreria/i.test(voce["aria-label"] || ""));
  assert.ok(pulsante, "Manca il pulsante accessibile per rimuovere il chip libreria");
  await pulsante.onclick();
  assert.equal(sessione.allegatiLibreria.length, 0);
  assert.equal(sessione.allegati.length, 1);
  assert.equal(salvataggi, 1);
  assert.equal(eliminazioni.length, 0);
});

test("libreria invio: dodici riferimenti senza testo inviano sette file più indice e conservano la copia completa", async () => {
  const {contesto, sessione, DOM, chiamate, salvati, avvisi} = ambiente(["riferimentiFileServer", "firmeAllegati", "invia"]);
  sessione.allegatiLibreria = Array.from({length: 12}, (_, indice) => fileLibreria(indice + 1));
  DOM.input.value = "";
  await contesto.invia();
  assert.equal(chiamate.length, 1, avvisi.join("\n"));
  const comando = chiamate[0];
  assert.equal(comando.type, "prompt");
  assert.equal(comando.piGuiFileRefs, undefined);
  const separato = allegatiCore.separaMessaggioConFile(comando.message);
  assert.equal(separato.file.length, 8);
  assert.ok(separato.file.slice(0, 7).every((voce) => voce.percorso.endsWith(".pdf.testo.md")));
  assert.equal(separato.file[7].nome, "indice della libreria");
  assert.equal(separato.file[7].percorso, fileLibreria().percorsoIndice);
  assert.ok(avvisi.some((testo) => /primi 7|primi sette/i.test(testo)), "Manca l'avviso sulla riduzione a sette più indice");
  assert.equal(sessione.inviiPendenti.length, 1);
  assert.equal(sessione.inviiPendenti[0].allegati.length, 12);
  assert.equal(sessione.inviiPendenti[0].allegati[0].origineLibreria, true);
  assert.equal(sessione.inviiPendenti[0].allegati[0].percorsoIndice, fileLibreria().percorsoIndice);
  assert.equal(sessione.inviiPendenti[0].firmePrompt.length, 8);
  assert.deepEqual(Array.from(sessione.inviiPendenti[0].firmePrompt).sort(), separato.file.map(allegatiCore.firmaAllegato).sort());
  assert.ok(salvati.some((argomenti) => argomenti[0] === "rpc-di-prova" && argomenti[2].length === 12));
  assert.equal(sessione.allegatiLibreria.length, 0);
});

test("libreria invio: prompt misto autorizza soltanto i pending tramite piGuiFileRefs", async () => {
  const {contesto, sessione, chiamate, avvisi} = ambiente(["riferimentiFileServer", "firmeAllegati", "invia"]);
  sessione.allegati = [filePendente()];
  sessione.allegatiLibreria = [fileLibreria(1), fileLibreria(2)];
  await contesto.invia();
  assert.equal(chiamate.length, 1, avvisi.join("\n"));
  assert.deepEqual(chiamate[0].piGuiFileRefs, [{id: "pending-1", token: "token-1"}]);
  assert.equal(allegatiCore.separaMessaggioConFile(chiamate[0].message).file.length, 3);
  assert.equal(sessione.inviiPendenti[0].allegati.length, 3);
  assert.equal(sessione.allegati.length, 0);
  assert.equal(sessione.allegatiLibreria.length, 0);
});

test("libreria invio: un pending senza token continua a bloccare anche il prompt misto", async () => {
  const {contesto, sessione, chiamate, avvisi} = ambiente(["riferimentiFileServer", "firmeAllegati", "invia"]);
  sessione.allegati = [{...filePendente(), token: undefined}];
  sessione.allegatiLibreria = [fileLibreria()];
  await contesto.invia();
  assert.equal(chiamate.length, 0);
  assert.ok(avvisi.some((testo) => /propriet/i.test(testo)));
  assert.equal(sessione.allegatiLibreria.length, 1);
  assert.equal(sessione.allegati.length, 1);
});

test("libreria invio: ricarica firme del prompt ridotto e riconcilia la cronologia senza perdere i dodici originali", async () => {
  const memoria = new Map();
  const localStorage = {
    get length() { return memoria.size; },
    key(indice) { return [...memoria.keys()][indice]; },
    getItem(chiave) { return memoria.get(chiave) ?? null; },
    setItem(chiave, valore) { memoria.set(chiave, String(valore)); },
    removeItem(chiave) { memoria.delete(chiave); },
  };
  const {contesto, sessione, chiamate, avvisi} = ambiente([
    "riferimentiFileServer", "firmeAllegati", "invia", "testoDaContenuto", "immaginiDaContenuto", "allegatiDaContenuto",
    "riconciliaInviiPendenti", "persistiInvioPendente", "caricaInviiPendenti", "chiaveArchivioInvii",
  ], {localStorage, PREFISSO_INVII: "invio:", DURATA_BOZZE_MS: 30 * 24 * 60 * 60 * 1000, invioGiaRisolto: () => false});
  sessione.allegatiLibreria = Array.from({length: 12}, (_, indice) => fileLibreria(indice + 1));
  await contesto.invia();
  assert.equal(chiamate.length, 1, avvisi.join("\n"));
  const invio = sessione.inviiPendenti[0];
  assert.equal(contesto.persistiInvioPendente(sessione, invio), true);
  sessione.inviiPendenti = contesto.caricaInviiPendenti(sessione.chiaveBozza);
  assert.equal(sessione.inviiPendenti.length, 1);
  assert.equal(sessione.inviiPendenti[0].allegati.length, 12);
  assert.equal(sessione.inviiPendenti[0].allegatiDati, undefined);
  assert.equal(sessione.inviiPendenti[0].firmePrompt.length, 8);
  contesto.riconciliaInviiPendenti(sessione, [{role: "user", content: [{type: "text", text: chiamate[0].message}], timestamp: invio.creatoIl + 1}]);
  assert.equal(sessione.inviiPendenti.length, 0, "La richiesta ridotta a otto riferimenti resta erroneamente da verificare");
});

test("libreria invio: attende la coda degli ingressi e include il riferimento appena indicizzato", async () => {
  const {contesto, sessione, chiamate, avvisi} = ambiente(["riferimentiFileServer", "firmeAllegati", "invia"]);
  let sblocca;
  sessione.codaIngressiLibreria = new Promise((risolvi) => { sblocca = risolvi; }).then(() => {
    sessione.allegatiLibreria.push(fileLibreria());
  });
  const invio = contesto.invia();
  await new Promise(setImmediate);
  try {
    assert.equal(chiamate.length, 0, "Il prompt è partito prima della conclusione dell'indicizzazione");
  } finally {
    sblocca();
    await invio;
  }
  assert.equal(chiamate.length, 1, avvisi.join("\n"));
  const separato = allegatiCore.separaMessaggioConFile(chiamate[0].message);
  assert.equal(separato.file.length, 1);
  assert.equal(separato.file[0].percorso, fileLibreria().percorso);
});

test("libreria invio: lineage risolta svuota entrambe le raccolte e invalida gli ingressi tardivi", () => {
  const eliminazioni = [];
  const {contesto, sessione, APP} = ambiente(["applicaLineageRisolta"], {eliminaFilePendentiBestEffort: async (_sessione, allegati) => eliminazioni.push(structuredClone(allegati))});
  sessione.allegati = [filePendente()];
  sessione.allegatiLibreria = [fileLibreria()];
  sessione.generazioneIngressiLibreria = 4;
  const altra = {...sessione, id: "altra", lineageId: "lineage-diversa", allegati: [], allegatiLibreria: [fileLibreria(2)]};
  APP.sessioni.set(altra.id, altra);
  contesto.applicaLineageRisolta("lineage");
  assert.equal(sessione.allegati.length, 0);
  assert.equal(sessione.allegatiLibreria.length, 0);
  assert.equal(sessione.generazioneIngressiLibreria, 5);
  assert.equal(sessione.lineageId, null);
  assert.equal(altra.allegatiLibreria.length, 1);
  assert.equal(altra.generazioneIngressiLibreria, 4);
  assert.deepEqual(eliminazioni, [[filePendente()]]);
});

test("libreria invio: inizializzazione e transizioni del composer includono lo stato della libreria", () => {
  const inizializzazione = funzione("creaSessione");
  assert.match(inizializzazione, /allegatiLibreria:\s*\[\]/, "La sessione deve inizializzare la raccolta della libreria");
  assert.match(inizializzazione, /codaIngressiLibreria:\s*Promise\.resolve\(\)/);
  assert.match(inizializzazione, /generazioneIngressiLibreria:\s*0/);
  assert.match(funzione("aggiornaInterfacciaAttiva"), /allegatiLibreria/, "Il pulsante Invio deve ammettere una richiesta con sola libreria");
  const inizioUnload = frontend.indexOf("window.addEventListener(\"beforeunload\"");
  const fineUnload = frontend.indexOf("window.addEventListener(\"storage\"", inizioUnload);
  const unload = frontend.slice(inizioUnload, fineUnload);
  assert.match(unload, /allegatiLibreria/, "Il refresh deve riconoscere riferimenti non inviati");
  assert.match(unload, /importazioniLibreriaInCorso/, "Il refresh deve riconoscere un'indicizzazione in corso");
  for (const nome of ["aggiornaIdentitaBozza", "dimenticaBozza", "disegnaInviiDaVerificare", "chiudiSessione", "gestisciComandoComposer", "passaConversazioneAlTerminale", "rpc"]) {
    assert.match(funzione(nome), /allegatiLibreria/, nome + " deve trattare anche i riferimenti della libreria");
  }
});
