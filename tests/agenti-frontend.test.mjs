import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const AGENTI = require("../app/public/agenti-core.js");
const CONSIGLIO = require("../app/public/consiglio-core.js");
const sorgenteAgenti = await readFile(new URL("../app/public/agenti-core.js", import.meta.url), "utf8");
const frontend = await readFile(new URL("../app/public/app.js", import.meta.url), "utf8");
const inizioSelettori = frontend.indexOf("function disegnaPannelloRuoliConsiglio(");
const fineSelettori = frontend.indexOf("\nasync function apriPannelloRuoliConsiglio(", inizioSelettori);
assert.ok(inizioSelettori > 0 && fineSelettori > inizioSelettori);
const inizioMontaggio = frontend.indexOf("try { globalThis.PiGuiAgentiCore?.montaAgenti?.(");
const fineMontaggio = frontend.indexOf("\nDOM.btnInvia.onclick = invia;", inizioMontaggio);
const montaggio = frontend.slice(inizioMontaggio, fineMontaggio);
assert.equal(montaggio.split("\n").length + 1, 9, "il montaggio con il commento occupa nove righe");

// DOM minimo con propagazione capture/bubble e fuoco: viene eseguito il modulo
// reale, insieme ai selettori che il montaggio passa dalla GUI esistente.
class Nodo {
  constructor(tag, documento) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = documento;
    this.children = []; this.parentNode = null; this.attributi = {};
    this.listeners = new Map(); this.hidden = false; this.disabled = false;
    this.inert = false; this.tabIndex = ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(this.tagName) ? 0 : -1;
    this.value = ""; this.className = ""; this.id = ""; this.proprioTesto = "";
  }
  get textContent() { return this.proprioTesto + this.children.map((figlio) => figlio.textContent).join(""); }
  set textContent(testo) { this.proprioTesto = String(testo); this.replaceChildren(); }
  setAttribute(nome, valore) { this.attributi[nome] = String(valore); }
  getAttribute(nome) { return Object.hasOwn(this.attributi, nome) ? this.attributi[nome] : null; }
  removeAttribute(nome) { delete this.attributi[nome]; }
  appendChild(figlio) { figlio.parentNode = this; this.children.push(figlio); return figlio; }
  append(...figli) { for (const figlio of figli) this.appendChild(figlio); }
  replaceChildren(...figli) { for (const figlio of this.children) figlio.parentNode = null; this.children = []; this.append(...figli); }
  after(nodo) { const fratelli = this.parentNode.children; nodo.parentNode = this.parentNode; fratelli.splice(fratelli.indexOf(this) + 1, 0, nodo); }
  remove() { if (this.parentNode) { const fratelli = this.parentNode.children; fratelli.splice(fratelli.indexOf(this), 1); this.parentNode = null; } }
  contains(nodo) { return nodo === this || this.children.some((figlio) => figlio.contains(nodo)); }
  addEventListener(nome, funzione, capture = false) {
    this.listeners.set(nome, [...(this.listeners.get(nome) || []), { funzione, capture }]);
  }
  removeEventListener(nome, funzione) { this.listeners.set(nome, (this.listeners.get(nome) || []).filter((riga) => riga.funzione !== funzione)); }
  querySelectorAll(selettore) {
    const selettori = selettore.split(",").map((s) => s.trim());
    return this.children.flatMap(tutti).filter((nodo) => selettori.some((s) => {
      if (s.startsWith("#")) return nodo.id === s.slice(1);
      const attributo = /^\[([^=\]]+)(?:=['"]([^'"]+)['"])?\]$/u.exec(s);
      if (attributo) return attributo[1] === "tabindex" ? nodo.getAttribute("tabindex") != null
        : attributo[2] ? nodo.getAttribute(attributo[1]) === attributo[2] : nodo.getAttribute(attributo[1]) != null;
      return nodo.tagName === s.toUpperCase();
    }));
  }
  querySelector(selettore) { return this.querySelectorAll(selettore)[0] || null; }
  focus() { this.ownerDocument.activeElement = this; this.emetti("focusin"); }
  click() { if (!this.disabled) return this.emetti("click").risultato; }
  emetti(nome, proprieta = {}) {
    const evento = {
      type: nome, target: this, key: "", defaultPrevented: false, fermato: false, immediato: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.fermato = true; },
      stopImmediatePropagation() { this.fermato = true; this.immediato = true; },
      ...proprieta,
    };
    const percorso = []; let nodo = this;
    while (nodo) { percorso.push(nodo); nodo = nodo.parentNode; }
    for (const capture of [true, false]) {
      for (const elemento of capture ? [...percorso].reverse() : percorso) {
        for (const riga of elemento.listeners.get(nome) || []) {
          if (riga.capture !== capture) continue;
          evento.risultato = riga.funzione(evento);
          if (evento.immediato) break;
        }
        if (!capture && elemento === this && !evento.immediato && typeof this["on" + nome] === "function") {
          evento.risultato = this["on" + nome](evento);
        }
        if (evento.fermato) return evento;
      }
    }
    return evento;
  }
}
function tutti(nodo) { return [nodo, ...nodo.children.flatMap(tutti)]; }
class Documento extends Nodo {
  constructor() {
    super("document", null); this.ownerDocument = this;
    this.body = new Nodo("body", this); this.appendChild(this.body);
    this.activeElement = this.body; this.defaultView = {};
  }
  createElement(tag) { return new Nodo(tag, this); }
}
function differita() {
  let risolvi, rifiuta;
  const promessa = new Promise((r, j) => { risolvi = r; rifiuta = j; });
  return { promessa, risolvi, rifiuta };
}
async function svuota() { for (let i = 0; i < 30; i += 1) await Promise.resolve(); }
const catalogo = [
  { provider: "finto", modelId: "alfa", nome: "Alfa" },
  { provider: "finto", modelId: "beta", nome: "Beta" },
];
const caricamento = () => ({
  tipo: "file", id: "00000000-0000-4000-8000-000000000001", token: "token-finto", nome: "caricato.txt", mimeType: "text/plain", dimensione: 24,
  percorso: "C:/profilo/.pi/gui/allegati/" + "a".repeat(64) + "/00000000-0000-4000-8000-000000000001-caricato.txt", ownerSessionId: "s1",
});
const riferimentoLibreria = () => ({
  tipo: "file", origineLibreria: true, nome: "nota.md", mimeType: "text/markdown", dimensione: 42,
  percorsoIndice: "C:/profilo/.pi/gui/libreria/.ingest-index.json",
  percorso: "C:/profilo/.pi/gui/libreria/raw/documenti/nota.md",
});
function preset(id = "rapido", nome = "Rapido") {
  return {
    id, nome, tipo: "testo", istruzioni: "Confronta le ipotesi.", versione: 1,
    ordine: ["consigliere-1", "scrittore"], livello: { "consigliere-1": "high", scrittore: null },
    assegnazioni: {
      "consigliere-1": { provider: "finto", modelId: "alfa" },
      scrittore: { provider: "finto", modelId: "beta" },
    },
  };
}
function rispostaIniziale() {
  const preimpostazioni = [preset(), preset("tre-consiglieri", "Tre consiglieri")];
  return {
    archivio: { schemaVersion: 1, versioneArchivio: 1, predefinita: "rapido", preimpostazioni },
    catalogo: structuredClone(catalogo),
    risoluzioni: preimpostazioni.map((voce) => ({
      id: voce.id, versione: voce.versione, configurazione: AGENTI.configurazioneDaPreimpostazione(voce),
      catalogo: structuredClone(catalogo), problemi: [], avvioPossibile: true,
      effettive: {
        consiglieri: [{ roleId: "consigliere-1", provider: "finto", modello: "alfa", nomeModello: "Alfa", thinking: "high", tipo: "consigliere", ordine: 1 }],
        scrittore: { roleId: "scrittore", provider: "finto", modello: "beta", nomeModello: "Beta", thinking: null, tipo: "scrittore", ordine: 2 },
      },
    })), cartellaLavori: "C:/finta/lavori",
  };
}
function ambiente(opzioni = {}) {
  const documento = new Documento();
  const composer = documento.createElement("div"); documento.body.appendChild(composer);
  const allega = documento.createElement("button"); allega.id = "btn-allega";
  const input = documento.createElement("textarea"); input.value = "Richiesta di prova, nessun modello reale.";
  composer.append(allega, input);
  const s = {
    id: "s1", chiaveBozza: "b1", attiva: true, cartella: "C:/finta/progetto", bozza: input.value,
    allegati: [], allegatiLibreria: [], livelli: ["off", "low", "medium", "high"], invioInCorso: false,
  };
  const stato = { corrente: s, dati: rispostaIniziale(), chiamate: [], avvisi: [], inviiOrdinari: 0, erroriMontaggio: [] };
  Object.assign(stato, opzioni);
  const crea = (tag, classe, testo) => {
    const nodo = documento.createElement(tag); nodo.className = classe || "";
    if (testo != null) nodo.textContent = testo;
    return nodo;
  };
  const disegnaRuoli = new Function("crea", "CONSIGLIO_CORE", "traduciLivello",
    "return " + frontend.slice(inizioSelettori, fineSelettori))(crea, CONSIGLIO, (livello) => livello);
  const ponte = {
    consiglio: CONSIGLIO, input, sessioneAttiva: () => stato.corrente,
    sessioni: new Map([[s.id, s]]), online: () => true, disegnaRuoli,
    operationId: () => "operazione-finta", toast: (testo) => stato.avvisi.push(testo),
    chiediConsenso: async () => true,
    chiama: async (via, corpo) => {
      stato.chiamate.push({ via, corpo: corpo && structuredClone(corpo) });
      if (via.startsWith("/api/consiglio/preimpostazioni")) {
        if (corpo && stato.salva) return stato.salva(corpo);
        return { ok: true, dati: structuredClone(stato.dati) };
      }
      if (stato.lancia) return stato.lancia(corpo);
      return { ok: true, dati: { lavoroId: "lavoro-finto" } };
    },
  };
  const ambienteMontaggio = {
    globalThis: { PiGuiAgentiCore: Object.hasOwn(opzioni, "moduloAgenti") ? opzioni.moduloAgenti : AGENTI },
    console: { error: (errore) => stato.erroriMontaggio.push(errore) },
    DOM: { composerShell: composer, input, conversazione: composer, btnInvia: documento.createElement("button") },
    invia: () => { stato.inviiOrdinari += 1; },
    CONSIGLIO_CORE: CONSIGLIO, chiamaConsiglio: ponte.chiama,
    sessioneAttiva: ponte.sessioneAttiva, APP: { sessioni: ponte.sessioni, bridgeOnline: true, paletteComandi: {} },
    aggiornaInterfacciaAttiva() {}, aggiornaDalPonte() {}, attivaSessione() {},
    chiediConsensoConsiglio: ponte.chiediConsenso, disegnaPannelloRuoliConsiglio: disegnaRuoli,
    toast: ponte.toast, composizioneInputInCorso: false,
  };
  const api = opzioni.montaggioReale
    ? new Function("ambiente", "const { " + Object.keys(ambienteMontaggio).join(", ") + " } = ambiente; " + montaggio
      + frontend.slice(fineMontaggio, fineMontaggio + "\nDOM.btnInvia.onclick = invia;".length)
      + "; return DOM.composerShell.querySelector('#btn-agenti')?.agenti;")(ambienteMontaggio)
    : AGENTI.montaAgenti(composer, ponte);
  const contenitore = composer.querySelector("#btn-agenti");
  const [primario, freccia] = contenitore?.children || [];
  const menu = composer.querySelector("#elenco-preimpostazioni-agenti");
  input.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" || evento.shiftKey) return;
    const sessione = stato.corrente;
    if (!sessione || sessione.handoffInCorso || sessione.chiusuraInCorso || sessione.invioInCorso) return;
    stato.inviiOrdinari += 1;
  });
  return { documento, composer, allega, input, s, stato, ponte, api, contenitore, primario, freccia, menu, btnInvia: ambienteMontaggio.DOM.btnInvia };
}
const lanci = (ambiente) => ambiente.stato.chiamate.filter((riga) => riga.via === "/api/consiglio/avvia");
const perNome = (radice, nome) => tutti(radice).find((voce) => voce.getAttribute("aria-label") === nome);
const bottone = (radice, nome) => tutti(radice).find((voce) => voce.tagName === "BUTTON" && voce.textContent === nome);

