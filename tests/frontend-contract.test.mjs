import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const RADICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const navigazioneCore = require("../app/public/navigazione-core.js");
const [html, frontend, stile, linkCore, clipboardCore, viewCore, attachmentCore, updaterCore] = await Promise.all([
  readFile(join(RADICE, "app", "public", "index.html"), "utf8"),
  readFile(join(RADICE, "app", "public", "app.js"), "utf8"),
  readFile(join(RADICE, "app", "public", "stile.css"), "utf8"),
  readFile(join(RADICE, "app", "public", "link-core.js"), "utf8"),
  readFile(join(RADICE, "app", "public", "clipboard-core.js"), "utf8"),
  readFile(join(RADICE, "app", "public", "view-core.js"), "utf8"),
  readFile(join(RADICE, "app", "public", "attachment-core.js"), "utf8"),
  readFile(join(RADICE, "app", "public", "updater-core.js"), "utf8"),
]);

function attributi(testo) {
  const risultato = new Map();
  const espressione = /(?:^|\s)([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const corrispondenza of testo.matchAll(espressione)) {
    risultato.set(
      corrispondenza[1].toLowerCase(),
      corrispondenza[2] ?? corrispondenza[3] ?? corrispondenza[4] ?? null,
    );
  }
  return risultato;
}

function elementi(testo) {
  return [...testo.matchAll(/<([a-z][\w-]*)\b([^<>]*)>/gi)].map((corrispondenza) => ({
    tag: corrispondenza[1].toLowerCase(),
    attributi: attributi(corrispondenza[2]),
    apertura: corrispondenza[0],
    indice: corrispondenza.index,
    fine: corrispondenza.index + corrispondenza[0].length,
  }));
}

const elementiHtml = elementi(html);

function elementoConId(id) {
  return elementiHtml.find((elemento) => elemento.attributi.get("id") === id);
}

function leggiMappaDom(sorgente) {
  const corpo = sorgente.match(/^const DOM = \{([\s\S]*?)^\};/m)?.[1];
  assert.ok(corpo, "manca la mappa DOM reale in app.js");
  const mappa = new Map();
  for (const riga of corpo.split(/\r?\n/).map((testo) => testo.trim()).filter(Boolean)) {
    const voce = riga.match(/^([A-Za-z_$][\w$]*):\s*\$\((["'])(#[\w-]+)\2\),?$/);
    assert.ok(voce, `registrazione DOM non verificabile: ${riga}`);
    assert.equal(mappa.has(voce[1]), false, `chiave DOM duplicata: ${voce[1]}`);
    mappa.set(voce[1], voce[3]);
  }
  return mappa;
}

const mappaDomReale = leggiMappaDom(frontend);

function verificaDipendenzeDom(sorgente, mappa = mappaDomReale, nodi = elementiHtml) {
  const nomi = new Set([...sorgente.matchAll(/\bDOM\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g)]
    .map((voce) => voce[1]));
  for (const nome of nomi) {
    assert.ok(mappa.has(nome), `DOM.${nome} usato ma non registrato nella mappa DOM reale`);
    const selettore = mappa.get(nome);
    assert.equal(nodi.filter((nodo) => nodo.attributi.get("id") === selettore.slice(1)).length, 1,
      `DOM.${nome}: il selettore ${selettore} deve esistere una volta in index.html`);
  }
}

function corpoElementoSemplice(id) {
  const elemento = elementoConId(id);
  assert.ok(elemento, `manca #${id}`);
  const chiusura = `</${elemento.tag}>`;
  const fine = html.toLowerCase().indexOf(chiusura, elemento.fine);
  assert.notEqual(fine, -1, `manca la chiusura di #${id}`);
  return html.slice(elemento.fine, fine);
}

function corpoFunzione(nome) {
  const inizio = frontend.indexOf(`function ${nome}(`);
  assert.notEqual(inizio, -1, `manca la funzione ${nome}`);
  const aperturaParametri = frontend.indexOf("(", inizio);
  let profonditaParametri = 0;
  let fineParametri = -1;
  for (let indice = aperturaParametri; indice < frontend.length; indice += 1) {
    if (frontend[indice] === "(") profonditaParametri += 1;
    if (frontend[indice] === ")") profonditaParametri -= 1;
    if (profonditaParametri === 0) {
      fineParametri = indice;
      break;
    }
  }
  assert.notEqual(fineParametri, -1, `la firma di ${nome} non e chiusa`);
  const apertura = frontend.indexOf("{", fineParametri);
  let profondita = 0;
  for (let indice = apertura; indice < frontend.length; indice += 1) {
    if (frontend[indice] === "{") profondita += 1;
    if (frontend[indice] === "}") profondita -= 1;
    if (profondita === 0) return frontend.slice(apertura + 1, indice);
  }
  assert.fail(`la funzione ${nome} non e chiusa`);
}

function funzioneProva(nome, parametri, ambiente, asincrona = false) {
  const corpo = corpoFunzione(nome);
  verificaDipendenzeDom(corpo);
  return new Function(...Object.keys(ambiente),
    `return ${asincrona ? "async " : ""}function(${parametri}) { ${corpo} };`,
  )(...Object.values(ambiente));
}

function costanteProva(nome) {
  const valore = frontend.match(new RegExp(`const ${nome} = ([\\s\\S]+?);(?:\\r?\\n|$)`))?.[1];
  assert.ok(valore, `manca la costante ${nome}`);
  return new Function(`return (${valore});`)();
}

function alberoProva() {
  const documento = { activeElement: null };
  const creaNodo = (tag, classe = "", textContent = "") => {
    const nodo = {
      tag, className: classe || "", textContent, children: [], dataset: {}, style: {},
      ownerDocument: documento, ascoltatori: {},
      attributi: new Map(), hidden: false, disabled: false, value: "", isConnected: true,
      setAttribute(nome, valore) { this.attributi.set(nome, String(valore)); },
      getAttribute(nome) { return this.attributi.get(nome); },
      removeAttribute(nome) { this.attributi.delete(nome); },
      append(...nodi) { for (const figlio of nodi) { figlio.remove?.(); figlio.parentNode = this; this.children.push(figlio); } },
      appendChild(figlio) { this.append(figlio); return figlio; },
      cloneNode() { const copia = creaNodo(this.tag, this.className, this.textContent); copia.value = this.value; return copia; },
      replaceChildren(...nodi) { this.children = []; this.append(...nodi); },
      focus() { documento.activeElement = this; },
      click() { return this.onclick?.({ target: this }) ?? this.ascoltatori.click?.[0]?.({ target: this, preventDefault() {}, stopImmediatePropagation() {} }); },
      addEventListener(nome, callback) { (this.ascoltatori[nome] ||= []).push(callback); },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((nodo) => nodo !== this); this.parentNode = null; },
      contains(candidato) { return candidato === this || this.children.some((figlio) => figlio.contains(candidato)); },
      querySelectorAll(selettore) {
        const corrisponde = (figlio) => selettore === "[data-riga-id]" ? Boolean(figlio.dataset.rigaId)
          : selettore === '[role="radio"]' ? figlio.getAttribute("role") === "radio"
          : selettore.startsWith("#") ? figlio.id === selettore.slice(1)
          : selettore.startsWith(".") ? figlio.classList.contains(selettore.slice(1))
          : selettore.includes("button") ? figlio.tag === "button" && !figlio.disabled
          : figlio.tag === selettore;
        return this.children.flatMap((figlio) => [...(corrisponde(figlio) ? [figlio] : []), ...figlio.querySelectorAll(selettore)]);
      },
      querySelector(selettore) { return this.querySelectorAll(selettore)[0] || null; },
      closest(selettore) { return selettore === "[data-riga-id]" && this.dataset.rigaId ? this : this.parentNode?.closest(selettore) || null; },
    };
    nodo.classList = {
      contains: (nome) => nodo.className.split(/\s+/u).includes(nome),
      add: (...nomi) => { nodo.className = [...new Set([...nodo.className.split(/\s+/u), ...nomi])].join(" ").trim(); },
      remove: (...nomi) => { nodo.className = nodo.className.split(/\s+/u).filter((nome) => !nomi.includes(nome)).join(" "); },
      toggle: (nome, forza) => { const attivo = forza ?? !nodo.classList.contains(nome); nodo.classList[attivo ? "add" : "remove"](nome); return attivo; },
    };
    return nodo;
  };
  documento.createElement = creaNodo;
  return { documento, creaNodo };
}

function contenutoCompleto(id) {
  const nodo = elementoConId(id);
  assert.ok(nodo, `manca #${id}`);
  const tag = new RegExp(`<(/?)${nodo.tag}\\b[^>]*>`, "gi");
  tag.lastIndex = nodo.indice;
  let livello = 0;
  for (let trovato; (trovato = tag.exec(html));) {
    livello += trovato[1] ? -1 : 1;
    if (!livello) return html.slice(nodo.fine, trovato.index);
  }
  assert.fail(`chiusura di #${id} non trovata`);
}

test("ogni riferimento DOM del frontend ha una registrazione reale e un selettore presente", () => {
  verificaDipendenzeDom(frontend);
  verificaDipendenzeDom([...mappaDomReale.keys()].map((nome) => `DOM.${nome}`).join("\n"));
});

test("il contratto DOM rileva una chiave rimossa e un selettore assente anche con gli stub", () => {
  const sorgenteSenzaChiave = frontend.replace(/^\s*cercaConversazioni:\s*\$\("#cerca-conversazioni"\),\r?\n/m, "");
  assert.notEqual(sorgenteSenzaChiave, frontend, "l'esca deve rimuovere la registrazione reale");
  assert.throws(() => verificaDipendenzeDom(frontend, leggiMappaDom(sorgenteSenzaChiave)),
    /DOM\.cercaConversazioni usato ma non registrato/);
  const nodiSenzaSelettore = elementiHtml.filter((nodo) => nodo.attributi.get("id") !== "cerca-conversazioni");
  assert.throws(() => verificaDipendenzeDom(frontend, mappaDomReale, nodiSenzaSelettore),
    /DOM\.cercaConversazioni: il selettore #cerca-conversazioni deve esistere/);
  const selettore = mappaDomReale.get("cercaConversazioni");
  try {
    mappaDomReale.delete("cercaConversazioni");
    assert.throws(() => funzioneProva("cercaConversazioniLaterali", "", {
      DOM: { cercaConversazioni: { value: "esca" } }, NAVIGAZIONE: {}, caricaConversazioniLaterali() {},
    }), /DOM\.cercaConversazioni usato ma non registrato/,
    "uno stub non deve compensare una dipendenza assente dalla mappa reale");
  } finally {
    mappaDomReale.set("cercaConversazioni", selettore);
  }
});

test("le GET protette di estensioni e consiglio acquisiscono il token prima della lettura e conservano i rifiuti", async () => {
  const APP = { tokenApi: null, clientId: "client-di-prova", replayId: "replay-di-prova" };
  const richieste = [];
  const signal = new AbortController().signal;
  let rifiuta = false;
  let chiedi;
  chiedi = funzioneProva("chiedi", "via, { corpo, signal } = {}", {
    APP, chiedi: (...args) => chiedi(...args),
    fetch: async (via, opzioni) => {
      richieste.push({ via, opzioni });
      if (via === "/api/stato") return { ok: true, json: async () => ({ tokenApi: "token-fornito-dal-ponte" }) };
      assert.equal(opzioni.headers["x-pi-gui-token"], "token-fornito-dal-ponte");
      assert.equal(opzioni.headers["x-pi-gui-client"], APP.clientId);
      assert.equal(opzioni.headers["x-pi-gui-replay"], APP.replayId);
      return rifiuta
        ? { ok: false, status: 403, json: async () => ({ code: "FORBIDDEN", messaggio: "Accesso rifiutato" }) }
        : { ok: true, json: async () => ({ disponibile: true }) };
    },
    ponteNonRaggiungibile: () => assert.fail("la risposta HTTP non è un guasto di collegamento"),
    programmaRiconnessione: () => assert.fail("la lettura autenticata non richiede riconnessioni"),
  }, true);
  for (const via of ["/api/estensioni", "/api/consiglio/preimpostazioni"]) {
    APP.tokenApi = null;
    richieste.length = 0;
    assert.deepEqual(await chiedi(via, { signal }), { disponibile: true });
    assert.deepEqual(richieste.map((richiesta) => richiesta.via), ["/api/stato", via]);
    assert.ok(richieste.every((richiesta) => richiesta.opzioni.signal === signal));
    assert.ok(richieste.every((richiesta) => richiesta.opzioni.method === undefined), "l'avvio usa soltanto GET");
    assert.equal(APP.tokenApi, "token-fornito-dal-ponte");
    richieste.length = 0;
    await chiedi(via, { signal });
    assert.deepEqual(richieste.map((richiesta) => richiesta.via), [via], "il token già disponibile viene riutilizzato");
  }
  richieste.length = 0;
  await chiedi("/api/estensioni/attiva", { corpo: { id: "estensione-di-prova" }, signal });
  assert.equal(richieste[0].opzioni.method, "POST");
  assert.equal(richieste[0].opzioni.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(richieste[0].opzioni.body), { id: "estensione-di-prova" });
  rifiuta = true;
  richieste.length = 0;
  await assert.rejects(chiedi("/api/estensioni", { signal }),
    (errore) => errore.statusHttp === 403 && errore.code === "FORBIDDEN" && errore.message === "Accesso rifiutato");
  assert.deepEqual(richieste.map((richiesta) => richiesta.via), ["/api/estensioni"], "un rifiuto non viene mascherato o ripetuto");
});

test("la barra laterale elenca le conversazioni aperte e salvate senza barra delle schede", () => {
  assert.equal(elementoConId("schede"), undefined);
  assert.doesNotMatch(html, /<nav\b[^>]*class="schede"/);
  const laterale = contenutoCompleto("pannello-laterale");
  for (const id of ["btn-nuova-conversazione", "cerca-conversazioni", "lista-conversazioni", "btn-carica-altre", "estensioni-attive", "btn-impostazioni", "btn-aiuto"]) {
    assert.ok(laterale.includes(`id="${id}"`), `manca l'accesso laterale ${id}`);
  }
  assert.match(laterale, /Apri cartella/);
  assert.equal(elementoConId("cerca-conversazioni").attributi.get("type"), "search");
  assert.equal(elementoConId("cerca-conversazioni").attributi.get("aria-controls"), "lista-conversazioni");
  assert.match(corpoFunzione("disegnaNavigazione"), /raggruppaConversazioni/);
  assert.match(corpoFunzione("disegnaNavigazione"), /salvate:\s*NAVIGAZIONE\.salvate/);
  assert.doesNotMatch(frontend, /function disegnaSchede\(/);
});

test("chiudere una riga non tocca le altre e lo stato mostrato viene da statoAttivita", async () => {
  const { documento, creaNodo } = alberoProva();
  const prima = { id: "prima", nomeSessione: "Prima", attiva: true, inEsecuzione: true, bozza: "Uno", allegati: [{ id: "a" }] };
  const seconda = { id: "seconda", nomeSessione: "Seconda", attiva: true, bozza: "Due", allegati: [{ id: "b" }] };
  const APP = { sessioni: new Map([[prima.id, prima], [seconda.id, seconda]]), attivaId: seconda.id, consiglio: { lavori: {} } };
  const DOM = { listaConversazioni: creaNodo("div"), input: creaNodo("textarea"), cercaConversazioni: creaNodo("input"),
    btnCaricaAltre: creaNodo("button"), statoConversazioni: creaNodo("p") };
  const NAVIGAZIONE = { salvate: [], ricerca: "", prossimoCursore: null, errore: "", caricamento: false };
  const chiuse = [];
  const aperture = [];
  const modaleArchivio = creaNodo("div");
  let caricamenti = 0;
  const chiudi = funzioneProva("chiudiRigaConversazione", "id", {
    APP, chiudiSessione: async (id) => { chiuse.push(id); APP.sessioni.delete(id); },
    chiudiSchedaRisultato: () => assert.fail("non e un risultato del consiglio"),
    caricaConversazioniLaterali: () => { caricamenti += 1; },
  }, true);
  const disegna = funzioneProva("disegnaNavigazione", "", {
    APP, DOM, NAVIGAZIONE, NAVIGAZIONE_CORE: navigazioneCore, document: documento, crea: creaNodo,
    chiudiRigaConversazione: chiudi, attivaSessione() {},
    apriConversazioneSalvata: (salvata) => { aperture.push(["apri", salvata.id]); modaleArchivio.focus(); },
    chiudiMenuLaterale: (opzioni) => { aperture.push(["chiudi-laterale", opzioni]); },
  });
  disegna();
  const righe = DOM.listaConversazioni.querySelectorAll("[data-riga-id]");
  assert.equal(righe.length, 2);
  assert.equal(righe[0].querySelector(".conversazione-stato").textContent, "già aperta · sta lavorando");
  assert.equal(righe[0].dataset.stato, navigazioneCore.statoConversazione(prima).testo.replaceAll(" ", "-"));
  assert.equal(righe[0].querySelector("button").getAttribute("aria-label"), "Prima, già aperta · sta lavorando");
  assert.equal(righe[1].querySelector(".conversazione-stato").textContent, "aperta");
  assert.equal(righe[1].querySelector("button").getAttribute("aria-label"), "Seconda, aperta");
  assert.equal(righe[1].querySelector("button").getAttribute("aria-current"), "page");
  assert.equal(DOM.listaConversazioni.querySelectorAll("h2").length, 0);
  assert.ok(DOM.listaConversazioni.querySelector("h3"));
  const lista = DOM.listaConversazioni;
  try {
    DOM.listaConversazioni = null;
    assert.throws(disegna, /Manca il contenitore delle conversazioni/,
      "una registrazione assente non deve lasciare silenziosamente vuoto il laterale");
  } finally {
    DOM.listaConversazioni = lista;
  }
  const intatta = structuredClone(seconda);
  await righe[0].querySelector(".conversazione-chiudi").click();
  assert.deepEqual(chiuse, ["prima"]);
  assert.equal(APP.sessioni.get("seconda"), seconda);
  assert.deepEqual(seconda, intatta);
  assert.equal(APP.attivaId, "seconda");
  assert.equal(caricamenti, 1);
  NAVIGAZIONE.salvate = [{ id: "archivio", percorso: "/salvate/archivio.jsonl", nome: "Archivio" }];
  disegna();
  DOM.listaConversazioni.querySelectorAll("[data-riga-id]")
    .find((riga) => riga.querySelector(".conversazione-nome").textContent === "Archivio")
    .querySelector("button").click();
  assert.deepEqual(aperture, [["chiudi-laterale", { ripristinaFocus: true }], ["apri", "archivio"]]);
  assert.equal(documento.activeElement, modaleArchivio, "aprire un archivio non sottrae il fuoco alla sua finestra");
});

test("Ctrl+Alt+Su e Giù percorrono le conversazioni nell'ordine visibile anche dopo una ricerca", () => {
  const { documento, creaNodo } = alberoProva();
  const sessioni = [
    { id: "zeta", cartella: "/Zeta", nomeSessione: "Ultima" },
    { id: "alfa", cartella: "/Alfa", nomeSessione: "Prima" },
    { id: "beta", cartella: "/Beta", nomeSessione: "Intermedia" },
  ];
  const APP = { sessioni: new Map(sessioni.map((sessione) => [sessione.id, sessione])), attivaId: "alfa", consiglio: {} };
  const NAVIGAZIONE = { salvate: [], ricerca: "", errore: "" };
  const DOM = { listaConversazioni: creaNodo("div"), input: creaNodo("textarea"), cercaConversazioni: creaNodo("input"),
    btnCaricaAltre: creaNodo("button"), statoConversazioni: creaNodo("p") };
  const aperture = [];
  const attivaSessione = (id) => { aperture.push(id); APP.attivaId = id; };
  const ambiente = { APP, NAVIGAZIONE, DOM, NAVIGAZIONE_CORE: navigazioneCore, document: documento, crea: creaNodo,
    attivaSessione, chiudiRigaConversazione() {}, chiudiMenuLaterale() {}, apriConversazioneSalvata() {},
    tastieraDiAgenti: () => false };
  const disegna = funzioneProva("disegnaNavigazione", "", ambiente);
  const tasto = funzioneProva("gestisciScorciatoia", "evento", ambiente);
  disegna();
  assert.deepEqual(DOM.listaConversazioni.querySelectorAll("[data-riga-id]").map((riga) => riga.dataset.rigaId),
    ["alfa", "beta", "zeta"], "l'ordine visibile deve differire dall'ordine di apertura del campione");
  for (const key of ["ArrowDown", "ArrowUp", "ArrowUp"]) {
    assert.equal(tasto({ key, ctrlKey: true, altKey: true, shiftKey: false }), true);
  }
  assert.deepEqual(aperture, ["beta", "alfa", "zeta"]);
  NAVIGAZIONE.ricerca = "Intermedia";
  disegna();
  assert.deepEqual(DOM.listaConversazioni.querySelectorAll("[data-riga-id]").map((riga) => riga.dataset.rigaId), ["beta"]);
  tasto({ key: "ArrowDown", ctrlKey: true, altKey: true, shiftKey: false });
  assert.equal(APP.attivaId, "beta");
});

test("una conversazione oltre l'ottantesima si trova con la ricerca e con Carica altre", async () => {
  const tutte = Array.from({ length: 83 }, (_, indice) => ({ id: String(indice), percorso: `/salvate/${indice}.jsonl`, nome: indice === 82 ? "Ricerca rara" : `Conversazione ${indice}` }));
  const NAVIGAZIONE = { salvate: [], ricerca: "", prossimoCursore: null, generazione: 0, caricamento: false };
  const richieste = [];
  const carica = funzioneProva("caricaConversazioniLaterali", "{ altre = false } = {}", {
    NAVIGAZIONE, disegnaNavigazione() {}, testoErrore: String,
    chiedi: async (url, { corpo }) => {
      richieste.push({ url, corpo });
      assert.equal(url, "/api/sessioni-salvate", "elencare non deve avviare processi");
      const filtrate = tutte.filter((voce) => voce.nome.toLowerCase().includes(corpo.ricerca.toLowerCase()));
      const inizio = corpo.cursore === "pagina-due" ? 80 : 0;
      return { sessioni: filtrate.slice(inizio, inizio + corpo.limite), prossimoCursore: filtrate.length > inizio + corpo.limite ? "pagina-due" : null };
    },
  }, true);
  await carica();
  assert.equal(NAVIGAZIONE.salvate.length, 80);
  assert.equal(NAVIGAZIONE.prossimoCursore, "pagina-due");
  await carica({ altre: true });
  assert.equal(NAVIGAZIONE.salvate.length, 83);
  assert.equal(NAVIGAZIONE.salvate.at(-1).nome, "Ricerca rara");
  assert.equal(NAVIGAZIONE.prossimoCursore, null);
  const cerca = funzioneProva("cercaConversazioniLaterali", "", {
    NAVIGAZIONE, DOM: { cercaConversazioni: { value: "rara" } }, caricaConversazioniLaterali: carica,
  });
  await cerca();
  assert.deepEqual(NAVIGAZIONE.salvate.map((voce) => voce.id), ["82"]);
  assert.equal(richieste[1].corpo.cursore, "pagina-due");
  assert.equal("cursore" in richieste[2].corpo, false, "la ricerca nuova azzera la pagina precedente");

  const risposte = [];
  const concorrente = funzioneProva("caricaConversazioniLaterali", "{ altre = false } = {}", {
    NAVIGAZIONE, disegnaNavigazione() {}, testoErrore: String,
    chiedi: () => new Promise((resolve) => risposte.push(resolve)),
  }, true);
  NAVIGAZIONE.ricerca = "vecchia";
  const vecchia = concorrente();
  NAVIGAZIONE.ricerca = "rara";
  const nuova = concorrente();
  risposte[1]({ sessioni: [tutte[82]], prossimoCursore: null });
  await nuova;
  risposte[0]({ sessioni: tutte.slice(0, 80), prossimoCursore: "pagina-due" });
  await vecchia;
  assert.deepEqual(NAVIGAZIONE.salvate.map((voce) => voce.id), ["82"], "una risposta tardiva non sovrascrive la ricerca corrente");
});

const VOCI_MENU_P3 = [
  ["name", "Rinomina"], ["new", "Ricomincia qui"], ["clone", "Duplica"],
  ["fork-message", "Crea versione da un messaggio"], ["tree", "Mostra albero"],
  ["history", "Cronologia e rami"], ["export", "Esporta"], ["import", "Importa"],
  ["share", "Condividi"], ["compact", "Libera spazio"], ["session", "Uso e costo"],
  ["copy", "Copia ultima risposta"], ["advanced", "Controlli avanzati"],
];

test("il menu della conversazione nasce chiuso e raggiunge tutte le voci della 2.8", async () => {
  const menu = elementoConId("menu-conversazione");
  assert.equal(menu.attributi.has("hidden"), true);
  assert.equal(menu.attributi.get("role"), "menu");
  const apertura = elementoConId("btn-menu-conversazione");
  assert.equal(apertura.attributi.get("aria-expanded"), "false");
  assert.equal(apertura.attributi.get("aria-haspopup"), "menu");
  const corpo = contenutoCompleto("menu-conversazione");
  const voci = elementi(corpo).filter((voce) => voce.attributi.has("data-comando"));
  assert.deepEqual(voci.map((voce) => voce.attributi.get("data-comando")), VOCI_MENU_P3.map(([nome]) => nome));
  const chiamate = [];
  const sessione = { id: "corrente" };
  const esegui = funzioneProva("eseguiComandoNavigazione", "nome", {
    APP: { bridgeOnline: true }, sessioneAttiva: () => sessione,
    eseguiWorkflowComando: (...dati) => chiamate.push(["workflow", ...dati]),
    apriAlberoOppureSpiega: (dato) => chiamate.push(["history", dato]),
    apriControlliAvanzati: (dato) => chiamate.push(["advanced", dato]),
    apriAggiornamenti() {}, mostraScorciatoiePi() {}, mostraChangelogPi() {}, ricaricaRisorsePi() {},
    toast: () => assert.fail("il comando e disponibile"),
  }, true);
  for (const [indice, [nome, etichetta]] of VOCI_MENU_P3.entries()) {
    assert.equal(voci[indice].tag, "button");
    assert.equal(voci[indice].attributi.get("role"), "menuitem");
    assert.equal(voci[indice].attributi.get("tabindex"), "-1");
    assert.ok(corpo.includes(`>${etichetta}</button>`), `etichetta mancante: ${etichetta}`);
    await esegui(nome);
    assert.deepEqual(chiamate.at(-1), ["history", "advanced"].includes(nome)
      ? [nome, sessione] : ["workflow", sessione, nome === "fork-message" ? "fork" : nome, ""]);
  }
});

test("modello, ragionamento, cartella e Ferma esistono una volta sola e stanno nel composer", () => {
  const composer = contenutoCompleto("composer-shell");
  for (const id of ["btn-modello", "btn-ragionamento", "btn-apri-cartella", "btn-ferma", "btn-allega", "btn-invia"]) {
    assert.equal(elementiHtml.filter((elemento) => elemento.attributi.get("id") === id).length, 1);
    assert.ok(composer.includes(`id="${id}"`), `${id} deve restare raggiungibile nel composer`);
  }
  for (const id of ["btn-ferma-top", "btn-controlli", "btn-consiglio"]) assert.equal(elementoConId(id), undefined);
  assert.equal(elementoConId("btn-ferma").attributi.has("hidden"), true);
  assert.match(frontend, /PiGuiAgentiCore\?\.montaAgenti\?\.\(DOM\.composerShell,/);
  assert.match(corpoFunzione("aggiornaInterfacciaAttiva"), /btnFerma\.hidden/);
});

test("modello e ragionamento espongono gruppi radio con una sola tappa Tab e selezione a frecce", async () => {
  for (const nome of ["apriSceltaModello", "apriSceltaRagionamento"]) {
    const corpo = corpoFunzione(nome);
    assert.match(corpo, /setAttribute\("role", "radio"\)/);
    assert.match(corpo, /setAttribute\("aria-checked",/);
    assert.match(corpo, /inizializzaGruppoScelta\(/);
    assert.doesNotMatch(corpo, /aria-pressed/);
  }
  const { documento, creaNodo } = alberoProva();
  const lista = creaNodo("div");
  const scelte = ["Basso", "Medio", "Alto", "Non disponibile"].map((nome, indice) => {
    const scelta = creaNodo("button", "", nome);
    scelta.setAttribute("role", "radio");
    scelta.setAttribute("aria-checked", String(indice === 1));
    scelta.disabled = indice === 3;
    return scelta;
  });
  const selezionate = [];
  scelte.forEach((scelta) => { scelta.onclick = () => selezionate.push(scelta.textContent); });
  lista.append(...scelte);
  funzioneProva("inizializzaGruppoScelta", "lista, etichetta", { document: documento })(lista, "Ragionamento");
  assert.equal(lista.getAttribute("role"), "radiogroup");
  assert.equal(lista.getAttribute("aria-label"), "Ragionamento");
  assert.deepEqual(scelte.slice(0, 3).map((scelta) => scelta.tabIndex), [-1, 0, -1]);
  scelte[1].focus();
  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End"]) {
    let prevenuto = false;
    lista.onkeydown({ key, preventDefault() { prevenuto = true; }, stopPropagation() {} });
    await Promise.resolve();
    assert.equal(prevenuto, true);
    assert.equal(scelte.filter((scelta) => scelta.tabIndex === 0).length, 1);
  }
  assert.deepEqual(selezionate, ["Alto", "Basso", "Alto", "Basso", "Alto"]);
  assert.equal(documento.activeElement, scelte[2]);
});

test("una scelta radio in corso blocca frecce e clic concorrenti fino alla risposta", async () => {
  const { documento, creaNodo } = alberoProva();
  const lista = creaNodo("div");
  const scelte = [creaNodo("button"), creaNodo("button")];
  const chiamate = [];
  let completa;
  scelte.forEach((scelta, indice) => {
    scelta.setAttribute("role", "radio");
    scelta.setAttribute("aria-checked", String(indice === 0));
    scelta.onclick = () => new Promise((resolve) => { chiamate.push(indice); completa = resolve; });
  });
  lista.append(...scelte);
  funzioneProva("inizializzaGruppoScelta", "lista, etichetta", { document: documento })(lista, "Modello");
  scelte[0].focus();
  const prima = scelte[0].click();
  assert.equal(lista.getAttribute("aria-busy"), "true");
  await scelte[1].click();
  let prevenuto = false;
  lista.onkeydown({ key: "ArrowDown", preventDefault() { prevenuto = true; }, stopPropagation() {} });
  assert.equal(prevenuto, true);
  assert.deepEqual(chiamate, [0], "la richiesta successiva attende la risposta della prima scelta");
  assert.equal(documento.activeElement, scelte[0]);
  completa();
  await prima;
  assert.equal(lista.getAttribute("aria-busy"), undefined);
  const seconda = scelte[1].click();
  assert.deepEqual(chiamate, [0, 1], "dopo la risposta il gruppo torna utilizzabile");
  completa();
  await seconda;
  assert.equal(lista.getAttribute("aria-busy"), undefined);
});

test("sotto 980 e sotto 860 pixel nessun controllo del composer viene nascosto e il laterale si comprime senza nascondere comandi", () => {
  assert.doesNotMatch(stile, /(?:#btn-(?:modello|ragionamento)|\.pillola[^{}]*)\s*\{[^{}]*display:\s*none/);
  for (const [, selettori, regole] of stile.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/#btn-(?:modello|ragionamento|apri-cartella|allega|invia)\b|\.(?:riga-comandi|pillola|scrittura|composizione)(?![\w-])/.test(selettori)) {
      assert.doesNotMatch(regole, /(?:display:\s*none|visibility:\s*hidden)/,
        `il controllo o il suo contenitore deve restare visibile: ${selettori.trim()}`);
    }
  }
  for (const selettore of [
    ".apri-cartella", ".titolo-riga", ".azioni-titolo", ".testo-bottone", ".cartella-attiva",
    ".sessione-gia-aperta", ".gruppo-cartella", ".cartella-icona", ".cartella-testo",
    ".navigazione-principale", "#lista-comandi", ".gruppo-suggerimenti", ".gruppo-strumenti", ".lista-strumenti",
  ]) {
    assert.doesNotMatch(stile, new RegExp(`${selettore.replace(/[.#]/g, "\\$&")}(?![\\w-])`),
      `il selettore orfano ${selettore} deve essere rimosso`);
  }
  const inizio29 = stile.indexOf("/* Interfaccia 2.9:");
  assert.ok(inizio29 > 0);
  assert.doesNotMatch(stile.slice(0, inizio29), /\.lato\s*\{|body\.menu-aperto::after\s*\{/,
    "il cassetto precedente non deve restare dipendente dall'ordine delle regole");
  assert.equal([...stile.matchAll(/body\.menu-aperto::after\s*\{/g)].length, 1);
  assert.match(stile, /body\.menu-aperto::after\s*\{[^}]*pointer-events:\s*auto/);
  assert.match(frontend, /document\.addEventListener\("click",\s*\(evento\)\s*=>\s*\{\s*if \(mediaMenuLaterale\.matches[\s\S]*?evento\.target === document\.body[\s\S]*?chiudiMenuLaterale\(\{ ripristinaFocus: true \}\)/,
    "il clic sul velo deve funzionare anche se la conversazione iniziale è nascosta");
  assert.match(stile, /\.riga-comandi\s*\{[^{}]*flex-wrap:\s*wrap/s);
  assert.match(stile, /@media\s*\(max-width:\s*940px\)/);
  assert.match(stile, /\.lato\s*\{[^{}]*overflow/s);
  const toggle = elementoConId("btn-menu");
  assert.equal(toggle.tag, "button");
  assert.equal(toggle.attributi.get("aria-controls"), "pannello-laterale");
  assert.match(corpoFunzione("aggiornaAccessibilitaMenu"), /aria-expanded/);
  assert.match(corpoFunzione("chiudiMenuLaterale"), /ripristinaFocus/);
});

test("il menu e le finestre restituiscono il fuoco e si governano con frecce, Invio ed Esc", () => {
  const { documento, creaNodo } = alberoProva();
  const pulsante = creaNodo("button");
  const menu = creaNodo("div"); menu.hidden = true;
  const scelte = [creaNodo("button"), creaNodo("button"), creaNodo("button")];
  menu.append(...scelte);
  let azioni = 0;
  scelte.forEach((voce) => { voce.onclick = () => { azioni += 1; }; });
  const ambiente = { $: (id) => id === "#menu-conversazione" ? menu : pulsante,
    document: documento, chiudiPaletteComandi() {}, chiudiMenuAzioniComposer() {} };
  const chiudi = funzioneProva("chiudiMenuConversazione", "{ ripristinaFocus = true } = {}", ambiente);
  const apri = funzioneProva("apriMenuConversazione", "", ambiente);
  const tasto = funzioneProva("gestisciTastiMenuConversazione", "evento", { ...ambiente, chiudiMenuConversazione: chiudi });
  pulsante.focus();
  apri();
  assert.equal(documento.activeElement, scelte[0]);
  assert.deepEqual(scelte.map((voce) => voce.tabIndex), [0, -1, -1]);
  assert.equal(tasto({ key: "ArrowDown" }), true);
  assert.equal(documento.activeElement, scelte[1]);
  assert.equal(tasto({ key: "End" }), true);
  assert.equal(documento.activeElement, scelte[2]);
  assert.equal(tasto({ key: "ArrowDown" }), true);
  assert.equal(documento.activeElement, scelte[0], "le frecce percorrono tutto il menu");
  assert.equal(tasto({ key: "ArrowUp" }), true);
  assert.equal(documento.activeElement, scelte[2]);
  tasto({ key: "Enter" }); tasto({ key: " " });
  assert.equal(azioni, 2, "Invio e Barra azionano una scelta ciascuno");
  assert.equal(tasto({ key: "Escape" }), true);
  assert.equal(menu.hidden, true);
  assert.equal(documento.activeElement, pulsante);
  assert.equal(pulsante.getAttribute("aria-expanded"), "false");
  assert.equal(tasto({ key: "Enter" }), false, "il menu chiuso non intercetta eventi");
  apri();
  const instradaMenu = funzioneProva("gestisciTastiMenuPalette", "evento", { gestisciTastiMenuConversazione: tasto });
  assert.equal(instradaMenu({ key: "Tab" }), "nativo", "Tab esce dal menu e prosegue nella sequenza nativa");
  assert.equal(menu.hidden, true);
  assert.equal(documento.activeElement, pulsante);

  const APP = {};
  const DOM = Object.fromEntries(["velo", "modale", "modaleCorpo", "modalePiede", "modaleTitolo", "modaleChiudi", "toastArea", "input"]
    .map((nome) => [nome, creaNodo(nome === "input" ? "textarea" : "div")]));
  DOM.velo.hidden = true;
  const sfondo = creaNodo("main"); sfondo.inert = false;
  documento.body = creaNodo("body"); documento.documentElement = creaNodo("html");
  documento.body.append(sfondo, DOM.velo, DOM.toastArea);
  const primo = creaNodo("input");
  const ultimo = creaNodo("button");
  const frames = [];
  const ambienteModale = { APP, DOM, document: documento, sessioneAttiva: () => null,
    requestAnimationFrame: (callback) => frames.push(callback), elementiFocusabili: () => [primo, ultimo],
    chiudiPaletteComandi() {}, aggiornaAccessibilitaMenu() {}, setTimeout() {}, clearTimeout() {}, mostraProssimoDialogoEstensione() {} };
  const chiudiModale = funzioneProva("chiudiModale", "{ annulla = true, continuaCoda = true } = {}", ambienteModale);
  const apriModale = funzioneProva("apriModale", "titolo, { larga = false, onCancel = null, chiudibile = true, contesto = null } = {}", { ...ambienteModale, chiudiModale });
  pulsante.focus();
  apriModale("Scelta");
  assert.equal(documento.activeElement, DOM.modale, "il fuoco entra subito nella finestra");
  assert.equal(sfondo.inert, true);
  frames.splice(0).forEach((callback) => callback());
  assert.equal(documento.activeElement, primo, "il primo controllo utile prende il fuoco");
  chiudiModale();
  assert.equal(documento.activeElement, pulsante);
  assert.equal(sfondo.inert, false);
  for (const dialogo of elementiHtml.filter((nodo) => nodo.attributi.get("role") === "dialog")) {
    assert.equal(dialogo.attributi.get("aria-modal"), "true");
  }
  const finestra = corpoFunzione("gestisciTastiFinestra");
  assert.match(finestra, /Escape/);
  assert.match(finestra, /trattieniFuoco\(evento, DOM\.modale\)/);
  const focusabili = [primo, ultimo];
  DOM.modale.querySelectorAll = () => focusabili;
  focusabili.forEach((nodo) => { nodo.getClientRects = () => [{}]; });
  const trattieni = funzioneProva("trattieniFuoco", "evento, contenitore, aggiuntivi = []", { document: documento });
  const gestisciFinestra = funzioneProva("gestisciTastiFinestra", "evento", {
    APP, DOM, document: documento, chiudiModale, trattieniFuoco: trattieni,
  });
  pulsante.focus();
  apriModale("Scelta");
  primo.focus();
  assert.equal(gestisciFinestra({ key: "Tab", shiftKey: true }), true);
  assert.equal(documento.activeElement, ultimo, "Maiusc+Tab torna all'ultimo controllo della finestra");
  assert.equal(gestisciFinestra({ key: "Tab" }), true);
  assert.equal(documento.activeElement, primo, "Tab resta nella finestra aperta");
  assert.equal(gestisciFinestra({ key: "Escape" }), true);
  assert.equal(documento.activeElement, pulsante, "Esc restituisce il fuoco all'apertura");
  assert.doesNotMatch(finestra, /interrompi|abort/);
});

test("i popup restano nel viewport basso e l'attesa dell'ospite usa i colori del tema", () => {
  const viewportBasso = [...stile.matchAll(/@media\s*\(max-height:\s*700px\)([\s\S]*?)(?=@media|$)/g)]
    .map((blocco) => blocco[1]).find((blocco) => blocco.includes(".menu-azioni-composer"));
  assert.ok(viewportBasso, "a 900 per 600 i popup devono avere un vincolo rispetto al viewport");
  const popup = viewportBasso.match(/\.menu-azioni-composer,\s*\.palette-comandi\s*\{([^}]+)\}/)?.[1];
  assert.ok(popup);
  for (const regola of [/position:\s*fixed/, /top:\s*60px/, /bottom:\s*auto/, /max-height:\s*calc\(100dvh - 74px\)/]) assert.match(popup, regola);
  assert.match(viewportBasso, /\.lista-palette-comandi\s*\{[^}]*max-height:\s*calc\(100dvh - 122px\)/);
  for (const classe of ["menu-azioni-composer", "lista-palette-comandi"]) {
    assert.match(stile, new RegExp(`\\.${classe}\\s*\\{[^}]*overflow-y:\\s*auto`));
  }
  assert.match(stile, /\.pannello-ospite-attesa\s*\{[^}]*color:\s*var\(--testo\)/);
  assert.match(stile, /\.pannello-ospite-attesa small\s*\{[^}]*color:\s*var\(--testo-debole\)/);
  assert.match(stile, /\.pannello-ospite-attesa\.errore strong\s*\{[^}]*color:\s*var\(--stato-errore-testo\)/);
});

test("senza estensioni attive non esiste nessuna voce ISO e il pannello resta un ospite vuoto", () => {
  assert.doesNotMatch(html, /Sistema Guidato|\bISO\b|diari|Second Brain/i);
  assert.equal(elementoConId("pannello-ospite").attributi.has("hidden"), true);
  assert.equal(elementoConId("frame-pannello-ospite").attributi.get("src"), "about:blank");
  assert.equal(contenutoCompleto("montaggio-estensioni").trim(), "");
  const { creaNodo } = alberoProva();
  const lista = creaNodo("div");
  const gruppo = creaNodo("section");
  const PANNELLO_OSPITE = { tipo: null, dati: null };
  let aperture = 0;
  const aggiorna = funzioneProva("aggiornaEstensioniAttive", "dati", {
    PANNELLO_OSPITE, $: (id) => id === "#estensioni-attive" ? lista : gruppo,
    bottoneAzione: (testo, onclick, classe) => Object.assign(creaNodo("button", classe, testo), { onclick }),
    apriPannelloSistemaGuidato: async () => { aperture += 1; }, apriPannelloEstensioni() {},
    comandoEstensioneVisibile: () => false, chiudiPannelloOspite() {}, toast() {}, testoErrore: String,
  });
  aggiorna({ estensioni: [] });
  assert.equal(lista.children.length, 0);
  assert.equal(gruppo.hidden, true);
  const pacchetto = { id: "sistema-guidato", nome: "Sistema Guidato", pannelli: [{}], attiva: true, attivaApplicata: false };
  aggiorna({ estensioni: [pacchetto] });
  assert.equal(lista.children.length, 0, "Attiva ancora da applicare non crea la voce");
  aggiorna({ estensioni: [{ ...pacchetto, attivaApplicata: true, stato: "Manomessa" }] });
  assert.equal(lista.children.length, 0);
  aggiorna({ estensioni: [{ ...pacchetto, attivaApplicata: true, stato: "Attiva" }] });
  assert.equal(gruppo.hidden, false);
  assert.equal(lista.children.length, 1);
  assert.equal(lista.children[0].getAttribute("aria-haspopup"), "dialog");
  assert.equal(lista.children[0].getAttribute("aria-controls"), "pannello-ospite");
  lista.children[0].click();
  assert.equal(aperture, 1);
  aggiorna({ estensioni: [] });
  assert.equal(lista.children.length, 0);
});

test("un guasto al montaggio delle estensioni produce un avviso nel laterale e un toast", () => {
  const { creaNodo } = alberoProva();
  const contenitore = creaNodo("div"); contenitore.hidden = true;
  const accesso = creaNodo("div");
  const avvisi = [];
  funzioneProva("montaPannelloEstensioni", "", {
    PANNELLO_OSPITE: {}, globalThis: { PiGuiEstensioniCore: { montaEstensioni() { throw new Error("Guasto di prova"); } } },
    $: (id) => id === "#montaggio-estensioni" ? contenitore : accesso, crea: creaNodo,
    leggiEstensioni() {}, aggiornaEstensioniAttive() {}, aggiornaDalPonte() {}, chiedi() {},
    apriSceltaCartella() {}, conferma() {}, apriPannelloSistemaGuidato() {}, apriPannelloEstensioni() {},
    toast: (...args) => avvisi.push(args), testoErrore: (errore) => errore.message,
  })();
  assert.equal(contenitore.hidden, true, "l'avviso non dipende dall'apertura del pannello ospite");
  assert.equal(accesso.children[0].hidden, false);
  assert.equal(accesso.children[0].getAttribute("role"), "status");
  assert.equal(accesso.children[0].textContent, "Estensioni non disponibili: Guasto di prova");
  assert.deepEqual(avvisi, [["Estensioni non disponibili: Guasto di prova", "errore"]]);
});

test("il pannello delle estensioni si monta nel contenitore e mostra Attiva, Disattiva, Apri, Aggiorna da cartella e Rimuovi", async () => {
  const { creaNodo } = alberoProva();
  const contenitore = creaNodo("div");
  const accesso = creaNodo("div");
  const PANNELLO_OSPITE = {};
  const dati = { versioneArchivio: 3, estensioni: [
    { id: "attiva", nome: "Pacchetto attivo", attiva: true, attivaApplicata: true, versioneInstallata: "1.0.0", versioneApplicata: "1.0.0", pannelli: [{}], rimovibile: true },
    { id: "spenta", nome: "Pacchetto spento", attiva: false, attivaApplicata: false, versioneInstallata: "1.0.0", rimovibile: true },
  ] };
  const richieste = [];
  const monta = funzioneProva("montaPannelloEstensioni", "", {
    PANNELLO_OSPITE, globalThis: { PiGuiEstensioniCore: require("../app/public/estensioni-core.js") },
    $: (id) => id === "#montaggio-estensioni" ? contenitore : accesso,
    leggiEstensioni: async () => dati, aggiornaEstensioniAttive() {}, aggiornaDalPonte() {},
    chiedi: async (...args) => { richieste.push(args); return dati; },
    apriSceltaCartella() {}, conferma() {}, apriPannelloSistemaGuidato() {}, apriPannelloEstensioni() {}, toast() {}, testoErrore: String,
  });
  monta();
  assert.ok(PANNELLO_OSPITE.estensioni, "il montaggio deve chiamare davvero il modulo consegnato da P1");
  assert.equal(accesso.querySelector("#btn-estensioni").textContent, "Estensioni");
  assert.equal(accesso.querySelector("#btn-estensioni").getAttribute("aria-controls"), "pannello-ospite");
  assert.equal(contenitore.querySelector("#pannello-estensioni").hidden, true);
  await PANNELLO_OSPITE.estensioni.apri();
  assert.equal(contenitore.querySelector("#pannello-estensioni").hidden, false);
  const bottoni = contenitore.querySelectorAll("button");
  for (const nome of ["Attiva", "Disattiva", "Apri", "Aggiorna da cartella", "Rimuovi"]) {
    assert.ok(bottoni.some((nodo) => nodo.textContent === nome), `manca ${nome}`);
  }
  await bottoni.find((nodo) => nodo.textContent === "Attiva").click();
  assert.equal(richieste.length, 1);
  assert.equal(richieste[0][0], "/api/estensioni/attiva");
  assert.deepEqual(richieste[0][1].corpo, { id: "spenta", attiva: true, versioneAttesa: 3 });
});

test("Approva prepara la bozza senza inviare e con la bozza cambiata offre sostituzione o copia", async () => {
  const { creaNodo } = alberoProva();
  const sessione = { id: "s", bozza: "Cache precedente" };
  const APP = { attivaId: "s", sessioni: new Map([["s", sessione]]) };
  const DOM = { input: creaNodo("textarea"), modalePiede: creaNodo("footer") };
  const memoria = new Map([["pi-gui-consiglio-bozza-avvio:l", JSON.stringify({ testo: "Bozza iniziale" })]]);
  const copie = []; const salvataggi = []; const avvisi = [];
  let quotaEsaurita = false;
  let annulla;
  const localStorage = {
    getItem: (chiave) => memoria.get(chiave) ?? null,
    setItem: (chiave, valore) => { if (quotaEsaurita) throw new Error("Quota"); memoria.set(chiave, valore); },
  };
  const scrivi = funzioneProva("scriviBozzaConsiglio", "{ sessionId, testo }", {
    APP, DOM, ramificaLineageBozza() {}, salvaBozza: (corrente) => salvataggi.push(corrente.bozza),
    adattaAltezza() {}, aggiornaInterfacciaAttiva() {},
    invia: () => assert.fail("Approva non invia prompt"), rpc: () => assert.fail("scrivere la bozza non chiama Pi"),
  });
  const conferma = funzioneProva("confermaBozzaConsiglio", "", {
    DOM, crea: creaNodo,
    apriModale: (_titolo, opzioni) => { annulla = opzioni.onCancel; DOM.modalePiede.replaceChildren(); return creaNodo("section"); },
    chiudiModale() {}, bottoneAzione: (testo, onclick) => Object.assign(creaNodo("button", "", testo), { onclick }),
  });
  const prepara = funzioneProva("preparaBozzaApprovata", "lavoroId, { sessionId, testo }", {
    APP, DOM, localStorage, scriviBozzaConsiglio: scrivi, confermaBozzaConsiglio: conferma,
    copiaTesto: async (testo) => copie.push(testo), toast: (testo) => avvisi.push(testo),
  }, true);
  const dati = { sessionId: "s", testo: "Risultato approvato" };
  DOM.input.value = "Modifica appena scritta";
  let attesa = prepara("l", dati);
  assert.deepEqual(DOM.modalePiede.children.map((nodo) => nodo.textContent), ["Sostituisci la bozza", "Copia risultato"]);
  DOM.modalePiede.children[1].click();
  assert.equal(await attesa, false);
  assert.deepEqual(copie, [dati.testo]);
  assert.equal(DOM.input.value, "Modifica appena scritta");
  assert.equal(salvataggi.length, 0);
  attesa = prepara("l", dati); DOM.modalePiede.children[0].click();
  assert.equal(await attesa, true);
  assert.equal(JSON.parse(memoria.get("pi-gui-consiglio-bozze-precedenti:l"))[0].testo, "Modifica appena scritta");
  assert.equal(DOM.input.value, dati.testo);
  assert.deepEqual(salvataggi, [dati.testo]);
  DOM.input.value = "Da conservare con quota esaurita"; quotaEsaurita = true;
  attesa = prepara("l", dati); DOM.modalePiede.children[0].click();
  assert.equal(await attesa, false);
  assert.equal(DOM.input.value, "Da conservare con quota esaurita");
  assert.match(avvisi.at(-1), /La bozza resta intatta/);
  assert.equal(salvataggi.length, 1);
  DOM.input.value = "";
  attesa = prepara("l", dati); annulla();
  assert.equal(await attesa, false, "anche svuotare la bozza dopo l'avvio richiede una scelta");
  assert.equal(DOM.input.value, "");
  assert.equal(salvataggi.length, 1);
  DOM.input.value = "Bozza iniziale";
  assert.equal(await prepara("l", dati), true, "la bozza identica all'avvio accoglie il risultato");
  assert.match(corpoFunzione("disegnaSchedaRisultato"), /Metti nella bozza, non invia/);
});

test("le azioni iniziali compilano la bozza e non inviano richieste", () => {
  const { creaNodo } = alberoProva();
  const sessione = { id: "s", bozza: "" };
  const APP = { attivaId: "s", sessioni: new Map([["s", sessione]]) };
  const DOM = { input: creaNodo("textarea") };
  const ESEMPI = costanteProva("ESEMPI");
  const lista = creaNodo("div"); const salvataggi = []; const aperture = [];
  const imposta = funzioneProva("impostaBozzaComposer", "sessione, valore, { salvaSubito = false } = {}", {
    APP, DOM, ramificaLineageBozza() {}, salvaBozza: (corrente) => salvataggi.push(corrente.bozza),
    programmaSalvaBozza: () => assert.fail("la bozza iniziale va salvata subito"), adattaAltezza() {}, aggiornaInterfacciaAttiva() {},
  });
  const prepara = funzioneProva("preparaAzioneIniziale", "richiesta, azione", {
    APP, DOM, sessioneAttiva: () => sessione, impostaBozzaComposer: imposta,
    apriSceltaCartella: () => aperture.push("cartella"), apriMenuAzioniComposer: () => aperture.push("allegati"),
    invia: () => assert.fail("un'azione iniziale non invia"), rpc: () => assert.fail("un'azione iniziale non chiama Pi"),
  });
  funzioneProva("disegnaEsempi", "", { ESEMPI, $: () => lista, crea: creaNodo, preparaAzioneIniziale: prepara })();
  assert.equal(lista.children.length, 4);
  assert.doesNotMatch(JSON.stringify(ESEMPI), /ISO|diari|Sistema Guidato/i);
  DOM.input.value = "Testo gia scritto";
  lista.children.forEach((bottone) => { assert.equal(bottone.type, "button"); bottone.click(); });
  assert.deepEqual(aperture, ["cartella", "allegati"]);
  assert.equal(salvataggi.length, 3);
  assert.equal(DOM.input.value, ["Testo gia scritto", ...ESEMPI.slice(1).map((voce) => voce[2])].join("\n\n"));
});

test("ogni comando della 2.8 resta raggiungibile dal punto dichiarato nella mappa", async (t) => {
  const builtin = costanteProva("TESTI_BUILTIN");
  assert.deepEqual(Object.keys(builtin).sort(), ["sistema", "settings", "model", "scoped-models", "export", "import", "share", "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "tree", "trust", "login", "logout", "new", "compact", "resume", "reload", "quit"].sort());
  const menu = elementi(contenutoCompleto("menu-conversazione")).filter((voce) => voce.attributi.has("data-comando"));
  const haMenu = (...nomi) => { for (const nome of nomi) assert.ok(menu.some((voce) => voce.attributi.get("data-comando") === nome), `manca il comando ${nome} nel menu`); };
  const mappa = [
    ["ricerca comandi: slash e Ctrl+K", () => {
      assert.equal(elementoConId("btn-cerca-comandi").attributi.get("aria-keyshortcuts"), "Control+K");
      assert.match(frontend, /btnCercaComandi\.onclick\s*=\s*\(\)\s*=>\s*apriRicercaComandi\(\)/);
      const ricerca = frontend.slice(frontend.indexOf("function apriRicercaComandi("), frontend.indexOf("function chiudiPaletteComandi("));
      for (const fonte of ["builtin", "skill", "prompt", "extension"]) assert.ok(ricerca.includes(`"${fonte}"`), `la ricerca deve includere ${fonte}`);
      assert.match(corpoFunzione("aggiornaPaletteComandi"), /analizzaRichiamoComando/);
      const richiamo = require("../app/public/palette-core.js").analizzaRichiamoComando("/", 1, 1);
      assert.ok(richiamo, "lo slash resta un ingresso della ricerca dei comandi");
      assert.equal(richiamo.query, "");
      assert.match(corpoFunzione("apriRicercaComandi"), /filtraCatalogoComandi/);
    }],
    ["Aiuto: Scorciatoie, Novita e versione", async () => {
      const { creaNodo } = alberoProva();
      const corpo = creaNodo("section");
      const chiamate = [];
      const lettureHost = [];
      const lettureHttp = [];
      const versioneHost = JSON.parse(await readFile(join(RADICE, "package.json"), "utf8")).version;
      let erroreHost = false;
      let versioneHttp = versioneHost;
      const apri = funzioneProva("apriAiuto", "", { apriModale: () => { corpo.replaceChildren(); return corpo; }, crea: creaNodo,
        bottoneAzione: (testo, onclick) => Object.assign(creaNodo("button", "", testo), { onclick }),
        eseguiComandoNavigazione: (nome) => chiamate.push(nome), apriAggiornamenti: () => chiamate.push("aggiornamenti"),
        invocaTauri: async (comando) => {
          lettureHost.push(comando);
          if (erroreHost) throw new Error("Host non disponibile");
          return { currentVersion: versioneHost };
        },
        chiedi: async (url) => { lettureHttp.push(url); return { versioneHost: versioneHttp }; },
      }, true);
      await apri();
      assert.deepEqual(lettureHost, ["updater_status"], "Aiuto legge lo stato locale e non controlla aggiornamenti");
      assert.deepEqual(lettureHttp, [], "la versione nativa non richiede una seconda lettura HTTP");
      assert.deepEqual(chiamate, [], "nessun workflow parte aprendo Aiuto");
      assert.equal(corpo.children[0].textContent, `Versione ${versioneHost}`);
      assert.equal(corpo.children[0].getAttribute("role"), "status");
      corpo.querySelectorAll("button").forEach((bottone) => bottone.click());
      assert.deepEqual(chiamate, ["hotkeys", "changelog", "aggiornamenti"]);
      erroreHost = true;
      await apri();
      assert.equal(corpo.children[0].textContent, `Versione ${versioneHost}`);
      assert.deepEqual(lettureHttp, ["/api/stato"], "il browser legge la versione esposta dal ponte");
      versioneHttp = undefined;
      await apri();
      assert.match(corpo.children[0].textContent, /Versione dell'app non disponibile/);
      assert.doesNotMatch(corpo.children[0].textContent, /\d+\.\d+\.\d+/);
      assert.deepEqual(lettureHost, ["updater_status", "updater_status", "updater_status"]);
      assert.deepEqual(lettureHttp, ["/api/stato", "/api/stato"]);
      assert.ok(elementoConId("btn-aiuto"));
    }],
    ["Apri cartella: composer e una sola voce laterale", () => {
      assert.ok(contenutoCompleto("composer-shell").includes('id="btn-apri-cartella"'));
      const laterale = elementi(contenutoCompleto("pannello-laterale"));
      assert.equal(laterale.filter((voce) => voce.attributi.get("data-azione") === "cartella").length, 1);
      assert.match(corpoFunzione("eseguiAzione"), /azione === "cartella"\) return apriSceltaCartella\(\)/);
      assert.match(frontend, /#btn-apri-cartella[^\n]+apriSceltaCartella/);
    }],
    ["menu: importa, condividi, copia, esporta, rinomina, spazio, uso", () => {
      haMenu("import", "share", "copy", "export", "name", "compact", "session");
      assert.match(corpoFunzione("eseguiComandoNavigazione"), /eseguiWorkflowComando/);
    }],
    ["menu: Ricomincia qui, Duplica, Mostra albero, Cronologia e rami", async () => {
      haMenu("new", "clone", "fork-message", "tree", "history");
      assert.match(corpoFunzione("eseguiComandoNavigazione"), /nome === "history"\) return apriAlberoOppureSpiega\(sessione\)/);
      assert.match(corpoFunzione("apriAlberoOppureSpiega"), /Cronologia e rami sono conservati/);
      const sessione = { id: "s", haMessaggi: true, bozza: "Bozza originale" };
      const APP = { sessioni: new Map([[sessione.id, sessione]]), attivaId: sessione.id, bridgeOnline: true };
      const richieste = [];
      const conferme = [];
      let accetta = false;
      let cronologie = 0;
      const nuova = funzioneProva("nuovaConversazione", "operazione = null", {
        sessioneAttiva: () => sessione,
        conferma: async (...argomenti) => { conferme.push(argomenti); return accetta; },
        rpc: async (...argomenti) => { richieste.push(argomenti); return {}; },
        renderCronologia: (_sessione, messaggi) => { assert.deepEqual(messaggi, []); cronologie += 1; },
        sincronizzaSessione: async () => {}, toast() {}, testoErrore: String,
      }, true);
      const { creaNodo } = alberoProva();
      const corpo = creaNodo("section");
      const DOM = { input: creaNodo("textarea") };
      const fork = funzioneProva("scegliFork", "sessione, operazione = null", {
        APP, DOM, crea: creaNodo, breve: String, apriModale: () => corpo, chiudiModale() {},
        chiedi: async (url, { corpo: richiesta }) => {
          assert.equal(url, "/api/forche"); assert.deepEqual(richiesta, { sessionId: "s" });
          return { messages: [{ entryId: "messaggio-scelto", text: "Testo dal messaggio" }] };
        },
        rpc: async (...argomenti) => { richieste.push(argomenti); return { text: "Bozza del ramo" }; },
        sincronizzaSessione: async () => {}, ramificaLineageBozza() {}, salvaBozza() {},
        adattaAltezza() {}, aggiornaInterfacciaAttiva() {}, toast() {}, testoErrore: String,
      }, true);
      const workflow = funzioneProva("eseguiWorkflowComando", "sessione, azioneOriginale, argomenti, dati = {}, operazione = null", {
        APP, nuovaConversazione: nuova, scegliFork: fork,
      }, true);
      const esegui = funzioneProva("eseguiComandoNavigazione", "nome", {
        APP, sessioneAttiva: () => sessione, eseguiWorkflowComando: workflow,
      }, true);
      await esegui("new");
      assert.equal(conferme.length, 1);
      assert.match(conferme[0][1], /resta salvata/);
      assert.equal(richieste.length, 0, "annullare Ricomincia qui non modifica la sessione");
      assert.equal(cronologie, 0);
      accetta = true;
      await esegui("new");
      assert.deepEqual(richieste[0], [{ type: "new_session" }, { sessionId: "s", timeout: 60000 }]);
      assert.equal(cronologie, 1);
      await esegui("fork-message");
      assert.equal(richieste.length, 1, "aprire Crea versione propone la scelta senza ramificare");
      await corpo.querySelector("button").click();
      assert.deepEqual(richieste[1], [{ type: "fork", entryId: "messaggio-scelto" }, { sessionId: "s", timeout: 60000 }]);
      assert.equal(DOM.input.value, "Bozza del ramo", "il testo scelto resta in bozza senza invio");
    }],
    ["Comandi Avanzati: impostazioni, modelli rapidi, fiducia, account, reload, aggiornamenti", () => {
      const richiesti = ["settings", "scoped-models", "trust", "login", "logout", "reload", "aggiornamenti"];
      assert.deepEqual(costanteProva("COMANDI_AVANZATI"), richiesti);
      const { creaNodo } = alberoProva();
      const corpo = creaNodo("section");
      const chiamate = [];
      funzioneProva("apriControlliAvanzati", "sessioneRichiesta = null", {
        sessioneAttiva: () => ({ id: "s", statoRpc: {} }), apriModale: () => corpo, crea: creaNodo,
        sezioneAvanzata: (titolo) => creaNodo("section", "", titolo),
        bottoneAzione: (testo, onclick) => Object.assign(creaNodo("button", "", testo), { onclick }),
        COMANDI_AVANZATI: costanteProva("COMANDI_AVANZATI"), TESTI_BUILTIN: builtin,
        eseguiComandoNavigazione: (nome) => chiamate.push(nome),
      })();
      const accessi = corpo.querySelectorAll("button").filter((bottone) => bottone.dataset.comandoAvanzato);
      accessi.forEach((bottone) => bottone.click());
      assert.deepEqual(chiamate, richiesti);
      assert.ok(contenutoCompleto("gruppo-comandi").includes('id="btn-avanzati"'));
    }],
    ["Comandi Avanzati: Shell diretta, forme ! e !! e Protocollo RPC", () => {
      const avanzati = corpoFunzione("apriControlliAvanzati");
      assert.match(avanzati, /sezioneAvanzata\("Shell diretta"\)/);
      assert.match(avanzati, /sezioneAvanzata\("Protocollo RPC completo"\)/);
      assert.ok(avanzati.includes("Questo comando viene eseguito sul computer con i tuoi permessi e il risultato entra nel contesto di pi. Usalo solo se sai esattamente cosa fa."));
      assert.match(avanzati, /eseguiBash\(sessione, comandoShell\.value, outputShell\)/);
      assert.match(avanzati, /rpc\(comando, \{ sessionId: sessione\.id/);
      assert.match(corpoFunzione("mostraScorciatoiePi"), /!!/);
      assert.match(corpoFunzione("invia"), /shell|Bash/);
    }],
    ["composer: Modello, Livello e un solo Ferma", () => {
      for (const id of ["btn-modello", "btn-ragionamento", "btn-ferma"]) {
        assert.equal(elementiHtml.filter((nodo) => nodo.attributi.get("id") === id).length, 1);
        assert.ok(contenutoCompleto("composer-shell").includes(`id="${id}"`));
      }
      assert.match(frontend, /btnModello\.onclick\s*=\s*\(\)\s*=>\s*apriSceltaModello\(\)/);
      assert.match(frontend, /btnRagionamento\.onclick[^\n]*apriSceltaRagionamento/);
      assert.match(frontend, /btnFerma\.onclick[^\n]*interrompi/);
    }],
    ["laterale: Nuova conversazione, salvate, ricerca, Carica altre, chiusura", () => {
      for (const id of ["btn-nuova-conversazione", "cerca-conversazioni", "lista-conversazioni", "btn-carica-altre"]) assert.ok(elementoConId(id));
      assert.match(frontend, /#btn-nuova-conversazione[^\n]*avviaNuovaSchedaNelContestoCorrente/);
      assert.match(corpoFunzione("disegnaNavigazione"), /chiudiRigaConversazione\(voce\.id\)/);
      assert.match(corpoFunzione("caricaConversazioniLaterali"), /prossimoCursore/);
    }],
    ["skill: elenco nella ricerca e origine di ciascuna", () => {
      assert.match(corpoFunzione("apriRicercaComandi"), /bottoneComando/);
      assert.match(corpoFunzione("bottoneComando"), /origine|origin|etichettaFonteComando/);
      assert.match(corpoFunzione("bottoneComando"), /inserisciComandoNelComposer/);
    }],
    ["consiglio: pulsante Agenti diviso montato da P2", () => {
      assert.match(frontend, /PiGuiAgentiCore\?\.montaAgenti\?\.\(DOM\.composerShell,/);
      assert.equal(elementoConId("btn-consiglio"), undefined);
      assert.equal(elementoConId("btn-agenti"), undefined);
      assert.ok(html.indexOf('src="/agenti-core.js"') < html.indexOf('src="/app.js"'));
    }],
    ["Sistema Guidato: voce disponibile solo con estensione attiva", async () => {
      assert.equal(elementoConId("btn-sistema-guidato"), undefined);
      assert.match(corpoFunzione("aggiornaEstensioniAttive"), /attivaApplicata/);
      assert.match(corpoFunzione("comandoEstensioneVisibile"), /sistema/);
      assert.match(corpoFunzione("apriPannelloSistemaGuidato"), /comandoEstensioneVisibile/);
      const { documento, creaNodo } = alberoProva();
      documento.body = creaNodo("body");
      documento.getElementById = () => null;
      const DOM = Object.fromEntries(["pannelloOspite", "framePannelloOspite", "attesaPannelloOspite", "btnRicaricaPannelloOspite", "btnChiudiPannelloOspite", "velo", "toastArea", "input", "statoPannelloOspite"]
        .map((nome) => [nome, creaNodo(nome === "input" ? "textarea" : "div")]));
      DOM.pannelloOspite.hidden = true;
      const sfondo = creaNodo("main"); sfondo.inert = false;
      documento.body.append(sfondo, DOM.pannelloOspite, DOM.velo, DOM.toastArea);
      const invocante = creaNodo("button"); invocante.dataset.estensione = "sistema-guidato";
      const sostituto = creaNodo("button"); sostituto.dataset.estensione = "sistema-guidato";
      const lista = creaNodo("div"); lista.querySelectorAll = () => [sostituto];
      const PANNELLO_OSPITE = { sfondo: [] };
      const PANNELLO_SISTEMA_GUIDATO = { generazione: 0 };
      const ambiente = { DOM, PANNELLO_OSPITE, PANNELLO_SISTEMA_GUIDATO, document: documento,
        $: (id) => id === "#estensioni-attive" ? lista : creaNodo("div"),
        DESTINAZIONE_SISTEMA_GUIDATO_PREDEFINITA: "/sistema",
      };
      const sfondoInerte = funzioneProva("sfondoSistemaGuidatoInerte", "inerte", ambiente);
      const mostra = funzioneProva("mostraPannelloOspite", "tipo, titolo, invocante = document.activeElement", {
        ...ambiente, sfondoSistemaGuidatoInerte: sfondoInerte,
      });
      const caricate = [];
      const apri = funzioneProva("apriPannelloSistemaGuidato", "destinazione = '/sistema'", {
        ...ambiente, mostraPannelloOspite: mostra, normalizzaDestinazioneSistemaGuidato: (destinazione) => destinazione,
        leggiEstensioni: async () => { invocante.isConnected = false; documento.body.focus(); },
        comandoEstensioneVisibile: () => true,
        caricaPannelloSistemaGuidato: async (destinazione) => {
          caricate.push(destinazione); PANNELLO_SISTEMA_GUIDATO.destinazione = destinazione;
          DOM.framePannelloOspite.src = destinazione; DOM.framePannelloOspite.hidden = false;
        },
      }, true);
      const chiudiSistema = funzioneProva("chiudiPannelloSistemaGuidato", "", { ...ambiente, sfondoSistemaGuidatoInerte: sfondoInerte });
      const chiudi = funzioneProva("chiudiPannelloOspite", "", { ...ambiente, chiudiPannelloSistemaGuidato: chiudiSistema });
      invocante.focus();
      await apri();
      assert.equal(documento.activeElement, DOM.btnChiudiPannelloOspite);
      assert.equal(sfondo.inert, true);
      await apri();
      assert.deepEqual(caricate, ["/sistema"], "la destinazione gia aperta non ricarica il pannello");
      chiudi();
      assert.equal(documento.activeElement, sostituto, "il fuoco torna alla stessa estensione dopo la ricreazione dell'invocante");
      assert.equal(sfondo.inert, false);
      assert.equal(DOM.framePannelloOspite.src, "about:blank");
    }],
  ];
  assert.equal(mappa.length, 12);
  for (const [riga, verifica] of mappa) await t.test(riga, verifica);
});

test("il redesign conserva tutti gli ID statici richiesti dal frontend", () => {
  const idHtml = elementiHtml
    .map((elemento) => elemento.attributi.get("id"))
    .filter(Boolean);
  const duplicati = idHtml.filter((id, indice) => idHtml.indexOf(id) !== indice);
  assert.deepEqual([...new Set(duplicati)], [], "gli ID HTML devono essere univoci");

  const selettoriId = [
    ...frontend.matchAll(/\$\(\s*["']#([\w-]+)["']\s*\)/g),
  ].map((corrispondenza) => corrispondenza[1]);
  assert.ok(selettoriId.length >= 30, "il controllo deve coprire la mappa DOM reale di app.js");
  for (const id of new Set(selettoriId)) {
    assert.ok(idHtml.includes(id), `app.js usa #${id}, ma index.html non lo espone`);
  }

  for (const id of [
    "lista-conversazioni",
    "cerca-conversazioni",
    "btn-carica-altre",
    "btn-nuova-conversazione",
    "btn-menu-conversazione",
    "menu-conversazione",
    "btn-aiuto",
    "btn-impostazioni",
    "conversazione",
    "annuncio-risposta",
    "input",
    "btn-invia",
    "btn-allega",
    "menu-azioni-composer",
    "azione-allega-file",
    "azione-allega-immagine",
    "azione-richiama-skill",
    "azione-comandi-estensioni",
    "azione-ricarica-risorse",
    "scegli-file",
    "scegli-immagini",
    "allegati",
    "invii-verifica",
    "avvisi",
    "coda",
    "modo-coda",
    "invio-occupato",
    "spia",
    "eti-stato",
    "eti-cartella",
    "eti-percorso",
    "eti-modello",
    "eti-ragionamento",
    "stato-sessione-tui",
    "stato-cwd",
    "stato-uso",
    "contesto-info",
    "stato-modello-tui",
    "composer-shell",
    "palette-comandi",
    "lista-palette-comandi",
    "stato-palette-comandi",
    "suggerimento",
    "btn-ricarica-risorse",
    "btn-cerca-comandi",
    "btn-modello",
    "btn-ragionamento",
    "btn-avanzati",
    "btn-ferma",
    "pannello-ospite",
    "pannello-ospite-titolo",
    "stato-pannello-ospite",
    "attesa-pannello-ospite",
    "frame-pannello-ospite",
    "btn-ricarica-pannello-ospite",
    "btn-chiudi-pannello-ospite",
    "stati-estensioni",
    "widget-sopra",
    "widget-sotto",
    "velo",
    "modale",
    "modale-titolo",
    "modale-corpo",
    "modale-piede",
    "modale-chiudi",
    "toast-area",
  ]) {
    assert.ok(idHtml.includes(id), `manca il punto di integrazione #${id}`);
  }
});

test("l'ospite generico conserva isolamento e destinazioni affidabili dei pannelli", () => {
  assert.equal(elementoConId("btn-sistema-guidato"), undefined, "l'estensione non ha un ingresso statico");
  const pannello = elementoConId("pannello-ospite");
  assert.equal(pannello?.attributi.has("hidden"), true);
  const dialogo = elementiHtml.find((elemento) =>
    elemento.attributi.get("aria-labelledby") === "pannello-ospite-titolo");
  assert.equal(dialogo?.attributi.get("role"), "dialog");
  assert.equal(dialogo?.attributi.get("aria-modal"), "true");

  const frame = elementoConId("frame-pannello-ospite");
  assert.equal(frame?.tag, "iframe");
  assert.equal(frame?.attributi.get("src"), "about:blank");
  assert.equal(frame?.attributi.get("referrerpolicy"), "no-referrer");
  assert.match(frame?.attributi.get("sandbox") || "", /allow-same-origin/u);
  assert.match(frame?.attributi.get("sandbox") || "", /allow-scripts/u);
  assert.match(frame?.attributi.get("sandbox") || "", /allow-downloads/u);
  assert.doesNotMatch(frame?.attributi.get("sandbox") || "", /allow-top-navigation/u);

  const carica = corpoFunzione("caricaPannelloSistemaGuidato");
  assert.match(carica, /fetch\("\/sistema\/api\/health"/u);
  assert.match(carica, /credentials:\s*"same-origin"/u);
  assert.match(carica, /"X-SG-Nonce":\s*nonce/u);
  assert.match(carica, /risposta\.headers\.get\("X-SG-Nonce"\)\s*!==\s*nonce/u);
  assert.match(carica, /normalizzaDestinazioneSistemaGuidato\(destinazione\)/u);
  assert.match(carica, /framePannelloOspite\.src\s*=\s*destinazioneConsentita/u);
  assert.doesNotMatch(carica, /localStorage|sessionStorage|X-SG-Token|api[-_]?key/iu);
  assert.doesNotMatch(frontend, /X-SG-Token/iu,
    "la capability interna non deve esistere nel JavaScript del browser");
  const apriPannello = corpoFunzione("apriPannelloSistemaGuidato");
  assert.match(apriPannello, /mostraPannelloOspite\("sistema", "Sistema Guidato", invocante\)/u);
  assert.match(corpoFunzione("mostraPannelloOspite"), /sfondoSistemaGuidatoInerte\(true\)/u);
  assert.match(apriPannello, /caricaPannelloSistemaGuidato\(destinazioneConsentita\)/u,
    "un sottocomando deve aggiornare la destinazione anche quando il pannello e gia aperto");
  assert.match(apriPannello, /PANNELLO_SISTEMA_GUIDATO\.destinazione\s*===\s*destinazioneConsentita/u,
    "la stessa destinazione gia aperta non deve ricaricare l'iframe");
  assert.match(apriPannello, /DOM\.framePannelloOspite\.src\s*!==\s*"about:blank"/u);
  assert.match(corpoFunzione("chiudiPannelloOspite"), /chiudiPannelloSistemaGuidato\(\)/u);
  assert.match(corpoFunzione("chiudiPannelloSistemaGuidato"), /sfondoSistemaGuidatoInerte\(false\)/u);
  const workflow = corpoFunzione("eseguiWorkflowComando");
  assert.match(workflow, /sistema-guidato-panel/u);
  assert.match(workflow, /destinazioneSistemaGuidatoDaArgomenti\(argomenti\)/u);

  const destinazioneLegacy = corpoFunzione("destinazioneSistemaGuidatoDaArgomenti");
  assert.match(destinazioneLegacy, /DESTINAZIONI_SOTTOCOMANDI_SISTEMA_GUIDATO\.get\(sottoComando\)/u);
  assert.match(destinazioneLegacy, /DESTINAZIONE_SISTEMA_GUIDATO_PREDEFINITA/u);
  assert.doesNotMatch(destinazioneLegacy, /URLSearchParams|encodeURI|new URL/iu,
    "gli argomenti liberi non devono poter costruire la URL dell'iframe");
  for (const destinazione of [
    "/sistema/?action=create",
    "/sistema/?step=project",
    "/sistema/?step=interview",
    "/sistema/?step=evidence",
    "/sistema/?step=documents",
    "/sistema/?step=documents&content=1",
  ]) assert.ok(frontend.includes(JSON.stringify(destinazione)), `destinazione trusted mancante: ${destinazione}`);
  assert.match(stile, /\.pannello-ospite\s*\{/u);
  assert.match(stile, /\.pannello-ospite-corpo iframe\s*\{/u);
});

test("una nuova scheda puo riusare la stessa cartella senza riusare la conversazione", () => {
  const nuovaScheda = corpoFunzione("avviaNuovaSchedaNelContestoCorrente");
  assert.match(nuovaScheda, /corrente\?\.cartella\s*&&\s*!corrente\.senzaCartella/);
  assert.match(nuovaScheda, /avviaSessione\(corrente\.cartella,\s*\{\s*forzaNuova:\s*true\s*\}\)/);
  assert.match(nuovaScheda, /senzaCartella:\s*true,\s*forzaNuova:\s*true/);

  const explorer = corpoFunzione("apriSceltaCartella");
  assert.match(explorer, /avviaSessione\(stato\.selezionata\.percorso,[\s\S]*?forzaNuova:\s*true/);
  assert.match(frontend, /\$\("#btn-nuova-conversazione"\)\.onclick\s*=\s*avviaNuovaSchedaNelContestoCorrente/);
});

test("il primo avvio si autoripara senza duplicare la sessione o bloccare il composer", () => {
  assert.match(html, /<script src="\/startup-core\.js"><\/script>\s*<script src="\/app\.js"><\/script>/);

  const assicura = corpoFunzione("assicuraSessioneIniziale");
  assert.match(assicura, /STARTUP_CORE\.assicuraSessioneIniziale/);
  assert.match(assicura, /forzaNuova:\s*false/,
    "il retry del bootstrap deve riusare l'eventuale sessione creata dalla POST ambigua");
  assert.match(assicura, /propagaErrore:\s*true/,
    "un fallimento automatico deve arrivare al ciclo di riconnessione");

  const bootstrap = corpoFunzione("avvio");
  const reconnect = corpoFunzione("risincronizzaDopoRiconnessione");
  assert.match(bootstrap, /assicuraSessioneIniziale\(\{\s*sincronizza:\s*false\s*\}\)/);
  assert.match(reconnect, /assicuraSessioneIniziale\(\{\s*sincronizza:\s*false\s*\}\)/);
  assert.match(bootstrap, /sincronizzaSessioniUtilizzabili\(\)/,
    "la nuova sessione deve essere sincronizzata una volta sola e verificata");
  assert.match(reconnect, /sincronizzaSessioniUtilizzabili\(\)/);
  assert.match(reconnect, /aggiornaDalPonte\(\{\s*sostituisci:\s*true\s*\}\)[\s\S]*sessioniUtilizzabili/,
    "il reconnect deve ricontrollare lo snapshot dopo la sincronizzazione");

  const sincronizzaTutte = corpoFunzione("sincronizzaSessioniUtilizzabili");
  assert.match(sincronizzaTutte, /esiti\[indice\]\s*===\s*true/);
  assert.match(sincronizzaTutte, /if \(!riuscite\.length\)[\s\S]*throw new Error/,
    "un catalogo modelli non verificato non puo dichiarare guarito il bootstrap");

  const trasporto = corpoFunzione("chiedi");
  assert.ok((trasporto.match(/programmaRiconnessione\(\)/g) || []).length >= 2,
    "gli errori di trasporto e di conferma devono sempre avviare l'autoriparazione");

  const sincronizza = corpoFunzione("sincronizzaSessione");
  assert.match(sincronizza, /richiestaSincronizzazione/);
  assert.match(sincronizza, /finally\s*\{/);
  assert.match(sincronizza, /void caricaCapacita\(sessione\)/,
    "il catalogo accessorio non deve prolungare il blocco principale");

  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  const gateComposer = interfaccia.slice(
    interfaccia.indexOf("const composerScrivibile"),
    interfaccia.indexOf("const utilizzabile"),
  );
  assert.doesNotMatch(gateComposer, /sincronizzazione/,
    "durante la sincronizzazione deve essere possibile preparare la bozza");
  assert.match(gateComposer, /avvioCompletato\s*!==\s*false/,
    "una sessione half-started non deve accettare testo che il rollback renderebbe irraggiungibile");
  assert.match(interfaccia, /mutazioniUtilizzabili[\s\S]*!sessione\?\.sincronizzazione/,
    "invio e cambio modello restano protetti finche la sincronizzazione non termina");
});

test("la struttura Codex-like mantiene i contratti accessibili della conversazione", () => {
  const conversazione = elementoConId("conversazione");
  assert.equal(conversazione?.attributi.get("role"), "log");
  assert.equal(conversazione?.attributi.get("aria-live"), "polite");
  assert.equal(conversazione?.attributi.get("aria-relevant"), "additions");
  assert.equal(conversazione?.attributi.get("tabindex"), "0");

  const stato = elementoConId("stato");
  assert.equal(stato?.attributi.get("role"), "status");
  assert.equal(stato?.attributi.get("aria-live"), "polite");

  const avvisi = elementoConId("avvisi");
  assert.equal(avvisi?.attributi.get("role"), "alert");
  assert.equal(avvisi?.attributi.get("aria-live"), "assertive");

  const annuncio = elementoConId("annuncio-risposta");
  assert.equal(annuncio?.attributi.get("aria-live"), "polite");
  assert.equal(annuncio?.attributi.get("aria-atomic"), "true");

  assert.equal(elementoConId("input")?.tag, "textarea");
  const input = elementoConId("input");
  assert.equal(input?.attributi.get("aria-controls"), "lista-palette-comandi");
  assert.equal(input?.attributi.get("aria-expanded"), "false");
  assert.equal(input?.attributi.get("aria-autocomplete"), "list");
  assert.equal(input?.attributi.get("aria-haspopup"), "listbox");
  assert.equal(input?.attributi.get("aria-describedby"), "suggerimento");
  assert.equal(elementoConId("palette-comandi")?.attributi.has("hidden"), true);
  assert.equal(elementoConId("lista-palette-comandi")?.attributi.get("role"), "listbox");
  assert.equal(elementoConId("stato-palette-comandi")?.attributi.get("role"), "status");
  assert.ok(
    elementiHtml.some((elemento) =>
      elemento.tag === "label" && elemento.attributi.get("for") === "input"),
    "la textarea deve conservare un'etichetta associata",
  );

  const modale = elementoConId("modale");
  assert.equal(modale?.attributi.get("role"), "dialog");
  assert.equal(modale?.attributi.get("aria-modal"), "true");
  assert.equal(modale?.attributi.get("aria-labelledby"), "modale-titolo");

  for (const elemento of elementiHtml) {
    for (const attributo of ["aria-controls", "aria-labelledby"]) {
      const riferimenti = elemento.attributi.get(attributo)?.split(/\s+/).filter(Boolean) || [];
      for (const id of riferimenti) {
        assert.ok(elementoConId(id), `${attributo} punta all'ID inesistente #${id}`);
      }
    }
  }
});

test("la barra TUI conserva per sessione cwd, contesto, modello e statistiche", () => {
  const barra = elementoConId("stato-sessione-tui");
  assert.equal(barra?.attributi.get("role"), "status");
  assert.equal(barra?.attributi.get("aria-live"), "polite");
  assert.equal(barra?.attributi.get("aria-atomic"), "true");
  const corpo = corpoElementoSemplice("stato-sessione-tui");
  for (const id of ["stato-cwd", "stato-uso", "contesto-info", "stato-modello-tui"]) {
    assert.match(corpo, new RegExp(`\\bid=["']${id}["']`), `manca #${id} nella barra TUI`);
  }

  const disegna = corpoFunzione("disegnaBarraStatoSessione");
  assert.match(disegna, /sessione\.statoRpc\?\.cwd\s*\|\|\s*sessione\.cartella/,
    "il percorso RPC deve avere il fallback alla cartella canonica");
  assert.match(disegna, /sessione\.provider/);
  assert.match(disegna, /sessione\.modello/);
  assert.match(disegna, /sessione\.ragionamento/);
  assert.match(corpoFunzione("testoContestoSessione"), /contextUsage/);
  assert.match(corpoFunzione("testoContestoSessione"), /Math\.max\(0,\s*finestra\s*-\s*usati\)/,
    "la barra deve mostrare anche il contesto rimanente");
  assert.match(corpoFunzione("testoContestoSessione"), /ultimoUso\?\.totalTokens/,
    "durante lo streaming il contesto deve avanzare senza attendere agent_settled");
  assert.match(corpoFunzione("testoContestoSessione"), /autoCompactionEnabled\s*===\s*true/,
    "la barra deve mostrare l'indicatore auto come il footer TUI");
  assert.match(corpoFunzione("testoContestoSessione"), /contesto\?\.tokens\s*==\s*null\s*\?\s*NaN/,
    "dopo una compaction tokens=null non deve essere trasformato in un falso zero");
  const finestra = corpoFunzione("finestraModelloSessione");
  assert.match(finestra, /VISTA_CORE\.finestraContestoModelloCorrente/,
    "la finestra deve essere risolta dal core che lega i dati all'identita del modello corrente");
  assert.match(finestra, /modelloStatistiche:\s*sessione\?\.modelloStatistiche/,
    "le statistiche possono contribuire soltanto insieme al modello che le ha prodotte");
  assert.match(stile, /\.stato-sessione-tui\s*\{/);
  assert.match(stile, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  const uso = corpoFunzione("testoUsoSessione");
  for (const simbolo of ["↑", "↓", "R", "W", "CH"]) assert.match(uso, new RegExp(simbolo));
  assert.match(corpoFunzione("mostraUsoBreve"), /ultimoCacheHitPercento/);
});

test("le statistiche si aggiornano fail-soft dopo sync e agent_settled, non durante i delta", () => {
  const aggiorna = corpoFunzione("aggiornaStatisticheSessione");
  assert.match(aggiorna, /type:\s*["']get_session_stats["']/);
  assert.match(aggiorna, /statisticheInCaricamento/,
    "le letture concorrenti devono essere riunite per sessione");
  assert.match(aggiorna, /catch\s*\{/,
    "un errore accessorio non deve cancellare l'ultima fotografia valida");
  assert.doesNotMatch(aggiorna, /statisticheSessione\s*=\s*null/);

  const risposta = corpoFunzione("aggiornaDaRisposta");
  assert.match(risposta, /evento\.command\s*===\s*["']get_session_stats["']/);
  assert.match(risposta, /sessione\.statisticheSessione\s*=\s*dati/);
  assert.match(risposta, /revisioneRichiesta\s*===\s*Number\(sessione\.revisioneModello/,
    "una risposta statistica tardiva non deve contaminare il modello appena selezionato");
  assert.match(risposta, /VISTA_CORE\.chiaveModello\(modelloRichiesta\)/,
    "provider e ID richiesti devono coincidere con quelli ancora correnti");

  const sync = corpoFunzione("sincronizzaSessione");
  const fineSync = sync.indexOf("sessione.sincronizzazione = false");
  const statisticheDopoSync = sync.indexOf("void aggiornaStatisticheSessione(sessione)");
  assert.ok(fineSync >= 0 && statisticheDopoSync > fineSync,
    "get_session_stats non deve allungare la sincronizzazione principale");

  const eventi = corpoFunzione("gestisciEvento");
  const settled = eventi.indexOf('evento.type === "agent_settled"');
  const richiesta = eventi.indexOf("aggiornaStatisticheSessione(sessione)", settled);
  const delta = eventi.indexOf('evento.type === "message_update"');
  assert.ok(settled >= 0 && richiesta > settled && richiesta < delta,
    "le statistiche devono partire in differita alla fine del turno");
  const ramoDelta = eventi.slice(delta, eventi.indexOf('evento.type === "message_end"', delta));
  assert.doesNotMatch(ramoDelta, /aggiornaStatisticheSessione/,
    "la lettura delle statistiche non deve rallentare il primo delta");
});

test("la sincronizzazione finale assorbe soltanto i conflitti transitori della cronologia", () => {
  const finale = corpoFunzione("sincronizzaMessaggiFinali");
  assert.match(finale, /\[409,\s*423\]\.includes\(errore\?\.statusHttp\)/,
    "message_end e agent_settled possono incontrare sia un 409 sia un 423 transitorio");
  assert.match(finale, /tentativiTransitori\s*<\s*2/,
    "i retry devono essere limitati per non nascondere un conflitto persistente");
  assert.match(finale, /setTimeout\(risolvi,\s*100\s*\*\s*tentativiTransitori\)/,
    "la rilettura deve lasciare al JSONL il tempo di stabilizzarsi");
  assert.match(finale, /else if \(errore\?\.statusHttp !== 423\)[\s\S]*mostraErroreCronologia/,
    "un 409 persistente deve continuare a essere mostrato come errore reale");
});

test("il primo delta e visibile subito e il ragionamento resta compatto", () => {
  const delta = corpoFunzione("gestisciDelta");
  assert.match(delta, /const primoDelta = !sessione\.bloccoTesto/);
  assert.match(delta, /primoDelta[\s\S]*appendChild\(document\.createTextNode\(aggiornamento\.delta\)\)/,
    "il primo token testuale deve essere scritto subito nel DOM");
  assert.match(delta, /else\s*\{[\s\S]*deltaTestoInAttesa[\s\S]*pianificaDelta/,
    "i delta successivi restano raggruppati per contenere i reflow");
  assert.match(corpoFunzione("apriRagionamento"), /box\.open\s*=\s*Boolean\(testo\s*&&\s*sessione\.ragionamentiAperti/,
    "il ragionamento deve restare compatto finche l'utente non lo apre");
  assert.doesNotMatch(corpoFunzione("chiudiRagionamento"), /box\.open\s*=\s*false/,
    "la fine del ragionamento non deve annullare una scelta esplicita dell'utente");
});

test("solo l'attivita tecnica in corso mostra un avanzamento grafico discreto", () => {
  const creaGruppo = corpoFunzione("ottieniGruppoAttivita");
  assert.match(creaGruppo, /stato\.setAttribute\(["']role["'],\s*["']status["']\)/);
  assert.match(creaGruppo, /stato\.setAttribute\(["']aria-live["'],\s*["']polite["']\)/);
  assert.match(creaGruppo, /stato\.setAttribute\(["']aria-atomic["'],\s*["']true["']\)/);
  assert.doesNotMatch(creaGruppo, /conteggio\.setAttribute\(["']aria-live["']/,
    "il conteggio ad alta frequenza non deve produrre annunci continui");
  const aggiorna = corpoFunzione("aggiornaGruppoAttivita");
  assert.match(aggiorna, /const attivitaInCorso\s*=\s*inCorso\s*\|\|\s*!gruppo\.finalizzato/);
  assert.match(aggiorna, /classList\.toggle\(["']in-corso["'],\s*attivitaInCorso\)/,
    "un tentativo fallito non deve spegnere l'animazione mentre il gruppo continua");
  assert.match(aggiorna, /classList\.toggle\(["']con-avvisi["'],\s*stato\.livello === ["']avviso["']\)/,
    "avanzamento e avviso devono poter coesistere");
  assert.match(stile, /\.gruppo-attivita\.in-corso \.stato::after\s*\{/,
    "lo stato attivo deve avere un indicatore pulsante");
  assert.match(stile, /\.gruppo-attivita\.in-corso > summary::after\s*\{/,
    "il gruppo attivo deve avere una luce di avanzamento");
  assert.match(stile, /@keyframes respiro-attivita/);
  assert.match(stile, /@keyframes avanzamento-attivita/);
  assert.doesNotMatch(stile, /\.gruppo-attivita:not\(\.in-corso\)[^{]*animation/,
    "i gruppi completati devono restare statici");
  const ridotto = stile.slice(stile.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(ridotto, /\.gruppo-attivita\.in-corso \.stato::after[\s\S]*?animation:\s*none/);
  assert.match(ridotto, /\.gruppo-attivita\.in-corso > summary::after[\s\S]*?animation:\s*none/);
});

test("il trasferimento al terminale distingue la chat nuova e guida il blocco multi-finestra", () => {
  const controlli = corpoFunzione("apriControlliAvanzati");
  assert.match(controlli, /Nuova conversazione nel terminale/);
  assert.match(controlli, /Sposta questa conversazione nel terminale/);
  const handoff = corpoFunzione("passaConversazioneAlTerminale");
  assert.match(handoff, /HANDOFF_CLIENT_RECONNECT_GRACE/);
  assert.match(handoff, /retryAfterMs/);
  assert.match(handoff, /HANDOFF_OTHER_CLIENT_CONNECTED/);
  assert.match(handoff, /Chiudi l'altra finestra di Interfaccia Pi/);
  const chiedi = corpoFunzione("chiedi");
  assert.match(chiedi, /errore\.retryAfterMs/);
  assert.match(chiedi, /errore\.blocker/);
});

test("Skills e comandi sono un elenco nativo a scomparsa, chiuso inizialmente", () => {
  const gruppo = elementoConId("gruppo-comandi");
  assert.equal(gruppo?.tag, "details", "#gruppo-comandi deve usare disclosure nativa");
  assert.equal(gruppo?.attributi.has("open"), false, "l'elenco non deve occupare spazio all'avvio");

  const corpo = corpoElementoSemplice("gruppo-comandi");
  assert.match(corpo, /^\s*<summary\b/i, "summary deve essere il primo figlio del details");
  const sommario = corpo.match(/^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
  assert.ok(sommario, "manca il summary del pannello Skills");
  assert.match(sommario[1].replace(/<[^>]+>/g, " "), /\bComandi\b/);
  assert.doesNotMatch(sommario[1], /<(?:button|input|select|textarea|a)\b/i,
    "summary non deve contenere altri controlli interattivi");

  for (const id of ["btn-avanzati", "btn-ricarica-risorse"]) {
    assert.match(corpo, new RegExp(`\\bid=["']${id}["']`), `#${id} deve restare nel pannello`);
  }
  const cerca = elementoConId("btn-cerca-comandi");
  assert.equal(cerca?.tag, "button");
  assert.equal(cerca?.attributi.get("type"), "button");
  assert.ok(contenutoCompleto("pannello-laterale").includes(cerca.apertura));
  assert.match(corpoElementoSemplice("btn-cerca-comandi"), /Cerca comandi e skill/);
  assert.match(corpoFunzione("apriRicercaComandi"), /bottoneComando/,
    "le skill restano elencate nella ricerca accessibile dal laterale");
});

test("le skill restano selezionabili con nome e spiegazione in linguaggio naturale", () => {
  const descrizione = corpoFunzione("descrizioneComando");
  assert.match(descrizione, /comando\.description/,
    "la descrizione fornita dalla skill deve avere priorita");
  assert.match(descrizione, /comando\.source === ["']skill["']/);
  assert.match(descrizione, /competenza specializzata/i);
  assert.match(descrizione, /comando\.source === ["']prompt["']/);
  assert.match(descrizione, /procedura guidata/i);
  assert.doesNotMatch(descrizione, /skill:graphify|skill:bonifica-vault/,
    "le descrizioni delle skill devono arrivare dal catalogo di pi");

  const bottone = corpoFunzione("bottoneComando");
  assert.match(bottone, /crea\(["']button["'],\s*["']voce["']/);
  assert.match(bottone, /\.type\s*=\s*["']button["']/);
  assert.match(bottone, /titoloComando\(comando\)/,
    "la skill deve mostrare un nome leggibile");
  assert.match(bottone, /descrizioneComando\(comando\)/,
    "la skill deve mostrare la spiegazione naturale");
  assert.match(bottone, /inserisciComandoNelComposer/,
    "pannello e palette devono usare lo stesso completamento sicuro");
  assert.match(bottone, /chiaveComando\(comando\)/,
    "la selezione deve distinguere sorgenti omonime");

  const elenco = corpoFunzione("disegnaComandi");
  assert.match(elenco, /btnCercaComandi\.hidden\s*=\s*false/,
    "la ricerca deve essere raggiungibile anche con poche skill");
  assert.match(frontend, /DOM\.btnCercaComandi\.onclick\s*=\s*\(\)\s*=>\s*apriRicercaComandi\(\)/);

  const ricerca = corpoFunzione("apriRicercaComandi");
  assert.match(frontend, /titolo\s*=\s*["']Comandi e skill di questa conversazione["']/);
  assert.match(frontend, /etichettaRicerca\s*=\s*["']Cerca comandi e skill["']/);
  assert.match(ricerca, /new Set\(fonti\)/,
    "lo stesso selettore deve accettare filtri di sorgente espliciti");
  assert.match(ricerca, /filtraCatalogoComandi\(/,
    "la ricerca deve riusare la normalizzazione del catalogo autorevole");
});

test("il pulsante + apre un menu rapido accessibile senza fingere di installare estensioni", () => {
  const apertura = elementoConId("btn-allega");
  assert.equal(apertura?.tag, "button");
  assert.equal(apertura?.attributi.get("aria-haspopup"), "menu");
  assert.equal(apertura?.attributi.get("aria-expanded"), "false");
  assert.equal(apertura?.attributi.get("aria-controls"), "menu-azioni-composer");
  assert.match(apertura?.attributi.get("aria-label") || "", /allega file|azioni/i);

  const menu = elementoConId("menu-azioni-composer");
  assert.equal(menu?.attributi.get("role"), "menu");
  assert.equal(menu?.attributi.has("hidden"), true);
  const corpoMenu = corpoElementoSemplice("menu-azioni-composer");
  for (const [id, testo] of [
    ["azione-allega-file", /allega file/i],
    ["azione-allega-immagine", /allega immagine/i],
    ["azione-richiama-skill", /richiama skill o procedura/i],
    ["azione-comandi-estensioni", /comandi estensioni/i],
    ["azione-ricarica-risorse", /ricarica dopo installazione/i],
  ]) {
    const voce = elementoConId(id);
    assert.equal(voce?.tag, "button");
    assert.equal(voce?.attributi.get("type"), "button");
    assert.equal(voce?.attributi.get("role"), "menuitem");
    assert.equal(voce?.attributi.get("tabindex"), "-1");
    assert.match(corpoMenu, new RegExp(`id=["']${id}["'][\\s\\S]*?${testo.source}`, "i"));
  }
  assert.doesNotMatch(corpoMenu, /installa(?:re|zione) estension/i,
    "il menu non deve promettere una funzione di installazione inesistente");
  assert.match(corpoMenu, /gi[àa] installate o configurate/i,
    "il reload deve essere descritto come riscoperta di risorse gia presenti");

  const picker = corpoFunzione("eseguiAzioneMenuComposer");
  assert.match(picker, /fonti:\s*\["skill",\s*"prompt"\]/,
    "skill e prompt devono provenire dal catalogo della sessione");
  assert.match(picker, /fonti:\s*\["extension"\]/,
    "il pannello estensioni deve usare soltanto source=extension");
  assert.match(picker, /mostraDisponibilita:\s*true/,
    "i comandi estensione devono dichiarare GUI o terminale");
  assert.match(picker, /conservaBozzaComeArgomenti:\s*true/,
    "scegliere dal menu + non deve cancellare il testo gia scritto");
  assert.match(picker, /ricaricaRisorsePi\(\)/,
    "Ricarica dopo installazione deve riusare il workflow sicuro esistente");

  const inserimento = corpoFunzione("inserisciComandoNelComposer");
  assert.match(inserimento, /conservaBozzaComeArgomenti\s*\?\s*DOM\.input\.value\.trim\(\)/,
    "la bozza deve diventare l'argomento della skill o estensione selezionata");
  assert.match(inserimento, /argomentiEsistenti/,
    "il comando scelto deve conservare la bozza nel composer");

  const apri = corpoFunzione("apriMenuAzioniComposer");
  assert.match(apri, /chiudiPaletteComandi\(\)/,
    "menu rapido e palette slash non devono sovrapporsi");
  assert.match(apri, /aria-expanded["'],\s*["']true/);
  const chiudi = corpoFunzione("chiudiMenuAzioniComposer");
  assert.match(chiudi, /aria-expanded["'],\s*["']false/);
  assert.match(chiudi, /ripristinaFocus/);
  const sposta = corpoFunzione("spostaFocusMenuAzioniComposer");
  assert.match(sposta, /inizio/);
  assert.match(sposta, /fine/);
  const { documento, creaNodo } = alberoProva();
  const APP = { menuAzioniComposer: { aperto: false, indiceAttivo: 0 }, paletteComandi: { aperta: false } };
  const DOM = { menuAzioniComposer: creaNodo("div"), btnAllega: creaNodo("button"), input: creaNodo("textarea") };
  const voci = [creaNodo("button"), creaNodo("button"), creaNodo("button")];
  let azioni = 0;
  voci.forEach((voce) => { voce.onclick = () => { azioni += 1; }; });
  const ambiente = { APP, DOM, document: documento, vociMenuAzioniComposer: () => voci };
  const aggiornaFocus = funzioneProva("aggiornaFocusMenuAzioniComposer", "", ambiente);
  const chiudiMenu = funzioneProva("chiudiMenuAzioniComposer", "{ ripristinaFocus = false } = {}", ambiente);
  const apriMenu = funzioneProva("apriMenuAzioniComposer", "", {
    ...ambiente, chiudiPaletteComandi() {}, aggiornaFocusMenuAzioniComposer: aggiornaFocus,
    requestAnimationFrame: (callback) => callback(),
  });
  const spostaFocus = funzioneProva("spostaFocusMenuAzioniComposer", "movimento", {
    ...ambiente, aggiornaFocusMenuAzioniComposer: aggiornaFocus,
  });
  documento.getElementById = () => null;
  const tastoMenu = funzioneProva("gestisciTastiMenuPalette", "evento", {
    ...ambiente, gestisciTastiMenuConversazione: () => false, $: () => ({ hidden: true }),
    spostaFocusMenuAzioniComposer: spostaFocus, chiudiMenuAzioniComposer: chiudiMenu,
  });
  apriMenu();
  assert.equal(documento.activeElement, voci[0]);
  for (const [key, indice] of [["ArrowDown", 1], ["ArrowUp", 0], ["End", 2], ["ArrowDown", 0], ["Home", 0]]) {
    assert.equal(tastoMenu({ key }), true, `${key} viene consumato dal menu rapido`);
    assert.equal(documento.activeElement, voci[indice]);
    assert.deepEqual(voci.map((voce) => voce.tabIndex), voci.map((_, i) => i === indice ? 0 : -1));
  }
  tastoMenu({ key: "Enter" }); tastoMenu({ key: " " });
  assert.equal(azioni, 2, "Invio e Barra azionano una sola scelta ciascuno");
  tastoMenu({ key: "Escape" });
  assert.equal(DOM.menuAzioniComposer.hidden, true);
  assert.equal(documento.activeElement, DOM.btnAllega);
  apriMenu(); tastoMenu({ key: "Tab" });
  assert.equal(documento.activeElement, DOM.input);
  apriMenu(); tastoMenu({ key: "Tab", shiftKey: true });
  assert.equal(documento.activeElement, DOM.btnAllega);
  assert.match(frontend, /menuAzioniComposer\.contains\(evento\.target\)/,
    "un click esterno deve chiudere il menu");
  for (const classe of ["menu-azioni-composer", "menu-azione-composer", "disponibilita-comando"]) {
    assert.match(stile, new RegExp(`\\.${classe}(?:[^\\w-]|$)`), `manca lo stile .${classe}`);
  }
});

test("file generici e immagini possono essere scelti o trascinati senza mostrare il marcatore tecnico", () => {
  assert.ok(html.indexOf("/attachment-core.js") < html.indexOf("/app.js"),
    "il codec degli allegati deve essere disponibile prima del frontend");
  assert.match(attachmentCore, /<pi_gui_files_v1>/);
  assert.match(attachmentCore, /creaMessaggioConFile/);
  assert.match(attachmentCore, /separaMessaggioConFile/);

  const picker = elementoConId("scegli-file");
  assert.equal(picker?.tag, "input");
  assert.equal(picker?.attributi.get("type"), "file");
  assert.equal(picker?.attributi.has("multiple"), true);
  assert.equal(picker?.attributi.has("hidden"), true);
  assert.match(corpoFunzione("eseguiAzioneMenuComposer"), /DOM\.scegliFile\.click\(\)/);

  const aggiungi = corpoFunzione("aggiungiFile");
  assert.match(aggiungi, /LIMITE_FILE_ALLEGATO/);
  assert.match(aggiungi, /leggiFileBase64/);
  assert.match(aggiungi, /chiedi\(["']\/api\/allega-file["']/);
  assert.match(aggiungi, /risposta\?\.allegato/);
  assert.match(aggiungi, /riferimentiFileServer\(\[caricato\]\)/,
    "ogni upload deve ricevere anche il token opaco di proprieta");
  assert.match(aggiungi, /caricato\.ownerSessionId !== sessione\.id/,
    "ogni upload deve dichiarare anche la sessione server proprietaria");
  assert.match(aggiungi, /eliminaFilePendentiBestEffort/,
    "un upload abbandonato durante una race deve essere cancellato best-effort");
  assert.match(aggiungi, /APP\.sessioni\.get\(sessione\.id\) === sessione/,
    "cambiare scheda durante l'upload non deve scartare il file della scheda di origine");
  assert.doesNotMatch(aggiungi, /sessioneAttiva\(\) !== sessione/,
    "la validita dell'upload dipende dall'esistenza della scheda, non dal fatto che sia visibile");
  const invio = corpoFunzione("invia");
  assert.match(invio, /creaMessaggioConFile\(testoInvio,\s*fileAllegati\)/,
    "Pi deve ricevere i percorsi locali in un envelope strutturato");
  assert.match(invio, /message:\s*testoRpc/);
  assert.match(invio, /piGuiFileRefs:\s*riferimentiFilePrompt\.length/,
    "il ponte deve preparare e finalizzare gli stessi file del prompt");
  assert.match(invio, /riferimentiFilePrompt\.length !== fileAllegati\.length/,
    "un file senza token non deve essere inviato come percorso non protetto");
  assert.match(frontend, /chiedi\(["']\/api\/gestisci-file-allegati["']/);
  const adozione = corpoFunzione("adottaFilePendentiBozza");
  assert.match(adozione, /chiedi\(["']\/api\/adotta-file-allegati["']/);
  assert.match(adozione, /ownerSessionId:\s*allegato\.ownerSessionId/);
  assert.match(adozione, /adottato\.ownerSessionId !== sessione\.id/);
  assert.match(adozione, /adottato\.token === origine\.allegato\.token/,
    "l'adozione deve esigere la rotazione del token");
  const ripristino = corpoFunzione("ripristinaFotografiaAllegatiBozza");
  assert.match(ripristino, /await adottaFilePendentiBozza/,
    "il restore deve adottare i file prima di renderli nuovamente inviabili");
  assert.match(ripristino, /forzaCopia:\s*copiaPerAltroDocumento/,
    "una seconda finestra deve ricevere pending server distinti");
  assert.ok(
    ripristino.indexOf("await adottaFilePendentiBozza")
      < ripristino.indexOf("sessione.allegati = raccolti.map"),
    "l'adozione deve precedere la pubblicazione degli allegati nella sessione",
  );
  assert.match(corpoFunzione("disegnaAllegati"), /eliminaFilePendentiBestEffort/,
    "rimuovere un file dalla bozza deve chiedere la cancellazione server-side");
  const chiusura = corpoFunzione("chiudiSessione");
  assert.match(chiusura, /const filePendenti = riferimentiFileServer\(sessione\.allegati\)/);
  assert.match(chiusura, /filePendenti\.length \? \{ filePendenti \}/,
    "la chiusura deve consegnare i token pending al server prima di eliminare la bozza locale");
  assert.match(chiusura, /allegat\$\{sessione\.allegati\.length === 1 \? ["']o["'] : ["']i["']\}/,
    "la conferma di chiusura deve parlare di allegati, non soltanto di immagini");
  assert.match(chiusura, /esitoChiusura\?\.pendingNonEliminati/,
    "un cleanup parziale dopo lo stop deve chiudere comunque la scheda e mostrare un avviso");
  assert.match(chiusura, /dimenticaBozza\(sessione,\s*\{ preservaInviiPendenti: true \}\)/,
    "la chiusura deve scartare la bozza corrente senza eliminare le copie degli invii da verificare");
  const dimentica = corpoFunzione("dimenticaBozza");
  assert.match(dimentica, /sessione\.inviiPendenti\.length && !preservaInviiPendenti/);
  assert.match(dimentica, /if \(!preservaInviiPendenti\) \{[\s\S]*sessione\.inviiPendenti = \[\]/,
    "i record storici degli invii devono essere indipendenti dal bundle della bozza confermata");
  assert.match(corpoFunzione("aggiungiMessaggio"), /separaMessaggioConFile/,
    "la cronologia deve mostrare il prompt umano e i file, non l'envelope interno");

  assert.match(frontend, /document\.addEventListener\(["']dragenter["']/);
  assert.match(frontend, /document\.addEventListener\(["']dragover["']/);
  assert.match(frontend, /document\.addEventListener\(["']drop["']/);
  assert.match(frontend, /accodaAggiuntaAllegati\(evento\.dataTransfer\?\.files/);
  assert.match(stile, /\.composer-shell\.trascinamento-file/);
  assert.match(frontend, /setInterval\(rinnovaFileBozzeAperte,\s*INTERVALLO_RINNOVO_FILE_BOZZA_MS\)/,
    "una bozza ancora aperta deve rinnovare periodicamente i propri pending");
  assert.match(frontend, /visibilityState === ["']visible["'][\s\S]{0,100}rinnovaFileBozzeAperte/,
    "il ritorno alla finestra deve rinnovare i pending prima del TTL");
});

test("un drop misto resta legato alla scheda di origine anche durante gli await", () => {
  const misto = corpoFunzione("accodaAggiuntaAllegati");
  assert.match(misto, /const sessione = sessioneAttiva\(\)/);
  assert.match(misto, /await accodaAggiuntaFile\(generici,\s*sessione\)/);
  assert.match(misto, /await accodaAggiuntaImmagini\(immagini,\s*sessione\)/);

  const immagini = corpoFunzione("aggiungiImmagini");
  assert.match(immagini, /APP\.sessioni\.get\(sessione\.id\) === sessione/);
  assert.match(immagini, /sessione\.chiaveBozza === chiaveAttesa/);
  assert.doesNotMatch(immagini, /sessioneAttiva\(\) !== sessione/,
    "la lettura FileReader non deve spostare l'immagine sulla scheda diventata visibile");
  assert.ok(
    immagini.indexOf("sessioneAncoraValida()")
      < immagini.indexOf("await Promise.all(accettati.map(leggiImmagine))"),
    "la scheda di origine va verificata sia prima sia dopo FileReader",
  );
  assert.ok(
    immagini.lastIndexOf("sessioneAncoraValida()")
      > immagini.indexOf("await Promise.all(accettati.map(leggiImmagine))"),
    "la scheda di origine va ricontrollata dopo FileReader",
  );
});

test("Ctrl+V incolla screenshot come allegati senza intercettare il normale testo", () => {
  assert.match(html, /Ctrl\+V per incollare uno screenshot/i,
    "il composer deve rendere la funzione scopribile");
  assert.match(frontend, /SUGGERIMENTO_PREDEFINITO\s*=\s*["'][^"']*Ctrl\+V/,
    "il suggerimento deve restare visibile dopo aver chiuso la palette comandi");

  assert.ok(html.indexOf("/clipboard-core.js") < html.indexOf("/app.js"),
    "il core della clipboard deve essere caricato prima del frontend");
  assert.match(clipboardCore, /clipboardData\.items/,
    "la sorgente primaria deve essere DataTransferItemList");
  assert.match(clipboardCore, /getAsFile/);
  assert.match(clipboardCore, /clipboardData\.files/,
    "serve il fallback DataTransfer.files di WebView2");
  assert.match(clipboardCore, /TIPI_IMMAGINE_SUPPORTATI/,
    "il paste non deve ampliare i MIME gia ammessi dal selettore");

  const inizio = frontend.indexOf('DOM.input.addEventListener("paste"');
  const fine = frontend.indexOf('DOM.input.addEventListener("input"', inizio);
  assert.ok(inizio >= 0 && fine > inizio, "manca il gestore paste del composer");
  const gestore = frontend.slice(inizio, fine);
  assert.ok(gestore.indexOf("if (!immagini.length) return") < gestore.indexOf("preventDefault"),
    "incollare solo testo deve mantenere il comportamento nativo del textarea");
  assert.match(gestore, /DOM\.azioneAllegaImmagine\.disabled/,
    "Ctrl+V deve rispettare gli stessi blocchi del pulsante allega");
  assert.match(gestore, /await accodaAggiuntaImmagini\(immagini\)/,
    "file picker e clipboard devono condividere limiti, persistenza e anteprima");
  assert.match(gestore, /testoAssociato/,
    "la policy image-first delle clipboard miste deve essere comunicata all'utente");
  assert.doesNotMatch(gestore, /navigator\.clipboard\.read/,
    "il paste esplicito non deve richiedere permessi permanenti alla clipboard");

  const coda = corpoFunzione("accodaAggiuntaImmagini");
  assert.ok(coda.indexOf("importazioniImmaginiInCorso") < coda.indexOf(".then("),
    "il latch deve essere visibile prima dell'avvio asincrono di FileReader");
  assert.match(coda, /codaImportazioneImmagini/);
  const invio = corpoFunzione("invia");
  assert.ok(invio.indexOf("codaImportazioneImmagini") < invio.indexOf("codaAllegatiBozza"),
    "Invio deve attendere prima la lettura e poi la persistenza dello screenshot");
  assert.ok(invio.indexOf("codaImportazioneImmagini") < invio.indexOf("allegatiInviati"),
    "la fotografia degli allegati non puo precedere il completamento del paste");
  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  assert.match(interfaccia, /!sessione\.importazioniImmaginiInCorso/,
    "il composer deve restare bloccato durante la breve acquisizione asincrona");
});

test("la vista compatta viene caricata prima del frontend", () => {
  assert.ok(html.indexOf('/view-core.js') < html.indexOf('/app.js'));
  assert.match(frontend, /globalThis\.PiGuiViewCore/);
  assert.match(viewCore, /pulisciRispostaAgente/);
  assert.match(viewCore, /statoAttivita/);
});

test("l'updater nativo e controllato dall'utente e non avvia controlli automatici", () => {
  assert.ok(html.indexOf("/updater-core.js") < html.indexOf("/app.js"));
  assert.ok(contenutoCompleto("gruppo-comandi").includes('id="btn-avanzati"'));
  assert.ok(costanteProva("COMANDI_AVANZATI").includes("aggiornamenti"));
  assert.match(corpoFunzione("eseguiComandoNavigazione"), /nome === "aggiornamenti"\) return apriAggiornamenti\(\)/u);
  assert.match(frontend, /globalThis\.PI_GUI_UPDATER/u);
  const apertura = corpoFunzione("apriAggiornamenti");
  assert.match(apertura, /invocaTauri\("updater_status"\)/u,
    "aprire il pannello deve leggere solo lo stato locale");
  assert.match(apertura, /esegui\("updater_check"\)/u);
  assert.match(apertura, /esegui\("updater_download"\)/u);
  assert.match(apertura, /invocaTauri\("updater_install"\)/u);
  assert.match(apertura, /conferma\(/u,
    "l'installazione deve avere una conferma distinta dal download");
  assert.doesNotMatch(frontend, /(?:DOMContentLoaded|window\.onload)[\s\S]{0,300}updater_check/u,
    "il controllo non deve partire automaticamente all'avvio");
  assert.match(updaterCore, /Il controllo parte soltanto quando lo richiedi/u);
  assert.match(updaterCore, /firma verificata/u);
});

test("la GUI non lascia che Pi trasformi silenziosamente gli allegati in image omitted", () => {
  const corrente = corpoFunzione("modelloCorrenteSessione");
  assert.match(corrente, /stato\.provider\s*===\s*sessione\.provider/,
    "un get_state precedente non deve decidere la capacita dopo un cambio modello a caldo");
  assert.match(corrente, /stato\.id\s*===\s*sessione\.modello/);
  const supporto = corpoFunzione("supportoImmaginiSessione");
  assert.match(supporto, /supportoImmaginiModello\(modelloCorrenteSessione\(sessione\)\)/,
    "la capacita deve essere tratta dai metadati autorevoli del modello");
  assert.match(clipboardCore, /supportoImmaginiModello/);
  assert.match(clipboardCore, /input\.includes\(["']image["']\)/);

  const avviso = corpoFunzione("avvisaModelloSenzaImmagini");
  assert.match(avviso, /supportoImmaginiSessione\(sessione\)\s*!==\s*false/,
    "un catalogo non ancora caricato non deve produrre un falso blocco");
  assert.match(avviso, /image omitted/,
    "il messaggio deve spiegare esattamente cio che farebbe Pi");
  assert.match(avviso, /Scegli modello/);

  const menu = corpoFunzione("eseguiAzioneMenuComposer");
  assert.ok(menu.indexOf("avvisaModelloSenzaImmagini") < menu.indexOf("scegliImmagini.click"),
    "il selettore file non deve aprirsi per un modello noto come solo testo");
  const coda = corpoFunzione("accodaAggiuntaImmagini");
  assert.ok(coda.indexOf("avvisaModelloSenzaImmagini") < coda.indexOf("importazioniImmaginiInCorso"),
    "anche paste e ritorno dal picker devono essere fermati prima di FileReader");
  const invio = corpoFunzione("invia");
  assert.ok(invio.indexOf("immaginiAllegate.length && avvisaModelloSenzaImmagini")
    < invio.indexOf("const allegatiInviati"),
  "il cambio modello a caldo deve lasciare le immagini in bozza senza bloccare i file generici");
});

test("Ricarica risorse resta raggiungibile da Comandi e conserva la conversazione", () => {
  const ricarica = elementoConId("btn-ricarica-risorse");
  assert.equal(ricarica?.tag, "button");
  assert.equal(ricarica?.attributi.get("type"), "button");
  assert.equal(ricarica?.attributi.get("data-azione"), "ricarica");
  assert.match(corpoElementoSemplice("gruppo-comandi"), /id="btn-avanzati"/);
  assert.match(corpoElementoSemplice("gruppo-comandi"), /id="btn-ricarica-risorse"/,
    "Ricarica resta raggiungibile da Comandi insieme ad Avanzati");
  const testoControllo = [
    ricarica?.attributi.get("aria-label") || "",
    ricarica?.attributi.get("title") || "",
    corpoElementoSemplice("btn-ricarica-risorse"),
  ].join(" ");
  for (const risorsa of ["estensioni", "skill", "prompt", "temi", "configurazioni"]) {
    assert.match(testoControllo, new RegExp(risorsa, "i"), `il controllo deve spiegare che ricarica ${risorsa}`);
  }
  assert.match(testoControllo, /senza (?:perdere|chiudere) la conversazione/i,
    "tooltip e nome accessibile devono rassicurare sulla conservazione della conversazione");
  assert.match(frontend, /btnRicaricaRisorse:\s*\$\(["']#btn-ricarica-risorse["']\)/,
    "il controllo deve essere incluso nella mappa DOM del frontend");
  const instradamento = corpoFunzione("eseguiAzione");
  assert.match(instradamento, /azione\s*===\s*["']ricarica["'][\s\S]*ricaricaRisorsePi\(\)/,
    "la voce Strumenti deve attivare il workflow dedicato attraverso data-azione");

  const workflow = corpoFunzione("ricaricaRisorsePi");
  assert.match(workflow, /trovaComandoCatalogo\(sessione,\s*["']reload["']\)/,
    "il refresh deve risolvere il built-in reload dal catalogo corrente");
  assert.match(workflow,
    /invocaComandoBuiltin\(sessione,\s*comando,\s*["']["'],\s*["']\/reload["']\)/,
    "le skill devono essere ricaricate dal built-in di Pi, non da una sola GET del catalogo");
  assert.doesNotMatch(workflow,
    /^\s*await\s+caricaCapacita\(sessione,\s*\{\s*refresh:\s*true\s*\}\)\s*;?\s*$/,
    "caricaCapacita da sola non ricarica le risorse di Pi");

  assert.match(workflow, /const\s+(?:snapshot|(?:catalogo|comandi)(?:Precedente|Verificato|Snapshot))\s*=/i,
    "prima del reload va conservata la fotografia del catalogo verificato");
  const gestioneErrore = workflow.match(/catch\s*(?:\([^)]*\))?\s*\{([\s\S]*)$/)?.[1] || "";
  assert.match(gestioneErrore, /sessione\.comandi\s*=/,
    "un reload fallito deve ripristinare esplicitamente i comandi precedenti");
  assert.match(gestioneErrore, /(?:catalogo|comandi)(?:Precedente|Verificato|Snapshot)|snapshot(?:\.(?:comandi|revisioneCapacita|capacitaComplete))?/i,
    "il ramo di errore deve riusare la fotografia, non svuotare il pannello");
  assert.doesNotMatch(gestioneErrore, /sessione\.comandi\s*=\s*\[\s*\]/,
    "un errore non deve cancellare le skill gia visibili");
  assert.match(workflow, /La conversazione resta aperta/,
    "l'avvio deve dare un feedback esplicito senza suggerire un riavvio");

  const esito = corpoFunzione("gestisciEsitoRpcBuiltin");
  assert.match(esito, /Estensioni, skill, prompt, temi e configurazioni ricaricati/,
    "l'esito positivo deve confermare tutte le risorse ricaricate");
  assert.match(esito, /conversazione [èe] rimasta aperta/,
    "l'esito positivo deve confermare che la conversazione e stata conservata");

  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  assert.match(interfaccia,
    /DOM\.btnRicaricaRisorse\.disabled\s*=\s*!utilizzabile[\s\S]*sessione\?\.inEsecuzione|DOM\.btnRicaricaRisorse\.disabled\s*=\s*[^;]*sessione\?*\.?inEsecuzione/,
    "Ricarica estensioni deve essere disabilitato mentre Pi sta generando una risposta");
  assert.match(interfaccia, /btnRicaricaRisorse\.setAttribute\(["']aria-busy["']/,
    "il ricaricamento in corso deve essere comunicato alle tecnologie assistive");
  assert.match(interfaccia, /Ricaricamento…/,
    "l'etichetta visibile deve confermare che il comando e in corso");
});

test("la palette slash e inline, dinamica e completamente utilizzabile da tastiera", () => {
  assert.ok(html.indexOf("/palette-core.js") < html.indexOf("/app.js"),
    "il core puro deve essere caricato prima del frontend");
  const aggiorna = corpoFunzione("aggiornaPaletteComandi");
  assert.match(aggiorna, /analizzaRichiamoComando/);
  assert.match(aggiorna, /filtraCatalogoComandi\(sessione\.comandi/,
    "i risultati devono provenire dal catalogo della sessione");
  assert.match(aggiorna, /sessione\.revisioneCapacita/,
    "il rendering deve essere legato alla revisione della sessione");

  const selezione = corpoFunzione("inserisciComandoNelComposer");
  assert.match(selezione, /APP\.sessioni\.get\(sessionId\)/);
  assert.match(selezione, /sessione\.id !== APP\.attivaId/,
    "un click obsoleto non deve scrivere nella nuova scheda");
  assert.match(selezione, /trovaComandoPerChiave/,
    "la voce va riletta dal catalogo corrente");

  assert.match(frontend, /evento\.isComposing\s*\|\|\s*composizioneInputInCorso/);
  for (const tasto of ["ArrowDown", "ArrowUp", "Home", "End", "Escape", "Tab", "Enter"]) {
    assert.match(frontend, new RegExp(`evento\\.key === ["']${tasto}["']`), `manca la semantica ${tasto}`);
  }
  for (const classe of ["composer-shell", "palette-comandi", "palette-opzione", "palette-descrizione", "palette-categoria"]) {
    assert.match(stile, new RegExp(`\\.${classe}(?:[^\\w-]|$)`), `manca lo stile .${classe}`);
  }
  const regolaOpzione = stile.match(/\.palette-opzione\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.match(regolaOpzione, /width:\s*100%/,
    "ogni risultato deve occupare tutta la larghezza della palette");
  assert.match(regolaOpzione, /background:\s*transparent/,
    "lo sfondo globale dei button non deve creare righe irregolari");
});

test("built-in, estensioni verificate e shell vengono intercettati prima di cronologia e invii pendenti", () => {
  const invio = corpoFunzione("invia");
  const intercetta = invio.indexOf("gestisciComandoComposer");
  assert.ok(intercetta >= 0, "manca l'intercettazione del composer");
  assert.ok(intercetta < invio.indexOf("aggiungiMessaggio"));
  assert.ok(intercetta < invio.indexOf("registraInvioPendente"));

  const gestore = corpoFunzione("gestisciComandoComposer");
  assert.match(gestore, /!\{1,2\}/);
  assert.match(gestore, /excludeFromContext:\s*shell\[1\]\s*===\s*["']!!["']/);
  assert.match(gestore, /\["skill",\s*"prompt"\]/,
    "skill e prompt devono continuare lungo il normale invio");
  assert.match(gestore, /\["builtin",\s*"extension"\]\.includes\(comando\.source\)/,
    "built-in ed estensioni devono attraversare lo stesso endpoint verificato");
  assert.match(gestore, /invocaComandoBuiltin\(sessione,\s*comando,\s*richiamo\.arguments,\s*fotografia\)/,
    "la disponibilita GUI o terminale deve essere decisa dal catalogo autorevole del ponte");
  assert.doesNotMatch(gestore, /rpc\(\s*\{\s*type:\s*["']prompt["']/,
    "il frontend non deve inviare direttamente un comando extension grezzo");
  assert.match(gestore, /sessione\.allegati\.length/,
    "immagini e comandi non devono separarsi silenziosamente");

  const invoca = corpoFunzione("invocaComandoBuiltin");
  assert.match(invoca, /preparaAttesaRpcEsterna/);
  assert.ok(invoca.indexOf("preparaAttesaRpcEsterna") < invoca.indexOf("/api/invoca-comando"),
    "l'attesa SSE va registrata prima del POST");
  assert.ok(invoca.indexOf("registraInvioPendente") < invoca.indexOf("/api/invoca-comando"),
    "il registro exactly-once deve essere persistito prima del POST");
  assert.match(invoca, /creaRegistroComandoBuiltin/);
  assert.match(invoca, /lineageId:\s*sessione\.lineageId/);
  assert.match(invoca, /catalogRevision/);
  assert.match(invoca, /attesa\.stato\.conclusa/,
    "un ack anticipato deve restare autorevole se la risposta HTTP si perde");
  const attendeAck = invoca.indexOf("risultatoRpcAnticipato ?? await attesa.promessa");
  const risolveDopoAck = invoca.indexOf("dimenticaCopiaSicurezzaVerificata", attendeAck);
  assert.ok(attendeAck >= 0 && attendeAck < risolveDopoAck,
    "marker e safety draft non vanno risolti prima dell'ack RPC");
  assert.match(invoca, /erroreCatalogoComandiObsoleto/);
  assert.match(invoca, /caricaCapacita\(sessione, \{ refresh: false \}\)/,
    "un 409 stale aggiorna il catalogo senza rieseguire il comando");
  assert.doesNotMatch(invoca, /return\s+invocaComandoBuiltin\(/,
    "un comando con catalogo stale non deve avere auto-retry");

  const risposta = corpoFunzione("aggiornaDaRisposta");
  assert.match(risposta, /invioCorrelato\?\.origine === ["']builtin["']/);
  assert.match(risposta, /gestisciAckComandoBuiltinSenzaAttesa/,
    "ack live tardivi e guiReplay devono usare il registro persistito");
  const riconcilia = corpoFunzione("riconciliaInviiPendenti");
  assert.match(riconcilia, /invioRichiedeVerificaManuale/,
    "un built-in non deve essere scambiato per un normale messaggio user");
  assert.ok(
    riconcilia.indexOf("!sessione.inviiNascosti.has(invio.id)")
      < riconcilia.indexOf("dimenticaInvioPendente(sessione, invio.id)"),
    "la visibilita della safety-copy va letta prima che la riconciliazione la dimentichi",
  );
  assert.match(
    riconcilia,
    /if \(notificaRiconciliazione && sessione\.id === APP\.attivaId\)/,
    "la conferma di un normale invio live nascosto non deve produrre un toast di recupero",
  );
  const safety = corpoFunzione("dimenticaCopiaSicurezzaVerificata");
  assert.match(safety, /lineageRecordBozza\(recordSicurezza\) === invio\.lineageId/,
    "l'ack non deve cancellare una nuova bozza identica con lineage diversa");

  const bash = corpoFunzione("eseguiBash");
  assert.ok(bash.indexOf("registraInvioPendente") < bash.indexOf("await rpc"),
    "! e !! devono persistere il journal prima della POST RPC");
  assert.match(bash, /creaRegistroShell/);
  assert.match(bash, /id,\s*\n\s*operationId,\s*\n\s*excludeFromContext:\s*Boolean\(excludeFromContext\)/,
    "la shell deve riusare ID e operationId del journal e conservare la semantica !!");
  assert.match(risposta, /invioCorrelato\?\.origine === ["']shell["']/);
  assert.match(risposta, /gestisciAckShellSenzaAttesa/);

  const chiedi = corpoFunzione("chiedi");
  assert.match(chiedi, /errore\.statusHttp = risposta\.status/);
  assert.match(chiedi, /errore\.code = codice/);
});

test("le risposte rendono cliccabili web e percorsi locali senza navigazione diretta", () => {
  assert.ok(html.indexOf('src="/link-core.js"') < html.indexOf('src="/app.js"'),
    "il classificatore puro deve essere disponibile prima del renderer");
  assert.match(frontend, /globalThis\.PiGuiLinkCore/);
  assert.match(frontend, /prossimaDestinazioneAutomatica/);
  assert.match(linkCore, /\["http:",\s*"https:",\s*"mailto:"\]/);
  assert.match(linkCore, /url\.protocol === "file:"/);
  assert.match(linkCore, /consentiRelativo/);

  const creaLink = corpoFunzione("creaCollegamentoGui");
  assert.match(creaLink, /crea\("button",\s*"link-locale",\s*etichetta\)/,
    "un percorso locale non deve avere un href navigabile");
  assert.match(creaLink, /collegamento\.type = "button"/);

  const inline = corpoFunzione("aggiungiInline");
  assert.match(inline, /LINK_CORE\.creaEspressioneInline\(\)/);
  assert.match(inline, /LINK_CORE\.analizzaTokenCollegamento\(token\)/);
  assert.match(inline, /collegamento \|\| document\.createTextNode\(link\?\.etichetta \|\| token\)/,
    "un target non valido deve restare testo, non un anchor inerte");

  const render = corpoFunzione("renderMarkdown");
  assert.match(render, /sessionId:\s*sessione\?\.id/);
  assert.match(render, /sessione\?\.cartella\s*&&\s*!sessione\?\.senzaCartella/);
  const apertura = corpoFunzione("collegaBrowserSistema");
  assert.match(apertura, /confirmed:\s*true/);
  assert.match(apertura, /\.\.\.\(sessionId \? \{ sessionId \} : \{\}\)/);
  assert.match(apertura, /aria-busy/);
  assert.doesNotMatch(apertura, /href\s*=\s*tipo === "web"\s*\?/,
    "il percorso locale non deve avere un fallback href");

  assert.match(stile, /\.markdown \.link-locale/);
  assert.match(stile, /:focus-visible/);
  assert.match(stile, /\[aria-busy="true"\]/);
});

test("i workflow built-in e i segreti delle estensioni hanno superfici GUI dedicate", () => {
  const workflow = corpoFunzione("eseguiWorkflowComando");
  for (const azione of [
    "model-picker", "scoped-models-picker", "export-picker", "import-picker",
    "share-session", "show-changelog", "show-hotkeys", "fork-picker", "tree-picker",
    "project-trust", "provider-login", "provider-logout", "resume-picker", "close-session",
  ]) assert.match(workflow, new RegExp(azione), `workflow non cablato: ${azione}`);

  const dialogo = corpoFunzione("mostraProssimoDialogoEstensione");
  assert.match(dialogo, /evento\.sensitive\s*\?\s*["']password["']/,
    "le credenziali non devono essere visibili in chiaro");
  const autenticazione = corpoFunzione("mostraNotificaAutenticazione");
  assert.match(autenticazione, /auth_url/);
  assert.match(autenticazione, /device_code/);
  assert.match(autenticazione, /Copia codice/);
  assert.match(corpoFunzione("urlAutenticazioneSicuro"), /\["http:",\s*"https:"\]/,
    "i collegamenti di autenticazione devono avere protocolli web espliciti");
  assert.match(corpoFunzione("scegliRiassuntoNavigazioneAlbero"), /type:\s*["']navigate_tree["']/);
  assert.match(corpoFunzione("mostraAlberoSessione"), /type:\s*["']set_label["']/);
  assert.match(corpoFunzione("apriEsportazionePi"), /\.jsonl\$\/i/);
  assert.match(corpoFunzione("apriEsportazionePi"), /outputPath/);
});

test("il journal workflow resta aperto fino al vero side effect e riconcilia il replay durevole", () => {
  const invoca = corpoFunzione("invocaComandoBuiltin");
  const ramoWorkflow = invoca.slice(
    invoca.indexOf('dati?.mode === "workflow"'),
    invoca.indexOf('dati?.mode === "terminal"'),
  );
  assert.match(ramoWorkflow, /creaOperazioneWorkflow/);
  assert.doesNotMatch(ramoWorkflow, /dimenticaCopiaSicurezzaVerificata/,
    "il solo routing HTTP non deve risolvere il journal");

  const operazione = corpoFunzione("creaOperazioneWorkflow");
  assert.match(operazione, /operationIdPasso/);
  assert.match(operazione, /rpcId\s*=\s*idRpc\(\)/,
    "ogni RPC effettiva deve avere una correlation nuova");
  assert.match(operazione, /persistiInvioPendente\(sessione,\s*aggiornato\)/);
  assert.ok(operazione.indexOf("persistiInvioPendente") < operazione.indexOf("return rpc("),
    "step e operationId vanno persistiti prima di contattare Pi");
  assert.match(operazione, /mutating\s*=\s*!String/);
  assert.match(operazione, /workflowRisolviSuAck:\s*Boolean\(finalStep\)/);

  const poll = corpoFunzione("attendiOperazioneServer");
  assert.match(poll, /\/api\/stato-operazione/);
  assert.match(poll, /operation\.status === ["']completed["']/);
  const reload = corpoFunzione("riconciliaOperazioniPersistite");
  assert.match(reload, /workflowOperationId\s*\|\|\s*corrente\.operationId/);
  assert.match(reload, /aggiornaDaRisposta/,
    "l'esito durevole deve attraversare la stessa logica degli ack SSE");
  const risposta = corpoFunzione("aggiornaDaRisposta");
  assert.match(risposta, /workflowRpcId === evento\.id/);
  assert.match(risposta, /workflowRisolviSuAck === false/,
    "un ack di un passo intermedio non deve chiudere il workflow");
});

test("settings, modelli, tree e resume mantengono la parita operativa di Pi", () => {
  const settings = corpoFunzione("apriImpostazioniPi");
  for (const nome of [
    "autoCompaction", "autoRetry", "steeringMode", "followUpMode", "blockImages",
    "autoResizeImages", "enableSkillCommands", "transport", "httpIdleTimeoutMs",
  ]) assert.match(settings, new RegExp(nome), `impostazione Pi non esposta: ${nome}`);
  assert.match(settings, /step:\s*`settings:\$\{name\}`/);
  assert.match(settings, /caricaCapacita\(sessione,\s*\{ refresh: true \}\)/,
    "abilitare/disabilitare i comandi skill deve ricostruire il catalogo");

  const catalogo = corpoFunzione("preparaCatalogoModelliDinamico");
  assert.match(catalogo, /type:\s*["']refresh_models["']/);
  assert.ok(catalogo.indexOf("apriModale") < catalogo.indexOf("refresh_models"),
    "il picker deve aprirsi subito sulla fotografia corrente");
  assert.match(catalogo, /sessione\.modelli = snapshot/,
    "un refresh fallito non deve sostituire il catalogo verificato");
  assert.match(catalogo, /risultato\.onAggiorna\?\.\(\)/,
    "l'elenco aperto deve aggiornarsi senza perdere il filtro");

  const tree = corpoFunzione("scegliRiassuntoNavigazioneAlbero");
  for (const scelta of ["none", "summary", "custom"]) {
    assert.match(tree, new RegExp(`["']${scelta}["']`), `manca la scelta tree ${scelta}`);
  }
  assert.match(tree, /customInstructions/);
  assert.match(tree, /abort_branch_summary/);
  assert.match(tree, /esito\.editorText/);

  const resume = corpoFunzione("apriRipresaConversazione");
  assert.match(resume, /Apri in una nuova scheda/);
  assert.match(resume, /Riprendi in questa scheda/);
  assert.match(resume, /type:\s*["']switch_session["']/);
  assert.match(resume, /operationId/);
});

test("il contesto dei modelli è dinamico e il cambio sotto pressione resta sicuro", () => {
  const snapshot = corpoFunzione("applicaSnapshot");
  assert.match(corpoFunzione("unisciSessione"), /catalogoModelliDaRicaricare/,
    "dopo F5 la guardia deve essere recuperata dallo stato del ponte");
  assert.match(snapshot, /contestoGptDaRicaricare[\s\S]*?aggiornaCatalogoContestoGptSessione/,
    "lo snapshot deve riprendere la verifica del catalogo ancora pendente");
  assert.doesNotMatch(frontend, /function\s+(?:modelloGpt56Configurabile|creaGestioneContestoEstesoGpt)\s*\(/,
    "la GUI non deve ripristinare il vecchio selettore universale del contesto GPT");
  for (const nome of ["apriSceltaModello", "preparaCatalogoModelliDinamico", "dettaglioModello", "pressioneContestoCambioModello"]) {
    assert.doesNotMatch(corpoFunzione(nome), /gpt-5\.6|GPT-5\.6|gpt-6-astra|GPT-6 Astra|\/api\/contesto-esteso-gpt|cost\??\.tiers|1[._]050[._]000|272[._]000/,
      `il picker generico non deve contenere una politica dedicata al contesto GPT: ${nome}`);
  }
  assert.doesNotMatch(frontend, /Conferma 1,05M|Usa 1\.050\.000 token/,
    "il vecchio interruttore universale 272k/1,05M deve restare assente");
  assert.doesNotMatch(frontend, /\b(?:272_000|1_050_000)\b/,
    "il frontend non deve imporre finestre di contesto codificate");

  const informazione = corpoFunzione("creaInformazioneContestoModelli");
  assert.match(informazione, /finestraModelloSessione\(sessione\)/,
    "il pannello deve mostrare la finestra effettiva della sessione");
  assert.match(informazione, /Number\.isFinite\(finestra\)[\s\S]*?`\$\{numero\(finestra\)\} token`/,
    "una finestra valida deve essere resa dinamicamente");
  assert.match(informazione, /finestra restituita dal catalogo effettivo di Pi/);
  assert.match(informazione, /Il limite segue il catalogo effettivo del modello/);
  assert.match(informazione, /modello attuale prima di effettuare il cambio/,
    "il pannello deve spiegare la compattazione preventiva");
  assert.match(informazione, /conserva il modello precedente/,
    "il pannello deve descrivere il fallimento atomico dello switch");
  assert.match(informazione, /modello\?\.provider !== "openai"[\s\S]*?!statoApi\.managedModelIds\.includes\(modello\.id\)\) return;/,
    "l'unico interruttore del pannello deve riguardare i modelli indicati dal server sul provider API");
  assert.doesNotMatch(frontend, /\bgpt-(?:5\.6-(?:sol|terra|luna)|6-astra)\b/,
    "il frontend non deve contenere una lista scritta a mano degli id dei modelli gestiti");
  assert.match(informazione, /Usa il contesto esteso di GPT-5\.6 Sol, Terra e Luna e GPT-6 Astra in API \(1\.050\.000 token\)/);
  assert.match(informazione, /cost[\s\S]*?\.tiers[\s\S]*?inputTokensAbove/,
    "soglia e prezzi lunghi devono provenire dal catalogo");
  assert.match(informazione, /l'intera richiesta usa la tariffa lunga/);
  assert.match(informazione, /corpo: \{ enabled, sessionId: sessione\.id \}/,
    "la GUI deve chiedere una scelta API, senza inventare una finestra numerica");
  assert.match(informazione, /await aggiornaCataloghiContestoGptAperti\(\)[\s\S]*?if \(esiti\.errori \|\| sessione\.contestoGptDaRicaricare\)/,
    "la scelta scritta richiede ancora la conferma effettiva del catalogo");
  const cataloghiAperti = corpoFunzione("aggiornaCataloghiContestoGptAperti");
  assert.match(cataloghiAperti, /APP\.sessioni\.values\(\)[\s\S]*?sessione\.attiva/);
  assert.match(cataloghiAperti, /for \(const sessione of aperte\) sessione\.contestoGptDaRicaricare = true/);
  assert.match(cataloghiAperti, /Promise\.allSettled[\s\S]*?aggiornaCatalogoContestoGptSessione\(sessione\)/,
    "un errore in una scheda non deve interrompere l'aggiornamento delle altre");
  assert.match(cataloghiAperti, /esito\.value\?\.pendente/);
  assert.match(informazione, /La scelta API è salvata, ma Pi deve ancora confermare il catalogo/,
    "un errore di refresh non deve essere presentato come fallimento della scrittura");
  assert.match(stile, /\.contesto-esteso-gpt\s*\{/);

  const pressione = corpoFunzione("pressioneContestoCambioModello");
  assert.match(pressione, /VISTA_CORE\.pianoCambioModello\(\{/,
    "la decisione deve provenire dall'helper puro condiviso");
  assert.match(pressione, /modelloCorrente:\s*modelloCorrenteSessione\(sessione\)/);
  assert.match(pressione, /modelloDestinazione:\s*modello/);
  assert.match(pressione, /riservaToken:\s*RISERVA_CAMBIO_MODELLO/);
  assert.match(pressione, /chiaveModello\(sessione\?\.modelloStatistiche\)[\s\S]*?chiaveModello\(modelloCorrenteSessione\(sessione\)\)/,
    "statistiche appartenenti a un altro modello non devono guidare il cambio");
  assert.match(pressione, /if \(!piano\.compatta\) return null/);
  assert.match(viewCore, /function pianoCambioModello\s*\(/);
  assert.match(viewCore, /const budget\s*=\s*finestra == null\s*\?\s*null\s*:\s*Math\.max\(0, finestra - riservaValida\)/);
  assert.match(viewCore, /!stessaIdentita[\s\S]*?usati > budget/,
    "lo stesso modello non deve compattare e il budget deve includere la riserva");
  assert.match(viewCore, /pianoCambioModello,/,
    "l'helper deve essere parte dell'API di view-core");

  const scelta = corpoFunzione("apriSceltaModello");
  assert.match(scelta, /creaInformazioneContestoModelli\(sessione/);
  assert.match(scelta, /preparazione\.onAggiorna\s*=\s*\(\)\s*=>\s*\{[\s\S]*?informazioneContesto\.aggiorna\(\)/,
    "il pannello deve seguire gli aggiornamenti del catalogo");
  assert.match(scelta, /informazioneContesto\.onCatalogoAggiornato = \(\) => preparazione\.onAggiorna\?\.\(\)/,
    "il refresh della scelta API deve ridisegnare anche la lista dei modelli");
  assert.match(scelta, /const pressioneAggiornata\s*=\s*pressioneContestoCambioModello\(sessione, modello\)/,
    "la pressione va ricontrollata al click, non congelata al rendering");
  assert.match(scelta, /type:\s*["']set_model["'][\s\S]*?timeout:\s*6 \* 60 \* 1000/,
    "il cambio sicuro può includere una compattazione e necessita di un timeout adeguato");
  assert.doesNotMatch(scelta, /type:\s*["']compact["']/,
    "la UI deve delegare al ponte lo switch atomico senza compattazioni separate");
  assert.ok(scelta.indexOf('type: "set_model"') < scelta.indexOf("ricordaModello(modello)"),
    "il modello recente va memorizzato soltanto dopo lo switch confermato");
  assert.ok(scelta.indexOf("ricordaModello(modello)") < scelta.indexOf("chiudiModale({ annulla: false })"),
    "la modale deve chiudersi soltanto dopo il successo");
  assert.match(scelta, /catch \(errore\)[\s\S]*?bottone\.disabled\s*=\s*false/,
    "un errore deve lasciare il picker aperto e nuovamente utilizzabile");
  assert.match(scelta, /Contesto riassunto con il modello precedente/);
});

test("il picker mostra un solo toast quando il cambio modello fallisce via HTTP dopo gli eventi SSE intermedi", async () => {
  const { creaNodo, documento } = alberoProva();
  const precedente = { provider: "fake", id: "grande", contextWindow: 272000 };
  const destinazione = { provider: "fake", id: "piccolo", contextWindow: 32000 };
  const sessione = {
    id: "s1", provider: precedente.provider, modello: precedente.id,
    modelli: [destinazione], statoRpc: {}, inviiPendenti: [],
  };
  const app = { attivaId: sessione.id, sessioni: new Map([[sessione.id, sessione]]), attese: new Map() };
  const corpo = creaNodo("section");
  const notifiche = [];
  const richieste = [];
  const eventiElaborati = [];
  const vistaCore = new Function("module", `${viewCore}; return module.exports;`)({ exports: {} });
  let interfaccia;
  const ambiente = {
    APP: app, VISTA_CORE: vistaCore, COMANDI_CAMBIO_SESSIONE: new Set(), document: documento,
    sessioneAttiva: () => sessione,
    preparaCatalogoModelliDinamico: () => ({ corpo, statiProvider: {} }),
    creaInformazioneContestoModelli: () => ({ elemento: creaNodo("section"), aggiorna() {} }),
    crea: creaNodo, localStorage: { getItem: () => null },
    modelloLocale: () => false, nomeModello: (modello) => modello.id, dettaglioModello: () => "",
    pressioneContestoCambioModello: () => ({ testo: "È necessario riassumere prima del cambio." }),
    avvisa() {}, requestAnimationFrame: (callback) => callback(),
    toast: (testo, tipo) => notifiche.push({ testo, tipo }),
    ricordaModello: () => assert.fail("un cambio rifiutato non deve essere memorizzato"),
    chiudiModale: () => assert.fail("un cambio rifiutato deve lasciare aperto il picker"),
    idRpc: () => "scelta1", chiaveAttesa: (id, comandoId) => `${id}:${comandoId}`,
    programmaTimeoutAttesa() {},
    confermaRipresaDopoCompattazione() {},
    applicaModelloSessione: (corrente, modello) => {
      corrente.provider = modello.provider;
      corrente.modello = modello.id;
    },
    aggiornaIdentitaBozza() {}, disegnaNavigazione() {}, aggiornaInterfacciaAttiva() {},
    chiedi: async (via, opzioni) => {
      richieste.push({ via, comando: opzioni.corpo });
      // Le risposte riuscite restano pubbliche; l'errore del compact interno
      // viene restituito soltanto dalla richiesta HTTP del cambio controllato.
      for (const [command, data] of [
        ["get_state", { model: precedente, sessionName: "Conversazione precedente" }],
        ["get_available_models", { models: [precedente, destinazione] }],
        ["get_available_thinking_levels", { levels: ["low", "high"] }],
      ]) {
        interfaccia.gestisciEvento({
          type: "response", id: `interno-${command}`, guiSessionId: sessione.id,
          command, success: true, data,
        });
        eventiElaborati.push(command);
      }
      assert.equal(app.attese.size, 1, "le risposte interne non devono completare l'attesa del picker");
      assert.deepEqual(notifiche, [], "le risposte intermedie riuscite non devono generare toast");
      throw Object.assign(new Error("Nothing to compact"), { statusHttp: 409 });
    },
  };
  interfaccia = new Function("ambiente", `
    const { ${Object.keys(ambiente).join(", ")} } = ambiente;
    function testoErrore(errore) { ${corpoFunzione("testoErrore")} }
    function spiegaErrorePi(errore, sessione) { ${corpoFunzione("spiegaErrorePi")} }
    function completaAttesa(evento) { ${corpoFunzione("completaAttesa")} }
    function aggiornaDaRisposta(sessione, evento) { ${corpoFunzione("aggiornaDaRisposta")} }
    function gestisciEvento(evento) { ${corpoFunzione("gestisciEvento")} }
    function inizializzaGruppoScelta(lista, etichetta) { ${corpoFunzione("inizializzaGruppoScelta")} }
    async function rpc(comando, { sessionId = APP.attivaId, timeout = 30000 } = {}) { ${corpoFunzione("rpc")} }
    async function apriSceltaModello(filtroIniziale = "", operazione = null, sessioneRichiesta = null) { ${corpoFunzione("apriSceltaModello")} }
    return { apriSceltaModello, gestisciEvento };
  `)(ambiente);
  await interfaccia.apriSceltaModello();
  const nodi = (nodo) => [nodo, ...nodo.children.flatMap(nodi)];
  const bottone = nodi(corpo).find((nodo) => nodo.tag === "button");
  await bottone.onclick();
  assert.deepEqual(richieste, [{
    via: "/api/comando",
    comando: { type: "set_model", provider: "fake", modelId: "piccolo", id: "scelta1", sessionId: "s1" },
  }]);
  assert.deepEqual(eventiElaborati, ["get_state", "get_available_models", "get_available_thinking_levels"]);
  assert.equal(sessione.nomeSessione, "Conversazione precedente");
  assert.deepEqual(sessione.modelli, [precedente, destinazione]);
  assert.deepEqual(sessione.livelli, ["low", "high"]);
  assert.deepEqual(notifiche, [{ testo: "La conversazione è ancora troppo breve per essere riassunta.", tipo: "errore" }]);
  assert.equal(bottone.disabled, false);
  assert.equal(sessione.modello, precedente.id);
  assert.equal(app.attese.size, 0, "il rifiuto HTTP deve chiudere l'attesa del cambio");
});

test("il pannello API usa le tariffe del modello e conserva la scelta salvata se il catalogo fallisce", async () => {
  const richieste = [];
  const managedModelIds = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra"];
  const creaNodo = (tag, classe = "", textContent = "") => ({
    tag, className: classe, textContent, children: [],
    setAttribute(nome, valore) { this[nome] = valore; },
    append(...nodi) { this.children.push(...nodi); },
    appendChild(nodo) { this.children.push(nodo); return nodo; },
    replaceChildren(...nodi) { this.children = nodi; },
  });
  const nodi = (nodo) => [nodo, ...nodo.children.flatMap(nodi)];
  const testo = (pannello) => nodi(pannello.elemento).map((nodo) => nodo.textContent).join(" ");
  const sessione = {
    id: "sessione-api", contestoGptDaRicaricare: false,
    modello: {
      provider: "openai", id: "gpt-5.6-terra", contextWindow: 272000,
      cost: { input: 2, output: 12, tiers: [{ inputTokensAbove: 272000, input: 4, output: 18 }] },
    },
  };
  let erroreRefresh = false;
  const creaPannello = new Function(
    "crea", "APP", "modelloCorrenteSessione", "finestraModelloSessione", "numero", "chiedi",
    "contestoGptSessioneOccupata", "aggiornaCataloghiContestoGptAperti", "testoErrore", "bottoneAzione",
    `return function(sessione, { nascosto = false } = {}) { ${corpoFunzione("creaInformazioneContestoModelli")} };`,
  )(
    creaNodo, { modale: {} }, (corrente) => corrente.modello, (corrente) => corrente.modello.contextWindow,
    (valore) => valore.toLocaleString("it-IT"),
    async (via, { corpo }) => {
      richieste.push({ via, corpo });
      return { managedModelIds, enabled: corpo.enabled === true, mutable: true, conflict: false, refreshRequired: Object.hasOwn(corpo, "enabled") };
    },
    () => false,
    async () => {
      sessione.contestoGptDaRicaricare = erroreRefresh;
      return { errori: erroreRefresh ? 1 : 0, pendenti: 0, aggiornate: erroreRefresh ? 0 : 1 };
    },
    (errore) => errore.message,
    (etichetta, onclick) => ({ ...creaNodo("button", "", etichetta), onclick }),
  );
  const pannello = creaPannello(sessione);
  let aggiornamentiLista = 0;
  pannello.onCatalogoAggiornato = () => { aggiornamentiLista += 1; };
  pannello.aggiorna();
  await Promise.resolve();
  assert.match(testo(pannello), /Oltre 272\.000 token in ingresso l'intera richiesta/);
  assert.match(testo(pannello), /input 2 -> 4, output 12 -> 18 USD per milione/,
    "Terra deve mostrare le proprie tariffe, senza ereditare quelle di Sol");
  let interruttore = nodi(pannello.elemento).find((nodo) => nodo.type === "checkbox");
  assert.equal(interruttore.checked, false);
  assert.equal(interruttore.disabled, false);
  interruttore.checked = true;
  erroreRefresh = true;
  await interruttore.onchange();
  assert.deepEqual(richieste, [
    { via: "/api/contesto-esteso-gpt", corpo: {} },
    { via: "/api/contesto-esteso-gpt", corpo: { enabled: true, sessionId: sessione.id } },
  ]);
  interruttore = nodi(pannello.elemento).find((nodo) => nodo.type === "checkbox");
  assert.equal(interruttore.checked, true, "la scelta è stata scritta anche se il catalogo non è confermato");
  assert.equal(interruttore.disabled, true, "il catalogo pendente continua a bloccare nuove mutazioni");
  assert.match(testo(pannello), /La scelta API è salvata, ma Pi deve ancora confermare il catalogo/);
  assert.equal(sessione.contestoGptDaRicaricare, true);
  assert.equal(aggiornamentiLista, 1);

  erroreRefresh = false;
  sessione.contestoGptDaRicaricare = false;
  pannello.aggiorna();
  interruttore = nodi(pannello.elemento).find((nodo) => nodo.type === "checkbox");
  interruttore.checked = false;
  await interruttore.onchange();
  assert.deepEqual(richieste.at(-1).corpo, { enabled: false, sessionId: sessione.id });
  assert.equal(nodi(pannello.elemento).find((nodo) => nodo.type === "checkbox").checked, false);
  assert.match(testo(pannello), /Scelta API salvata e cataloghi verificati/);
  assert.equal(aggiornamentiLista, 2);

  const astra = creaPannello({
    ...sessione,
    modello: {
      provider: "openai", id: "gpt-6-astra", contextWindow: 272000,
      cost: { input: 10, output: 50, tiers: [{ inputTokensAbove: 272000, input: 20, output: 75 }] },
    },
  });
  astra.aggiorna();
  await Promise.resolve();
  assert.equal(nodi(astra.elemento).find((nodo) => nodo.type === "checkbox").disabled, false,
    "GPT-6 Astra deve offrire l'interruttore API quando è nella lista del server");
  assert.match(testo(astra), /GPT-5\.6 Sol, Terra e Luna e GPT-6 Astra/);
  assert.match(testo(astra), /input 10 -> 20, output 50 -> 75 USD per milione/,
    "Astra deve mostrare le proprie tariffe dal catalogo");

  for (const modello of [
    { ...sessione.modello, provider: "openai-codex" },
    { ...sessione.modello, id: "altro-modello" },
  ]) {
    const senzaScelta = creaPannello({ ...sessione, modello });
    senzaScelta.aggiorna();
    await Promise.resolve();
    assert.equal(nodi(senzaScelta.elemento).some((nodo) => nodo.type === "checkbox"), false);
    if (modello.provider === "openai-codex") {
      assert.match(testo(senzaScelta), /non viene emessa una fattura per token/);
      assert.match(testo(senzaScelta), /il consumo pesa sui limiti del piano/);
    } else {
      assert.doesNotMatch(testo(senzaScelta), /GPT-5\.6|GPT-6 Astra|tariffa lunga|scelta API/i,
        "un modello fuori lista non deve avere informazioni o controlli dedicati");
    }
  }
  assert.equal(richieste.length, 5,
    "ogni pannello API legge la lista del server, mentre l'account ChatGPT non interroga la scelta API");
});

test("una risposta senza managedModelIds non mostra l'interruttore e non lancia eccezioni", async () => {
  const richieste = [];
  const risposta = { enabled: false, mutable: true, conflict: false };
  let rispostaApi = risposta;
  const creaNodo = (tag, classe = "", textContent = "") => ({
    tag, className: classe, textContent, children: [],
    setAttribute(nome, valore) { this[nome] = valore; },
    append(...nodi) { this.children.push(...nodi); },
    appendChild(nodo) { this.children.push(nodo); return nodo; },
    replaceChildren(...nodi) { this.children = nodi; },
  });
  const nodi = (nodo) => [nodo, ...nodo.children.flatMap(nodi)];
  const creaPannello = new Function(
    "crea", "APP", "modelloCorrenteSessione", "finestraModelloSessione", "numero", "chiedi",
    "contestoGptSessioneOccupata", "aggiornaCataloghiContestoGptAperti", "testoErrore", "bottoneAzione",
    `return function(sessione, { nascosto = false } = {}) { ${corpoFunzione("creaInformazioneContestoModelli")} };`,
  )(
    creaNodo, { modale: {} }, (sessione) => sessione.modello, () => 272000, String,
    async (via, { corpo }) => {
      richieste.push({ via, corpo });
      return rispostaApi;
    },
    () => false, async () => {}, (errore) => errore.message,
    (titolo, onclick) => ({ ...creaNodo("button", "", titolo), onclick }),
  );
  const sessione = {
    id: "sessione-api-astra", invioInCorso: false, contestoGptDaRicaricare: false,
    modello: { provider: "openai", id: "gpt-6-astra" },
  };
  for (const gestito of [false, true]) {
    rispostaApi = gestito ? { ...risposta, managedModelIds: ["gpt-6-astra"] } : risposta;
    let pannello;
    await assert.doesNotReject(async () => {
      pannello = creaPannello(sessione);
      pannello.aggiorna();
      await Promise.resolve();
      pannello.aggiorna();
    });
    const elementi = nodi(pannello.elemento);
    assert.equal(elementi.some((nodo) => nodo.textContent === "Riprova la verifica API"), false);
    const interruttore = elementi.find((nodo) => nodo.type === "checkbox");
    if (gestito) {
      assert.ok(interruttore, "la stessa risposta con Astra nell'elenco deve mostrare l'interruttore");
      assert.equal(interruttore.checked, false);
      assert.equal(interruttore.disabled, false);
    } else {
      assert.equal(interruttore, undefined);
      assert.equal(elementi.some((nodo) => nodo.className === "avviso-sicurezza"), false,
        "il campo assente non deve generare avvisi di errore");
    }
  }
  assert.deepEqual(richieste, [
    { via: "/api/contesto-esteso-gpt", corpo: {} },
    { via: "/api/contesto-esteso-gpt", corpo: {} },
  ]);
});

test("due verifiche API ravvicinate producono una sola richiesta", async () => {
  const richieste = [];
  let completaVerifica;
  const creaNodo = (tag, classe = "", textContent = "") => ({
    tag, className: classe, textContent, children: [],
    setAttribute(nome, valore) { this[nome] = valore; },
    append(...nodi) { this.children.push(...nodi); },
    appendChild(nodo) { this.children.push(nodo); return nodo; },
    replaceChildren(...nodi) { this.children = nodi; },
  });
  const nodi = (nodo) => [nodo, ...nodo.children.flatMap(nodi)];
  const creaPannello = new Function(
    "crea", "APP", "modelloCorrenteSessione", "finestraModelloSessione", "numero", "chiedi",
    "contestoGptSessioneOccupata", "aggiornaCataloghiContestoGptAperti", "testoErrore", "bottoneAzione",
    `return function(sessione, { nascosto = false } = {}) { ${corpoFunzione("creaInformazioneContestoModelli")} };`,
  )(
    creaNodo, { modale: {} }, (sessione) => sessione.modello, () => 272000, String,
    async (via, opzioni) => {
      richieste.push({ via, opzioni });
      if (richieste.length === 1) throw new Error("Verifica temporaneamente non disponibile");
      return new Promise((risolvi) => { completaVerifica = risolvi; });
    },
    () => false, async () => {}, (errore) => errore.message,
    (titolo, onclick) => ({ ...creaNodo("button", "", titolo), onclick }),
  );
  const pannello = creaPannello({
    id: "s1", invioInCorso: false, contestoGptDaRicaricare: false,
    modello: { provider: "openai", id: "gpt-5.6-terra" },
  });
  const bottoneRiprova = () => nodi(pannello.elemento).find((nodo) => nodo.textContent === "Riprova la verifica API");
  pannello.aggiorna();
  await Promise.resolve();
  assert.equal(richieste.length, 1);
  const riprova = bottoneRiprova();
  assert.equal(riprova.disabled, false);
  const primo = riprova.onclick();
  const secondo = riprova.onclick();
  assert.equal(richieste.length, 2, "dopo il primo errore i due clic devono avviare una sola nuova richiesta");
  assert.equal(bottoneRiprova().disabled, true, "il bottone deve restare disabilitato durante la verifica");
  await secondo;
  completaVerifica({ managedModelIds: ["gpt-5.6-terra"], enabled: false, mutable: true, conflict: false });
  await primo;
  assert.equal(bottoneRiprova(), undefined);
  assert.equal(nodi(pannello.elemento).find((nodo) => nodo.type === "checkbox").disabled, false);
  assert.ok(richieste.every(({ via }) => via === "/api/contesto-esteso-gpt"));
});

test("le schede aperte aggiornano il catalogo API anche se una verifica fallisce", async () => {
  const sessioni = [
    { id: "pronta", attiva: true },
    { id: "occupata", attiva: true },
    { id: "errore", attiva: true },
    { id: "chiusa", attiva: false },
  ];
  const chiamate = [];
  const aggiorna = new Function("APP", "aggiornaCatalogoContestoGptSessione",
    `return async function() { ${corpoFunzione("aggiornaCataloghiContestoGptAperti")} };`,
  )(
    { sessioni: new Map(sessioni.map((sessione) => [sessione.id, sessione])) },
    async (sessione) => {
      assert.ok(sessioni.filter((corrente) => corrente.attiva).every((corrente) => corrente.contestoGptDaRicaricare),
        "tutte le guardie devono essere impostate prima di avviare gli aggiornamenti");
      chiamate.push(sessione.id);
      if (sessione.id === "errore") throw new Error("Catalogo temporaneamente non disponibile");
      return sessione.id === "occupata" ? { pendente: true } : { aggiornata: true };
    },
  );
  assert.deepEqual(await aggiorna(), { aggiornate: 1, pendenti: 1, errori: 1 });
  assert.deepEqual(chiamate, ["pronta", "occupata", "errore"]);
  assert.equal(sessioni[3].contestoGptDaRicaricare, undefined);
});

test("il bottone dei controlli avanzati apre tutte le sezioni anche ricevendo l'evento del clic", () => {
  const creaNodo = (tag, classe = "", textContent = "") => ({
    tag, className: classe, textContent, children: [], style: {}, dataset: {},
    setAttribute(nome, valore) { this[nome] = valore; },
    append(...nodi) { this.children.push(...nodi); },
    appendChild(nodo) { this.children.push(nodo); return nodo; },
    cloneNode() { return creaNodo(this.tag, this.className, this.textContent); },
  });
  const attiva = { id: "s1", statoRpc: {} };
  const evento = { type: "click", target: { id: "btn-avanzati" } };
  let corpo;
  const apri = new Function("sessioneAttiva", "apriModale", "crea", "sezioneAvanzata", "bottoneAzione", "COMANDI_AVANZATI", "TESTI_BUILTIN", "eseguiComandoNavigazione",
    `return function(sessioneRichiesta = null) { ${corpoFunzione("apriControlliAvanzati")} };`,
  )(
    () => attiva, () => { corpo = creaNodo("section"); return corpo; }, creaNodo,
    (titolo) => creaNodo("section", "", titolo),
    (titolo, onclick) => ({ ...creaNodo("button", "", titolo), onclick }),
    costanteProva("COMANDI_AVANZATI"), costanteProva("TESTI_BUILTIN"), () => {},
  );
  apri(evento);
  assert.deepEqual(corpo.children.filter((nodo) => nodo.tag === "section").map((nodo) => nodo.textContent), [
    "Sessione", "Comportamento automatico e coda", "Shell diretta", "Protocollo RPC completo",
  ]);
  assert.ok(attiva.bashUi, "il pannello deve usare la sessione attiva");
  const richiesta = { id: "s2", statoRpc: {} };
  apri(richiesta);
  assert.ok(richiesta.bashUi, "una sessione richiesta esplicitamente deve essere rispettata");

  const collegamento = frontend.match(/DOM\.btnAvanzati\.onclick = [^\r\n]+;/)?.[0];
  assert.ok(collegamento, "manca il collegamento del bottone dei controlli avanzati");
  const dom = { btnAvanzati: {} };
  let argomenti;
  new Function("DOM", "apriControlliAvanzati", collegamento)(dom, (...ricevuti) => { argomenti = ricevuti; });
  dom.btnAvanzati.onclick(evento);
  assert.deepEqual(argomenti, [], "il bottone non deve inoltrare l'evento come sessione");
});

test("l'etichetta della soglia mantiene l'ultimo valore salvato con 89.5 e 49", async () => {
  const creaNodo = (tag, classe = "", textContent = "") => ({
    tag, className: classe, textContent, children: [], style: {},
    setAttribute(nome, valore) { this[nome] = valore; },
    append(...nodi) { this.children.push(...nodi); },
    appendChild(nodo) { this.children.push(nodo); return nodo; },
    focus() {},
  });
  const app = { modale: {} };
  const piede = creaNodo("footer");
  let corpo;
  let valoreSalvato = 87;
  const apri = new Function("APP", "DOM", "apriModale", "crea", "bottoneAzione", "chiedi",
    "sessioneAttiva", "apriPannelloRuoliConsiglio", "montaAspettoImpostazioni",
    `return async function() { ${corpoFunzione("apriImpostazioniGui")} };`,
  )(
    app, { modalePiede: piede },
    () => { corpo = creaNodo("section"); return corpo; }, creaNodo,
    (titolo, onclick) => ({ ...creaNodo("button", "", titolo), onclick }),
    async (_via, opzioni) => {
      if (opzioni?.corpo) valoreSalvato = opzioni.corpo.sogliaCompattazionePercento;
      return { sogliaCompattazionePercento: valoreSalvato };
    },
    // Il pannello dei ruoli del consiglio vive nella stessa finestra: qui non
    // è in prova, quindi resta un doppio silenzioso.
    () => null, async () => {}, () => ({ carica() {} }),
  );
  await apri();
  const nodi = (nodo) => [nodo, ...nodo.children.flatMap(nodi)];
  const campo = nodi(corpo).find((nodo) => nodo.type === "number");
  const etichetta = nodi(corpo).find((nodo) => nodo.tag === "strong");
  const salva = piede.children.find((nodo) => nodo.textContent === "Salva impostazioni GUI");
  const testoEtichetta = (valore) => `Compatta prima di inviare oltre il ${valore}% della finestra`;
  assert.equal(etichetta.textContent, testoEtichetta(87));
  for (const valoreConfermato of [87, 91]) {
    for (const valoreInvalido of ["89.5", "49"]) {
      campo.value = "92";
      campo.oninput();
      assert.equal(etichetta.textContent, testoEtichetta(92), "un intero valido può essere mostrato durante la modifica");
      campo.value = valoreInvalido;
      campo.oninput();
      await salva.onclick();
      assert.equal(etichetta.textContent, testoEtichetta(valoreConfermato), "un valore invalido deve ripristinare l'ultima soglia salvata");
      assert.equal(valoreSalvato, valoreConfermato);
      assert.match(nodi(corpo).map((nodo) => nodo.textContent).join(" "), /numero intero da 50 a 95/);
    }
    campo.value = "91";
    campo.oninput();
    await salva.onclick();
    assert.equal(etichetta.textContent, testoEtichetta(91));
  }
});

test("le impostazioni della GUI leggono la soglia salvata e mantengono il valore confermato dopo un errore", async () => {
  const creaNodo = (tag, classe = "", textContent = "") => ({
    tag, className: classe, textContent, children: [], style: {},
    setAttribute(nome, valore) { this[nome] = valore; },
    append(...nodi) { this.children.push(...nodi); },
    appendChild(nodo) { this.children.push(nodo); return nodo; },
    focus() {},
  });
  const app = { modale: {} };
  const piede = creaNodo("footer");
  let corpo;
  const richieste = [];
  let salvata = 87;
  let fallisce = false;
  const apri = new Function("APP", "DOM", "apriModale", "crea", "bottoneAzione", "chiedi", "testoErrore", "chiudiModale",
    "sessioneAttiva", "apriPannelloRuoliConsiglio", "montaAspettoImpostazioni",
    `return async function() { ${corpoFunzione("apriImpostazioniGui")} };`,
  )(
    app, { modalePiede: piede },
    () => { corpo = creaNodo("section"); piede.children = []; app.modale = {}; return corpo; },
    creaNodo,
    (titolo, onclick) => ({ ...creaNodo("button", "", titolo), onclick }),
    async (via, opzioni) => {
      richieste.push({ via, opzioni });
      if (opzioni?.corpo) {
        if (fallisce) throw new Error("Scrittura non riuscita");
        salvata = opzioni.corpo.sogliaCompattazionePercento;
      }
      return { sogliaCompattazionePercento: salvata };
    },
    (errore) => errore.message, () => {},
    () => null, async () => {}, () => ({ carica() {} }),
  );
  const nodi = (nodo) => [nodo, ...nodo.children.flatMap(nodi)];
  const testo = () => nodi(corpo).map((nodo) => nodo.textContent).join(" ");
  await apri();
  let campo = nodi(corpo).find((nodo) => nodo.type === "number");
  let salva = piede.children.find((nodo) => nodo.textContent === "Salva impostazioni GUI");
  assert.deepEqual([campo.min, campo.max, campo.step, campo.value], ["50", "95", "1", "87"]);
  assert.deepEqual(richieste[0], { via: "/api/impostazioni", opzioni: undefined });
  for (const valore of ["49", "96", "89.5", "testo", ""]) {
    campo.value = valore;
    await salva.onclick();
    assert.match(testo(), /numero intero da 50 a 95/);
  }
  assert.equal(richieste.length, 1, "i valori invalidi non devono essere inviati al ponte");
  campo.value = "92";
  await salva.onclick();
  assert.deepEqual(richieste[1], { via: "/api/impostazioni", opzioni: { corpo: { sogliaCompattazionePercento: 92 } } });
  assert.match(testo(), /Soglia salvata: 92%/);
  fallisce = true;
  campo.value = "95";
  await salva.onclick();
  assert.equal(salvata, 92);
  assert.match(testo(), /Ultima soglia confermata: 92%/);
  assert.equal(salva.disabled, false);
  await apri();
  campo = nodi(corpo).find((nodo) => nodo.type === "number");
  assert.equal(campo.value, "92", "la riapertura deve rileggere la preferenza dal ponte");
  for (const nome of ["apriImpostazioniPi", "apriControlliAvanzati"]) {
    assert.match(corpoFunzione(nome), /Impostazioni della GUI[\s\S]*?apriImpostazioniGui\(\)/);
  }
  assert.doesNotMatch(corpoFunzione("apriImpostazioniGui"), /set_auto_compaction|set_rpc_setting|autoCompaction/,
    "salvare la soglia GUI non deve modificare l'interruttore automatico di Pi");
  assert.match(corpoFunzione("apriImpostazioniGui"), /Con finestre fino a circa 164\.000 token Pi riassume da solo prima di questa soglia \(riserva predefinita di Pi: 16\.384 token\)\. La soglia conta sulle finestre più grandi\./);
  assert.match(testo(), /164\.000[\s\S]*?16\.384/,
    "la riserva nativa di Pi deve essere spiegata nel pannello visibile");
});

test("con la compattazione automatica di Pi disattivata il pannello mostra l'avviso sulla soglia preventiva", async () => {
  const testoAvviso = "Attenzione: con lo spazio automatico disattivato resta solo la soglia preventiva della GUI, applicata prima di un nuovo invio. Steer, follow-up e turni lunghi non sono protetti e il contesto può esaurirsi.";
  const dichiarazioneAvviso = frontend.match(/const AVVISO_SPAZIO_AUTOMATICO_DISATTIVATO = ("[^"\r\n]+");/);
  assert.ok(dichiarazioneAvviso);
  const avvisoCondiviso = JSON.parse(dichiarazioneAvviso[1]);
  assert.equal(avvisoCondiviso, testoAvviso);
  const creaNodo = (tag, classe = "", textContent = "") => ({
    tag, className: classe, textContent, children: [],
    setAttribute(nome, valore) { this[nome] = valore; },
    append(...nodi) { this.children.push(...nodi); },
    appendChild(nodo) { this.children.push(nodo); return nodo; },
    replaceChildren(...nodi) { this.children = nodi; },
  });
  const app = { modale: {} };
  const piede = creaNodo("footer");
  const richieste = [];
  let corpo;
  let autoCompaction = false;
  const apri = new Function("APP", "DOM", "apriModale", "crea", "bottoneAzione", "rpc", "AVVISO_SPAZIO_AUTOMATICO_DISATTIVATO",
    `return async function(sessione, operazione = null) { ${corpoFunzione("apriImpostazioniPi")} };`,
  )(
    app, { modalePiede: piede },
    () => { corpo = creaNodo("section"); piede.children = []; app.modale = {}; return corpo; },
    creaNodo, (titolo, onclick) => ({ ...creaNodo("button", "", titolo), onclick }),
    async (comando) => {
      richieste.push(comando);
      return { settings: { autoCompaction } };
    },
    avvisoCondiviso,
  );
  const nodi = (nodo) => [nodo, ...nodo.children.flatMap(nodi)];
  const testoVisibile = () => nodi(corpo).filter((nodo) => !nodo.hidden).map((nodo) => nodo.textContent).join(" ");
  const selezioneSpazio = () => nodi(corpo).find((nodo) => nodo.tag === "select" && nodo["aria-label"] === "Libera spazio automaticamente");
  for (autoCompaction of [false, true]) {
    await apri({ id: "s1" });
    const avviso = nodi(corpo).find((nodo) => nodo.textContent === testoAvviso);
    assert.equal(avviso.hidden, autoCompaction, "all'apertura l'avviso deve seguire il valore effettivo di Pi");
    assert.equal(testoVisibile().includes(testoAvviso), !autoCompaction);
    assert.equal(avviso["aria-live"], "polite");
    const selezione = selezioneSpazio();
    const riga = corpo.children.findIndex((nodo) => nodo.children.includes(selezione));
    assert.equal(corpo.children[riga + 1], avviso, "l'avviso deve comparire subito sotto la riga dello spazio automatico");
    selezione.value = "false";
    selezione.onchange();
    assert.equal(avviso.hidden, false);
    assert.ok(testoVisibile().includes(testoAvviso));
    selezione.value = "true";
    selezione.onchange();
    assert.equal(avviso.hidden, true);
    assert.equal(testoVisibile().includes(testoAvviso), false);
  }
  assert.deepEqual(richieste, [{ type: "get_rpc_settings" }, { type: "get_rpc_settings" }],
    "mostrare l'avviso e cambiare selezione non deve riattivare né salvare automaticamente lo spazio di Pi");
});

test("il comando rapido di disattivazione avvisa solo dopo la conferma di Pi", async () => {
  const avvisoCondiviso = JSON.parse(frontend.match(/const AVVISO_SPAZIO_AUTOMATICO_DISATTIVATO = ("[^"\r\n]+");/)[1]);
  const creaNodo = (tag, classe = "", textContent = "") => ({
    tag, className: classe, textContent, children: [], style: {}, dataset: {},
    setAttribute(nome, valore) { this[nome] = valore; },
    append(...nodi) { this.children.push(...nodi); },
    appendChild(nodo) { this.children.push(nodo); return nodo; },
    cloneNode() { return creaNodo(this.tag, this.className, this.textContent); },
  });
  const richieste = [];
  const avvisi = [];
  let completaComando;
  let corpo;
  const comandoBreve = new Function("rpc", "toast", "testoErrore",
    `return async function(sessione, comando) { ${corpoFunzione("comandoBreve")} };`,
  )(
    async (comando) => {
      richieste.push(comando);
      return new Promise((risolvi, rifiuta) => { completaComando = { risolvi, rifiuta }; });
    },
    () => {}, (errore) => errore.message,
  );
  const apri = new Function("apriModale", "crea", "sezioneAvanzata", "bottoneAzione", "comandoBreve", "avvisa", "AVVISO_SPAZIO_AUTOMATICO_DISATTIVATO", "COMANDI_AVANZATI", "TESTI_BUILTIN",
    `return function(sessioneRichiesta = null) { ${corpoFunzione("apriControlliAvanzati")} };`,
  )(
    () => { corpo = creaNodo("section"); return corpo; }, creaNodo, (titolo) => creaNodo("section", "", titolo),
    (titolo, onclick) => ({ ...creaNodo("button", "", titolo), onclick }),
    comandoBreve, (messaggio) => avvisi.push(messaggio), avvisoCondiviso,
    costanteProva("COMANDI_AVANZATI"), costanteProva("TESTI_BUILTIN"),
  );
  apri({ id: "s1", statoRpc: {} });
  const nodi = (nodo) => [nodo, ...nodo.children.flatMap(nodi)];
  const disattiva = nodi(corpo).find((nodo) => nodo.textContent === "Spazio automatico: disattiva");
  const invio = disattiva.onclick();
  assert.deepEqual(richieste, [{ type: "set_auto_compaction", enabled: false }]);
  assert.deepEqual(avvisi, [], "l'avviso deve attendere l'esito del comando");
  completaComando.risolvi({});
  await invio;
  assert.deepEqual(avvisi, [avvisoCondiviso]);
  const fallimento = disattiva.onclick();
  completaComando.rifiuta(new Error("Impostazione non applicata"));
  await fallimento;
  assert.deepEqual(avvisi, [avvisoCondiviso], "un errore RPC non deve annunciare una disattivazione non confermata");
});

test("le statistiche sconosciute mostrano non disponibile senza una barra a zero", () => {
  const creaNodo = (tag, classe = "", textContent = "") => ({
    tag, className: classe, textContent, children: [], style: {},
    appendChild(nodo) { this.children.push(nodo); return nodo; },
  });
  let corpo;
  const mostra = new Function("apriModale", "crea", "VISTA_CORE", "numero",
    `return function(dati, sessione) { ${corpoFunzione("mostraStatistiche")} };`,
  )(() => { corpo = creaNodo("section"); return corpo; }, creaNodo, { presentaCosto: () => null }, String);
  const nodi = (nodo) => [nodo, ...nodo.children.flatMap(nodi)];
  mostra({ contextUsage: { percent: null, tokens: null, contextWindow: 272000 } }, null);
  const testo = nodi(corpo).map((nodo) => nodo.textContent).join(" ");
  assert.match(testo, /Percentuale di contesto non disponibile/);
  assert.match(testo, /non disponibile di 272000 token/);
  assert.doesNotMatch(testo, /0\.0%/);
  assert.equal(nodi(corpo).some((nodo) => nodo.className === "barra-contesto"), false);
  mostra({ contextUsage: { percent: 0, tokens: 0, contextWindow: 272000 } }, null);
  assert.match(nodi(corpo).map((nodo) => nodo.textContent).join(" "), /0\.0% del contesto usato/);
  assert.equal(nodi(corpo).some((nodo) => nodo.className === "barra-contesto"), true,
    "uno zero effettivamente misurato resta distinto dal valore sconosciuto");
});

test("la compattazione preventiva mantiene la guardia fino all'evento finale correlato", () => {
  const sessione = { id: "s1" };
  const avvisi = [];
  const messaggi = [];
  let sospensioni = 0;
  let riprese = 0;
  const aggiorna = new Function("APP", "sospendiTimeoutPromptPerCompattazione", "aggiornaEventoCompattazione", "avvisa", "riprendiTimeoutPromptDopoCompattazione",
    `return function(sessione, evento) { ${corpoFunzione("aggiornaCompattazionePreventiva")} };`,
  )(
    { attivaId: sessione.id }, () => { sospensioni += 1; },
    (_sessione, messaggio) => messaggi.push(messaggio), (testo) => avvisi.push(testo), () => { riprese += 1; },
  );
  aggiorna(sessione, { fase: "conclusa", promptId: "sotto-soglia", messaggio: "Verifica preventiva conclusa." });
  assert.equal(sessione.compattazionePreventivaInCorso, false);
  assert.equal(messaggi.length, 0, "il controllo sotto soglia non deve inventare una compattazione");
  aggiorna(sessione, { fase: "in_corso", promptId: "prompt1" });
  assert.equal(sessione.compattazionePreventivaInCorso, true);
  assert.equal(sospensioni, 1);
  assert.match(avvisi.at(-1), /Libero spazio prima di inviare\.\.\./);
  aggiorna(sessione, { fase: "conclusa", promptId: "vecchio-prompt" });
  assert.equal(sessione.compattazionePreventivaInCorso, true, "un finale tardivo non può sbloccare un'altra richiesta");
  aggiorna(sessione, { fase: "errore", promptId: "prompt1", messaggio: "Tempo scaduto; il prompt non è stato inoltrato." });
  assert.equal(sessione.compattazionePreventivaInCorso, false);
  assert.equal(sessione.promptCompattazionePreventiva, null);
  assert.equal(riprese, 2);
  assert.match(avvisi.at(-1), /il prompt non è stato inoltrato/);
  const messaggioSaltata = "Compattazione preventiva saltata: l'ultimo riassunto non ha liberato spazio sotto la soglia. Interviene la compattazione automatica di Pi.";
  aggiorna(sessione, { fase: "saltata", promptId: "riassunto-inefficace", messaggio: messaggioSaltata });
  assert.equal(avvisi.at(-1), messaggioSaltata, "la fase saltata deve mostrare il messaggio del ponte senza sostituirlo con un testo generico");
  assert.equal(sessione.compattazionePreventivaInCorso, false);
  aggiorna(sessione, { fase: "in_corso", promptId: "riassunto-annunciato" });
  aggiorna(sessione, { fase: "saltata", promptId: "riassunto-annunciato", messaggio: messaggioSaltata });
  assert.equal(messaggi.at(-1).nota, messaggioSaltata, "anche lo stato già annunciato deve conservare il messaggio del ponte");
  assert.equal(avvisi.at(-1), messaggioSaltata);
  const eventi = corpoFunzione("gestisciEvento");
  const fineCompatta = eventi.slice(eventi.indexOf('evento.type === "compaction_end"'), eventi.indexOf('evento.type === "auto_retry_start"'));
  assert.doesNotMatch(fineCompatta, /compattazionePreventivaInCorso\s*=\s*false/);
  assert.match(fineCompatta, /if \(!sessione\.compattazionePreventivaInCorso\)\s*\{\s*riprendiTimeoutPromptDopoCompattazione/);
  assert.match(corpoFunzione("creaSessione"), /compattazionePreventivaInCorso:\s*Boolean\(meta\.compattazionePreventivaInCorso\)/);
  assert.match(corpoFunzione("unisciSessione"), /"compattazionePreventivaInCorso"/);
  assert.match(corpoFunzione("applicaSnapshot"), /compattazionePreventivaInCorso[\s\S]*?sospendiTimeoutPromptPerCompattazione/);
  for (const nome of ["contestoGptSessioneOccupata", "ricaricaRisorsePi", "aggiornaInterfacciaAttiva", "invia"]) {
    assert.match(corpoFunzione(nome), /compattazionePreventivaInCorso/, `${nome} deve rispettare la prenotazione preventiva`);
  }
  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  assert.match(interfaccia, /const interrompibile[\s\S]*?sessione\.compattazionePreventivaInCorso/);
  assert.match(interfaccia, /fermaLaterale\.disabled = !interrompibile/);
  assert.match(interfaccia, /DOM\.btnFerma\.hidden = !interrompibile/);
  assert.match(interfaccia, /DOM\.btnFerma\.disabled = !interrompibile/);
  assert.doesNotMatch(corpoFunzione("aggiornaCompattazionePreventiva"), /\brpc\(|\binvia\(|setTimeout/,
    "un evento finale non deve reinviare il prompt né programmare retry");
});

test("il latch impedisce due invii ravvicinati e il timeout conserva un esito da verificare", async () => {
  let liberaCoda;
  const sessione = {
    id: "s1", bozza: "Richiesta conservata", chiaveBozza: "bozza1",
    codaIngressiLibreria: new Promise((risolvi) => { liberaCoda = risolvi; }),
  };
  let aggiornamenti = 0;
  const invia = new Function("sessioneAttiva", "aggiornaInterfacciaAttiva", "APP", "DOM",
    `return async function() { ${corpoFunzione("invia")} };`,
  )(() => sessione, () => { aggiornamenti += 1; }, { attivaId: "s1" }, { input: { focus() {} } });
  const primo = invia();
  assert.equal(sessione.invioInCorso, true);
  await invia();
  assert.equal(aggiornamenti, 1, "il secondo invio deve fermarsi prima di attraversare gli await");
  sessione.chiusuraInCorso = true;
  liberaCoda();
  await primo;
  assert.equal(sessione.invioInCorso, false);
  assert.equal(sessione.bozza, "Richiesta conservata");
  const corpoInvio = corpoFunzione("invia");
  assert.equal([...corpoInvio.matchAll(/await rpc\(comando,/g)].length, 1);
  assert.ok(corpoInvio.indexOf("sessione.invioInCorso = true") < corpoInvio.indexOf("await "));
  assert.ok(corpoInvio.indexOf("await rpc(comando") < corpoInvio.indexOf('sessione.bozza = ""'));
  assert.match(corpoInvio, /errore\?\.esitoIgnoto[\s\S]*?Non reinviare subito/);

  let scadenza;
  let erroreRicevuto;
  const pendente = { tipoComando: "prompt", mutante: true, timeoutMs: 30000, rifiuta: (errore) => { erroreRicevuto = errore; } };
  const attese = new Map([["s1:p1", pendente]]);
  const programma = new Function("APP", "setTimeout", "clearTimeout",
    `return function(chiave, pendente, durata = pendente.timeoutMs) { ${corpoFunzione("programmaTimeoutAttesa")} };`,
  )({ attese }, (callback) => { scadenza = callback; return 1; }, () => {});
  programma("s1:p1", pendente);
  scadenza();
  assert.equal(attese.size, 0);
  assert.equal(erroreRicevuto.esitoIgnoto, true);
  assert.match(erroreRicevuto.message, /non ha risposto in tempo/);
  assert.doesNotMatch(corpoFunzione("programmaTimeoutAttesa"), /\brpc\(|\binvia\(/);
});

test("l'albero della conversazione resta raggiungibile dal menu della conversazione", () => {
  const albero = elementoConId("btn-albero");
  assert.equal(albero?.tag, "button");
  assert.equal(albero?.attributi.get("type"), "button");
  assert.equal(albero?.attributi.get("data-comando"), "history");
  assert.equal(albero?.attributi.get("role"), "menuitem");
  assert.match(
    `${albero?.attributi.get("aria-label") || ""} ${corpoElementoSemplice("btn-albero").replace(/<[^>]+>/g, " ")}`,
    /(?:cronologia|rami|passaggi? precedenti?|torna)/i,
    "il pulsante deve spiegare che permette di tornare a passaggi o rami precedenti",
  );

  assert.match(frontend, /btnAlbero:\s*\$\(["']#btn-albero["']\)/,
    "il pulsante deve essere incluso nella mappa DOM del frontend");
  assert.match(
    corpoFunzione("eseguiAzione"),
    /azione\s*===\s*["']albero["'][\s\S]*?return\s+apriAlberoOppureSpiega\(sessione\)/,
    "l'azione laterale deve conservare un feedback anche quando Pi lavora",
  );

  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  const bloccoDisabilitazione = interfaccia.match(
    /DOM\.btnAlbero\.disabled\s*=([\s\S]*?);/,
  )?.[1] || "";
  assert.doesNotMatch(bloccoDisabilitazione, /sessione\.inEsecuzione|sessione\.compattazioneInCorso/,
    "il controllo non deve sembrare scomparso mentre Pi lavora");
  const occupato = corpoFunzione("apriAlberoOppureSpiega");
  assert.match(occupato, /alberoTemporaneamenteOccupato/);
  assert.match(occupato, /Cronologia e rami sono conservati/);
  const modale = corpoFunzione("mostraAlberoSessione");
  assert.match(modale, /voci visibili/);
  assert.match(modale, /tecniciNascosti/);
});

test("i riepiloghi di compattazione restano chiusi e vengono renderizzati solo su richiesta", () => {
  const render = corpoFunzione("renderCronologia");
  assert.match(render, /aggiungiRiepilogoContesto\(sessione,\s*"compaction"/);
  assert.match(render, /aggiungiRiepilogoContesto\(sessione,\s*"branch"/);
  assert.doesNotMatch(render, /Contesto precedente riassunto|Riepilogo del ramo precedente/);
  assert.ok(render.indexOf("finalizzaGruppoAttivita") < render.indexOf("riconciliaInviiPendenti"),
    "anche l'ultimo blocco tecnico ricostruito deve risultare concluso");
  const riepilogo = corpoFunzione("aggiungiRiepilogoContesto");
  assert.match(riepilogo, /crea\("details",\s*"riepilogo-contesto"\)/);
  assert.match(riepilogo, /box\.addEventListener\("toggle"/);
  assert.ok(riepilogo.indexOf("if (!box.open || renderizzato) return") < riepilogo.indexOf("renderMarkdown"));
  assert.match(stile, /\.riepilogo-contesto-corpo\s*\{[\s\S]*?max-height:/);
});

test("le cronologie grandi vengono renderizzate in batch senza perdere prompt o ordine", () => {
  assert.match(frontend, /const SOGLIA_RENDER_CRONOLOGIA_PROGRESSIVO\s*=\s*\d+/);
  assert.match(frontend, /const MESSAGGI_PER_BATCH_CRONOLOGIA\s*=\s*\d+/);
  const render = corpoFunzione("renderCronologia");
  assert.match(render, /const listaMessaggi\s*=\s*Array\.from\(messaggi\s*\|\|\s*\[\]\)/,
    "il render deve fotografare l'intera sequenza senza filtrarla o troncarla");
  assert.match(render,
    /!forzaSincrono[\s\S]*?listaMessaggi\.length\s*>=\s*SOGLIA_RENDER_CRONOLOGIA_PROGRESSIVO[\s\S]*?!sessione\.inEsecuzione[\s\S]*?!sessione\.compattazioneInCorso/,
    "solo una cronologia grande e ferma puo essere dilazionata");
  assert.match(render, /sessione\.generazioneRenderCronologia\s*=\s*generazione/);
  assert.match(render, /sessione\.annullaRenderCronologia\?\.\(\)/,
    "una nuova fotografia deve annullare il render precedente");
  assert.match(render, /sessione\.generazioneRenderCronologia\s*===\s*generazione/,
    "ogni batch deve appartenere ancora alla generazione corrente");
  assert.match(render,
    /while \(indice < fineBatch\)[\s\S]*?renderizzaMessaggio\(listaMessaggi\[indice\]\)[\s\S]*?indice \+= 1/,
    "i messaggi devono essere consumati uno alla volta nello stesso ordine del JSONL");
  assert.doesNotMatch(render, /listaMessaggi\.(?:sort|reverse|splice)\(/,
    "il percorso progressivo non deve riordinare o eliminare prompt");
  assert.match(render,
    /messaggio\.role === "user"[\s\S]*?testoDaContenuto\(messaggio\.content\)/,
    "il prompt originale completo deve continuare a essere la fonte del messaggio utente");
  assert.match(render,
    /if \(indice < listaMessaggi\.length\)[\s\S]*?requestAnimationFrame\(renderizzaBatch\)[\s\S]*?return;[\s\S]*?finalizza\(\)/,
    "riconciliazione e finalizzazione devono avvenire soltanto dopo l'ultimo batch");
  assert.match(render,
    /const finalizza[\s\S]*?finalizzaGruppoAttivita[\s\S]*?riconciliaInviiPendenti\(sessione, listaMessaggi\)/);

  const caricamento = corpoFunzione("caricaCronologiaSessione");
  assert.match(caricamento,
    /sessione\.messaggiSincronizzati\s*=\s*false;[\s\S]*?await renderCronologia\(sessione, messaggi,[\s\S]*?sessione\.messaggiSincronizzati\s*=\s*!parziale/,
    "la cronologia non puo risultare sincronizzata mentre il DOM e ancora parziale");
  const risposta = corpoFunzione("aggiornaDaRisposta");
  assert.match(risposta,
    /evento\.command === "get_messages"[\s\S]*?messaggiSincronizzati\s*=\s*false[\s\S]*?renderCronologia[\s\S]*?\.then\([\s\S]*?messaggiSincronizzati\s*=\s*true/,
    "anche il percorso RPC deve attendere il completamento reale del render");
});

test("durante il render progressivo la bozza resta scrivibile e tutte le mutazioni sono bloccate", () => {
  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  const gateComposer = interfaccia.slice(
    interfaccia.indexOf("const composerScrivibile"),
    interfaccia.indexOf("const utilizzabile"),
  );
  assert.doesNotMatch(gateComposer, /sincronizzazione|renderCronologiaInCorso/,
    "la sola ricostruzione progressiva non deve disabilitare la textarea");
  assert.match(interfaccia,
    /const mutazioniUtilizzabili\s*=\s*utilizzabile[\s\S]*?&&\s*!sessione\?\.sincronizzazione[\s\S]*?&&\s*!sessione\?\.renderCronologiaInCorso/);
  assert.match(interfaccia, /DOM\.input\.disabled\s*=\s*!composerScrivibile/);
  assert.match(interfaccia, /Ricostruisco la cronologia salvata:[^"']*bozza resta salvata/);
  assert.match(interfaccia,
    /DOM\.conversazione\.setAttribute\([\s\S]*?"aria-busy"[\s\S]*?sessione\?\.renderCronologiaInCorso/);
  for (const controllo of ["btnAllega", "btnInvia", "btnModello", "btnRagionamento", "btnAvanzati"]) {
    assert.match(interfaccia, new RegExp(`DOM\\.${controllo}\\.disabled\\s*=\\s*!mutazioniUtilizzabili`),
      `${controllo} deve restare bloccato finche la cronologia e parziale`);
  }

  const rpc = corpoFunzione("rpc");
  assert.match(rpc,
    /sessione\.renderCronologiaInCorso[\s\S]*?!String\(comando\?\.type[\s\S]*?startsWith\("get_"\)[\s\S]*?erroreRenderCronologiaInCorso/,
    "anche una modale gia aperta non deve aggirare il blocco delle mutazioni");
  const invio = corpoFunzione("invia");
  assert.match(invio, /if \(sessione\?\.renderCronologiaInCorso\)[\s\S]*?bozza resta salvata/);
  assert.match(invio,
    /await \(sessione\.codaAllegatiBozza[\s\S]*?if \(sessione\.renderCronologiaInCorso\)/,
    "il controllo deve essere ripetuto dopo le code asincrone degli allegati");
  assert.match(corpoFunzione("aggiungiFile"), /sessione\.renderCronologiaInCorso/);
  assert.match(corpoFunzione("aggiungiImmagini"), /sessione\.renderCronologiaInCorso/);

  const eventi = corpoFunzione("gestisciEvento");
  assert.match(eventi,
    /sessione\.renderCronologiaInCorso[\s\S]*?EVENTI_RIPRESA_DOPO_COMPATTAZIONE[\s\S]*?completaRenderCronologiaSincrono\?\.\(\)/,
    "se la sessione diventa live, la fotografia deve essere completata prima dei delta");
});

test("gli eventi live arrivati durante il download seguono una sola fotografia completa", () => {
  assert.match(frontend, /caricamentoCronologiaInCorso:\s*null/);

  const caricamento = corpoFunzione("caricaCronologiaSessione");
  const creaBarriera = caricamento.indexOf("sessione.caricamentoCronologiaInCorso = caricamentoCronologia");
  const avviaDownload = caricamento.indexOf('fetch("/api/cronologia"');
  const staccaCoda = caricamento.indexOf("staccaEventiCronologiaAccodati");
  const avviaRender = caricamento.indexOf("await renderCronologia");
  const sincronizzata = caricamento.indexOf("sessione.messaggiSincronizzati = !parziale");
  const riproduciCoda = caricamento.lastIndexOf("riproduciEventiCronologiaAccodati");
  assert.ok(creaBarriera >= 0 && creaBarriera < avviaDownload,
    "la barriera deve esistere prima che inizi il download NDJSON");
  assert.ok(staccaCoda > avviaDownload && staccaCoda < avviaRender,
    "gli eventi devono essere separati dalla barriera prima di ricostruire il DOM");
  assert.match(caricamento, /forzaSincrono:\s*eventiAccodati\.length\s*>\s*0/,
    "una coda live richiede una fotografia sincrona prima del replay");
  assert.ok(sincronizzata > avviaRender && sincronizzata < riproduciCoda,
    "i delta accodati devono essere riammessi solo dopo la sincronizzazione completa");

  const eventi = corpoFunzione("gestisciEvento");
  const accoda = eventi.indexOf("caricamentoCronologia.eventi.push(evento)");
  const gestisceLive = eventi.indexOf("const statoDiventatoLive");
  assert.ok(accoda >= 0 && accoda < gestisceLive,
    "un evento live non deve mutare la sessione mentre il download e ancora in corso");
  assert.match(eventi,
    /caricamentoCronologia\.richiesta\s*===\s*sessione\.richiestaCronologia[\s\S]*?evento\.type\s*!==\s*"response"[\s\S]*?startsWith\("gui_"\)[\s\S]*?eventi\.push\(evento\);\s*return;/,
    "solo la barriera corrente deve accodare gli eventi di timeline, senza bloccare RPC e lifecycle GUI");
});

test("il primo message_update che promuove un render progressivo non viene scartato", () => {
  const eventi = corpoFunzione("gestisciEvento");
  const promozione = eventi.indexOf("const renderCompletato = sessione.completaRenderCronologiaSincrono?.()");
  const abilitaDelta = eventi.indexOf("if (renderCompletato) sessione.messaggiSincronizzati = true", promozione);
  const primoDelta = eventi.indexOf('evento.type === "message_update"');
  assert.ok(promozione >= 0 && promozione < abilitaDelta && abilitaDelta < primoDelta,
    "la promozione deve rendere la fotografia sincronizzata nello stesso stack del primo delta");
});

test("la compattazione troppo breve produce un solo feedback neutro", () => {
  const evento = corpoFunzione("gestisciEvento");
  const inizio = evento.indexOf('evento.type === "compaction_end"');
  const fine = evento.indexOf('evento.type === "auto_retry_start"', inizio);
  const ramo = evento.slice(inizio, fine);
  assert.match(ramo, /presentaErroreCompattazione\(evento\.errorMessage\)/);
  assert.match(ramo, /compattazione\.nonNecessaria[\s\S]*?\{ nota: compattazione\.testo \}/,
    "Nothing to compact deve aggiornare il banner come nota, non come errore");

  const risposta = corpoFunzione("aggiornaDaRisposta");
  assert.match(
    risposta,
    /!\(avevaAttesa\s*&&\s*compattazione\?\.nonNecessaria\)/,
    "l'ack non deve creare un toast quando il chiamante attende questo esito noto",
  );

  const azione = corpoFunzione("eseguiAzione");
  assert.match(azione, /azione === "comprimi"[\s\S]*?presentaErroreCompattazione/);
  assert.match(azione, /if \(!compattazione\?\.nonNecessaria\)\s*\{[\s\S]*?toast\(/,
    "il catch non deve aggiungere un secondo toast per una chat troppo breve");
});

test("l'etichetta di ricalcolo si spegne appena PI riprende davvero il lavoro", () => {
  const ripresa = corpoFunzione("confermaRipresaDopoCompattazione");
  assert.match(ripresa, /sessione\?\.contestoDaRicalcolare/);
  assert.match(ripresa, /EVENTI_RIPRESA_DOPO_COMPATTAZIONE\.has\(tipoEvento\)/);
  assert.match(ripresa, /sessione\.contestoDaRicalcolare\s*=\s*false/);
  assert.match(ripresa, /disegnaBarraStatoSessione\(sessione\)/,
    "anche gli eventi delta, che hanno un fast path, devono aggiornare subito l'etichetta");
  for (const evento of [
    "message_update",
    "tool_execution_start",
    "bash_execution_update",
    "agent_settled",
  ]) {
    assert.match(frontend, new RegExp(`["']${evento}["']`), `manca l'evidenza di ripresa ${evento}`);
  }
  assert.match(corpoFunzione("gestisciEvento"),
    /confermaRipresaDopoCompattazione\(sessione,\s*evento\.type\)/);
  const statistiche = corpoFunzione("aggiornaStatisticheSessione");
  assert.match(statistiche,
    /sessione\.contestoDaRicalcolare[\s\S]*?!sessione\.inEsecuzione[\s\S]*?=\s*false/,
    "anche un ricalcolo accessorio fallito a sessione ferma non deve lasciare il testo per sempre");
});

test("durante la compattazione la bozza resta scrivibile ma non viene inviata", () => {
  assert.match(corpoFunzione("invia"),
    /if \(sessione\.contestoGptDaRicaricare\)[\s\S]*?await aggiornaCatalogoContestoGptSessione\(sessione\)[\s\S]*?if \(sessione\.contestoGptDaRicaricare\)/,
    "il primo prompt deve attendere il catalogo e ricontrollare la guardia dopo la verifica");
  assert.match(corpoFunzione("creaSessione"),
    /compattazioneInCorso:\s*Boolean\(meta\.compattazioneInCorso\)/,
    "un reload deve ereditare la barriera autorevole del server");
  assert.match(corpoFunzione("unisciSessione"),
    /["']compattazioneInCorso["']/,
    "anche gli snapshot successivi devono aggiornare la barriera autorevole");
  const interfaccia = corpoFunzione("aggiornaInterfacciaAttiva");
  const definizioneScrittura = interfaccia.slice(
    interfaccia.indexOf("const composerScrivibile"),
    interfaccia.indexOf("const utilizzabile"),
  );
  assert.doesNotMatch(definizioneScrittura, /compattazioneInCorso/,
    "il riassunto non deve disabilitare la textarea");
  assert.match(interfaccia,
    /const utilizzabile\s*=\s*composerScrivibile\s*&&\s*!sessione\?\.compattazioneInCorso/,
    "invio, allegati e cambi di configurazione restano bloccati durante il riassunto");
  assert.match(interfaccia, /DOM\.input\.disabled\s*=\s*!composerScrivibile/);
  assert.match(interfaccia, /Scrivi pure:[^"']*bozza resta salvata/);
  const invio = corpoFunzione("invia");
  assert.match(invio, /if \(sessione\?\.compattazioneInCorso\)/,
    "Invio da tastiera deve rispettare lo stesso blocco del pulsante disabilitato");
  assert.match(invio, /La bozza è salvata/);
  assert.match(invio,
    /await \(sessione\.codaAllegatiBozza[\s\S]*?if \(sessione\.compattazioneInCorso\)/,
    "una compattazione iniziata durante gli await deve bloccare comunque il prompt RPC");
  assert.match(invio,
    /if \(sessione\.compattazioneInCorso\)[\s\S]*?bloccoCompattazione[\s\S]*?throw bloccoCompattazione;[\s\S]*?await rpc\(comando/,
    "l'ultima guardia deve trovarsi immediatamente nel tratto che precede il prompt RPC");
  assert.match(invio, /errore\?\.compattazioneInCorso[\s\S]*?messaggio\.msg\.remove\(\)/,
    "la race deve rimuovere l'anteprima ottimistica senza cancellare la bozza");
  const azioniLaterali = corpoFunzione("abilitaAzioni");
  assert.match(azioniLaterali,
    /azione === ["']nuova["']\s*&&\s*!sessione\?\.compattazioneInCorso/,
    "Nuova conversazione nella sidebar deve disabilitarsi durante la compattazione");
  assert.doesNotMatch(azioniLaterali,
    /\[[^\]]*["']nuova["'][^\]]*\]\.includes/,
    "Nuova conversazione non deve piu essere una deroga incondizionata");
});

test("lo stato locale non devia Pi e steer resta una scelta esplicita one-shot", () => {
  const stato = elementoConId("btn-stato-attivita");
  assert.equal(stato?.tag, "button");
  const statoAttivita = corpoFunzione("testoStatoAttivita");
  assert.match(statoAttivita, /nessuna percentuale inventata/i);
  assert.match(statoAttivita, /sessione\.gruppiTurno/,
    "lo stato deve contare tutti i gruppi del turno anche dopo un follow-up ottimistico");
  assert.match(frontend, /DOM\.btnStatoAttivita\.onclick\s*=\s*mostraStatoAttivita/);
  const opzioni = corpoElementoSemplice("modo-coda");
  assert.ok(opzioni.indexOf('value="followUp"') < opzioni.indexOf('value="steer"'));
  assert.match(opzioni, /non interrompe/);
  assert.match(opzioni, /può deviare/);
  assert.match(frontend, /Intervenire nel lavoro in corso\?/);
  const invio = corpoFunzione("invia");
  assert.match(invio, /modoScelto === "steer"[\s\S]*?sessione\.modoCoda = "followUp"/);
});

test("la barra distingue la stima tariffaria dall'addebito OAuth", () => {
  const uso = corpoFunzione("testoUsoSessione");
  assert.match(uso, /VISTA_CORE\.presentaCosto\(costo, provider\)/);
  const barra = corpoFunzione("disegnaBarraStatoSessione");
  assert.match(barra, /input non in cache/);
  assert.match(barra, /sessione\.spiegazioneCosto/);
  const statistiche = corpoFunzione("mostraStatistiche");
  assert.match(statistiche, /Costo equivalente stimato/);
  assert.match(frontend, /mostraStatistiche\(statistiche, sessione\)/,
    "la risposta asincrona deve conservare la sessione che ha prodotto i dati");
  assert.match(frontend, /mostraStatistiche\(risultato, sessione\)/);
});

test("il pulsante Modello non usa il PointerEvent come filtro di ricerca", () => {
  assert.match(
    frontend,
    /DOM\.btnModello\.onclick\s*=\s*\(\)\s*=>\s*apriSceltaModello\(\)/,
  );
  assert.doesNotMatch(frontend, /DOM\.btnModello\.onclick\s*=\s*apriSceltaModello\s*;/);
});

test("le modali prendono subito il focus e i workflow tornano al composer", () => {
  const apertura = corpoFunzione("apriModale");
  assert.match(apertura, /sessioneAttiva\(\)\?\.invioInCorso/);
  assert.match(apertura, /composerDaRipristinare/);
  assert.match(apertura, /DOM\.modale\.focus\(\{ preventScroll: true \}\)/);
  const chiusura = corpoFunzione("chiudiModale");
  assert.match(chiusura, /stato\?\.precedente\?\.isConnected/);
});

test("share e login cancellabili usano operazioni stabili senza retry automatici", () => {
  const share = corpoFunzione("condividiSessione");
  assert.match(share, /preparaPasso\(["']share["']\)/);
  assert.match(share, /chiediOperazioneIdempotente/);
  assert.match(share, /PREFISSO_RISULTATI_OPERAZIONI/);

  const auth = corpoFunzione("mostraNotificaAutenticazione");
  assert.match(auth, /AUTH_FLOW\.loginCommandIdEvento\(evento\)/);
  assert.match(auth, /annullaLoginProvider/);
  const dialogo = corpoFunzione("mostraProssimoDialogoEstensione");
  assert.match(dialogo, /AUTH_FLOW\.loginCommandIdEvento\(evento\)/);
  assert.match(dialogo, /if \(risposta\.cancelled\) annullaAutenticazione\(\)/);
  const annulla = corpoFunzione("annullaLoginProvider");
  assert.match(annulla, /\/api\/annulla-login-provider/);
  assert.match(annulla, /loginProviderAnnullati\.has/,
    "chiusura, pulsante e timeout devono produrre una sola cancellazione");
  assert.doesNotMatch(annulla, /setTimeout|while\s*\(/,
    "la cancellazione auth non deve avere retry automatici");
});



function ambienteSalvataggioTema(chiedi) {
  const stato = { scelta: "caldo", confermata: "caldo", revisione: 0, pendenti: 0, coda: Promise.resolve() };
  const applicati = [];
  const ambiente = {
    TEMA_GUI: stato, chiedi,
    normalizzaSceltaTema: funzioneProva("normalizzaSceltaTema", "scelta", {}),
    applicaSceltaTema(scelta) { stato.scelta = scelta; applicati.push(scelta); },
  };
  return {
    stato, applicati,
    salva: funzioneProva("salvaSceltaTema", "scelta", ambiente),
    ricevi: funzioneProva("riceviTemaImpostazioni", "impostazioni, revisione", ambiente),
  };
}

test("la lettura del ponte fallita sblocca Aspetto sul ricordo locale senza dichiararlo confermato", async () => {
  for (const ricordo of ["caldo", "notte", "automatico"]) {
    const { creaNodo } = alberoProva();
    const corpo = creaNodo("div");
    const APP = { modale: {} };
    const richieste = [];
    const ambiente = {
      APP, DOM: { modalePiede: creaNodo("footer") }, crea: creaNodo,
      apriModale: () => corpo, sessioneAttiva: () => null,
      apriPannelloRuoliConsiglio: async () => {}, chiudiModale() {},
      testoErrore: (errore) => errore.message,
      bottoneAzione(testo, azione, classe) {
        const nodo = creaNodo("button", classe, testo);
        nodo.onclick = azione;
        return nodo;
      },
      chiedi: async (via) => { richieste.push(via); throw new Error("Ponte non raggiungibile"); },
    };
    const tema = ambienteSalvataggioTema(ambiente.chiedi);
    tema.stato.scelta = ricordo;
    // Una scelta applicata localmente può differire dall'ultima conferma ricevuta.
    tema.stato.confermata = ricordo === "notte" ? "caldo" : "notte";
    ambiente.montaAspettoImpostazioni = funzioneProva("montaAspettoImpostazioni", "corpo, modaleRichiesta", {
      ...ambiente, TEMA_GUI: tema.stato, riceviTemaImpostazioni: tema.ricevi, salvaSceltaTema: tema.salva,
    });
    await funzioneProva("apriImpostazioniGui", "", ambiente, true)();
    const sezione = corpo.querySelector(".aspetto-impostazioni");
    const radio = sezione.querySelectorAll("input");
    assert.deepEqual(radio.map((nodo) => nodo.value), ["caldo", "notte", "automatico"]);
    assert.ok(radio.every((nodo) => nodo.disabled === false), "il tema resta selezionabile senza ponte");
    assert.deepEqual(radio.filter((nodo) => nodo.checked).map((nodo) => nodo.value), [ricordo]);
    const stato = sezione.querySelectorAll("p").find((nodo) => nodo.getAttribute("role") === "status");
    assert.equal(stato.textContent, "Tema applicato localmente, non confermato dal ponte");
    assert.equal(stato.getAttribute("aria-live"), "polite");
    assert.equal(sezione.querySelector("h4")?.textContent, "Aspetto");
    assert.deepEqual(tema.applicati, [], "l'errore di lettura non sovrascrive la scelta locale");
    assert.deepEqual(richieste, ["/api/impostazioni"]);
    assert.ok(corpo.querySelectorAll("input").find((nodo) => nodo.type === "number").disabled,
      "la soglia del ponte resta disabilitata finché non viene letta");
    assert.ok(corpo.querySelectorAll("button").some((nodo) => nodo.textContent === "Riprova"));
  }
});

test("due scelte rapide del tema si applicano subito e si salvano nell'ordine senza ritorni al tema vecchio", async () => {
  const richieste = [];
  const risposte = [];
  const avviate = [Promise.withResolvers(), Promise.withResolvers()];
  const { stato, applicati, salva } = ambienteSalvataggioTema((via, opzioni) => {
    const indice = richieste.length;
    richieste.push({ via, corpo: opzioni.corpo });
    return new Promise((resolve) => { risposte.push(resolve); avviate[indice].resolve(); });
  });
  const prima = salva("notte");
  const seconda = salva("automatico");
  assert.equal(stato.scelta, "automatico", "la scelta è visibile prima della risposta del ponte");
  assert.deepEqual(applicati, ["notte", "automatico"]);
  await avviate[0].promise;
  assert.deepEqual(richieste, [{ via: "/api/impostazioni", corpo: { tema: "notte" } }]);
  risposte[0]({ tema: "notte" });
  await prima;
  await avviate[1].promise;
  assert.equal(stato.scelta, "automatico", "la risposta precedente non ripristina Notte");
  assert.deepEqual(applicati, ["notte", "automatico"]);
  risposte[1]({ tema: "automatico" });
  await seconda;
  assert.deepEqual(richieste.map((richiesta) => richiesta.corpo.tema), ["notte", "automatico"]);
  assert.equal(stato.scelta, "automatico");
  assert.equal(stato.confermata, "automatico");
  assert.equal(stato.pendenti, 0);
});

test("un errore di salvataggio del tema rilegge il ponte, ripristina se necessario e lascia utilizzabile la scelta successiva", async () => {
  for (const temaRiletto of ["notte", "caldo", null]) {
    const errore = new Error("Risposta del salvataggio persa");
    const richieste = [];
    let primoInvio = true;
    const { stato, salva } = ambienteSalvataggioTema(async (via, opzioni) => {
      richieste.push({ via, corpo: opzioni?.corpo });
      if (opzioni?.corpo) {
        if (primoInvio) { primoInvio = false; throw errore; }
        return { tema: opzioni.corpo.tema };
      }
      if (temaRiletto === null) throw new Error("Ponte non raggiungibile");
      return { tema: temaRiletto };
    });
    const salvataggio = salva("notte");
    assert.equal(stato.scelta, "notte");
    if (temaRiletto === "notte") assert.equal(await salvataggio, "notte", "una rilettura concorde conferma la scrittura");
    else await assert.rejects(salvataggio, (ricevuto) => ricevuto === errore);
    assert.equal(stato.scelta, temaRiletto === "notte" ? "notte" : "caldo");
    assert.equal(stato.confermata, stato.scelta);
    assert.equal(stato.pendenti, 0);
    assert.deepEqual(richieste, [
      { via: "/api/impostazioni", corpo: { tema: "notte" } },
      { via: "/api/impostazioni", corpo: undefined },
    ]);
    assert.equal(await salva("automatico"), "automatico", "l'errore precedente non blocca la coda");
    assert.equal(stato.scelta, "automatico");
    assert.equal(stato.pendenti, 0);
  }
});

test("una lettura delle impostazioni in ritardo non annulla una scelta locale più recente o pendente", () => {
  const { stato, applicati, ricevi } = ambienteSalvataggioTema(() => assert.fail("la ricezione non deve inviare richieste"));
  stato.scelta = "automatico";
  stato.revisione = 1;
  stato.pendenti = 1;
  ricevi({ tema: "notte" }, 0);
  ricevi({ tema: "notte" }, 1);
  assert.deepEqual(applicati, []);
  assert.equal(stato.scelta, "automatico");
  stato.pendenti = 0;
  ricevi({ tema: "notte" }, 0);
  assert.deepEqual(applicati, [], "una vecchia lettura resta vecchia dopo il salvataggio");
  ricevi({ tema: "notte" }, 1);
  assert.equal(stato.scelta, "notte", "una lettura corrente del ponte è la fonte di verità");
  assert.equal(stato.confermata, "notte");
  assert.deepEqual(applicati, ["notte"]);
});

function verificaGettoniTema(css) {
  const senzaCommenti = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocchi = [...senzaCommenti.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.ok(blocchi.length >= 2, "mancano i due blocchi dei gettoni");
  assert.equal(blocchi[0].index, 0, "i gettoni devono aprire il foglio di stile");
  assert.match(blocchi[0][1].trim(), /^:root\s*,\s*\[data-tema=["']notte["']\]$/,
    "il primo blocco unisce :root e il tema Notte");
  assert.match(blocchi[1][1].trim(), /^\[data-tema=["']caldo["']\]$/,
    "il secondo blocco contiene il tema Caldo");
  for (const blocco of blocchi.slice(0, 2)) {
    for (const dichiarazione of blocco[2].split(";").map((voce) => voce.trim()).filter(Boolean)) {
      assert.match(dichiarazione, /^--[\w-]+\s*:/, "i blocchi iniziali contengono soltanto gettoni");
    }
  }
  const resto = senzaCommenti.slice(blocchi[1].index + blocchi[1][0].length);
  assert.doesNotMatch(resto, /(?:^|[{},])\s*:root(?=[\s,{.:#\[])/,
    "nessun altro :root può sovrascrivere i gettoni in cascata");
  assert.doesNotMatch(resto, /(?:^|[}])\s*\[data-tema=["'](?:caldo|notte)["']\]\s*\{/,
    "ogni tema ha un solo blocco dei gettoni");
  const colore = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/i;
  // Il controllo legge valori CSS: un selettore ID non è un colore.
  for (const dichiarazione of resto.matchAll(/(?:^|[;{])\s*[\w-]+\s*:\s*([^;{}]*)/g)) {
    const letterale = dichiarazione[1].match(colore);
    assert.equal(letterale, null,
      "colore letterale fuori dai blocchi dei gettoni: " + (letterale?.[0] || ""));
  }
}

test("i colori CSS sono gettoni dichiarati soltanto nei due blocchi iniziali", () => {
  verificaGettoniTema(stile);
});

test("il contratto dei gettoni rileva colori fuori blocco in ogni sintassi", () => {
  const valido = ':root, [data-tema="notte"] { --fondo: #000000; }\n[data-tema="caldo"] { --fondo: #ffffff; }\n#abc { color: var(--testo); }';
  verificaGettoniTema(valido);
  for (const colore of ["#123456", "#abc", "#abcd", "#12345678", "rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "hsl(1 2% 3%)", "hsla(1, 2%, 3%, 0.5)"]) {
    assert.throws(() => verificaGettoniTema(valido + "\n.esca { color: " + colore + "; }"),
      /colore letterale fuori dai blocchi dei gettoni/);
    assert.throws(() => verificaGettoniTema(valido + "\n@media (width < 980px) { .esca { box-shadow: 0 0 2px " + colore + "; } }"),
      /colore letterale fuori dai blocchi dei gettoni/);
  }
  assert.throws(() => verificaGettoniTema(valido + "\n:root { --fondo: #123456; }"), /nessun altro :root/);
});

const PROTEZIONI_TESTI_TINTI = [
  ["#btn-modello .pillola-etichetta", "modello-testo-etichetta"],
  [".riga-conversazione.attiva .conversazione-stato", "testo-su-riempimento"],
  [".contesto-esteso-gpt .nota", "testo-su-riempimento"],
  [".contesto-esteso-gpt .nota-costo-contesto", "testo-su-riempimento"],
  [".cronologia-in-attesa .nota", "testo-su-riempimento"],
  [".esplora-riga:hover .esplora-cartella-testo small", "testo-su-riempimento"],
  [".esplora-riga.selezionata .esplora-cartella-testo small", "testo-su-riempimento"],
  [".voce.attiva .voce-testo small:not(.avviso-modello)", "voce-attiva-secondario"],
];

function verificaTestiSuFondiTinti(css, protezioni = []) {
  const blocchi = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const gettoniCaldo = new Map();
  const regole = new Map();
  for (const [, selettori, corpo] of blocchi) {
    const dichiarazioni = [...corpo.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]*)/g)]
      .map(([, nome, valore]) => [nome, valore.trim()]);
    if (/^\s*\[data-tema=["']caldo["']\]\s*$/.test(selettori)) {
      for (const [nome, valore] of dichiarazioni) gettoniCaldo.set(nome, valore);
    } else if (!selettori.includes(":root") && !selettori.includes("data-tema=")) {
      for (const selettore of selettori.split(",").map((voce) => voce.trim().replace(/\s+/g, " "))) {
        const regola = regole.get(selettore) || new Map();
        for (const [nome, valore] of dichiarazioni) regola.set(nome, valore);
        regole.set(selettore, regola);
      }
    }
  }
  function usaGettone(valore, cercati, visitati = new Set()) {
    for (const [, nome] of (valore || "").matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (cercati.has(nome)) return true;
      if (visitati.has(nome)) continue;
      visitati.add(nome);
      if (usaGettone(gettoniCaldo.get(nome), cercati, visitati)) return true;
    }
    return false;
  }
  const fondiTinti = new Set(["--selezione", "--verde-fondo", "--azzurro-fondo", "--ambra-fondo"]);
  const testiVietati = new Set(["--testo-debole", "--accento"]);
  const selettoriTinti = [...regole].filter(([, regola]) =>
    usaGettone(regola.get("background"), fondiTinti) || usaGettone(regola.get("background-color"), fondiTinti))
    .map(([selettore]) => selettore);
  // Contratto statico: selettori identici e discendenti espliciti, senza simulare DOM o media query.
  for (const [selettore, regola] of regole) {
    const suFondoTinto = selettoriTinti.some((fondo) => selettore === fondo
      || (selettore.startsWith(fondo) && /^[\s>.:#\[]/.test(selettore.slice(fondo.length))));
    if (suFondoTinto) assert.equal(usaGettone(regola.get("color"), testiVietati), false,
      "testo debole o accento su fondo tinto: " + selettore);
  }
  // Questi override proteggono anche i colori provenienti da selettori generici, come .nota.
  for (const [selettore, gettone] of protezioni) {
    assert.equal(regole.get(selettore)?.get("color"), "var(--" + gettone + ")",
      "manca la protezione del testo su fondo tinto: " + selettore);
    assert.equal(usaGettone(gettoniCaldo.get("--" + gettone), testiVietati), false,
      "la protezione del testo Caldo non deve risolvere a un colore vietato: " + gettone);
  }
}

test("i testi sui fondi tinti Caldo escludono testo debole e accento, anche tramite alias", () => {
  verificaTestiSuFondiTinti(stile, PROTEZIONI_TESTI_TINTI);
});

test("il contratto dei fondi tinti rileva blocchi separati, discendenti e override rimossi", () => {
  const alias = '[data-tema="caldo"] { --fondo-esca: var(--selezione); --testo-esca: var(--testo-debole); }\n';
  for (const fondo of ["selezione", "verde-fondo", "azzurro-fondo", "ambra-fondo", "fondo-esca"]) {
    for (const testo of ["testo-debole", "accento", "testo-esca"]) {
      for (const regole of [
        ".esca { background: var(--" + fondo + "); color: var(--" + testo + "); }",
        ".esca { color: var(--" + testo + "); } .esca { background-color: var(--" + fondo + "); }",
        ".esca { background: var(--" + fondo + "); } .esca small { color: var(--" + testo + "); }",
      ]) assert.throws(() => verificaTestiSuFondiTinti(alias + regole), /testo debole o accento su fondo tinto/);
    }
  }
  const corretto = alias + ".esca { background: var(--fondo-esca); } .esca small { color: var(--testo-debole); }"
    + " .esca small { color: var(--testo-tenue); }";
  verificaTestiSuFondiTinti(corretto);
  assert.throws(() => verificaTestiSuFondiTinti(corretto + " .esca small { color: var(--accento); }"),
    /testo debole o accento su fondo tinto/);
  for (const gettone of ["testo-su-riempimento", "voce-attiva-secondario", "modello-testo-etichetta"]) {
    const senzaProtezione = stile.replace(new RegExp("color:\\s*var\\(--" + gettone + "\\)\\s*;", "g"), "");
    assert.notEqual(senzaProtezione, stile, "la prova deve rimuovere un override esistente");
    assert.throws(() => verificaTestiSuFondiTinti(senzaProtezione, PROTEZIONI_TESTI_TINTI),
      /testo debole o accento su fondo tinto|manca la protezione del testo su fondo tinto/);
  }
});

function scriptTemaIniziale() {
  const foglio = elementiHtml.find((nodo) => nodo.tag === "link" && nodo.attributi.get("rel") === "stylesheet");
  assert.ok(foglio, "manca il foglio di stile");
  const script = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .find((candidato) => !attributi(candidato[1]).has("src") && candidato[2].includes("pi-gui-tema"));
  assert.ok(script, "manca lo script inline del ricordo del tema");
  const testa = html.match(/<head\b[^>]*>/i);
  assert.ok(script.index > testa.index && script.index < html.search(/<\/head>/i), "il tema iniziale si applica nel head");
  assert.ok(script.index + script[0].length < foglio.indice, "il tema si applica prima del foglio di stile");
  const attributiScript = attributi(script[1]);
  assert.equal(attributiScript.has("defer"), false);
  assert.equal(attributiScript.has("async"), false);
  assert.notEqual(attributiScript.get("type"), "module", "la prima pittura non deve attendere un modulo");
  return script[2];
}

test("il ricordo del tema si applica prima del CSS senza interrompere l'ordine di avvio", async () => {
  scriptTemaIniziale();
  const scriptEsterni = elementiHtml.filter((nodo) => nodo.tag === "script" && nodo.attributi.has("src"))
    .map((nodo) => nodo.attributi.get("src"));
  const indiceTema = scriptEsterni.indexOf("/tema-core.js");
  const indiceAvvio = scriptEsterni.indexOf("/startup-core.js");
  assert.ok(indiceTema >= 0 && indiceTema < indiceAvvio, "il modulo tema precede l'avvio del frontend");
  assert.equal(scriptEsterni[indiceAvvio + 1], "/app.js");
  assert.match(html, /<script src="\/startup-core\.js"><\/script>\s*<script src="\/app\.js"><\/script>/);
  const config = JSON.parse(await readFile(join(RADICE, "src-tauri/tauri.conf.json"), "utf8"));
  assert.equal(config.bundle.resources["../app/public/tema-core.js"], "app/public/tema-core.js");
});


function verificaFontiScriptCsp(csp, hash, nome) {
  assert.ok(csp, "manca la CSP del " + nome);
  const direttiveScript = csp.split(";").map((direttiva) => direttiva.trim().split(/\s+/))
    .filter(([direttiva]) => direttiva.toLowerCase() === "script-src");
  assert.equal(direttiveScript.length, 1, "la CSP del " + nome + " deve avere un solo script-src");
  assert.deepEqual(direttiveScript[0].slice(1).sort(), ["'self'", hash].sort(),
    "la CSP del " + nome + " deve autorizzare soltanto self e l'hash esatto dello script iniziale");
  assert.doesNotMatch(csp, /'unsafe-(?:inline|eval)'/i, "il tema non allarga la CSP del " + nome);
}

test("la CSP del ponte e del desktop autorizza soltanto self e l'hash dello script iniziale", async () => {
  const hash = "'sha256-" + createHash("sha256").update(scriptTemaIniziale().replace(/\r\n?/g, "\n")).digest("base64") + "'";
  const [server, config] = await Promise.all([
    readFile(join(RADICE, "app/server.mjs"), "utf8"),
    readFile(join(RADICE, "src-tauri/tauri.conf.json"), "utf8").then(JSON.parse),
  ]);
  const cspPonte = server.match(/"content-security-policy":\s*"([^"]*)"/)?.[1];
  for (const [nome, csp] of [["ponte", cspPonte], ["desktop", config.app.security.csp]]) {
    verificaFontiScriptCsp(csp, hash, nome);
  }
});

test("il contratto CSP respinge fonti script aggiuntive, mancanti e direttive duplicate", () => {
  const hash = "'sha256-esempio'";
  const valida = "default-src 'self'; script-src 'self' " + hash;
  verificaFontiScriptCsp(valida, hash, "esempio");
  verificaFontiScriptCsp("script-src " + hash + " 'self';", hash, "ordine inverso");
  for (const fonte of ["https://esempio.invalid", "*", "'sha256-altro'", "'self'", hash]) {
    assert.throws(() => verificaFontiScriptCsp(valida + " " + fonte, hash, "fonte aggiunta"),
      /deve autorizzare soltanto self e l'hash esatto/);
  }
  assert.throws(() => verificaFontiScriptCsp("script-src " + hash, hash, "self assente"),
    /deve autorizzare soltanto self e l'hash esatto/);
  for (const duplicata of ["script-src 'none'", "SCRIPT-SRC 'self' " + hash, "script-src"]) {
    assert.throws(() => verificaFontiScriptCsp(valida + "; " + duplicata, hash, "direttiva duplicata"),
      /deve avere un solo script-src/);
  }
});

test("la prima pittura rispetta ricordo, schema di sistema e storage indisponibile", () => {
  const sorgente = scriptTemaIniziale();
  for (const [scelta, scuro, atteso] of [
    [null, false, "caldo"], [null, true, "caldo"],
    ["caldo", true, "caldo"], ["notte", false, "notte"],
    ["automatico", false, "caldo"], ["automatico", true, "notte"],
    ["sconosciuto", true, "caldo"],
  ]) {
    const radice = { dataset: {}, style: {}, setAttribute(nome, valore) { this.dataset[nome.slice(5)] = valore; } };
    radice.style.setProperty = (nome, valore) => { radice.style[nome === "color-scheme" ? "colorScheme" : nome] = valore; };
    const document = { documentElement: radice };
    const localStorage = { "pi-gui-tema": scelta, getItem: (chiave) => chiave === "pi-gui-tema" ? scelta : null };
    const matchMedia = (query) => { assert.equal(query, "(prefers-color-scheme: dark)"); return { matches: scuro }; };
    new Function("document", "localStorage", "matchMedia", "window", sorgente)(document, localStorage, matchMedia, { document, localStorage, matchMedia });
    assert.equal(radice.dataset.tema, atteso, "ricordo " + scelta + ", sistema " + (scuro ? "scuro" : "chiaro"));
  }
  const radice = { dataset: {}, style: {}, setAttribute(nome, valore) { this.dataset[nome.slice(5)] = valore; } };
  radice.style.setProperty = (nome, valore) => { radice.style[nome === "color-scheme" ? "colorScheme" : nome] = valore; };
  const document = { documentElement: radice };
  const localStorage = new Proxy({}, { get() { throw new Error("storage non disponibile"); } });
  const matchMedia = () => ({ matches: true });
  assert.doesNotThrow(() => new Function("document", "localStorage", "matchMedia", "window", sorgente)(document, localStorage, matchMedia, { document, localStorage, matchMedia }));
  assert.equal(radice.dataset.tema, "caldo", "senza storage il tema predefinito resta applicabile");
});

test("il nuovo tema continua a stilizzare i nodi creati dinamicamente da app.js", () => {
  for (const classe of [
    "riga-conversazione",
    "conversazione-voce",
    "msg",
    "msg-chi",
    "msg-corpo",
    "utente",
    "agente",
    "strumento",
    "voce",
  ]) {
    assert.match(stile, new RegExp(`\\.${classe}(?:[^\\w-]|$)`),
      `stile.css non copre piu la classe dinamica .${classe}`);
  }
});

test("gli identificativi statici nuovi del consiglio sono unici e usati", () => {
  const idHtml = elementiHtml
    .map((elemento) => elemento.attributi.get("id"))
    .filter(Boolean);
  for (const id of ["fascia-consiglio"]) {
    assert.equal(
      idHtml.filter((candidato) => candidato === id).length,
      1,
      `#${id} deve comparire una volta sola in index.html`,
    );
  }
  assert.match(frontend, /fasciaConsiglio: \$\("#fascia-consiglio"\)/);
  assert.match(frontend, /DOM\.fasciaConsiglio\.replaceChildren\(\)/);
  assert.equal(elementoConId("btn-consiglio"), undefined);
  assert.equal(elementoConId("btn-agenti"), undefined, "il pulsante diviso appartiene al montaggio P2");
  assert.match(frontend, /PiGuiAgentiCore\?\.montaAgenti\?\.\(DOM\.composerShell,/);
  assert.match(html, /src="\/agenti-core\.js"/);

  const fascia = elementoConId("fascia-consiglio");
  assert.equal(fascia.attributi.get("aria-live"), "polite");
  assert.equal(fascia.attributi.get("role"), "status");
  assert.ok(fascia.attributi.has("hidden"), "la fascia del consiglio nasce nascosta");

  assert.match(html, /<script src="\/consiglio-core\.js"><\/script>/);
  const ordine = html.indexOf('src="/consiglio-core.js"');
  assert.ok(ordine !== -1 && ordine < html.indexOf('src="/app.js"'),
    "il modulo del consiglio va caricato prima del frontend");

  for (const classe of [
    "fascia-consiglio",
    "fascia-consiglio-riga",
    "conversazione-stato",
    "consiglio-pannello",
    "consiglio-sezione",
    "consiglio-tabella",
    "consiglio-azioni",
    "consiglio-motivo",
    "consiglio-avviso",
    "consiglio-elenco",
    "consiglio-testo",
    "consiglio-ruoli-riga",
    "consiglio-consenso",
    "consiglio-comando",
    "consiglio-stato",
    "consiglio-nota",
  ]) {
    assert.match(stile, new RegExp(`\.${classe}(?:[^\w-]|$)`),
      `stile.css non copre la classe dinamica .${classe}`);
    assert.ok(frontend.includes(classe), `app.js non usa più la classe .${classe}`);
  }
});