test("il primario porta il nome della preimpostazione e avvia al primo clic, la freccia apre elenco e Gestisci", async () => {
  const a = ambiente(); await a.api.pronto;
  assert.equal(a.allega.parentNode.children[a.allega.parentNode.children.indexOf(a.allega) + 1], a.contenitore);
  assert.deepEqual(a.contenitore.children.map((voce) => voce.tagName), ["BUTTON", "BUTTON"]);
  assert.equal(a.primario.textContent, "Agenti · Rapido");
  assert.equal(a.freccia.getAttribute("aria-label"), "Scegli la preimpostazione");
  assert.equal(a.freccia.getAttribute("aria-haspopup"), "menu");
  await a.primario.click(); await svuota();
  assert.equal(lanci(a).length, 1);
  assert.deepEqual(lanci(a)[0].corpo.preimpostazione, { id: "rapido", versione: 1 });
  a.freccia.click();
  assert.equal(a.menu.hidden, false); assert.equal(a.freccia.getAttribute("aria-expanded"), "true");
  assert.equal(a.menu.children.at(-1).textContent, "Gestisci");
  await a.menu.children[1].click(); await svuota();
  assert.equal(lanci(a).length, 2);
  assert.equal(lanci(a)[1].corpo.preimpostazione.id, "tre-consiglieri");
  assert.equal(a.input.value, a.s.bozza);
  a.api.distruggi();
});

test("elenco e finestra si governano con frecce, Invio ed Esc e restituiscono il fuoco", async () => {
  const a = ambiente(); await a.api.pronto;
  a.freccia.click();
  assert.equal(a.documento.activeElement, a.menu.children[0]);
  a.menu.children[0].emetti("keydown", { key: "ArrowDown" });
  assert.equal(a.documento.activeElement, a.menu.children[1]);
  assert.equal(a.menu.children.filter((voce) => voce.tabIndex === 0).length, 1);
  const barra = a.documento.activeElement.emetti("keydown", { key: " " }); await svuota();
  assert.equal(barra.defaultPrevented, true, "la scelta consuma il default nativo e non produce un secondo clic");
  assert.equal(lanci(a).length, 1); assert.equal(a.documento.activeElement, a.freccia);
  a.freccia.click(); a.documento.activeElement.emetti("keydown", { key: "Escape" });
  assert.equal(a.menu.hidden, true); assert.equal(a.documento.activeElement, a.freccia);
  a.freccia.click(); a.documento.activeElement.emetti("keydown", { key: "End" });
  const invio = a.documento.activeElement.emetti("keydown", { key: "Enter" }); await svuota();
  assert.equal(invio.defaultPrevented, true, "Invio non ripete l'attivazione nativa del bottone");
  const finestra = a.documento.querySelector('[role="dialog"]');
  assert.equal(finestra.getAttribute("aria-modal"), "true");
  assert.equal(a.documento.activeElement, perNome(finestra, "Preimpostazione da gestire"));
  const focusabili = finestra.querySelectorAll("button, input, select, textarea").filter((voce) => !voce.disabled);
  focusabili.at(-1).focus();
  const tab = focusabili.at(-1).emetti("keydown", { key: "Tab" });
  assert.equal(tab.defaultPrevented, true); assert.equal(a.documento.activeElement, focusabili[0]);
  focusabili[0].emetti("keydown", { key: "Tab", shiftKey: true });
  assert.equal(a.documento.activeElement, focusabili.at(-1));
  a.input.focus(); assert.equal(finestra.contains(a.documento.activeElement), true);
  a.documento.activeElement.emetti("keydown", { key: "Escape" });
  assert.equal(a.documento.querySelector('[role="dialog"]'), null);
  assert.equal(a.documento.activeElement, a.freccia);
  assert.equal(a.composer.inert, false);
  a.api.distruggi();
});

test("senza catalogo il pulsante e disattivato con il motivo e Gestisci resta apribile", async () => {
  const dati = rispostaIniziale(); dati.catalogo = [];
  const a = ambiente({ dati }); await a.api.pronto;
  assert.equal(a.primario.disabled, true);
  assert.match(a.composer.querySelector("#stato-agenti").textContent, /modelli effettivi non sono leggibili/);
  await a.primario.click(); assert.equal(lanci(a).length, 0);
  a.freccia.click(); await a.menu.children.at(-1).click();
  const finestra = a.documento.querySelector('[role="dialog"]');
  assert.ok(finestra);
  assert.match(finestra.textContent, /modelli effettivi non sono leggibili/);
  const scrittore = perNome(finestra, "Modello di Scrittore");
  assert.equal(scrittore.value, "finto/beta");
  assert.ok(scrittore.children.some((voce) => voce.value === "finto/beta"));
  let richiesta;
  a.stato.salva = async (corpo) => { richiesta = corpo; return { ok: true, dati: structuredClone(dati) }; };
  perNome(finestra, "Nome della preimpostazione").value = "Rapido rinominato";
  await bottone(finestra, "Salva").click();
  assert.deepEqual(richiesta.preimpostazione.assegnazioni, dati.archivio.preimpostazioni[0].assegnazioni,
    "rinominare a Pi spento conserva le coppie salvate e non le trasforma in Automatico");
  assert.equal(lanci(a).length, 0);
  a.api.distruggi();
});

test("un clic apre un solo lavoro, le code sono attese e la sessione resta congelata", async () => {
  const a = ambiente(); await a.api.pronto;
  const code = [differita(), differita(), differita(), differita()];
  [a.s.codaIngressiLibreria, a.s.codaImportazioneImmagini, a.s.codaImportazioneFile, a.s.codaAllegatiBozza] = code.map((coda) => coda.promessa);
  const primo = a.api.avvia(a.stato.dati.archivio.preimpostazioni[0]);
  assert.equal(a.s.invioInCorso, true, "il latch precede il primo await");
  const duplicato = a.api.avvia(a.stato.dati.archivio.preimpostazioni[0]);
  assert.equal(await duplicato, false, "il secondo avvia diretto non supera il latch");
  a.input.emetti("keydown", { key: "Enter" });
  assert.equal(a.stato.inviiOrdinari, 0);
  for (const coda of code.slice(0, 3)) {
    coda.risolvi(); await svuota(); assert.equal(lanci(a).length, 0);
  }
  a.s.allegatiLibreria.push(riferimentoLibreria());
  code[3].risolvi(); await primo;
  assert.equal(lanci(a).length, 1);
  assert.equal(lanci(a)[0].corpo.prompt, a.input.value);
  assert.deepEqual(lanci(a)[0].corpo.allegati.map((voce) => voce.percorso), [riferimentoLibreria().percorso]);
  assert.equal(lanci(a)[0].corpo.sourceSessionId, "s1");
  assert.equal(a.s.invioInCorso, false);
  const attesa = differita(); a.s.codaIngressiLibreria = attesa.promessa;
  const secondo = a.api.avvia(a.stato.dati.archivio.preimpostazioni[0]);
  a.stato.corrente = { ...a.s, id: "s2", chiaveBozza: "b2", invioInCorso: false };
  a.input.value = "Testo della seconda conversazione";
  attesa.risolvi(); await secondo;
  assert.equal(lanci(a).length, 1, "cambiare sessione durante le code non apre un lavoro sulla sessione nuova");
  assert.equal(a.input.value, "Testo della seconda conversazione");
  a.api.distruggi();
});

test("con un modello assente il lancio si ferma e chiede una scelta", async () => {
  const dati = rispostaIniziale(); dati.catalogo.pop();
  const a = ambiente({ dati }); await a.api.pronto;
  await a.primario.click();
  assert.equal(lanci(a).length, 0);
  assert.match(a.stato.avvisi.join(" "), /Scegli esplicitamente le assegnazioni/);
  assert.ok(a.documento.querySelector('[role="dialog"]'));
  assert.equal(perNome(a.documento, "Modello di Scrittore").value, "finto/beta");
  assert.equal(a.stato.chiamate.some((riga) => riga.via.startsWith("/api/consiglio/ruoli")), false);
  a.api.distruggi();
});

test("la finestra Gestisci non salva consenso, testo o allegati dentro la preimpostazione", async () => {
  const a = ambiente(); await a.api.pronto;
  a.s.consenso = true; a.s.allegati = [caricamento()];
  const inviati = [];
  a.stato.salva = async (corpo) => {
    inviati.push(corpo);
    if (corpo.azione === "crea") {
      a.stato.dati.archivio.preimpostazioni.push({ ...corpo.preimpostazione, id: "nuova", versione: 1 });
    }
    return { ok: true, dati: structuredClone(a.stato.dati) };
  };
  await a.api.apriGestisci();
  const finestra = a.documento.querySelector('[role="dialog"]');
  const selettore = perNome(finestra, "Preimpostazione da gestire");
  selettore.value = ""; selettore.onchange();
  perNome(finestra, "Nome della preimpostazione").value = "Solo scrittore";
  perNome(finestra, "Istruzioni della preimpostazione").value = "Scrivi con chiarezza.";
  const numero = perNome(finestra, "Numero di consiglieri"); numero.value = "0"; numero.onchange();
  await bottone(finestra, "Salva").click();
  assert.equal(inviati.length, 1); assert.equal(inviati[0].azione, "crea");
  assert.deepEqual(Object.keys(inviati[0].preimpostazione).sort(), ["assegnazioni", "istruzioni", "livello", "nome", "ordine", "tipo"]);
  assert.deepEqual(inviati[0].preimpostazione.ordine, ["scrittore"]);
  assert.equal(JSON.stringify(inviati[0]).includes(a.input.value), false);
  assert.equal(JSON.stringify(inviati[0]).includes(a.s.allegati[0].percorso), false);
  assert.equal(Object.hasOwn(inviati[0], "consenso"), false);
  await bottone(finestra, "Duplica").click();
  await bottone(finestra, "Usa come predefinita").click();
  await bottone(finestra, "Elimina").click();
  assert.deepEqual(inviati.map((riga) => riga.azione), ["crea", "duplica", "predefinita", "elimina"]);
  for (const richiesta of inviati.slice(1)) {
    assert.equal(richiesta.versioneArchivioAttesa, 1); assert.equal(richiesta.versioneAttesa, 1);
  }
  a.api.distruggi();
});

test("la scorciatoia avvia solo dentro il composer e non invia il prompt ordinario", async () => {
  const a = ambiente(); await a.api.pronto;
  const scorciatoia = { key: "Enter", ctrlKey: true, shiftKey: true };
  a.documento.body.emetti("keydown", scorciatoia); await svuota();
  assert.equal(lanci(a).length, 0);
  const evento = a.input.emetti("keydown", scorciatoia); await svuota();
  assert.equal(evento.defaultPrevented, true); assert.equal(lanci(a).length, 1);
  assert.equal(a.stato.inviiOrdinari, 0);
  a.input.emetti("keydown", { key: "Enter" }); assert.equal(a.stato.inviiOrdinari, 1);
  a.input.emetti("keydown", { ...scorciatoia, isComposing: true }); await svuota();
  assert.equal(lanci(a).length, 1);
  a.input.value = " "; a.freccia.focus(); await a.primario.click();
  assert.equal(lanci(a).length, 1); assert.equal(a.documento.activeElement, a.input);
  a.api.distruggi();
});

test("un cambiamento del piano durante il consenso blocca il secondo avvio", async () => {
  const a = ambiente(); await a.api.pronto;
  a.stato.dati.archivio.preimpostazioni[0].tipo = "codice";
  await a.api.aggiorna();
  a.stato.lancia = async () => ({ ok: false, codice: "consenso-mancante", consenso: "Il consiglio modificherà i file." });
  a.ponte.chiediConsenso = async () => {
    a.stato.dati.risoluzioni[0].effettive.scrittore.modello = "alfa";
    return true;
  };
  await a.primario.click();
  assert.equal(lanci(a).length, 1, "il consenso non riapre con un piano diverso da quello mostrato");
  assert.match(a.stato.avvisi.join(" "), /modelli effettivi sono cambiati/);
  a.api.distruggi();
});

test("un allegato bloccato conserva chip e bozza anche dal montaggio e dal percorso compatibile", async () => {
  const a = ambiente({ montaggioReale: true }); await a.api.pronto;
  a.s.allegati.push({ id: "immagine-finta", nome: "immagine.png", mimeType: "image/png", data: "ZmludG8=", previewUrl: "data:image/png;base64,ZmludG8=", larghezza: 1, altezza: 1, bytes: 5 });
  const bozza = a.input.value; const chip = structuredClone(a.s.allegati);
  await a.primario.click();
  assert.equal(lanci(a).length, 0); assert.match(a.stato.avvisi.join(" "), /immagin/i);
  assert.equal(a.input.value, bozza); assert.deepEqual(a.s.allegati, chip);
  const compatibile = await CONSIGLIO.avviaConsiglio({ sourceSessionId: a.s.id, prompt: bozza, operationId: "legacy", chiama: a.ponte.chiama });
  assert.equal(compatibile.avviato, false); assert.equal(lanci(a).length, 0);
  assert.equal(a.input.value, bozza); assert.deepEqual(a.s.allegati, chip);
  a.api.distruggi();
});

test("un errore di lettura del catalogo disattiva l'avvio e lascia un motivo senza rigetti pendenti", async () => {
  const a = ambiente(); await a.api.pronto;
  a.ponte.chiama = async () => { throw new Error("rete indisponibile"); };
  assert.equal(await a.api.aggiorna(), false);
  assert.equal(a.primario.disabled, true);
  assert.match(a.composer.querySelector("#stato-agenti").textContent, /Non riesco a leggere le preimpostazioni/);
  await a.api.apriGestisci();
  assert.match(a.documento.querySelector('[role="dialog"]').textContent, /ponte sia disponibile/);
  assert.equal(lanci(a).length, 0);
  a.api.distruggi();
});

test("il montaggio protegge Invia quando il modulo manca o solleva un errore", () => {
  const browser = {};
  new Function("globalThis", "module", sorgenteAgenti)(browser, undefined);
  assert.equal(typeof browser.PiGuiAgentiCore.montaAgenti, "function");
  assert.deepEqual(Object.keys(browser), ["PiGuiAgentiCore"]);
  for (const moduloAgenti of [undefined, { montaAgenti() { throw new Error("Montaggio fallito"); } }]) {
    const a = ambiente({ montaggioReale: true, moduloAgenti });
    assert.equal(a.api, undefined);
    a.btnInvia.click();
    assert.equal(a.stato.inviiOrdinari, 1, "il cablaggio ordinario prosegue dopo il montaggio protetto");
    assert.equal(a.stato.erroriMontaggio.length, moduloAgenti ? 1 : 0);
  }
});

test("un caricamento reale esterno blocca entrambi gli ingressi e conserva anche la voce di libreria", async () => {
  const a = ambiente(); await a.api.pronto;
  a.s.allegati.push(caricamento());
  a.s.allegatiLibreria.push(riferimentoLibreria());
  const chip = structuredClone([a.s.allegati, a.s.allegatiLibreria]);
  const bozza = a.input.value;
  assert.equal(await a.api.avvia(a.stato.dati.archivio.preimpostazioni[0]), false);
  assert.match(a.stato.avvisi.join(" "), /caricato\.txt/);
  const esito = await CONSIGLIO.avviaConsiglio({ sourceSessionId: a.s.id, prompt: bozza, operationId: "legacy-upload", chiama: a.ponte.chiama });
  assert.equal(esito.avviato, false);
  assert.match(esito.messaggio, /caricato\.txt/);
  assert.equal(lanci(a).length, 0);
  assert.equal(a.input.value, bozza); assert.equal(a.s.bozza, bozza);
  assert.deepEqual([a.s.allegati, a.s.allegatiLibreria], chip);
  a.api.distruggi();
});

test("la firma legge solo le identita dei modelli e rileva un cambio di modello", async () => {
  const a = ambiente(); await a.api.pronto;
  a.s.modelli = [{ provider: "finto", id: "alfa", toJSON() { throw new Error("Catalogo serializzato per intero"); } }];
  Object.defineProperty(a.s.modelli[0], "dettagli", { get() { throw new Error("Metadati letti a ogni tasto"); } });
  await a.api.aggiorna();
  const prima = a.stato.chiamate.length;
  a.input.emetti("input"); await svuota();
  assert.equal(a.stato.chiamate.length, prima);
  a.s.modelli[0].id = "beta";
  a.input.emetti("input"); await svuota();
  assert.equal(a.stato.chiamate.length, prima + 1);
  a.api.distruggi();
});

test("il catalogo resta utilizzabile durante l'aggiornamento con uno stato veritiero", async () => {
  const a = ambiente(); await a.api.pronto;
  const risposta = differita(); const chiama = a.ponte.chiama;
  a.ponte.chiama = (via, corpo) => via.startsWith("/api/consiglio/preimpostazioni") && !corpo
    ? risposta.promessa : chiama(via, corpo);
  const aggiornamento = a.api.aggiorna();
  assert.equal(a.contenitore.getAttribute("aria-busy"), "true");
  assert.match(a.composer.querySelector("#stato-agenti").textContent, /in aggiornamento/);
  assert.doesNotMatch(a.composer.querySelector("#stato-agenti").textContent, /non sono leggibili/);
  assert.equal(a.primario.disabled, false);
  a.freccia.click();
  const avvio = a.menu.children[0].click(); await svuota();
  assert.equal(lanci(a).length, 0, "il piano corrente viene comunque verificato prima del lancio");
  risposta.risolvi({ ok: true, dati: structuredClone(a.stato.dati) });
  await aggiornamento; await avvio; await svuota();
  assert.equal(lanci(a).length, 1);
  assert.equal(a.contenitore.getAttribute("aria-busy"), "false");
  a.api.distruggi();
});

test("i motivi di preparazione precedono il campo vuoto e la bozza salvata resta utilizzabile", async () => {
  const a = ambiente(); await a.api.pronto;
  a.input.value = "";
  for (const campo of ["sincronizzazione", "renderCronologiaInCorso", "handoffInCorso"]) {
    a.s[campo] = true;
    assert.equal(await a.api.avvia(a.stato.dati.archivio.preimpostazioni[0]), false);
    assert.match(a.stato.avvisi.at(-1), /ancora in preparazione/);
    a.s[campo] = false;
  }
  assert.equal(lanci(a).length, 0);
  assert.equal(await a.api.avvia(a.stato.dati.archivio.preimpostazioni[0]), true);
  assert.equal(lanci(a)[0].corpo.prompt, a.s.bozza);
  assert.equal(a.input.value, "");
  a.api.distruggi();
});

test("il preset di codice senza cartella disattiva il primario e si ferma prima del consenso", async () => {
  const a = ambiente(); await a.api.pronto;
  a.s.cartella = null;
  a.stato.dati.archivio.preimpostazioni[0].tipo = "codice";
  let consensi = 0; a.ponte.chiediConsenso = async () => { consensi += 1; return true; };
  await a.api.aggiorna();
  assert.equal(a.primario.disabled, true);
  assert.match(a.composer.querySelector("#stato-agenti").textContent, /cartella di lavoro/);
  assert.equal(await a.api.avvia(a.stato.dati.archivio.preimpostazioni[0]), false);
  assert.equal(lanci(a).length, 0); assert.equal(consensi, 0);
  a.api.distruggi();
});

for (const [campo, nome] of [
  ["codaIngressiLibreria", "della libreria"],
  ["codaImportazioneImmagini", "delle immagini"],
  ["codaImportazioneFile", "dei file"],
  ["codaAllegatiBozza", "degli allegati della bozza"],
]) {
  test("il rigetto " + campo + " blocca Agenti e l'ingresso precedente conservando bozza e chip", async () => {
    for (const precedente of [false, true]) {
      const a = ambiente(); await a.api.pronto;
      a.s.allegatiLibreria.push(riferimentoLibreria());
      const bozza = a.input.value; const chip = structuredClone(a.s.allegatiLibreria);
      const coda = differita(); a.s[campo] = coda.promessa;
      const avvio = precedente
        ? CONSIGLIO.avviaConsiglio({ sourceSessionId: a.s.id, prompt: bozza, operationId: "legacy-coda", chiama: a.ponte.chiama })
        : a.api.avvia(a.stato.dati.archivio.preimpostazioni[0]);
      await svuota(); coda.rifiuta(new Error("Errore finto di importazione"));
      const esito = await avvio;
      assert.equal(precedente ? esito.avviato : esito, false);
      assert.ok((precedente ? esito.messaggio : a.stato.avvisi.at(-1)).includes("L'importazione " + nome + " è fallita"));
      assert.equal(lanci(a).length, 0); assert.equal(a.s.invioInCorso, false);
      assert.equal(a.input.value, bozza); assert.equal(a.s.bozza, bozza);
      assert.deepEqual(a.s.allegatiLibreria, chip);
      a.api.distruggi();
    }
  });
}

test("entrambi gli ingressi attendono anche la coda bozza creata durante l'ingresso in libreria", async () => {
  for (const precedente of [false, true]) {
    const a = ambiente(); await a.api.pronto;
    const ingresso = differita(); a.s.codaIngressiLibreria = ingresso.promessa;
    a.s.codaAllegatiBozza = Promise.resolve();
    const avvio = precedente
      ? CONSIGLIO.avviaConsiglio({ sourceSessionId: a.s.id, prompt: a.input.value, operationId: "legacy-nuova-coda", chiama: a.ponte.chiama })
      : a.api.avvia(a.stato.dati.archivio.preimpostazioni[0]);
    const nuovaCoda = differita();
    a.s.allegatiLibreria.push(riferimentoLibreria());
    a.s.codaAllegatiBozza = nuovaCoda.promessa;
    ingresso.risolvi(); await svuota();
    assert.equal(lanci(a).length, 0);
    nuovaCoda.rifiuta(new Error("Salvataggio finto fallito"));
    const esito = await avvio;
    assert.equal(precedente ? esito.avviato : esito, false);
    assert.match(precedente ? esito.messaggio : a.stato.avvisi.at(-1), /importazione degli allegati della bozza è fallita/);
    assert.equal(lanci(a).length, 0); assert.equal(a.s.invioInCorso, false);
    assert.equal(a.input.value, a.s.bozza); assert.deepEqual(a.s.allegatiLibreria, [riferimentoLibreria()]);
    a.api.distruggi();
  }
});
